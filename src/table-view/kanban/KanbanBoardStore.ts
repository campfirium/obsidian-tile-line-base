import { getPluginContext } from '../../pluginContext';
import type { FilterRule } from '../../types/filterView';
import type {
	KanbanBoardDefinition,
	KanbanBoardState,
	KanbanCardContentConfig,
	KanbanSortDirection
} from '../../types/kanban';
import {
	DEFAULT_KANBAN_BOARD_STATE,
	DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT,
	DEFAULT_KANBAN_SORT_DIRECTION,
	sanitizeKanbanFontScale,
	sanitizeKanbanInitialVisibleCount
} from '../../types/kanban';
import { cloneKanbanContentConfig, isKanbanContentConfigEffectivelyEmpty } from './KanbanContentConfig';
import { DEFAULT_KANBAN_LANE_WIDTH, sanitizeKanbanLaneWidth } from './kanbanWidth';

export interface CreateBoardOptions {
	name: string;
	icon: string | null;
	laneField: string;
	lanePresets?: string[] | null;
	laneOrderOverrides?: string[] | null;
	laneWidth?: number | null;
	fontScale?: number | null;
	filterRule: FilterRule | null;
	setActive?: boolean;
	initialVisibleCount?: number | null;
	content?: KanbanCardContentConfig | null;
	sortField?: string | null;
	sortDirection?: KanbanSortDirection | null;
}

export interface UpdateBoardOptions {
	name?: string | null;
	icon?: string | null;
	laneField?: string | null;
	lanePresets?: string[] | null;
	laneOrderOverrides?: string[] | null;
	laneWidth?: number | null;
	fontScale?: number | null;
	filterRule?: FilterRule | null;
	initialVisibleCount?: number | null;
	content?: KanbanCardContentConfig | null;
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
		const laneOrderOverrides = this.normalizeLaneOrderOverrides(options.laneOrderOverrides);
		const board: KanbanBoardDefinition = {
			id: this.generateId(),
			name: this.sanitizeName(options.name),
			icon: this.sanitizeIcon(options.icon),
			laneField: this.sanitizeLaneField(options.laneField),
			lanePresets: this.sanitizeLanePresets(options.lanePresets),
			laneOrderOverrides,
			laneWidth: this.sanitizeLaneWidth(options.laneWidth),
			fontScale: this.sanitizeFontScale(options.fontScale),
			filterRule: this.cloneFilterRule(options.filterRule),
			initialVisibleCount: this.sanitizeInitialVisibleCount(options.initialVisibleCount),
			content: this.sanitizeContentConfig(options.content),
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
		if (updates.lanePresets !== undefined) {
			target.lanePresets = this.sanitizeLanePresets(updates.lanePresets);
		}
		if (updates.laneOrderOverrides !== undefined) {
			target.laneOrderOverrides = this.normalizeLaneOrderOverrides(updates.laneOrderOverrides);
		}
		if (updates.laneWidth !== undefined) {
			target.laneWidth = this.sanitizeLaneWidth(updates.laneWidth);
		}
		if (updates.fontScale !== undefined) {
			target.fontScale = this.sanitizeFontScale(updates.fontScale);
		}
		if (updates.filterRule !== undefined) {
			target.filterRule = this.cloneFilterRule(updates.filterRule);
		}
		if (updates.initialVisibleCount !== undefined) {
			target.initialVisibleCount = this.sanitizeInitialVisibleCount(updates.initialVisibleCount);
		}
		if (updates.content !== undefined) {
			target.content = this.sanitizeContentConfig(updates.content);
		}
		if (updates.sortField !== undefined) {
			target.sortField = this.sanitizeSortField(updates.sortField);
		}
		if (updates.sortDirection !== undefined) {
			target.sortDirection = this.sanitizeSortDirection(updates.sortDirection);
		}
		return {
			...target,
			lanePresets: Array.isArray(target.lanePresets) ? [...target.lanePresets] : [],
			laneOrderOverrides: Array.isArray(target.laneOrderOverrides)
				? [...target.laneOrderOverrides]
				: null
		};
	}

	applyLaneOrder(id: string, laneNames: string[]): string[] | undefined {
		const target = this.state.boards.find((board) => board.id === id);
		if (!target) {
			return undefined;
		}
		const next = this.normalizeLaneOrderOverrides(laneNames);
		if (this.areLaneOrdersEqual(target.laneOrderOverrides, next)) {
			return undefined;
		}
		target.laneOrderOverrides = next ? [...next] : null;
		return next ? [...next] : [];
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

	private sanitizeInitialVisibleCount(value: number | string | null | undefined): number {
		return sanitizeKanbanInitialVisibleCount(
			value ?? DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT,
			DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT
		);
	}

	private sanitizeContentConfig(config: KanbanCardContentConfig | null | undefined): KanbanCardContentConfig | null {
		if (!config) {
			return null;
		}
		const normalized = cloneKanbanContentConfig(config);
		return isKanbanContentConfigEffectivelyEmpty(normalized) ? null : normalized;
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

	private sanitizeLanePresets(values: string[] | null | undefined): string[] {
		if (!Array.isArray(values)) {
			return [];
		}
		const result: string[] = [];
		const seen = new Set<string>();
		for (const value of values) {
			const label = typeof value === 'string' ? value.trim() : '';
			if (!label) {
				continue;
			}
			const normalized = label.toLowerCase();
			if (seen.has(normalized)) {
				continue;
			}
			seen.add(normalized);
			result.push(label);
		}
		return result;
	}

	private sanitizeLaneOrderOverrides(values: string[] | null | undefined): string[] {
		if (!Array.isArray(values)) {
			return [];
		}
		const result: string[] = [];
		const seen = new Set<string>();
		for (const value of values) {
			const label = typeof value === 'string' ? value.trim() : '';
			if (!label) {
				continue;
			}
			const normalized = label.toLowerCase();
			if (seen.has(normalized)) {
				continue;
			}
			seen.add(normalized);
			result.push(label);
		}
		return result;
	}

	private normalizeLaneOrderOverrides(values: string[] | null | undefined): string[] | null {
		const sanitized = this.sanitizeLaneOrderOverrides(values);
		return sanitized.length > 0 ? sanitized : null;
	}

	private sanitizeSortField(field: string | null | undefined): string | null {
		if (typeof field !== 'string') {
			return null;
		}
		const trimmed = field.trim();
		return trimmed.length > 0 ? trimmed : null;
	}

	private sanitizeSortDirection(
		direction: KanbanSortDirection | null | undefined
	): KanbanSortDirection {
		if (direction === 'asc' || direction === 'desc') {
			return direction;
		}
		return DEFAULT_KANBAN_SORT_DIRECTION;
	}

	private sanitizeLaneWidth(value: unknown): number {
		return sanitizeKanbanLaneWidth(value, DEFAULT_KANBAN_LANE_WIDTH);
	}

	private sanitizeFontScale(value: unknown): number {
		return sanitizeKanbanFontScale(value);
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
						lanePresets: this.sanitizeLanePresets(board.lanePresets ?? null),
						laneWidth: this.sanitizeLaneWidth(board.laneWidth ?? null),
						fontScale: this.sanitizeFontScale(board.fontScale ?? null),
						filterRule: this.cloneFilterRule(board.filterRule ?? null),
						initialVisibleCount: this.sanitizeInitialVisibleCount(board.initialVisibleCount ?? null),
						content: this.sanitizeContentConfig(board.content ?? null),
						sortField: this.sanitizeSortField(board.sortField ?? null),
						sortDirection: this.sanitizeSortDirection(board.sortDirection ?? null),
						laneOrderOverrides: this.normalizeLaneOrderOverrides(board.laneOrderOverrides ?? null)
					}))
			: [];
		return {
			boards,
			activeBoardId: typeof state.activeBoardId === 'string' ? state.activeBoardId : null
		};
	}

	private areLaneOrdersEqual(
		current: string[] | null | undefined,
		next: string[] | null
	): boolean {
		const normalize = (values: string[] | null | undefined): string[] | null => {
			if (!Array.isArray(values) || values.length === 0) {
				return null;
			}
			return values;
		};
		const a = normalize(current);
		const b = normalize(next);
		if (!a && !b) {
			return true;
		}
		if (!a || !b || a.length !== b.length) {
			return false;
		}
		for (let i = 0; i < a.length; i += 1) {
			if (a[i] !== b[i]) {
				return false;
			}
		}
		return true;
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
}
