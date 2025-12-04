export const MIN_KANBAN_LANE_WIDTH = 12;
export const MAX_KANBAN_LANE_WIDTH = 32;
export const DEFAULT_KANBAN_LANE_WIDTH = 15;

const DECIMAL_PRECISION = 2;

const clamp = (value: number, min: number, max: number): number =>
	Math.min(Math.max(value, min), max);

const round = (value: number): number =>
	Math.round(value * 10 ** DECIMAL_PRECISION) / 10 ** DECIMAL_PRECISION;

export function parseKanbanLaneWidth(value: unknown): number | null {
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
	return clamp(round(numeric), MIN_KANBAN_LANE_WIDTH, MAX_KANBAN_LANE_WIDTH);
}

export function sanitizeKanbanLaneWidth(value: unknown, fallback = DEFAULT_KANBAN_LANE_WIDTH): number {
	const parsed = parseKanbanLaneWidth(value);
	return parsed === null ? fallback : parsed;
}
