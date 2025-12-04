import { App, Notice } from 'obsidian';
import type { TableView } from '../../TableView';
import { t } from '../../i18n';
import {
	DEFAULT_KANBAN_FONT_SCALE,
	DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT,
	DEFAULT_KANBAN_SORT_DIRECTION,
	sanitizeKanbanFontScale,
	sanitizeKanbanInitialVisibleCount,
	type KanbanBoardDefinition
} from '../../types/kanban';
import { KanbanBoardStore } from './KanbanBoardStore';
import { cloneKanbanContentConfig } from './KanbanContentConfig';
import { DEFAULT_KANBAN_LANE_WIDTH, sanitizeKanbanLaneWidth } from './kanbanWidth';
import { showKanbanBoardMenu } from './KanbanBoardMenu';
import { KanbanLaneFieldRepair } from './KanbanLaneFieldRepair';
import { openKanbanLanePresetModal } from './KanbanLanePresetModal';
import { isStatusLaneField } from './statusLaneHelpers';
import { KanbanBoardDialogService } from './KanbanBoardDialogService';
import { createDefaultStatusBoard } from './defaultStatusBoard';
interface KanbanBoardControllerOptions { app: App; view: TableView; store: KanbanBoardStore; }
export class KanbanBoardController {
	private readonly app: App;
	private readonly view: TableView;
	private readonly store: KanbanBoardStore;
	private readonly laneFieldRepair: KanbanLaneFieldRepair;
	private readonly dialogs: KanbanBoardDialogService;
	private loadedFilePath: string | null = null;
	private repairingLaneField = false;
	private autoCreateInProgress = false;
	constructor(options: KanbanBoardControllerOptions) {
		this.app = options.app;
		this.view = options.view;
		this.store = options.store;
		this.laneFieldRepair = new KanbanLaneFieldRepair(this.view);
		this.dialogs = new KanbanBoardDialogService(this.app, this.view, this.laneFieldRepair, this.store);
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

	private getActiveBoardDefinition(): KanbanBoardDefinition | null {
		const snapshot = this.store.getState();
		if (!snapshot.activeBoardId) {
			return null;
		}
		return snapshot.boards.find((board) => board.id === snapshot.activeBoardId) ?? null;
	}
	async createBoard(): Promise<void> {
	const editor = await this.dialogs.openBoardModal({
		title: t('kanbanView.toolbar.createBoardTitle'),
		defaultName: this.dialogs.suggestNewBoardName(),
		defaultIcon: 'layout-kanban',
		...this.dialogs.getModalDefaults(null)
	});
		if (!editor) {
			return;
		}
		const board = this.store.createBoard({
			name: editor.name,
			icon: editor.icon,
			laneField: editor.laneField,
			laneWidth: editor.laneWidth,
			fontScale: editor.fontScale,
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
	const editor = await this.dialogs.openBoardModal({
		title: t('kanbanView.toolbar.editBoardTitle'),
		defaultName: board.name,
		defaultIcon: board.icon ?? null,
		...this.dialogs.getModalDefaults(board)
	});
		if (!editor) {
			return;
		}
	const updated = this.store.updateBoard(board.id, {
		name: editor.name,
		icon: editor.icon,
		laneField: editor.laneField,
		laneWidth: editor.laneWidth,
		fontScale: editor.fontScale,
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
	const editor = await this.dialogs.openBoardModal({
		title: t('kanbanView.toolbar.duplicateBoardTitle', {
			name: board.name || t('kanbanView.toolbar.unnamedBoardLabel')
		}),
		defaultName: duplicatedName,
		defaultIcon: board.icon ?? null,
		...this.dialogs.getModalDefaults(board)
	});
		if (!editor) {
			return;
		}
	const cloned = this.store.createBoard({
		name: editor.name,
		icon: editor.icon,
		laneField: editor.laneField,
		lanePresets: board.lanePresets ?? [],
		laneWidth: editor.laneWidth,
		fontScale: editor.fontScale,
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
	async deleteBoard(board: KanbanBoardDefinition): Promise<void> {
		const state = this.store.getState();
		if (state.boards.length <= 1) {
			new Notice(t('kanbanView.toolbar.cannotDeleteLastBoard'));
			return;
		}
		const confirmed = await this.dialogs.confirmBoardDeletion(board.name || t('kanbanView.toolbar.unnamedBoardLabel'));
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
		this.view.kanbanFontScale = DEFAULT_KANBAN_FONT_SCALE;
		this.view.kanbanInitialVisibleCount = DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT;
		this.view.kanbanCardContentConfig = null;
		this.view.kanbanSortField = null;
		this.view.kanbanSortDirection = DEFAULT_KANBAN_SORT_DIRECTION;
		this.view.kanbanLanePresets = [];
		this.view.kanbanLaneOrder = [];
		this.view.kanbanBoardsLoaded = false;
		this.repairingLaneField = false;
		this.autoCreateInProgress = false;
		this.laneFieldRepair.reset();
	}
	private applyBoardContext(
		board: KanbanBoardDefinition | null,
		options?: { persist?: boolean; rerender?: boolean }
	): void {
	if (board) {
		this.view.kanbanCardContentConfig = board.content ? cloneKanbanContentConfig(board.content) : null;
		this.view.kanbanLanePresets = Array.isArray(board.lanePresets) ? [...board.lanePresets] : [];
		this.view.kanbanLaneOrder = Array.isArray(board.laneOrderOverrides) ? [...board.laneOrderOverrides] : [];
		const laneField = typeof board.laneField === 'string' ? board.laneField.trim() : '';
		if (laneField.length > 0) {
			if (this.isLaneFieldAvailable(laneField)) {
				this.view.kanbanLaneField = laneField;
				this.laneFieldRepair.reset();
			} else {
				this.view.kanbanLaneField = null;
				this.laneFieldRepair.markMissing(board.id);
				if (this.laneFieldRepair.hasLaneFieldPrerequisites()) {
					void this.handleInvalidLaneField(board);
				}
			}
		} else {
			this.view.kanbanLaneField = null;
		}
		this.view.activeKanbanBoardFilter = board.filterRule ?? null;
		this.view.activeKanbanBoardId = board.id;
		this.view.kanbanLaneWidth = sanitizeKanbanLaneWidth(
			board.laneWidth ?? this.view.kanbanLaneWidth ?? DEFAULT_KANBAN_LANE_WIDTH,
			DEFAULT_KANBAN_LANE_WIDTH
		);
		this.view.kanbanFontScale = sanitizeKanbanFontScale(
			board.fontScale ?? this.view.kanbanFontScale ?? DEFAULT_KANBAN_FONT_SCALE
		);
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
		this.view.kanbanFontScale = DEFAULT_KANBAN_FONT_SCALE;
		this.view.kanbanInitialVisibleCount = DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT;
		this.view.kanbanCardContentConfig = null;
		this.view.kanbanSortField = null;
		this.view.kanbanSortDirection = DEFAULT_KANBAN_SORT_DIRECTION;
		this.view.kanbanLanePresets = [];
		this.view.kanbanLaneOrder = [];
		this.laneFieldRepair.reset();
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
		this.view.kanbanFontScale = DEFAULT_KANBAN_FONT_SCALE;
		this.view.kanbanInitialVisibleCount = DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT;
		this.view.kanbanCardContentConfig = null;
		this.view.kanbanSortField = null;
		this.view.kanbanSortDirection = DEFAULT_KANBAN_SORT_DIRECTION;
		this.view.kanbanLanePresets = [];
		this.view.kanbanLaneOrder = [];
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
			this.dialogs.getLaneFieldCandidates().length === 0
		) {
			return;
		}

		this.ensureDefaultLaneField();
		this.autoCreateInProgress = true;
		void this.handleAutoBoardCreation()
			.catch(() => undefined)
			.finally(() => {
				this.autoCreateInProgress = false;
			});
	}

	private async handleAutoBoardCreation(): Promise<void> {
		const defaultBoard = await createDefaultStatusBoard({
			view: this.view,
			store: this.store,
			laneFieldCandidates: this.dialogs.getLaneFieldCandidates()
		});
		if (defaultBoard) {
			this.applyBoardContext(defaultBoard, { persist: true, rerender: true });
			this.refreshToolbar();
			return;
		}
		await this.createBoard();
	}

	private ensureDefaultLaneField(): void {
		if (this.view.kanbanLaneField) {
			return;
		}
		const schema = this.view.schema;
		const statusField = schema?.columnNames?.find((column) => column?.trim().toLowerCase() === 'status');
		if (statusField) {
			this.view.kanbanLaneField = statusField;
		}
	}
	private isLaneFieldAvailable(field: string): boolean {
		const candidates = this.dialogs.getLaneFieldCandidates();
		return candidates.includes(field);
	}
	private async handleInvalidLaneField(board: KanbanBoardDefinition): Promise<void> {
		this.laneFieldRepair.markMissing(board.id);
		if (this.repairingLaneField) {
			return;
		}
		if (!this.laneFieldRepair.hasLaneFieldPrerequisites()) {
			return;
		}

		this.laneFieldRepair.clearPending();
		this.repairingLaneField = true;
		try {
			const editor = await this.dialogs.openBoardModal({
				title: t('kanbanView.toolbar.editBoardTitle'),
				defaultName: board.name,
				defaultIcon: board.icon ?? null,
				...this.dialogs.getModalDefaults(board),
				initialLaneField: null
			});
			if (!editor) {
				return;
			}
			const updated = this.store.updateBoard(board.id, {
				name: editor.name,
				icon: editor.icon,
				laneField: editor.laneField,
				laneWidth: editor.laneWidth,
				fontScale: editor.fontScale,
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

	public processPendingLaneFieldRepairs(): void {
		if (this.repairingLaneField) {
			return;
		}
		if (!this.laneFieldRepair.hasLaneFieldPrerequisites()) {
			return;
		}
		const boardId = this.laneFieldRepair.getPendingBoardId();
		if (!boardId) {
			return;
		}
		const state = this.store.getState();
		const board = state.boards.find((entry) => entry.id === boardId);
		if (!board) {
			this.laneFieldRepair.clearPending();
			return;
		}
		const laneField = typeof board.laneField === 'string' ? board.laneField.trim() : '';
		if (laneField.length > 0 && this.isLaneFieldAvailable(laneField)) {
			this.laneFieldRepair.reset();
			this.applyBoardContext(board, { persist: false, rerender: false });
			return;
		}
		void this.handleInvalidLaneField(board);
	}

	public async updateActiveLaneOrder(laneNames: string[]): Promise<void> {
		const boardId = this.view.activeKanbanBoardId;
		if (!boardId || !Array.isArray(laneNames)) {
			return;
		}
		const applied = this.store.applyLaneOrder(boardId, laneNames);
		if (!applied) {
			return;
		}
		this.view.kanbanLaneOrder = [...applied];
		await this.store.persist();
	}

	public async addLanePreset(): Promise<void> {
		const board = this.getActiveBoardDefinition();
		if (!board) {
			return;
		}
		const laneField =
			typeof this.view.kanbanLaneField === 'string' ? this.view.kanbanLaneField.trim() : '';
		if (!laneField) {
			new Notice(t('kanbanView.lanePresetModal.missingLaneField'));
			return;
		}
		if (isStatusLaneField(laneField)) {
			new Notice(t('kanbanView.lanePresetModal.statusFieldBlocked'));
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
		this.applyBoardContext(updated, { persist: false, rerender: true });
		new Notice(t('kanbanView.lanePresetModal.successNotice', { name: preset }));
	}
}
