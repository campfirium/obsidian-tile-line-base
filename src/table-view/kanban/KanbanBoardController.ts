import { App, Menu, Notice, Setting } from 'obsidian';
import type { TableView } from '../../TableView';
import { getLocaleCode, t } from '../../i18n';
import {
	DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT,
	MAX_KANBAN_INITIAL_VISIBLE_COUNT,
	MIN_KANBAN_INITIAL_VISIBLE_COUNT,
	sanitizeKanbanInitialVisibleCount,
	type KanbanBoardDefinition
} from '../../types/kanban';
import { KanbanBoardStore } from './KanbanBoardStore';
import type { FilterRule } from '../../types/filterView';
import { FilterViewEditorModal } from '../filter/FilterViewModals';
import type { FilterColumnOption } from '../TableViewFilterPresenter';
import { getAvailableColumns } from '../TableViewFilterPresenter';
import { KanbanBoardConfirmModal } from './KanbanBoardConfirmModal';
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
	const editor = await this.openBoardModal({
		title: t('kanbanView.toolbar.createBoardTitle'),
		defaultName: this.suggestNewBoardName(),
		defaultIcon: 'layout-kanban',
		initialFilter: null,
		initialLaneField: this.view.kanbanLaneField ?? null,
		initialVisibleCount: this.view.kanbanInitialVisibleCount
	});
		if (!editor) {
			return;
		}
		const board = this.store.createBoard({
			name: editor.name,
			icon: editor.icon,
			laneField: editor.laneField,
			filterRule: editor.filterRule,
			initialVisibleCount: editor.initialVisibleCount,
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
		initialVisibleCount: board.initialVisibleCount ?? null
	});
		if (!editor) {
			return;
		}
	const updated = this.store.updateBoard(board.id, {
		name: editor.name,
		icon: editor.icon,
		laneField: editor.laneField,
		filterRule: editor.filterRule,
		initialVisibleCount: editor.initialVisibleCount
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
		initialVisibleCount: board.initialVisibleCount ?? null
	});
		if (!editor) {
			return;
		}
	const cloned = this.store.createBoard({
		name: editor.name,
		icon: editor.icon,
		laneField: editor.laneField,
		filterRule: editor.filterRule,
		initialVisibleCount: editor.initialVisibleCount,
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
		this.repairingLaneField = false;
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
		this.view.kanbanInitialVisibleCount = sanitizeKanbanInitialVisibleCount(
			board.initialVisibleCount ?? DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT
		);
	} else {
		this.view.activeKanbanBoardFilter = null;
		this.view.activeKanbanBoardId = null;
		this.view.kanbanInitialVisibleCount = DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT;
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
		this.view.kanbanInitialVisibleCount = DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT;
		this.refreshToolbar();
		this.view.kanbanToolbar?.setActiveBoard(null);
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
				initialVisibleCount: board.initialVisibleCount ?? null
			});
			if (!editor) {
				return;
			}
	const updated = this.store.updateBoard(board.id, {
		name: editor.name,
		icon: editor.icon,
		laneField: editor.laneField,
		filterRule: editor.filterRule,
		initialVisibleCount: editor.initialVisibleCount
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
		const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
		if (!Number.isFinite(value) || value <= 0) {
			return String(value);
		}
		if (value <= 9) {
			return digits[value];
		}
		if (value === 10) {
			return '十';
		}
		if (value < 20) {
			const units = value % 10;
			return `十${units === 0 ? '' : digits[units]}`;
		}
		if (value < 100) {
			const tens = Math.floor(value / 10);
			const units = value % 10;
			const tensLabel = tens === 1 ? '十' : `${digits[tens]}十`;
			return units === 0 ? tensLabel : `${tensLabel}${digits[units]}`;
		}
		return String(value);
	}
	private async openBoardModal(options: {
		title: string;
		defaultName: string;
		defaultIcon: string | null;
		initialFilter: FilterRule | null;
		initialLaneField: string | null;
		initialVisibleCount: number | null;
	}): Promise<{
		name: string;
		icon: string | null;
		laneField: string;
		filterRule: FilterRule | null;
		initialVisibleCount: number;
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
		let selectedLane = options.initialLaneField && laneOptions.includes(options.initialLaneField)
			? options.initialLaneField
			: laneOptions[0];
		let initialVisibleCount = sanitizeKanbanInitialVisibleCount(
			options.initialVisibleCount ?? DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT,
			DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT
		);
		return new Promise((resolve) => {
			const modal = new FilterViewEditorModal(this.app, {
				title: options.title,
				columns,
				initialName: options.defaultName,
				initialIcon: options.defaultIcon,
				initialRule: options.initialFilter,
				allowFilterEditing: true,
				allowSortEditing: false,
				minConditionCount: 0,
				renderAdditionalControls: (container) => {
				const laneSetting = new Setting(container);
				laneSetting.setName(t('kanbanView.toolbar.laneFieldLabel'));
				laneSetting.addDropdown((dropdown) => {
					for (const option of laneOptions) {
						dropdown.addOption(option, option);
					}
					dropdown.setValue(selectedLane);
					dropdown.onChange((value) => {
						selectedLane = value;
					});
				});
				const countSetting = new Setting(container);
				countSetting.setName(t('kanbanView.toolbar.initialVisibleCountLabel'));
				countSetting.setDesc(t('kanbanView.toolbar.initialVisibleCountDesc'));
				countSetting.addText((text) => {
					text.inputEl.type = 'number';
					text.inputEl.min = String(MIN_KANBAN_INITIAL_VISIBLE_COUNT);
					text.inputEl.max = String(MAX_KANBAN_INITIAL_VISIBLE_COUNT);
					text.setValue(String(initialVisibleCount));
					text.onChange((raw) => {
						const trimmed = raw.trim();
						if (!trimmed) {
							return;
						}
						initialVisibleCount = sanitizeKanbanInitialVisibleCount(trimmed, initialVisibleCount);
					});
					text.inputEl.addEventListener('blur', () => {
						initialVisibleCount = sanitizeKanbanInitialVisibleCount(initialVisibleCount);
						text.setValue(String(initialVisibleCount));
					});
				});
			},
			onSubmit: (result) => {
					const trimmed = result.name?.trim();
					if (!trimmed) {
						resolve(null);
						return;
					}
					const laneField = typeof selectedLane === 'string' ? selectedLane.trim() : '';
				resolve({
					name: trimmed,
					icon: result.icon ?? null,
					laneField: laneField.length > 0 ? laneField : laneOptions[0],
					filterRule: result.filterRule ?? null,
					initialVisibleCount: sanitizeKanbanInitialVisibleCount(initialVisibleCount)
				});
				},
				onCancel: () => resolve(null)
			});
			modal.open();
		});
	}
}
