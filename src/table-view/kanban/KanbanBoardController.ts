/* eslint-disable max-lines -- TODO(T0152): split KanbanBoardController into leaner modules */
import { App, Notice } from 'obsidian';
import type { TableView } from '../../TableView';
import { getLocaleCode, t } from '../../i18n';
import { DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT, DEFAULT_KANBAN_SORT_DIRECTION, DEFAULT_KANBAN_SORT_FIELD, sanitizeKanbanInitialVisibleCount, type KanbanBoardDefinition, type KanbanCardContentConfig, type KanbanSortDirection } from '../../types/kanban';
import { KanbanBoardStore } from './KanbanBoardStore';
import type { FilterRule } from '../../types/filterView';
import type { FilterColumnOption } from '../TableViewFilterPresenter';
import { getAvailableColumns } from '../TableViewFilterPresenter';
import { KanbanBoardConfirmModal } from './KanbanBoardConfirmModal';
import { cloneKanbanContentConfig } from './KanbanContentConfig';
import { openKanbanBoardModal } from './KanbanBoardModal';
import { openKanbanLanePresetModal } from './KanbanLanePresetModal';
import { composeBoardName } from './boardNaming';
import { DEFAULT_KANBAN_LANE_WIDTH, sanitizeKanbanLaneWidth } from './kanbanWidth';
import { showKanbanBoardMenu } from './KanbanBoardMenu';
import { isStatusLaneField } from './statusLaneHelpers';
interface KanbanBoardControllerOptions { app: App; view: TableView; store: KanbanBoardStore; }
export class KanbanBoardController {
	private readonly app: App;
	private readonly view: TableView;
	private readonly store: KanbanBoardStore;
	private loadedFilePath: string | null = null;
	private repairingLaneField = false;
	private autoCreateInProgress = false;
	constructor(options: KanbanBoardControllerOptions) {
		this.app = options.app;
		this.view = options.view;
		this.store = options.store;
	}
	ensureInitialized(): void {
		const filePath = this.view.file?.path ?? null;
		if (!filePath) {
			this.reset();
			return;
		}
		if (this.loadedFilePath === filePath && this.view.kanbanBoardsLoaded) {
			return;
		}
		this.store.setFilePath(filePath);
		this.store.loadFromSettings();
		const pending = this.view.pendingKanbanBoardState;
		this.view.pendingKanbanBoardState = null;
		if (pending) {
			this.store.setState(pending);
			void this.store.persist();
		}
		let state = this.store.getState();
		if (!state.boards || state.boards.length === 0) {
			this.handleEmptyBoards();
			this.loadedFilePath = filePath;
			this.view.kanbanBoardsLoaded = true;
			return;
		}
		if (!state.activeBoardId && state.boards.length > 0) {
			this.store.setActiveBoard(state.boards[0].id);
			state = this.store.getState();
		}
		const activeBoard = state.activeBoardId
			? state.boards.find((board) => board.id === state.activeBoardId) ?? null
			: null;
		this.applyBoardContext(activeBoard, { persist: false, rerender: false });
		this.loadedFilePath = filePath;
		this.view.kanbanBoardsLoaded = true;
		if (this.view.kanbanToolbar) {
			this.refreshToolbar();
		}
	}
	ensureBoardForActiveKanbanView(): void {
		const snapshot = this.store.getState();
		const boards = snapshot.boards ?? [];
		if (boards.length === 0) {
			this.handleEmptyBoards();
			return;
		}
		const activeBoardId = snapshot.activeBoardId;
		const activeBoard = activeBoardId ? boards.find((board) => board.id === activeBoardId) ?? null : null;
		if (activeBoard) {
			this.applyBoardContext(activeBoard, { persist: false, rerender: false });
			return;
		}
		const fallback = boards[0];
		this.store.setActiveBoard(fallback.id);
		const refreshed = this.store.getState();
		const resolved = refreshed.boards.find((board) => board.id === fallback.id) ?? fallback;
		this.applyBoardContext(resolved, { persist: true, rerender: false });
	}
	getBoards(): KanbanBoardDefinition[] {
		return this.store.getState().boards;
	}
	getActiveBoardId(): string | null {
		return this.store.getState().activeBoardId;
	}
	async createBoard(): Promise<void> {
	const editor = await this.openBoardModal({
		title: t('kanbanView.toolbar.createBoardTitle'),
		defaultName: this.suggestNewBoardName(),
		defaultIcon: 'layout-kanban',
		initialFilter: null,
		initialLaneField: this.view.kanbanLaneField ?? null,
		initialLaneWidth: this.view.kanbanLaneWidth ?? DEFAULT_KANBAN_LANE_WIDTH,
		initialVisibleCount: this.view.kanbanInitialVisibleCount,
		initialContent: null,
		initialSortField: this.view.kanbanSortField ?? DEFAULT_KANBAN_SORT_FIELD,
		initialSortDirection: this.view.kanbanSortDirection ?? DEFAULT_KANBAN_SORT_DIRECTION,
		sortFieldOptions: this.getSortFieldOptions()
	});
		if (!editor) {
			return;
		}
		const board = this.store.createBoard({
			name: editor.name,
			icon: editor.icon,
			laneField: editor.laneField,
			laneWidth: editor.laneWidth,
			filterRule: editor.filterRule,
			initialVisibleCount: editor.initialVisibleCount,
			content: editor.content,
			sortField: editor.sortField,
			sortDirection: editor.sortDirection,
			setActive: true
		});
		await this.store.persist();
		this.applyBoardContext(board, { persist: true, rerender: true });
		this.refreshToolbar();
	}
	async editBoard(board: KanbanBoardDefinition): Promise<void> {
	const editor = await this.openBoardModal({
		title: t('kanbanView.toolbar.editBoardTitle'),
		defaultName: board.name,
		defaultIcon: board.icon ?? null,
		initialFilter: board.filterRule ?? null,
		initialLaneField: board.laneField,
		initialLaneWidth: board.laneWidth ?? this.view.kanbanLaneWidth ?? DEFAULT_KANBAN_LANE_WIDTH,
		initialVisibleCount: board.initialVisibleCount ?? null,
		initialContent: board.content ?? null,
		initialSortField: board.sortField ?? this.view.kanbanSortField ?? DEFAULT_KANBAN_SORT_FIELD,
		initialSortDirection:
			board.sortDirection ?? this.view.kanbanSortDirection ?? DEFAULT_KANBAN_SORT_DIRECTION,
		sortFieldOptions: this.getSortFieldOptions()
	});
		if (!editor) {
			return;
		}
	const updated = this.store.updateBoard(board.id, {
		name: editor.name,
		icon: editor.icon,
		laneField: editor.laneField,
		laneWidth: editor.laneWidth,
		filterRule: editor.filterRule,
		initialVisibleCount: editor.initialVisibleCount,
		content: editor.content,
		sortField: editor.sortField,
		sortDirection: editor.sortDirection
	});
		if (!updated) {
			return;
		}
		await this.store.persist();
		if (this.store.getState().activeBoardId === board.id) {
			this.applyBoardContext(updated, { persist: true, rerender: true });
		}
		this.refreshToolbar();
	}
	async duplicateBoard(board: KanbanBoardDefinition): Promise<void> {
		const duplicatedName = `${board.name} ${t('kanbanView.toolbar.duplicateNameSuffix')}`.trim();
	const editor = await this.openBoardModal({
		title: t('kanbanView.toolbar.duplicateBoardTitle', {
			name: board.name || t('kanbanView.toolbar.unnamedBoardLabel')
		}),
		defaultName: duplicatedName,
		defaultIcon: board.icon ?? null,
		initialFilter: board.filterRule ?? null,
		initialLaneField: board.laneField,
		initialLaneWidth: board.laneWidth ?? this.view.kanbanLaneWidth ?? DEFAULT_KANBAN_LANE_WIDTH,
		initialVisibleCount: board.initialVisibleCount ?? null,
		initialContent: board.content ?? null,
		initialSortField: board.sortField ?? this.view.kanbanSortField ?? DEFAULT_KANBAN_SORT_FIELD,
		initialSortDirection:
			board.sortDirection ?? this.view.kanbanSortDirection ?? DEFAULT_KANBAN_SORT_DIRECTION,
		sortFieldOptions: this.getSortFieldOptions()
	});
		if (!editor) {
			return;
		}
	const cloned = this.store.createBoard({
		name: editor.name,
		icon: editor.icon,
		laneField: editor.laneField,
		laneWidth: editor.laneWidth,
		lanePresets: board.lanePresets ?? [],
		filterRule: editor.filterRule,
		initialVisibleCount: editor.initialVisibleCount,
		content: editor.content,
		sortField: editor.sortField,
		sortDirection: editor.sortDirection,
		setActive: true
	});
		await this.store.persist();
		this.applyBoardContext(cloned, { persist: true, rerender: true });
		this.refreshToolbar();
		new Notice(t('kanbanView.toolbar.duplicateBoardNotice', { name: cloned.name }));
	}

	async addLanePreset(): Promise<void> {
		const state = this.store.getState();
		const activeBoardId = state.activeBoardId;
		if (!activeBoardId) {
			new Notice(t('kanbanView.toolbar.noBoardsPlaceholder'));
			return;
		}
		const board = state.boards.find((entry) => entry.id === activeBoardId);
		if (!board) {
			new Notice(t('kanbanView.toolbar.noBoardsPlaceholder'));
			return;
		}
		const laneField = typeof board.laneField === 'string' ? board.laneField.trim() : '';
		if (!laneField) {
			new Notice(t('kanbanView.toolbar.laneFieldMissingNotice'));
			return;
		}
		if (isStatusLaneField(laneField)) {
			new Notice(t('kanbanView.toolbar.statusLanePresetForbidden'));
			return;
		}
		const existing = Array.isArray(board.lanePresets) ? board.lanePresets : [];
		const preset = await openKanbanLanePresetModal({
			app: this.app,
			laneField,
			existingPresets: existing
		});
		if (!preset) {
			return;
		}
		const updated = this.store.updateBoard(board.id, {
			lanePresets: [...existing, preset]
		});
		if (!updated) {
			return;
		}
		await this.store.persist();
		if (this.store.getState().activeBoardId === board.id) {
			this.applyBoardContext(updated, { persist: true, rerender: true });
		}
		new Notice(t('kanbanView.toolbar.lanePresetCreated', { name: preset }));
	}
	async deleteBoard(board: KanbanBoardDefinition): Promise<void> {
		const state = this.store.getState();
		if (state.boards.length <= 1) {
			new Notice(t('kanbanView.toolbar.cannotDeleteLastBoard'));
			return;
		}
		const confirmed = await this.confirmBoardDeletion(board.name || t('kanbanView.toolbar.unnamedBoardLabel'));
		if (!confirmed) {
			return;
		}
		const removed = this.store.deleteBoard(board.id);
		if (!removed) {
			return;
		}
		const nextState = this.store.getState();
		const activeBoard = nextState.activeBoardId
			? nextState.boards.find((entry) => entry.id === nextState.activeBoardId) ?? null
			: null;
		await this.store.persist();
		this.applyBoardContext(activeBoard, { persist: true, rerender: true });
		this.refreshToolbar();
	}
	async selectBoard(boardId: string): Promise<void> {
		this.store.setActiveBoard(boardId);
		const state = this.store.getState();
		const activeBoard = state.boards.find((entry) => entry.id === boardId) ?? null;
		await this.store.persist();
		this.applyBoardContext(activeBoard, { persist: true, rerender: true });
		this.refreshToolbar();
	}
	openBoardMenu(board: KanbanBoardDefinition, event: MouseEvent): void {
		showKanbanBoardMenu({
			event,
			onEdit: () => {
				void this.editBoard(board);
			},
			onDuplicate: () => {
				void this.duplicateBoard(board);
			},
			onDelete: () => {
				void this.deleteBoard(board);
			}
		});
	}
	refreshToolbar(): void {
		const toolbar = this.view.kanbanToolbar;
		if (toolbar) {
			const current = this.store.getState();
			toolbar.updateState(
				current.boards.map((entry) => ({
					id: entry.id,
					name: entry.name,
					icon: entry.icon ?? null
				})),
				current.activeBoardId
			);
		}
	}
	attachToolbar(): void {
		this.refreshToolbar();
	}
	reset(): void {
		this.loadedFilePath = null;
		this.store.reset();
		this.view.activeKanbanBoardFilter = null;
		this.view.activeKanbanBoardId = null;
		this.view.kanbanLaneField = null;
		this.view.kanbanLaneWidth = DEFAULT_KANBAN_LANE_WIDTH;
		this.view.kanbanLanePresets = [];
		this.view.kanbanInitialVisibleCount = DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT;
		this.view.kanbanCardContentConfig = null;
		this.view.kanbanSortField = null;
		this.view.kanbanSortDirection = DEFAULT_KANBAN_SORT_DIRECTION;
		this.view.kanbanBoardsLoaded = false;
		this.repairingLaneField = false;
		this.autoCreateInProgress = false;
	}
	private applyBoardContext(
		board: KanbanBoardDefinition | null,
		options?: { persist?: boolean; rerender?: boolean }
	): void {
	if (board) {
		this.view.kanbanCardContentConfig = board.content ? cloneKanbanContentConfig(board.content) : null;
		const laneField = typeof board.laneField === 'string' ? board.laneField.trim() : '';
		if (laneField.length > 0 && this.isLaneFieldAvailable(laneField)) {
			this.view.kanbanLaneField = laneField;
		} else {
			this.view.kanbanLaneField = null;
			void this.handleInvalidLaneField(board);
		}
		this.view.activeKanbanBoardFilter = board.filterRule ?? null;
		this.view.activeKanbanBoardId = board.id;
			this.view.kanbanLaneWidth = sanitizeKanbanLaneWidth(
				board.laneWidth ?? this.view.kanbanLaneWidth ?? DEFAULT_KANBAN_LANE_WIDTH,
				DEFAULT_KANBAN_LANE_WIDTH
			);
			this.view.kanbanLanePresets = Array.isArray(board.lanePresets)
				? [...board.lanePresets]
				: [];
			this.view.kanbanInitialVisibleCount = sanitizeKanbanInitialVisibleCount(
				board.initialVisibleCount ?? DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT
			);
			const sortField = typeof board.sortField === 'string' ? board.sortField.trim() : '';
			this.view.kanbanSortField = sortField.length > 0 ? sortField : null;
			this.view.kanbanSortDirection =
				board.sortDirection === 'desc' ? 'desc' : DEFAULT_KANBAN_SORT_DIRECTION;
		} else {
			this.view.activeKanbanBoardFilter = null;
			this.view.activeKanbanBoardId = null;
			this.view.kanbanLaneWidth = DEFAULT_KANBAN_LANE_WIDTH;
			this.view.kanbanLanePresets = [];
			this.view.kanbanInitialVisibleCount = DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT;
			this.view.kanbanCardContentConfig = null;
			this.view.kanbanSortField = null;
			this.view.kanbanSortDirection = DEFAULT_KANBAN_SORT_DIRECTION;
	}
		if (options?.persist !== false) {
			void this.view.persistenceService?.saveConfig();
		}
		if (options?.rerender === true) {
			void this.view.render();
		}
		this.view.kanbanToolbar?.setActiveBoard(board ? board.id : null);
	}
	private handleEmptyBoards(): void {
		this.store.setActiveBoard(null);
		this.view.activeKanbanBoardFilter = null;
		this.view.activeKanbanBoardId = null;
		this.view.kanbanLaneField = null;
		this.view.kanbanLaneWidth = DEFAULT_KANBAN_LANE_WIDTH;
		this.view.kanbanLanePresets = [];
		this.view.kanbanInitialVisibleCount = DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT;
		this.view.kanbanCardContentConfig = null;
		this.view.kanbanSortField = null;
		this.view.kanbanSortDirection = DEFAULT_KANBAN_SORT_DIRECTION;
		this.refreshToolbar();
		this.view.kanbanToolbar?.setActiveBoard(null);
		this.maybeTriggerAutoCreate();
	}

	private maybeTriggerAutoCreate(): void {
		const schema = this.view.schema;
		if (
			this.view.activeViewMode !== 'kanban' ||
			this.autoCreateInProgress ||
			this.store.getState().boards.length > 0 ||
			!schema ||
			!Array.isArray(schema.columnNames) ||
			schema.columnNames.length === 0 ||
			this.getLaneFieldCandidates().length === 0
		) {
			return;
		}

		this.autoCreateInProgress = true;
		void this.createBoard().catch(() => undefined).finally(() => {
			this.autoCreateInProgress = false;
		});
	}
	private isLaneFieldAvailable(field: string): boolean {
		const candidates = this.getLaneFieldCandidates();
		return candidates.includes(field);
	}
	private async handleInvalidLaneField(board: KanbanBoardDefinition): Promise<void> {
		if (this.repairingLaneField) {
			return;
		}
		this.repairingLaneField = true;
		try {
			new Notice(t('kanbanView.toolbar.laneFieldMissingNotice'));
			const editor = await this.openBoardModal({
				title: t('kanbanView.toolbar.editBoardTitle'),
				defaultName: board.name,
				defaultIcon: board.icon ?? null,
				initialFilter: board.filterRule ?? null,
				initialLaneField: null,
				initialLaneWidth: board.laneWidth ?? this.view.kanbanLaneWidth ?? DEFAULT_KANBAN_LANE_WIDTH,
				initialVisibleCount: board.initialVisibleCount ?? null,
				initialContent: board.content ?? null,
				initialSortField: board.sortField ?? this.view.kanbanSortField ?? DEFAULT_KANBAN_SORT_FIELD,
				initialSortDirection:
					board.sortDirection ?? this.view.kanbanSortDirection ?? DEFAULT_KANBAN_SORT_DIRECTION,
				sortFieldOptions: this.getSortFieldOptions()
			});
			if (!editor) {
				return;
			}
	const updated = this.store.updateBoard(board.id, {
		name: editor.name,
		icon: editor.icon,
		laneField: editor.laneField,
		laneWidth: editor.laneWidth,
		filterRule: editor.filterRule,
		initialVisibleCount: editor.initialVisibleCount,
		content: editor.content,
		sortField: editor.sortField,
		sortDirection: editor.sortDirection
	});
			if (!updated) {
				return;
			}
			void this.store.persist();
			this.applyBoardContext(updated, { rerender: true });
		} finally {
			this.repairingLaneField = false;
		}
	}
	private getLaneFieldCandidates(): string[] {
		const schema = this.view.schema;
		if (!schema || !Array.isArray(schema.columnNames)) {
			return [];
		}
		return schema.columnNames.filter((name) => {
			if (!name || typeof name !== 'string') {
				return false;
			}
			const trimmed = name.trim();
			if (trimmed.length === 0) {
				return false;
			}
			return trimmed !== '#' && trimmed !== '__tlb_row_id';
		});
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
	private async confirmBoardDeletion(boardName: string): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = new KanbanBoardConfirmModal(this.app, {
				message: t('kanbanView.toolbar.deleteBoardConfirm', { name: boardName }),
				onConfirm: () => resolve(true),
				onCancel: () => resolve(false)
			});
			modal.open();
		});
	}
	private suggestNewBoardName(): string {
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
	private async openBoardModal(options: {
		title: string;
		defaultName: string;
		defaultIcon: string | null;
		initialFilter: FilterRule | null;
		initialLaneField: string | null;
		initialLaneWidth: number | null;
		initialVisibleCount: number | null;
		initialContent: KanbanCardContentConfig | null;
		initialSortField: string | null;
		initialSortDirection: KanbanSortDirection | null;
		sortFieldOptions: string[];
	}): Promise<{
		name: string;
		icon: string | null;
		laneField: string;
		laneWidth: number;
		filterRule: FilterRule | null;
		initialVisibleCount: number;
		content: KanbanCardContentConfig | null;
		sortField: string | null;
		sortDirection: KanbanSortDirection;
	} | null> {
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
			initialVisibleCount: options.initialVisibleCount ?? DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT,
			initialContent: options.initialContent ?? null,
			columns,
			laneOptions,
			sortFieldOptions: options.sortFieldOptions,
			initialSortField: options.initialSortField,
			initialSortDirection: options.initialSortDirection,
			getContentFields: () => this.getLaneFieldCandidates()
		});
	}
}

/* eslint-enable max-lines */
