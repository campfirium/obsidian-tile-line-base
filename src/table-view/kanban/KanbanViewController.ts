import type { SortableEvent } from 'sortablejs';
import type { RowData } from '../../grid/GridAdapter';
import type { KanbanRuntimeCardContent } from '../../types/kanban';
import { FilterDataProcessor } from '../filter/FilterDataProcessor';
import type { TableView } from '../../TableView';
import { buildKanbanBoardState, type KanbanBoardState, type KanbanLane } from './KanbanDataBuilder';
import { globalQuickFilterManager } from '../filter/GlobalQuickFilterManager';
import { t } from '../../i18n';

type SortableStatic = typeof import('sortablejs');
type SortableInstance = ReturnType<SortableStatic['create']>;

interface KanbanViewControllerOptions {
	view: TableView;
	container: HTMLElement;
	laneField: string;
	sortField: string | null;
	fallbackLaneName: string;
	primaryField: string | null;
	content: KanbanRuntimeCardContent;
	enableDrag: boolean;
}

interface RowUpdate {
	lane?: string;
	sort?: string;
}

export class KanbanViewController {
	private readonly view: TableView;
	private readonly laneField: string;
	private readonly sortField: string | null;
	private readonly fallbackLaneName: string;
	private readonly primaryField: string | null;
	private readonly content: KanbanRuntimeCardContent;
	private readonly enableDrag: boolean;

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

	constructor(options: KanbanViewControllerOptions) {
		this.view = options.view;
		this.laneField = options.laneField;
		this.sortField = options.sortField;
		this.fallbackLaneName = options.fallbackLaneName;
		this.primaryField = options.primaryField;
		this.content = options.content;
		this.enableDrag = options.enableDrag;
		this.dragAvailable = this.enableDrag;

		this.recomputeVisibleRows();
		this.quickFilterValue = globalQuickFilterManager.getValue();

		this.rootEl = options.container.createDiv({ cls: 'tlb-kanban-root' });
		this.messageEl = this.rootEl.createDiv({ cls: 'tlb-kanban-message' });
		this.boardEl = this.rootEl.createDiv({ cls: 'tlb-kanban-board', attr: { role: 'list' } });

		this.registerListeners();
		this.ensureSortableLoaded();
		this.renderBoard();
	}

	destroy(): void {
		this.unsubscribeFilter?.();
		this.unsubscribeFilter = null;
		this.unsubscribeQuickFilter?.();
		this.unsubscribeQuickFilter = null;
		this.destroySortables();
		this.rootEl.empty();
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
		this.ensureSortableLoaded();
		this.destroySortables();
		this.boardEl.empty();
		this.boardEl?.setAttribute('aria-busy', 'true');

		const state = this.buildState();
		this.renderMessage(state);

		if (state.totalCards === 0) {
			this.renderEmptyState();
			this.boardEl?.removeAttribute('aria-busy');
			return;
		}

		for (const lane of state.lanes) {
			this.renderLane(lane);
		}
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
		return buildKanbanBoardState({
			rows: this.visibleRows,
			laneField: this.laneField,
			sortField: this.sortField,
			fallbackLane: this.fallbackLaneName,
			primaryField: this.primaryField,
			content: this.content,
			quickFilter: this.quickFilterValue,
			resolveRowIndex: (row) => this.view.dataStore.getBlockIndexFromRow(row)
		});
	}

	private renderMessage(_state: KanbanBoardState): void {
		this.messageEl.empty();
		this.messageEl.toggleAttribute('hidden', true);
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

		const count = header.createSpan({ cls: 'tlb-kanban-lane__count' });
		count.setText(String(lane.cards.length));
		count.setAttribute('aria-label', t('kanbanView.laneCountLabel', { count: String(lane.cards.length) }));

		const cardsContainer = laneEl.createDiv({
			cls: 'tlb-kanban-lane__cards',
			attr: {
				'data-lane-id': lane.id,
				'data-lane-name': lane.name
			}
		});

		if (lane.cards.length === 0) {
			const placeholder = cardsContainer.createDiv({ cls: 'tlb-kanban-lane__placeholder' });
			placeholder.setText(t('kanbanView.emptyLanePlaceholder'));
		}

		for (const card of lane.cards) {
			this.renderCard(cardsContainer, card);
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

		const titleEl = cardEl.createDiv({ cls: 'tlb-kanban-card__title' });
		const trimmedTitle = card.title.trim();
		const titleText = trimmedTitle.length > 0 ? trimmedTitle : t('kanbanView.untitledCardFallback');
		titleEl.setText(titleText);

		const ariaSegments: string[] = [titleText];
		const bodyText = card.body.trim();
		if (bodyText.length > 0) {
			if (this.content.showBody) {
				const bodyEl = cardEl.createDiv({ cls: 'tlb-kanban-card__body' });
				bodyEl.setText(bodyText);
			} else {
				const tooltip = (titleText + (bodyText.length > 0 ? '\n' + bodyText : '')).trim();
				cardEl.setAttribute('title', tooltip);
			}
			ariaSegments.push(bodyText);
		}

		if (card.tags.length > 0) {
			const tagsEl = cardEl.createDiv({ cls: 'tlb-kanban-card__tags' });
			for (const tag of card.tags) {
				const trimmedTag = tag.trim();
				if (!trimmedTag) {
					continue;
				}
				ariaSegments.push(trimmedTag);
				tagsEl.createSpan({ cls: 'tlb-kanban-card__tag', text: trimmedTag });
			}
		}

		cardEl.setAttribute('aria-label', ariaSegments.join(' ? '));
	}


	private handleDragEnd(event: SortableEvent): void {
		if (!this.dragAvailable) {
			return;
		}
		const itemEl = event.item as HTMLElement | null;
		const targetEl = event.to as HTMLElement | null;
		if (!itemEl || !targetEl) {
			this.renderBoard();
			return;
		}
		const rowIndex = parseInt(itemEl.dataset.rowIndex ?? '', 10);
		if (!Number.isInteger(rowIndex)) {
			this.renderBoard();
			return;
		}

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
			if (!laneEl || processed.has(laneEl)) {
				continue;
			}
			processed.add(laneEl);
			const laneName = laneEl.dataset.laneName ?? this.fallbackLaneName;
			const cardEls = Array.from(laneEl.querySelectorAll<HTMLElement>('.tlb-kanban-card'));
			cardEls.forEach((cardEl, index) => {
				const blockIndex = parseInt(cardEl.dataset.rowIndex ?? '', 10);
				if (!Number.isInteger(blockIndex)) {
					return;
				}
				const record = updates.get(blockIndex) ?? {};
				if (this.sortField) {
					record.sort = String(index + 1);
				}
				if (laneEl === targetEl && blockIndex === rowIndex) {
					record.lane = laneName;
				}
				updates.set(blockIndex, record);
			});
		}

		this.applyUpdates(updates, rowIndex);
	}

	private applyUpdates(updates: Map<number, RowUpdate>, focusRowIndex: number): void {
		const targets = [];
		for (const [rowIndex, change] of updates.entries()) {
			const fields: string[] = [];
			if (typeof change.lane === 'string') {
				fields.push(this.laneField);
			}
			if (this.sortField && typeof change.sort === 'string') {
				fields.push(this.sortField);
			}
			if (fields.length > 0) {
				targets.push({ index: rowIndex, fields });
			}
		}
		if (targets.length === 0) {
			this.renderBoard();
			return;
		}

		this.isApplyingMutation = true;
		const recorded = this.view.historyManager.captureCellChanges(
			targets,
			() => {
				for (const [rowIndex, change] of updates.entries()) {
					const block = this.view.blocks[rowIndex];
					if (!block) {
						continue;
					}
					if (typeof change.lane === 'string') {
						block.data[this.laneField] = change.lane;
					}
					if (this.sortField && typeof change.sort === 'string') {
						block.data[this.sortField] = change.sort;
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
		}
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
