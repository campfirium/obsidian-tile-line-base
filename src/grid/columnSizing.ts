export const COLUMN_MIN_WIDTH = 60;
export const COLUMN_MAX_WIDTH = 420;

export function clampColumnWidth(width: number): number {
	if (Number.isNaN(width)) {
		return COLUMN_MIN_WIDTH;
	}
	return Math.min(COLUMN_MAX_WIDTH, Math.max(COLUMN_MIN_WIDTH, width));
}
