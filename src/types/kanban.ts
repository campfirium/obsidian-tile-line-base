import type { FilterRule } from './filterView';

export type KanbanHeightMode = 'auto' | 'viewport';
export type KanbanSortDirection = 'asc' | 'desc';

export interface KanbanCardContentConfig {
	titleTemplate: string;
	bodyTemplate: string;
	tagsTemplate: string;
	showBody: boolean;
	tagsBelowBody: boolean;
}

export interface KanbanRuntimeCardContent extends KanbanCardContentConfig {
	referencedFields: string[];
}

export const DEFAULT_KANBAN_HEIGHT_MODE: KanbanHeightMode = 'auto';
export const DEFAULT_KANBAN_SORT_DIRECTION: KanbanSortDirection = 'asc';
export const DEFAULT_KANBAN_SORT_FIELD = '看板排序';
export const DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT = 10;
export const MIN_KANBAN_INITIAL_VISIBLE_COUNT = 1;
export const MAX_KANBAN_INITIAL_VISIBLE_COUNT = 500;

export const DEFAULT_KANBAN_CARD_CONTENT: KanbanCardContentConfig = {
	titleTemplate: '',
	bodyTemplate: '',
	tagsTemplate: '',
	showBody: true,
	tagsBelowBody: false
};

export function sanitizeKanbanInitialVisibleCount(
	value: unknown,
	fallback = DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT
): number {
	let numeric: number | null = null;
	if (typeof value === 'number') {
		numeric = value;
	} else if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed.length > 0) {
			const parsed = Number(trimmed);
			if (Number.isFinite(parsed)) {
				numeric = parsed;
			}
		}
	}
	if (!Number.isFinite(numeric ?? Number.NaN)) {
		numeric = fallback;
	}
	const bounded = Math.floor(numeric ?? fallback);
	return Math.min(MAX_KANBAN_INITIAL_VISIBLE_COUNT, Math.max(MIN_KANBAN_INITIAL_VISIBLE_COUNT, bounded));
}

export interface KanbanBoardDefinition {
	id: string;
	name: string;
	icon?: string | null;
	laneField: string;
	filterRule?: FilterRule | null;
	initialVisibleCount?: number | null;
	content?: KanbanCardContentConfig | null;
}

export interface KanbanBoardState {
	boards: KanbanBoardDefinition[];
	activeBoardId: string | null;
}

export const DEFAULT_KANBAN_BOARD_STATE: KanbanBoardState = {
	boards: [],
	activeBoardId: null
};
