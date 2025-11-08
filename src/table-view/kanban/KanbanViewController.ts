import type { SortableEvent } from 'sortablejs';
import type { RowData } from '../../grid/GridAdapter';
import { FilterDataProcessor } from '../filter/FilterDataProcessor';
import type {
	KanbanCardContentConfig,
	KanbanHeightMode,
	KanbanRuntimeCardContent,
	KanbanSortDirection
} from '../../types/kanban';
import { sanitizeKanbanHeightMode } from './kanbanHeight';
import { sanitizeKanbanLaneWidth } from './kanbanWidth';
import type { TableView } from '../../TableView';
import { buildKanbanBoardState, type KanbanBoardState, type KanbanLane } from './KanbanDataBuilder';
import { toRuntimeContent } from './KanbanCardContent';
import { KanbanViewportManager } from './KanbanViewportManager';
import { globalQuickFilterManager } from '../filter/GlobalQuickFilterManager';
import { t } from '../../i18n';
import { KanbanTooltipManager } from './KanbanTooltipManager';
import { resolveExpectedStatusLanes } from './statusLaneHelpers';
import { prepareLaneUpdates, type RowUpdate } from './KanbanLaneMutation';

type SortableStatic = typeof import('sortablejs');
type SortableInstance = ReturnType<SortableStatic['create']>;

interface KanbanViewControllerOptions {
	view: TableView;
	container: HTMLElement;
	laneField: string;
	laneWidth: number;
	sortField: string | null;
	fallbackLaneName: string;
	primaryField: string | null;
	displayFields: string[];
	heightMode: KanbanHeightMode;
	initialVisibleCount: number;
	enableDrag: boolean;
	contentConfig: KanbanCardContentConfig | null;
}

export class KanbanViewController {
	private readonly view: TableView;
	private readonly container: HTMLElement;
	private readonly laneField: string;
	private readonly sortField: string | null;
	private readonly fallbackLaneName: string;
	private readonly primaryField: string | null;
	private readonly displayFields: string[];
	private readonly enableDrag: boolean;
	private readonly laneWidth: number;
	private readonly initialVisibleCount: number;
	private readonly rawContentConfig: KanbanCardContentConfig | null;
	private readonly viewportManager: KanbanViewportManager;
	private cardContent!: KanbanRuntimeCardContent;
	private expandedLanes = new Set<string>();
	private heightMode: KanbanHeightMode;

	private readonly rootEl: HTMLElement;
	private readonly messageEl: HTMLElement;
	private boardEl: HTMLElement | null = null;

	private visibleRows: RowData[] = [];
	private quickFilterValue = '';
	private unsubscribeFilter: (() => void) | null = null;
	private unsubscribeQuickFilter: (() => void) | null = null;
	private sortables = new Map<string, SortableInstance>();
	private isApplyingMutation = false;
	private dragAvailable: boolean;
	private sortableClass: SortableStatic | null = null;
	private sortableLoadAttempted = false;
	private sortableLoadPromise: Promise<SortableStatic | null> | null = null;
	private tooltipManager = new KanbanTooltipManager();

	constructor(options: KanbanViewControllerOptions) {
		this.view = options.view;
		this.container = options.container;
		this.laneField = options.laneField;
		this.sortField = options.sortField;
		this.fallbackLaneName = options.fallbackLaneName;
		this.primaryField = options.primaryField;
		this.displayFields = options.displayFields;
		this.enableDrag = options.enableDrag;
		this.laneWidth = sanitizeKanbanLaneWidth(options.laneWidth);
		this.heightMode = sanitizeKanbanHeightMode(options.heightMode);
		const limit = Math.floor(options.initialVisibleCount ?? 1);
		this.initialVisibleCount = Math.max(1, limit);
		this.rawContentConfig = options.contentConfig ?? null;
		this.viewportManager = new KanbanViewportManager({ container: this.container });
		this.cardContent = toRuntimeContent(this.rawContentConfig, {
			availableFields: this.getAvailableFields(),
			laneField: this.laneField
		});
		this.dragAvailable = this.enableDrag;

		this.recomputeVisibleRows();
		this.quickFilterValue = globalQuickFilterManager.getValue();

		this.rootEl = this.container.createDiv({ cls: 'tlb-kanban-root' });
		this.messageEl = this.rootEl.createDiv({ cls: 'tlb-kanban-message' });
		this.boardEl = this.rootEl.createDiv({ cls: 'tlb-kanban-board', attr: { role: 'list' } });
		this.boardEl.style.setProperty('--tlb-kanban-lane-width', `${this.laneWidth}rem`);

		this.viewportManager.apply(this.heightMode);
		this.registerListeners();
		this.ensureSortableLoaded();
		this.renderBoard();
	}

	destroy(): void {
		this.tooltipManager.destroy();
		this.unsubscribeFilter?.();
		this.unsubscribeFilter = null;
		this.unsubscribeQuickFilter?.();
		this.unsubscribeQuickFilter = null;
		this.viewportManager.dispose();
		this.destroySortables();
		this.rootEl.empty();
	}

	public setHeightMode(mode: KanbanHeightMode): void {
		const normalized = sanitizeKanbanHeightMode(mode);
		if (this.heightMode === normalized) {
			return;
		}
		this.heightMode = normalized;
		this.viewportManager.apply(this.heightMode);
	}

	private registerListeners(): void {
		this.unsubscribeFilter = this.view.filterOrchestrator.addVisibleRowsListener(() => {
			this.recomputeVisibleRows();
			if (!this.isApplyingMutation) {
				this.renderBoard();
			}
		});
		this.unsubscribeQuickFilter = globalQuickFilterManager.subscribe((value) => {
			this.quickFilterValue = value ?? '';
			this.renderBoard();
		});
	}
		private recomputeVisibleRows(): void {
		this.visibleRows = this.applyBoardFilter(this.view.filterOrchestrator.getAllRows());
	}
		private applyBoardFilter(rows: RowData[]): RowData[] {
		const rule = this.view.activeKanbanBoardFilter;
		if (!rule) {
			return rows;
		}
		try {
			return FilterDataProcessor.applyFilterRule(rows, rule);
		} catch {
			return rows;
		}
	}

	private renderBoard(): void {
		if (!this.boardEl || !this.boardEl.isConnected) {
			return;
		}
		this.tooltipManager.hide();
		this.ensureSortableLoaded();
		this.destroySortables();
		this.boardEl.empty();
		this.boardEl?.setAttribute('aria-busy', 'true');

		const state = this.buildState();
		this.messageEl.empty();
		this.messageEl.toggleAttribute('hidden', true);

		const laneIds = new Set(state.lanes.map((lane) => lane.id));
		for (const id of Array.from(this.expandedLanes)) {
			if (!laneIds.has(id)) {
				this.expandedLanes.delete(id);
			}
		}
		for (const lane of state.lanes) {
			if (lane.cards.length <= this.initialVisibleCount && this.expandedLanes.has(lane.id)) {
				this.expandedLanes.delete(lane.id);
			}
		}

		if (state.totalCards === 0) {
			this.renderEmptyState();
			this.viewportManager.refresh(this.heightMode);
			this.boardEl?.removeAttribute('aria-busy');
			return;
		}

		for (const lane of state.lanes) {
			this.renderLane(lane);
		}
		this.viewportManager.refresh(this.heightMode);
		this.boardEl?.removeAttribute('aria-busy');
	}

	private ensureSortableLoaded(): void {
		if (
			!this.enableDrag ||
			this.sortableClass ||
			this.sortableLoadPromise ||
			this.sortableLoadAttempted
		) {
			return;
		}
		this.sortableLoadAttempted = true;
		this.sortableLoadPromise = this.loadSortable()
			.then((sortable) => {
				this.sortableClass = sortable;
				if (!this.sortableClass) {
					this.dragAvailable = false;
				}
				this.sortableLoadPromise = null;
				if (this.boardEl && this.boardEl.isConnected) {
					this.renderBoard();
				}
				return this.sortableClass;
			});
	}

	private async loadSortable(): Promise<SortableStatic | null> {
		try {
			const module = (await import('sortablejs')) as unknown;
			const sortable = this.normalizeSortable(module);
			if (sortable) {
				return sortable;
			}
		} catch (error) {
			console.warn(
				'[TileLineBase] Failed to load sortablejs for kanban drag interactions.',
				error
			);
		}
		return null;
	}

	private normalizeSortable(candidate: unknown): SortableStatic | null {
		if (typeof candidate === 'function') {
			const sortable = candidate as SortableStatic;
			if (typeof sortable.create === 'function') {
				return sortable;
			}
		}
		if (
			candidate &&
			typeof candidate === 'object' &&
			'default' in candidate &&
			typeof (candidate as { default: unknown }).default === 'function'
		) {
			const sortable = (candidate as { default: unknown }).default as SortableStatic;
			if (sortable && typeof sortable.create === 'function') {
				return sortable;
			}
		}
		return null;
	}

	private buildState(): KanbanBoardState {
		const availableFields = this.getAvailableFields();
		this.cardContent = toRuntimeContent(this.rawContentConfig, {
			availableFields,
			laneField: this.laneField
		});
		const sortDirection: KanbanSortDirection =
			this.view.kanbanSortDirection === 'desc' ? 'desc' : 'asc';
		const expectedLaneNames = resolveExpectedStatusLanes({
			laneField: this.laneField,
			filterRule: this.view.activeKanbanBoardFilter
		});
		return buildKanbanBoardState({
			rows: this.visibleRows,
			laneField: this.laneField,
			sortField: this.sortField,
			sortDirection,
			fallbackLane: this.fallbackLaneName,
			primaryField: this.primaryField,
			content: this.cardContent,
			displayFields: availableFields,
			quickFilter: this.quickFilterValue,
			resolveRowIndex: (row) => this.view.dataStore.getBlockIndexFromRow(row),
			expectedLaneNames
		});
	}

	private getAvailableFields(): string[] {
		const result: string[] = [];
		const seen = new Set<string>();
		for (const field of this.displayFields) {
			if (typeof field !== 'string') {
				continue;
			}
			const trimmed = field.trim();
			if (!trimmed || trimmed === '#' || seen.has(trimmed)) {
				continue;
			}
			seen.add(trimmed);
			result.push(trimmed);
		}
		const laneField = typeof this.laneField === 'string' ? this.laneField.trim() : '';
		if (laneField && !seen.has(laneField)) {
			seen.add(laneField);
			result.push(laneField);
		}
		return result;
	}


	private renderEmptyState(): void {
		if (!this.boardEl) {
			return;
		}
		const empty = this.boardEl.createDiv({ cls: 'tlb-kanban-empty' });
		const icon = empty.createSpan({ cls: 'tlb-kanban-empty__icon' });
		icon.setText('📋');
		const label = empty.createSpan({ cls: 'tlb-kanban-empty__label' });
		label.setText(
			this.quickFilterValue.trim().length > 0
				? t('kanbanView.emptyStateFiltered')
				: t('kanbanView.emptyState')
		);
	}

	private renderLane(lane: KanbanLane): void {
		if (!this.boardEl) {
			return;
		}

		const laneEl = this.boardEl.createDiv({
			cls: 'tlb-kanban-lane',
			attr: {
				role: 'listitem',
				'data-lane-id': lane.id,
				'data-lane-name': lane.name
			}
		});

		const header = laneEl.createDiv({ cls: 'tlb-kanban-lane__header' });
		const title = header.createSpan({ cls: 'tlb-kanban-lane__title' });
		title.setText(lane.name);

		const totalCards = lane.cards.length;
		const count = header.createSpan({ cls: 'tlb-kanban-lane__count' });
		count.setText(String(totalCards));
		count.setAttribute('aria-label', t('kanbanView.laneCountLabel', { count: String(totalCards) }));

		const cardsContainer = laneEl.createDiv({
			cls: 'tlb-kanban-lane__cards',
			attr: {
				'data-lane-id': lane.id,
				'data-lane-name': lane.name
			}
		});

		if (totalCards === 0) {
			const placeholder = cardsContainer.createDiv({ cls: 'tlb-kanban-lane__placeholder' });
			placeholder.setText(t('kanbanView.emptyLanePlaceholder'));
		} else {
			const expanded = this.expandedLanes.has(lane.id);
			const limit = this.initialVisibleCount;
			const visibleCards = !expanded && totalCards > limit ? lane.cards.slice(0, limit) : lane.cards;
			const hiddenCount = expanded ? 0 : Math.max(0, totalCards - visibleCards.length);

			for (const card of visibleCards) {
				this.renderCard(cardsContainer, card);
			}

			if (hiddenCount > 0) {
				const button = cardsContainer.createEl('button', {
					cls: 'tlb-kanban-lane__load-more',
					attr: { type: 'button' }
				});
				const label = t('kanbanView.showAllButtonLabel', { count: String(hiddenCount) });
				button.setText(label);
				button.setAttribute('aria-label', label);
				button.addEventListener('click', (event) => {
					event.preventDefault();
					event.stopPropagation();
					this.expandedLanes.add(lane.id);
					this.renderBoard();
				});
			}
		}

		if (this.dragAvailable && this.sortableClass) {
			const sortable = this.sortableClass.create(cardsContainer, {
				group: 'tlb-kanban-board',
				animation: 160,
				ghostClass: 'tlb-kanban-card--ghost',
				dragClass: 'tlb-kanban-card--dragging',
				handle: '.tlb-kanban-card',
				draggable: '.tlb-kanban-card',
				dataIdAttr: 'data-row-index',
				fallbackOnBody: true,
				forceFallback: false,
				onEnd: (event: SortableEvent) => {
					this.handleDragEnd(event);
				}
			});
			this.sortables.set(lane.id, sortable);
		}
	}

	private renderCard(container: HTMLElement, card: KanbanLane['cards'][number]): void {
		const cardEl = container.createDiv({
			cls: 'tlb-kanban-card',
			attr: {
				'data-row-index': String(card.rowIndex),
				'data-card-id': card.id,
				'data-lane-name': card.rawLane
			}
		});
		cardEl.setAttribute('tabindex', '0');

		const title = cardEl.createDiv({ cls: 'tlb-kanban-card__title' });
		const titleText = title.createSpan({ cls: 'tlb-kanban-card__title-text' });
		const trimmedTitle = card.title.trim();
		titleText.setText(trimmedTitle.length > 0 ? trimmedTitle : t('kanbanView.untitledCardFallback'));
		if (!this.cardContent.tagsBelowBody && card.tags.length > 0) {
			const tagsInline = title.createSpan({
				cls: 'tlb-kanban-card__tags tlb-kanban-card__tags--inline'
			});
			this.renderTags(tagsInline, card.tags);
		}

		const bodyText = card.body.trim();
		const showBody = this.cardContent.showBody && bodyText.length > 0;
		if (!showBody && bodyText.length > 0) {
			cardEl.addClass('tlb-kanban-card--tooltip');
			this.tooltipManager.register(cardEl, bodyText);
		} else {
			cardEl.removeClass('tlb-kanban-card--tooltip');
			this.tooltipManager.unregister(cardEl);
		}
		if (showBody) {
			const bodyEl = cardEl.createDiv({ cls: 'tlb-kanban-card__body' });
			bodyEl.setText(bodyText);
		}

		if (card.tags.length > 0 && this.cardContent.tagsBelowBody) {
			const tagsBlock = cardEl.createDiv({
				cls: 'tlb-kanban-card__tags tlb-kanban-card__tags--block'
			});
			this.renderTags(tagsBlock, card.tags);
		}

		cardEl.toggleClass('tlb-kanban-card--compact', !showBody);

		if (card.fields.length > 0) {
			const fieldsEl = cardEl.createDiv({ cls: 'tlb-kanban-card__fields' });
			for (const field of card.fields.slice(0, 6)) {
				const fieldRow = fieldsEl.createDiv({ cls: 'tlb-kanban-card__field' });
				const nameEl = fieldRow.createSpan({ cls: 'tlb-kanban-card__field-name' });
				nameEl.setText(field.name);
				const valueEl = fieldRow.createSpan({ cls: 'tlb-kanban-card__field-value' });
				valueEl.setText(field.value);
			}
			if (card.fields.length > 6) {
				const more = fieldsEl.createDiv({ cls: 'tlb-kanban-card__field-more' });
				more.setText(t('kanbanView.moreFieldsLabel', { count: String(card.fields.length - 6) }));
			}
		}
	}

	private renderTags(container: HTMLElement, tags: string[]): void {
		for (const tag of tags) {
			const tagEl = container.createSpan({ cls: 'tlb-kanban-card__tag' });
			tagEl.setText(tag);
		}
	}

	private handleDragEnd(event: SortableEvent): void {
		if (!this.dragAvailable) { return; }
		const itemEl = event.item as HTMLElement | null;
		const targetEl = event.to as HTMLElement | null;
		if (!itemEl || !targetEl) { this.renderBoard(); return; }
		const rowIndex = parseInt(itemEl.dataset.rowIndex ?? '', 10);
		if (!Number.isInteger(rowIndex)) { this.renderBoard(); return; }

		const targetLaneName = targetEl.dataset.laneName ?? this.fallbackLaneName;
		itemEl.dataset.laneName = targetLaneName;

		const updates = new Map<number, RowUpdate>();
		const processed = new Set<HTMLElement>();
		const lanesToProcess: HTMLElement[] = [];
		lanesToProcess.push(targetEl);
		const fromEl = event.from as HTMLElement | null;
		if (fromEl && fromEl !== targetEl) {
			lanesToProcess.push(fromEl);
		}

		for (const laneEl of lanesToProcess) {
			if (!laneEl || processed.has(laneEl)) { continue; }
			processed.add(laneEl);
			const laneName = laneEl.dataset.laneName ?? this.fallbackLaneName;
			const cardEls = Array.from(laneEl.querySelectorAll<HTMLElement>('.tlb-kanban-card'));
			cardEls.forEach((cardEl, _index) => {
				const blockIndex = parseInt(cardEl.dataset.rowIndex ?? '', 10);
				if (!Number.isInteger(blockIndex)) { return; }
				const record = updates.get(blockIndex) ?? {};
				if (laneEl === targetEl && blockIndex === rowIndex) {
					record.lane = laneName;
				}
				updates.set(blockIndex, record);
			});
		}

		this.applyUpdates(updates, rowIndex);
	}

	private applyUpdates(updates: Map<number, RowUpdate>, focusRowIndex: number): void {
		const { targets, normalized } = prepareLaneUpdates(this.view, this.laneField, updates);
		if (targets.length === 0) {
			this.renderBoard();
			return;
		}

		this.isApplyingMutation = true;
		const recorded = this.view.historyManager.captureCellChanges(
			targets,
			() => {
				for (const [rowIndex, change] of normalized.entries()) {
					const block = this.view.blocks[rowIndex];
					if (!block) { continue; }
					block.data[this.laneField] = change.lane;
					if (typeof change.statusTimestamp === 'string') {
						block.data['statusChanged'] = change.statusTimestamp;
					}
				}
			},
			() => ({
				undo: { rowIndex: focusRowIndex, field: this.laneField },
				redo: { rowIndex: focusRowIndex, field: this.laneField }
			})
		);
		this.isApplyingMutation = false;

		if (!recorded) {
			this.renderBoard();
			return;
		}

		this.view.filterOrchestrator?.refresh();
		this.view.persistenceService?.scheduleSave();
	}

	private destroySortables(): void {
		if (this.sortables.size === 0) {
			return;
		}
		for (const sortable of this.sortables.values()) {
			try {
				sortable.destroy();
			} catch {
				// noop
			}
		}
		this.sortables.clear();
	}
}
