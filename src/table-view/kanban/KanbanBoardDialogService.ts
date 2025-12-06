import { App, Notice } from 'obsidian';
import type { TableView } from '../../TableView';
import type { FilterRule } from '../../types/filterView';
import type { FilterColumnOption } from '../TableViewFilterPresenter';
import { getAvailableColumns } from '../TableViewFilterPresenter';
import { cloneKanbanContentConfig } from './KanbanContentConfig';
import { openKanbanBoardModal } from './KanbanBoardModal';
import { KanbanBoardConfirmModal } from './KanbanBoardConfirmModal';
import { composeBoardName } from './boardNaming';
import { getLocaleCode, t } from '../../i18n';
import type { KanbanBoardDefinition, KanbanCardContentConfig, KanbanSortDirection } from '../../types/kanban';
import {
	DEFAULT_KANBAN_FONT_SCALE,
	DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT,
	DEFAULT_KANBAN_SORT_DIRECTION,
	DEFAULT_KANBAN_SORT_FIELD
} from '../../types/kanban';
import { DEFAULT_KANBAN_LANE_WIDTH } from './kanbanWidth';
import type { KanbanLaneFieldRepair } from './KanbanLaneFieldRepair';
import type { KanbanBoardStore } from './KanbanBoardStore';

interface BoardModalOptions {
	title: string;
	defaultName: string;
	defaultIcon: string | null;
	initialFilter: FilterRule | null;
	initialLaneField: string | null;
	initialLaneWidth: number | null;
	initialFontScale: number | null;
	initialVisibleCount: number | null;
	initialContent: KanbanCardContentConfig | null;
	initialSortField: string | null;
	initialSortDirection: KanbanSortDirection | null;
	sortFieldOptions: string[];
}

interface BoardModalResult {
	name: string;
	icon: string | null;
	laneField: string;
	laneWidth: number;
	fontScale: number;
	filterRule: FilterRule | null;
	initialVisibleCount: number;
	content: KanbanCardContentConfig | null;
	sortField: string | null;
	sortDirection: KanbanSortDirection;
}

export class KanbanBoardDialogService {
	constructor(
		private readonly app: App,
		private readonly view: TableView,
		private readonly laneFieldRepair: KanbanLaneFieldRepair,
		private readonly store: KanbanBoardStore
	) {}

	public suggestNewBoardName(): string {
		const existing = new Set(
			this.store
				.getState()
				.boards.map((entry) => (typeof entry.name === 'string' ? entry.name.toLowerCase() : ''))
		);
		const base = t('kanbanView.toolbar.newBoardPlaceholder').trim();
		const locale = getLocaleCode();
		const normalizedBase = base.length > 0 ? base : t('kanbanView.toolbar.newBoardPlaceholder');
		for (let index = 1; index < 100; index += 1) {
			const candidate = composeBoardName(normalizedBase, index, locale);
			if (!existing.has(candidate.toLowerCase())) {
				return candidate;
			}
		}
		const fallbackBase = normalizedBase.length > 0 ? normalizedBase : 'Board';
		return `${fallbackBase} ${Date.now()}`;
	}

	public async confirmBoardDeletion(boardName: string): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = new KanbanBoardConfirmModal(this.app, {
				message: t('kanbanView.toolbar.deleteBoardConfirm', { name: boardName }),
				onConfirm: () => resolve(true),
				onCancel: () => resolve(false)
			});
			modal.open();
		});
	}

	public getModalDefaults(board: KanbanBoardDefinition | null) {
		const initialSortField = board
			? board.sortField ?? null
			: this.view.kanbanSortField ?? DEFAULT_KANBAN_SORT_FIELD;
		const initialSortDirection =
			board?.sortDirection ?? this.view.kanbanSortDirection ?? DEFAULT_KANBAN_SORT_DIRECTION;
		return {
			initialFilter: board?.filterRule ?? null,
			initialLaneField: board?.laneField ?? this.view.kanbanLaneField ?? null,
			initialLaneWidth: board?.laneWidth ?? this.view.kanbanLaneWidth ?? DEFAULT_KANBAN_LANE_WIDTH,
			initialFontScale: board?.fontScale ?? this.view.kanbanFontScale ?? DEFAULT_KANBAN_FONT_SCALE,
			initialVisibleCount: board?.initialVisibleCount ?? this.view.kanbanInitialVisibleCount,
			initialContent: board?.content ? cloneKanbanContentConfig(board.content) : null,
			initialSortField,
			initialSortDirection,
			sortFieldOptions: this.getSortFieldOptions()
		};
	}

	public async openBoardModal(options: BoardModalOptions): Promise<BoardModalResult | null> {
		const columns = this.getFilterColumnOptions();
		if (columns.length === 0) {
			new Notice(t('filterViewController.noColumns'));
			return null;
		}
		const laneOptions = this.getLaneFieldCandidates();
		if (laneOptions.length === 0) {
			new Notice(t('kanbanView.fieldModal.noColumns'));
			return null;
		}
		return openKanbanBoardModal({
			app: this.app,
			title: options.title,
			defaultName: options.defaultName,
			defaultIcon: options.defaultIcon,
			initialFilter: options.initialFilter,
			initialLaneField: options.initialLaneField,
			initialLaneWidth: options.initialLaneWidth,
			initialFontScale: options.initialFontScale,
			initialVisibleCount: options.initialVisibleCount ?? DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT,
			initialContent: options.initialContent ?? null,
			columns,
			laneOptions,
			sortFieldOptions: options.sortFieldOptions,
			initialSortField: options.initialSortField,
			initialSortDirection: options.initialSortDirection ?? DEFAULT_KANBAN_SORT_DIRECTION,
			getContentFields: () => this.getLaneFieldCandidates()
		});
	}

	public getLaneFieldCandidates(): string[] {
		return this.laneFieldRepair.getLaneFieldCandidates();
	}

	private getFilterColumnOptions(): FilterColumnOption[] {
		const columns = getAvailableColumns(this.view);
		return columns.map((name) => ({
			name,
			kind: 'text',
			allowNumericOperators: true
		}));
	}

	private getSortFieldOptions(): string[] {
		const columns = getAvailableColumns(this.view);
		const ordered: string[] = [];
		const seen = new Set<string>();
		for (const column of columns) {
			if (!column || seen.has(column)) {
				continue;
			}
			seen.add(column);
			ordered.push(column);
		}
		return ordered;
	}
}
