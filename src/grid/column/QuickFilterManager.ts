import { Column, GridApi } from 'ag-grid-community';

import { ROW_ID_FIELD } from '../GridAdapter';

type QuickFilterApi = GridApi & {
	setQuickFilter?: (value: string) => void;
	setQuickFilterColumns?: (columns: string[]) => void;
	getColumns?: () => Column[] | null;
	setGridOption?: (key: string, value: unknown) => void;
	onFilterChanged?: () => void;
};

export function applyQuickFilter(gridApi: GridApi | null, quickFilterText: string): void {
	if (!gridApi) {
		return;
	}

	const api = gridApi as QuickFilterApi;

	if (typeof api.setQuickFilterColumns === 'function' && typeof api.getColumns === 'function') {
		const columns = api.getColumns() ?? [];
		const filterable: string[] = [];
		for (const column of columns) {
			if (!column) {
				continue;
			}

			const colId =
				typeof column.getColId === 'function'
					? column.getColId()
					: typeof (column as any).getId === 'function'
						? (column as any).getId()
						: null;
			if (!colId) {
				continue;
			}
			if (colId === '#' || colId === ROW_ID_FIELD || colId === 'status') {
				continue;
			}
			if (typeof column.isVisible === 'function' && !column.isVisible()) {
				continue;
			}
			filterable.push(colId);
		}

		api.setQuickFilterColumns(filterable);
	}

	if (typeof api.setQuickFilter === 'function') {
		api.setQuickFilter(quickFilterText);
	} else if (typeof api.setGridOption === 'function') {
		api.setGridOption('quickFilterText', quickFilterText);
		if (typeof api.onFilterChanged === 'function') {
			api.onFilterChanged();
		}
	}
}
