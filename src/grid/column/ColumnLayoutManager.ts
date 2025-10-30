import { Column, GridApi } from 'ag-grid-community';

import { clampColumnWidth } from '../columnSizing';
import { isDisplayedSystemColumn } from '../systemColumnUtils';

interface ColumnLayoutDependencies {
	getContainer: () => HTMLElement | null;
}
export interface ColumnAutoSizeResult {
	key: string;
	width: number;
}
export interface ColumnLayoutInitResult {
	applied: boolean;
	autoSized: ColumnAutoSizeResult[];
}

export class ColumnLayoutManager {
	constructor(private readonly deps: ColumnLayoutDependencies) {}

	initialize(gridApi: GridApi, columns: Column[]): ColumnLayoutInitResult {
		const container = this.deps.getContainer();
		if (!container) {
			return { applied: false, autoSized: [] };
		}

		const containerWidth = container.clientWidth ?? 0;
		const containerHeight = container.clientHeight ?? 0;
		if (containerWidth <= 0 || containerHeight <= 0) {
			return { applied: false, autoSized: [] };
		}

		if (columns.length === 0) {
			return { applied: true, autoSized: [] };
		}

		const assignments: Array<{ key: string; newWidth: number }> = [];
		const autoSizeCandidates: Column[] = [];

		for (const column of columns) {
			const colId = column.getColId();
			if (!colId) {
				continue;
			}

			const colDef = (column.getColDef() ?? {}) as any;
			const context = (colDef.context ?? {}) as Record<string, unknown>;
			const stored = context.tlbStoredWidth;
			const explicit = colDef.width;
			const hasFlex = typeof colDef.flex === 'number' && colDef.flex > 0;

			if (typeof stored === 'number') {
				assignments.push({ key: colId, newWidth: clampColumnWidth(stored) });
				continue;
			}

			if (typeof explicit === 'number' && !hasFlex) {
				assignments.push({ key: colId, newWidth: clampColumnWidth(explicit) });
				continue;
			}

			if (isDisplayedSystemColumn(colId) || hasFlex) {
				continue;
			}

			autoSizeCandidates.push(column);
		}

		if (assignments.length > 0) {
			gridApi.setColumnWidths(assignments);
		}

		let autoSized: ColumnAutoSizeResult[] = [];
		if (autoSizeCandidates.length > 0) {
			autoSized = this.autoSizeColumns(gridApi, autoSizeCandidates);
		}

		const adjusted = this.applyWidthClamping(gridApi, columns);
		if (adjusted) {
			gridApi.refreshHeader();
			gridApi.refreshCells({ force: true });
		}

		return { applied: true, autoSized };
	}

	private autoSizeColumns(gridApi: GridApi, columns: Column[]): ColumnAutoSizeResult[] {
		const keys = columns
			.map((column) => column.getColId())
			.filter((id): id is string => typeof id === 'string' && id.length > 0);

		if (keys.length === 0) {
			return [];
		}

		const autoSizeColumns = (gridApi as any).autoSizeColumns;
		if (typeof autoSizeColumns === 'function') {
			autoSizeColumns.call(gridApi, keys, false);
		}

		const updates: Array<{ key: string; newWidth: number }> = [];
		const results: ColumnAutoSizeResult[] = [];
		for (const column of columns) {
			const colId = column.getColId();
			if (!colId) {
				continue;
			}
			const measured = column.getActualWidth();
			const clamped = clampColumnWidth(measured);
			if (Math.abs(clamped - measured) > 0.5) {
				updates.push({ key: colId, newWidth: clamped });
			}
			this.storeMeasuredWidth(column, clamped);
			results.push({ key: colId, width: clamped });
		}

		if (updates.length > 0) {
			gridApi.setColumnWidths(updates);
		}
		return results;
	}

	private storeMeasuredWidth(column: Column, width: number): void {
		const colDef = (column.getColDef() ?? {}) as any;
		const context = (colDef.context ?? {}) as Record<string, unknown>;
		context.tlbStoredWidth = width;
		colDef.context = context;
	}

	applyWidthClamping(gridApi: GridApi, columns: Column[]): boolean {
		let adjusted = false;
		for (const column of columns) {
			const colId = column.getColId();
			if (isDisplayedSystemColumn(colId)) {
				continue;
			}

			const current = column.getActualWidth();
			const clamped = clampColumnWidth(current);
			if (Math.abs(clamped - current) > 0.5) {
				gridApi.setColumnWidths([{ key: colId, newWidth: clamped }]);
				adjusted = true;
			}
		}
		return adjusted;
	}
}
