import { ColumnState } from 'ag-grid-community';

import { SortModelEntry } from '../GridAdapter';

export function cloneColumnState(state: ColumnState[] | null | undefined): ColumnState[] | null {
	if (!state) {
		return null;
	}
	return state.map((item) => ({ ...item }));
}

export function buildSortState(sortModel: SortModelEntry[]): ColumnState[] {
	if (!Array.isArray(sortModel)) {
		return [];
	}

	return sortModel
		.filter((item) => typeof item?.field === 'string' && item.field.length > 0)
		.map((item, index) => ({
			colId: item.field,
			sort: (item.direction === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc',
			sortIndex: index
		}));
}
