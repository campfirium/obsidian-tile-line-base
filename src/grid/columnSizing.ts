export const COLUMN_MIN_WIDTH = 60;
export const COLUMN_MAX_WIDTH = 420;

export interface ClampColumnWidthOptions {
	clampMax?: boolean;
}

export function clampColumnWidth(width: number, options?: ClampColumnWidthOptions): number {
	if (Number.isNaN(width)) {
		return COLUMN_MIN_WIDTH;
	}
	const sanitized = Math.max(COLUMN_MIN_WIDTH, width);
	if (options?.clampMax === false) {
		return sanitized;
	}
	return Math.min(COLUMN_MAX_WIDTH, sanitized);
}
