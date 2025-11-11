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
export const DEFAULT_KANBAN_SORT_FIELD = '';
export const DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT = 10;
export const MIN_KANBAN_INITIAL_VISIBLE_COUNT = 1;
export const MAX_KANBAN_INITIAL_VISIBLE_COUNT = 500;
export const DEFAULT_KANBAN_FONT_SCALE = 1;
export const MIN_KANBAN_FONT_SCALE = 0.75;
export const MAX_KANBAN_FONT_SCALE = 1.5;
const KANBAN_FONT_SCALE_DECIMALS = 2;

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

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
const roundScale = (value: number): number =>
	Math.round(value * 10 ** KANBAN_FONT_SCALE_DECIMALS) / 10 ** KANBAN_FONT_SCALE_DECIMALS;

export function parseKanbanFontScale(value: unknown): number | null {
	if (value === null || value === undefined) {
		return null;
	}
	let numeric: number;
	if (typeof value === 'number') {
		numeric = value;
	} else if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) {
			return null;
		}
		numeric = Number(trimmed);
	} else {
		return null;
	}
	if (!Number.isFinite(numeric)) {
		return null;
	}
	return clamp(roundScale(numeric), MIN_KANBAN_FONT_SCALE, MAX_KANBAN_FONT_SCALE);
}

export function sanitizeKanbanFontScale(value: unknown, fallback = DEFAULT_KANBAN_FONT_SCALE): number {
	const parsed = parseKanbanFontScale(value);
	return parsed === null ? fallback : parsed;
}

export interface KanbanBoardDefinition {
	id: string;
	name: string;
	icon?: string | null;
	laneField: string;
	lanePresets?: string[] | null;
	laneOrderOverrides?: string[] | null;
	laneWidth?: number | null;
	filterRule?: FilterRule | null;
	initialVisibleCount?: number | null;
	content?: KanbanCardContentConfig | null;
	sortField?: string | null;
	sortDirection?: KanbanSortDirection | null;
	fontScale?: number | null;
}

export interface KanbanBoardState {
	boards: KanbanBoardDefinition[];
	activeBoardId: string | null;
}

export const DEFAULT_KANBAN_BOARD_STATE: KanbanBoardState = {
	boards: [],
	activeBoardId: null
};

export interface KanbanViewPreferenceConfig {
	laneField: string;
	sortField?: string | null;
	sortDirection?: KanbanSortDirection | null;
	heightMode?: KanbanHeightMode | null;
	fontScale?: number | null;
	multiRow?: boolean | null;
}
