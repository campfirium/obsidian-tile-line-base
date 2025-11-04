import { DEFAULT_KANBAN_HEIGHT_MODE, type KanbanHeightMode } from '../../types/kanban';

const VIEWPORT_MODE: KanbanHeightMode = 'viewport';
const AUTO_MODE: KanbanHeightMode = 'auto';

export const KANBAN_VIEWPORT_PADDING_PX = 48;
export const KANBAN_VIEWPORT_MIN_HEIGHT_PX = 240;

export function sanitizeKanbanHeightMode(
	value: unknown,
	fallback: KanbanHeightMode = DEFAULT_KANBAN_HEIGHT_MODE
): KanbanHeightMode {
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase();
		if (normalized === VIEWPORT_MODE) {
			return VIEWPORT_MODE;
		}
		if (normalized === AUTO_MODE) {
			return AUTO_MODE;
		}
	}
	return fallback;
}

export function isViewportHeightMode(mode: KanbanHeightMode): boolean {
	return mode === VIEWPORT_MODE;
}
