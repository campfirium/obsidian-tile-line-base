import { App, Menu, Notice } from 'obsidian';
import type { TableView } from '../../TableView';
import { getLocaleCode, t } from '../../i18n';
import type { KanbanBoardDefinition } from '../../types/kanban';
import { KanbanBoardStore } from './KanbanBoardStore';
import type { FilterRule } from '../../types/filterView';
import type { FilterColumnOption } from '../TableViewFilterPresenter';
import { getAvailableColumns } from '../TableViewFilterPresenter';
import {
	DEFAULT_KANBAN_LANE_WIDTH,
	sanitizeKanbanLaneWidth
} from './kanbanWidth';
import {
	confirmKanbanBoardDeletion,
	openKanbanBoardEditor,
	type KanbanBoardEditorResult
} from './KanbanBoardModals';

interface KanbanBoardControllerOptions {
	app: App;
	view: TableView;
	store: KanbanBoardStore;
}

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

	getBoards(): KanbanBoardDefinition[] {
		return this.store.getState().boards;
	}

	getActiveBoardId(): string | null {
		return this.store.getState().activeBoardId;
	}

	async createBoard(): Promise<void> {
		const editor = await this.openBoardEditor({
			title: t('kanbanView.toolbar.createBoardTitle'),
			defaultName: this.suggestNewBoardName(),
			defaultIcon: 'layout-kanban',
			initialFilter: null,
			initialLaneField: this.view.kanbanLaneField ?? null,
			initialLaneWidth: this.view.kanbanLaneWidth ?? DEFAULT_KANBAN_LANE_WIDTH
		});
		if (!editor) {
			return;
		}

		const board = this.store.createBoard({
			name: editor.name,
			icon: editor.icon,
			laneField: editor.laneField,
			filterRule: editor.filterRule,
			laneWidth: editor.laneWidth,
			setActive: true
		});
		await this.store.persist();
		this.applyBoardContext(board, { persist: true, rerender: true });
		this.refreshToolbar();
	}

	async editBoard(board: KanbanBoardDefinition): Promise<void> {
		const editor = await this.openBoardEditor({
			title: t('kanbanView.toolbar.editBoardTitle'),
			defaultName: board.name,
			defaultIcon: board.icon ?? null,
			initialFilter: board.filterRule ?? null,
			initialLaneField: board.laneField,
			initialLaneWidth: board.laneWidth ?? null
		});
		if (!editor) {
			return;
		}

		const updated = this.store.updateBoard(board.id, {
			name: editor.name,
			icon: editor.icon,
			laneField: editor.laneField,
			filterRule: editor.filterRule,
			laneWidth: editor.laneWidth
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
		const editor = await this.openBoardEditor({
			title: t('kanbanView.toolbar.duplicateBoardTitle', {
				name: board.name || t('kanbanView.toolbar.unnamedBoardLabel')
			}),
			defaultName: duplicatedName,
			defaultIcon: board.icon ?? null,
			initialFilter: board.filterRule ?? null,
			initialLaneField: board.laneField,
			initialLaneWidth: board.laneWidth ?? null
		});
		if (!editor) {
			return;
		}

		const cloned = this.store.createBoard({
			name: editor.name,
			icon: editor.icon,
			laneField: editor.laneField,
			filterRule: editor.filterRule,
			laneWidth: editor.laneWidth,
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

		const confirmed = await confirmKanbanBoardDeletion(
			this.app,
			board.name || t('kanbanView.toolbar.unnamedBoardLabel')
		);
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
		if (nextState.boards.length === 0) {
			this.handleEmptyBoards();
			return;
		}
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
		const menu = new Menu();
		menu.addItem((item) => {
			item
				.setTitle(t('kanbanView.toolbar.editBoardLabel'))
				.setIcon('pencil')
				.onClick(() => {
					void this.editBoard(board);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('kanbanView.toolbar.duplicateBoardLabel'))
				.setIcon('copy')
				.onClick(() => {
					void this.duplicateBoard(board);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('kanbanView.toolbar.deleteBoardLabel'))
				.setIcon('trash-2')
				.onClick(() => {
					void this.deleteBoard(board);
				});
		});
		menu.showAtPosition({ x: event.clientX, y: event.clientY });
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
		this.view.kanbanBoardsLoaded = false;
		this.view.kanbanLaneWidth = DEFAULT_KANBAN_LANE_WIDTH;
		this.repairingLaneField = false;
		this.autoCreateInProgress = false;
	}

	private applyBoardContext(
		board: KanbanBoardDefinition | null,
		options?: { persist?: boolean; rerender?: boolean }
	): void {
		if (board) {
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
				board.laneWidth ?? null,
				this.view.kanbanLaneWidth ?? DEFAULT_KANBAN_LANE_WIDTH
			);
		} else {
			this.view.activeKanbanBoardFilter = null;
			this.view.activeKanbanBoardId = null;
			this.view.kanbanLaneWidth = DEFAULT_KANBAN_LANE_WIDTH;
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
		this.refreshToolbar();
		this.view.kanbanToolbar?.setActiveBoard(null);
		this.maybeTriggerAutoCreate();
	}

	ensureBoardForActiveKanbanView(): void {
		this.maybeTriggerAutoCreate();
	}

	private maybeTriggerAutoCreate(): void {
		if (this.view.activeViewMode !== 'kanban') {
			return;
		}
		if (this.autoCreateInProgress) {
			return;
		}
		const state = this.store.getState();
		if (state.boards.length > 0) {
			return;
		}
		const schema = this.view.schema;
		if (!schema || !Array.isArray(schema.columnNames) || schema.columnNames.length === 0) {
			return;
		}
		if (this.getLaneFieldCandidates().length === 0) {
			return;
		}

		this.autoCreateInProgress = true;
		void this.createBoard()
			.catch(() => {
				// noop
			})
			.finally(() => {
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
			const editor = await this.openBoardEditor({
				title: t('kanbanView.toolbar.editBoardTitle'),
				defaultName: board.name,
				defaultIcon: board.icon ?? null,
				initialFilter: board.filterRule ?? null,
				initialLaneField: null,
				initialLaneWidth: board.laneWidth ?? null
			});
			if (!editor) {
				return;
			}
			const updated = this.store.updateBoard(board.id, {
				name: editor.name,
				icon: editor.icon,
				laneField: editor.laneField,
				filterRule: editor.filterRule,
				laneWidth: editor.laneWidth
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

	private suggestNewBoardName(): string {
		const existing = new Set(
			this.store
				.getState()
				.boards.map((entry) => (typeof entry.name === 'string' ? entry.name.toLowerCase() : ''))
		);
		const base = t('kanbanView.toolbar.newBoardPlaceholder').trim();
		for (let index = 1; index < 100; index += 1) {
			const candidate = this.composeDefaultBoardName(base, index);
			if (!existing.has(candidate.toLowerCase())) {
				return candidate;
			}
		}
		const fallbackBase = base.length > 0 ? base : 'Board';
		return `${fallbackBase} ${Date.now()}`;
	}

	private composeDefaultBoardName(base: string, index: number): string {
		const locale = getLocaleCode();
		const normalizedBase = base.length > 0 ? base : t('kanbanView.toolbar.newBoardPlaceholder');
		if (locale === 'zh') {
			return `${normalizedBase}${this.toChineseNumeral(index)}`;
		}
		return normalizedBase.length > 0 ? `${normalizedBase} ${index}` : `Board ${index}`;
	}

	private toChineseNumeral(value: number): string {
		const digits = ['\u96f6', '\u4e00', '\u4e8c', '\u4e09', '\u56db', '\u4e94', '\u516d', '\u4e03', '\u516b', '\u4e5d'];
		if (!Number.isFinite(value) || value <= 0) {
			return String(value);
		}
		if (value <= 9) {
			return digits[value];
		}
		const ten = '\u5341';
		if (value === 10) {
			return ten;
		}
		if (value < 20) {
			const units = value % 10;
			return ten + (units === 0 ? '' : digits[units]);
		}
		if (value < 100) {
			const tens = Math.floor(value / 10);
			const units = value % 10;
			const tensLabel = tens === 1 ? ten : digits[tens] + ten;
			return units === 0 ? tensLabel : tensLabel + digits[units];
		}
		return String(value);
	}

	private async openBoardEditor(options: {
		title: string;
		defaultName: string;
		defaultIcon: string | null;
		initialFilter: FilterRule | null;
		initialLaneField: string | null;
		initialLaneWidth: number | null;
	}): Promise<KanbanBoardEditorResult | null> {
		return openKanbanBoardEditor({
			app: this.app,
			title: options.title,
			defaultName: options.defaultName,
			defaultIcon: options.defaultIcon,
			initialFilter: options.initialFilter,
			initialLaneField: options.initialLaneField,
			initialLaneWidth: options.initialLaneWidth,
			columns: this.getFilterColumnOptions(),
			laneOptions: this.getLaneFieldCandidates()
		});
	}
}
