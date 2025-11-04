import { getPluginContext } from '../../pluginContext';
import type { FilterRule } from '../../types/filterView';
import type { KanbanBoardDefinition, KanbanBoardState, KanbanCardContentConfig, KanbanSortDirection } from '../../types/kanban';
import { DEFAULT_KANBAN_BOARD_STATE, DEFAULT_KANBAN_CARD_CONTENT, DEFAULT_KANBAN_SORT_DIRECTION, DEFAULT_KANBAN_SORT_FIELD } from '../../types/kanban';
import { DEFAULT_KANBAN_LANE_WIDTH, sanitizeKanbanLaneWidth } from './kanbanWidth';

export interface CreateBoardOptions {
	name: string;
	icon: string | null;
	laneField: string;
	filterRule: FilterRule | null;
	content: KanbanCardContentConfig;
	laneWidth?: number | null;
	setActive?: boolean;
	sortField?: string | null;
	sortDirection?: KanbanSortDirection | null;
}

export interface UpdateBoardOptions {
	name?: string | null;
	icon?: string | null;
	laneField?: string | null;
	filterRule?: FilterRule | null;
	content?: KanbanCardContentConfig | null;
	laneWidth?: number | null;
	sortField?: string | null;
	sortDirection?: KanbanSortDirection | null;
}

export class KanbanBoardStore {
	private state: KanbanBoardState = this.cloneState(DEFAULT_KANBAN_BOARD_STATE);
	private filePath: string | null;

	constructor(filePath: string | null) {
		this.filePath = filePath;
	}

	setFilePath(filePath: string | null): void {
		this.filePath = filePath;
	}

	reset(): void {
		this.state = this.cloneState(DEFAULT_KANBAN_BOARD_STATE);
	}

	loadFromSettings(): KanbanBoardState {
		const filePath = this.filePath;
		if (!filePath) {
			this.reset();
			return this.cloneState(this.state);
		}
		const plugin = getPluginContext();
		if (!plugin || typeof plugin.getKanbanBoardsForFile !== 'function') {
			this.reset();
			return this.cloneState(this.state);
		}
		const raw = plugin.getKanbanBoardsForFile(filePath);
		this.state = this.cloneState(raw);
		return this.cloneState(this.state);
	}

	async persist(): Promise<void> {
		const filePath = this.filePath;
		if (!filePath) {
			return;
		}
		const plugin = getPluginContext();
		if (!plugin || typeof plugin.saveKanbanBoardsForFile !== 'function') {
			return;
		}
		await plugin.saveKanbanBoardsForFile(filePath, this.cloneState(this.state));
	}

	getState(): KanbanBoardState {
		return this.cloneState(this.state);
	}

	setState(next: KanbanBoardState | null | undefined): void {
		if (next && Array.isArray(next.boards)) {
			this.state = this.cloneState(next);
		} else {
			this.reset();
		}
	}

	updateState(updater: (state: KanbanBoardState) => void): KanbanBoardState {
		updater(this.state);
		return this.getState();
	}

	createBoard(options: CreateBoardOptions): KanbanBoardDefinition {
		const board: KanbanBoardDefinition = {
			id: this.generateId(),
			name: this.sanitizeName(options.name),
			icon: this.sanitizeIcon(options.icon),
			laneField: this.sanitizeLaneField(options.laneField),
			filterRule: this.cloneFilterRule(options.filterRule),
			content: this.cloneContent(options.content),
			laneWidth: this.sanitizeLaneWidth(options.laneWidth),
			sortField: this.sanitizeSortField(options.sortField),
			sortDirection: this.sanitizeSortDirection(options.sortDirection)
		};
		this.state.boards.push(board);
		if (options.setActive !== false) {
			this.state.activeBoardId = board.id;
		}
		return board;
	}

	updateBoard(id: string, updates: UpdateBoardOptions): KanbanBoardDefinition | null {
		const target = this.state.boards.find((board) => board.id === id);
		if (!target) {
			return null;
		}
		if (updates.name !== undefined) {
			target.name = this.sanitizeName(updates.name);
		}
		if (updates.icon !== undefined) {
			target.icon = this.sanitizeIcon(updates.icon);
		}
		if (updates.laneField !== undefined) {
			const lane = this.sanitizeLaneField(updates.laneField);
			if (lane) {
				target.laneField = lane;
			}
		}
		if (updates.filterRule !== undefined) {
			target.filterRule = this.cloneFilterRule(updates.filterRule);
		}
		if (updates.content !== undefined) {
			target.content = this.cloneContent(updates.content);
		}
		if (updates.laneWidth !== undefined) {
			target.laneWidth = this.sanitizeLaneWidth(updates.laneWidth);
		}
		if (updates.sortField !== undefined) {
			target.sortField = this.sanitizeSortField(updates.sortField);
		}
		if (updates.sortDirection !== undefined) {
			target.sortDirection = this.sanitizeSortDirection(updates.sortDirection);
		}
		return { ...target };
	}

	deleteBoard(id: string): boolean {
		const index = this.state.boards.findIndex((board) => board.id === id);
		if (index === -1) {
			return false;
		}
		this.state.boards.splice(index, 1);
		if (this.state.activeBoardId === id) {
			this.state.activeBoardId = this.state.boards[0]?.id ?? null;
		}
		return true;
	}

	setActiveBoard(id: string | null): void {
		if (id && !this.state.boards.some((board) => board.id === id)) {
			return;
		}
		this.state.activeBoardId = id;
	}

	private sanitizeIcon(icon: string | null | undefined): string | null {
		if (!icon || typeof icon !== 'string') {
			return null;
		}
		const trimmed = icon.trim();
		return trimmed.length > 0 ? trimmed : null;
	}

	private sanitizeName(name: string | null | undefined): string {
		if (typeof name !== 'string') {
			return '';
		}
		const trimmed = name.trim();
		return trimmed.length > 0 ? trimmed : '';
	}

	private sanitizeLaneField(field: string | null | undefined): string {
		if (typeof field !== 'string') {
			return '';
		}
		const trimmed = field.trim();
		return trimmed.length > 0 ? trimmed : '';
	}

	private generateId(): string {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
		return `kb-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
	}

	private cloneState(state: KanbanBoardState | null | undefined): KanbanBoardState {
		if (!state) {
			return this.cloneState(DEFAULT_KANBAN_BOARD_STATE);
		}
		const boards = Array.isArray(state.boards)
			? state.boards
					.filter((board): board is KanbanBoardDefinition => !!board && typeof board.id === 'string')
					.map((board) => ({
						id: board.id,
						name: this.sanitizeName(board.name),
						icon: this.sanitizeIcon(board.icon),
						laneField: this.sanitizeLaneField(board.laneField ?? null),
						filterRule: this.cloneFilterRule(board.filterRule ?? null),
						content: this.cloneContent(board.content ?? null),
						laneWidth: this.sanitizeLaneWidth(board.laneWidth ?? null),
						sortField: this.sanitizeSortField(board.sortField ?? null),
						sortDirection: this.sanitizeSortDirection(board.sortDirection ?? null)
					}))
			: [];
		return {
			boards,
			activeBoardId: typeof state.activeBoardId === 'string' ? state.activeBoardId : null
		};
	}

	private sanitizeLaneWidth(width: number | string | null | undefined): number {
		return sanitizeKanbanLaneWidth(width ?? DEFAULT_KANBAN_LANE_WIDTH);
	}

	private sanitizeSortField(field: string | null | undefined): string {
		if (typeof field !== 'string') {
			return DEFAULT_KANBAN_SORT_FIELD;
		}
		const trimmed = field.trim();
		return trimmed.length > 0 ? trimmed : DEFAULT_KANBAN_SORT_FIELD;
	}

	private sanitizeSortDirection(direction: KanbanSortDirection | string | null | undefined): KanbanSortDirection {
		return direction === 'asc' ? 'asc' : DEFAULT_KANBAN_SORT_DIRECTION;
	}

	private cloneFilterRule(rule: FilterRule | null | undefined): FilterRule | null {
		if (!rule) {
			return null;
		}
		try {
			return JSON.parse(JSON.stringify(rule)) as FilterRule;
		} catch {
			return null;
		}
	}

	private cloneContent(content: KanbanCardContentConfig | null | undefined): KanbanCardContentConfig {
		const base = DEFAULT_KANBAN_CARD_CONTENT;
		const normalize = (value: unknown): string => {
			if (typeof value !== 'string') {
				return '';
			}
			return value.replace(/\r\n/g, '\n').replace(/\{\{\s*/g, '{').replace(/\s*\}\}/g, '}');
		};
		return {
			titleTemplate: normalize(content?.titleTemplate) || base.titleTemplate,
			bodyTemplate: normalize(content?.bodyTemplate) || base.bodyTemplate,
			tagsTemplate: normalize(content?.tagsTemplate) || base.tagsTemplate,
			showBody: typeof content?.showBody === 'boolean' ? content.showBody : base.showBody
		};
	}
}


