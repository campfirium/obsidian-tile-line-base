import type { FilterRule } from './filterView';

export interface KanbanBoardDefinition {
	id: string;
	name: string;
	icon?: string | null;
	laneField: string;
	filterRule?: FilterRule | null;
}

export interface KanbanBoardState {
	boards: KanbanBoardDefinition[];
	activeBoardId: string | null;
}

export const DEFAULT_KANBAN_BOARD_STATE: KanbanBoardState = {
	boards: [],
	activeBoardId: null
};
