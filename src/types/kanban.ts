import type { FilterRule } from './filterView';

export type KanbanSortDirection = 'asc' | 'desc';

export interface KanbanBoardDefinition {
	id: string;
	name: string;
	icon?: string | null;
	laneField: string;
	filterRule?: FilterRule | null;
	laneWidth?: number | null;
	sortField?: string | null;
	sortDirection?: KanbanSortDirection | null;
}

export interface KanbanBoardState {
	boards: KanbanBoardDefinition[];
	activeBoardId: string | null;
}

export const DEFAULT_KANBAN_BOARD_STATE: KanbanBoardState = {
	boards: [],
	activeBoardId: null
};

export const DEFAULT_KANBAN_SORT_FIELD = 'statusChanged';
export const DEFAULT_KANBAN_SORT_DIRECTION: KanbanSortDirection = 'desc';
