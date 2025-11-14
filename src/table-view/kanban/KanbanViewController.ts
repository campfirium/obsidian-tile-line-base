import type { SortableEvent } from 'sortablejs';
import type { RowData } from '../../grid/GridAdapter';
import { FilterDataProcessor } from '../filter/FilterDataProcessor';
import type {
	KanbanCardContentConfig,
	KanbanHeightMode,
	KanbanRuntimeCardContent,
	KanbanSortDirection
} from '../../types/kanban';
import { sanitizeKanbanFontScale } from '../../types/kanban';
import { sanitizeKanbanHeightMode } from './kanbanHeight';
import { sanitizeKanbanLaneWidth } from './kanbanWidth';
import type { TableView } from '../../TableView';
import { buildKanbanBoardState, type KanbanBoardState, type KanbanLane } from './KanbanDataBuilder';
import { toRuntimeContent } from './KanbanCardContent';
import { KanbanViewportManager } from './KanbanViewportManager';
import { globalQuickFilterManager } from '../filter/GlobalQuickFilterManager';
import { t } from '../../i18n';
import { KanbanTooltipManager } from './KanbanTooltipManager';
import { KanbanLaneReorderController } from './KanbanLaneReorderController';
import { ensureFontScaleStyles } from './kanbanFontScaleStyles';
import type { RowUpdate } from './KanbanLaneMutation';
import { buildExpectedLaneNames } from './expectedLaneNames';
import { renderKanbanCard } from './KanbanCardRenderer';
import { handleCardDragEnd, applyLaneUpdates } from './KanbanCardDragHandler';
import { KanbanLaneWrapController } from './KanbanLaneWrapController';

type SortableStatic = typeof import('sortablejs');
type SortableInstance = ReturnType<SortableStatic['create']>;

interface KanbanViewControllerOptions {
	view: TableView;
	container: HTMLElement;
	laneField: string;
	laneWidth: number;
	fontScale: number;
	sortField: string | null;
	fallbackLaneName: string;
	primaryField: string | null;
	displayFields: string[];
	lanePresets: string[];
	laneOrder: string[];
	heightMode: KanbanHeightMode;
	multiRowEnabled: boolean;
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
	private readonly lanePresets: string[];
	private laneOrder: string[];
	private readonly enableDrag: boolean;
	private readonly laneWidth: number;
	private readonly fontScale: number;
	private readonly initialVisibleCount: number;
	private readonly rawContentConfig: KanbanCardContentConfig | null;
	private readonly viewportManager: KanbanViewportManager;
	private cardContent!: KanbanRuntimeCardContent;
	private expandedLanes = new Set<string>();
	private heightMode: KanbanHeightMode;
	private multiRowEnabled: boolean;

	private readonly rootEl: HTMLElement;
	private readonly messageEl: HTMLElement;
	private boardEl: HTMLElement | null = null;

	private visibleRows: RowData[] = [];
	private quickFilterValue = '';
	private unsubscribeFilter: (() => void) | null = null;
	private unsubscribeQuickFilter: (() => void) | null = null;
	private sortables = new Map<string, SortableInstance>();
	private readonly laneReorderController: KanbanLaneReorderController;
	private readonly laneWrapController: KanbanLaneWrapController | null;
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
		this.lanePresets = Array.isArray(options.lanePresets) ? options.lanePresets : [];
		this.laneOrder = Array.isArray(options.laneOrder) ? [...options.laneOrder] : [];
		this.enableDrag = options.enableDrag;
		this.laneWidth = sanitizeKanbanLaneWidth(options.laneWidth);
		this.fontScale = sanitizeKanbanFontScale(options.fontScale);
		this.heightMode = sanitizeKanbanHeightMode(options.heightMode);
		this.multiRowEnabled = options.multiRowEnabled;
		const limit = Math.floor(options.initialVisibleCount ?? 1);
		this.initialVisibleCount = Math.max(1, limit);
		this.rawContentConfig = options.contentConfig ?? null;
		this.viewportManager = new KanbanViewportManager({ container: this.container });
		this.cardContent = toRuntimeContent(this.rawContentConfig, {
			availableFields: this.getAvailableFields(),
			laneField: this.laneField
		});
		this.dragAvailable = this.enableDrag;
		this.laneReorderController = new KanbanLaneReorderController({
			getSortableClass: () => this.sortableClass,
			isDragAvailable: () => this.dragAvailable,
			disableCardDrag: (disabled) => {
				for (const sortable of this.sortables.values()) {
					try {
						sortable.option('disabled', disabled);
					} catch {
						// noop
					}
				}
			},
			onLaneOrderChange: (order) => {
				this.handleLaneOrderChange(order);
			}
		});

		this.recomputeVisibleRows();
		this.quickFilterValue = globalQuickFilterManager.getValue();

		ensureFontScaleStyles(this.container.ownerDocument ?? document);
		this.rootEl = this.container.createDiv({ cls: 'tlb-kanban-root' });
		this.rootEl.style.setProperty('--tlb-kanban-font-scale', `${this.fontScale}`);
		this.messageEl = this.rootEl.createDiv({ cls: 'tlb-kanban-message' });
		this.boardEl = this.rootEl.createDiv({ cls: 'tlb-kanban-board', attr: { role: 'list' } });
		this.boardEl.style.setProperty('--tlb-kanban-lane-width', `${this.laneWidth}rem`);

		this.laneWrapController = new KanbanLaneWrapController({
			wrapper: this.container,
			board: this.boardEl,
			enabled: this.multiRowEnabled
		});

		this.viewportManager.apply(this.heightMode);
		this.updateWrapperLayout();
		this.tooltipManager.setFontScale(this.fontScale);
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
		this.laneReorderController.destroy();
		this.laneWrapController?.destroy();
		this.rootEl.empty();
	}

	public setHeightMode(mode: KanbanHeightMode): void {
		const normalized = sanitizeKanbanHeightMode(mode);
		if (this.heightMode === normalized) {
			return;
		}
		this.heightMode = normalized;
		this.viewportManager.apply(this.heightMode);
		this.laneWrapController?.updateLaneMetrics();
		this.updateWrapperLayout();
	}

	public setMultiRowEnabled(enabled: boolean): void {
		if (this.multiRowEnabled === enabled) {
			return;
		}
		this.multiRowEnabled = enabled;
		this.laneWrapController?.setEnabled(enabled);
		if (enabled) {
			this.laneWrapController?.updateLaneMetrics();
		}
		this.updateWrapperLayout();
	}

	private updateWrapperLayout(): void {
		const forceSingleRowHeight = this.heightMode !== 'viewport' && !this.multiRowEnabled;
		this.container.classList.toggle('tlb-kanban-wrapper--single-row', forceSingleRowHeight);
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
		this.laneReorderController.destroy();
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
			this.laneWrapController?.updateLaneMetrics();
			this.viewportManager.refresh(this.heightMode);
			this.boardEl?.removeAttribute('aria-busy');
			return;
		}

		for (const lane of state.lanes) {
			this.renderLane(lane);
		}
		this.laneReorderController.attach(this.boardEl);
		this.laneWrapController?.updateLaneMetrics();
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
		const expectedLaneNames = buildExpectedLaneNames({
			laneField: this.laneField,
			filterRule: this.view.activeKanbanBoardFilter,
			lanePresets: this.lanePresets,
			laneOrder: this.laneOrder
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
		icon.setText('棣冩惖');
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
		header.setAttribute('title', t('kanbanView.laneReorderHint'));
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
				renderKanbanCard({
					container: cardsContainer,
					card,
					cardContent: this.cardContent,
					tooltipManager: this.tooltipManager
				});
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

	private handleDragEnd(event: SortableEvent): void {
		handleCardDragEnd({
			event,
			dragAvailable: this.dragAvailable,
			fallbackLaneName: this.fallbackLaneName,
			onInvalidDrop: () => {
				this.renderBoard();
			},
			applyUpdates: (updates, focusRowIndex) => {
				this.applyUpdates(updates, focusRowIndex);
			}
		});
	}

	private applyUpdates(updates: Map<number, RowUpdate>, focusRowIndex: number): void {
		applyLaneUpdates({
			view: this.view,
			laneField: this.laneField,
			updates,
			focusRowIndex,
			renderBoard: () => {
				this.renderBoard();
			},
			setApplyingMutation: (value) => {
				this.isApplyingMutation = value;
			}
		});
	}

	private handleLaneOrderChange(order: string[]): void {
		const matchesExisting =
			this.laneOrder.length === order.length &&
			this.laneOrder.every((value, index) => value === order[index]);
		if (order.length === 0 || matchesExisting) {
			return;
		}
		this.laneOrder = [...order];
		const controller = this.view.kanbanBoardController;
		if (controller && typeof controller.updateActiveLaneOrder === 'function') {
			void controller.updateActiveLaneOrder([...order]).catch(() => undefined);
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

