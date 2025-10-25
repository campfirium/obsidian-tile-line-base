import { ROW_ID_FIELD } from './GridAdapter';

export const AG_GRID_SELECTION_COLUMN_ID = 'ag-Grid-SelectionColumn';

export function normalizeColumnId(columnId: string | null | undefined): string {
	return (columnId ?? '').trim();
}

export function isDisplayedSystemColumn(columnId: string | null | undefined): boolean {
	const normalized = normalizeColumnId(columnId);
	if (normalized.length === 0) {
		return true;
	}
	return normalized === '#' || normalized === 'status' || normalized === AG_GRID_SELECTION_COLUMN_ID;
}

export function isReservedColumnId(columnId: string | null | undefined): boolean {
	const normalized = normalizeColumnId(columnId);
	return isDisplayedSystemColumn(normalized) || normalized === ROW_ID_FIELD;
}
