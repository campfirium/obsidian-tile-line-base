import type { RowData } from '../../grid/GridAdapter';
import type { TableView } from '../../TableView';
import { t } from '../../i18n';
import { globalQuickFilterManager } from '../filter/GlobalQuickFilterManager';
import {
	buildKanbanBoardState,
	type KanbanBoardState,
	type KanbanCard,
	type KanbanLane
} from './KanbanDataBuilder';
import type { KanbanLaneSource } from './KanbanLaneResolver';

interface KanbanViewControllerOptions {
	view: TableView;
	container: HTMLElement;
	lanes: KanbanLaneSource[];
	primaryField: string | null;
	displayFields: string[];
}

export class KanbanViewController {
	private readonly view: TableView;
	private readonly lanes: KanbanLaneSource[];
	private readonly primaryField: string | null;
	private readonly displayFields: string[];

	private readonly rootEl: HTMLElement;
	private readonly messageEl: HTMLElement;
	private boardEl: HTMLElement | null = null;

	private allRows: RowData[] = [];
	private quickFilterValue = '';
	private unsubscribeFilter: (() => void) | null = null;
	private unsubscribeQuickFilter: (() => void) | null = null;

	constructor(options: KanbanViewControllerOptions) {
		this.view = options.view;
		this.lanes = options.lanes;
		this.primaryField = options.primaryField;
		this.displayFields = options.displayFields;

		this.allRows = this.view.filterOrchestrator.getAllRows();
		this.quickFilterValue = globalQuickFilterManager.getValue();

		this.rootEl = options.container.createDiv({ cls: 'tlb-kanban-root' });
		this.messageEl = this.rootEl.createDiv({ cls: 'tlb-kanban-message' });
		this.boardEl = this.rootEl.createDiv({ cls: 'tlb-kanban-board', attr: { role: 'list' } });

		this.registerListeners();
		this.renderBoard();
	}

	destroy(): void {
		this.unsubscribeFilter?.();
		this.unsubscribeFilter = null;
		this.unsubscribeQuickFilter?.();
		this.unsubscribeQuickFilter = null;
		this.rootEl.empty();
	}

	private registerListeners(): void {
		this.unsubscribeFilter = this.view.filterOrchestrator.addVisibleRowsListener(() => {
			this.allRows = this.view.filterOrchestrator.getAllRows();
			this.renderBoard();
		});
		this.unsubscribeQuickFilter = globalQuickFilterManager.subscribe((value) => {
			this.quickFilterValue = value ?? '';
			this.renderBoard();
		});
	}

	private renderBoard(): void {
		if (!this.boardEl || !this.boardEl.isConnected) {
			return;
		}

		this.boardEl.empty();
		this.boardEl.setAttribute('aria-busy', 'true');

		if (this.lanes.length === 0) {
			this.renderNoLaneState();
			this.boardEl.removeAttribute('aria-busy');
			return;
		}

		const state = this.buildState();
		this.renderMessage(state);

		if (state.totalCards === 0) {
			this.renderEmptyState();
			this.boardEl.removeAttribute('aria-busy');
			return;
		}

		for (const lane of state.lanes) {
			this.renderLane(lane);
		}
		this.boardEl.removeAttribute('aria-busy');
	}

	private buildState(): KanbanBoardState {
		return buildKanbanBoardState({
			rows: this.allRows,
			lanes: this.lanes,
			primaryField: this.primaryField,
			displayFields: this.displayFields,
			quickFilter: this.quickFilterValue,
			resolveRowIndex: (row) => this.view.dataStore.getBlockIndexFromRow(row)
		});
	}

	private renderMessage(state: KanbanBoardState): void {
		this.messageEl.empty();
		const filterActive = this.quickFilterValue.trim().length > 0;

		const countLabel = this.messageEl.createSpan({ cls: 'tlb-kanban-message__count' });
		if (filterActive) {
			countLabel.setText(
				t('kanbanView.filteredCountLabel', {
					count: String(state.totalCards)
				})
			);
		} else {
			countLabel.setText(
				t('kanbanView.totalCountLabel', {
					count: String(state.totalCards)
				})
			);
		}
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
			return;
		}

		for (const card of lane.cards) {
			this.renderCard(cardsContainer, card);
		}
	}

	private renderCard(container: HTMLElement, card: KanbanCard): void {
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
		const trimmedTitle = card.title.trim();
		title.setText(trimmedTitle.length > 0 ? trimmedTitle : t('kanbanView.untitledCardFallback'));

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

	private renderNoLaneState(): void {
		if (!this.boardEl) {
			return;
		}
		this.messageEl.empty();

		const info = this.boardEl.createDiv({ cls: 'tlb-kanban-empty' });
		const icon = info.createSpan({ cls: 'tlb-kanban-empty__icon' });
		icon.setText('🗂️');
		const label = info.createSpan({ cls: 'tlb-kanban-empty__label' });
		label.setText(t('kanbanView.noLaneSources'));
		const hint = info.createSpan({ cls: 'tlb-kanban-empty__hint' });
		hint.setText(t('kanbanView.configureLaneHint'));
	}
}
