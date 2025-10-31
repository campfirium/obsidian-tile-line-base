import { Column, GridApi } from 'ag-grid-community';

import { clampColumnWidth } from '../columnSizing';
import { isDisplayedSystemColumn } from '../systemColumnUtils';

// Ensure auto-sized columns still occupy most of the grid to avoid wide empty gaps.
const MINIMUM_AUTO_FILL_RATIO = 0.9;

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
				assignments.push({ key: colId, newWidth: clampColumnWidth(stored, { clampMax: false }) });
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
			const adjustedAutoSized = this.ensureMinimumFill(gridApi, columns, containerWidth, autoSized);
			if (adjustedAutoSized) {
				autoSized = adjustedAutoSized;
			}
		}

		const adjusted = this.applyWidthClamping(gridApi, columns);
		if (adjusted) {
			gridApi.refreshHeader();
			gridApi.refreshCells({ force: true });
		}

		return { applied: true, autoSized };
	}

	fillToMinimumWidth(
		gridApi: GridApi,
		columns: Column[],
		options?: { overrideManual?: boolean }
	): ColumnAutoSizeResult[] {
		const container = this.deps.getContainer();
		if (!container) {
			return [];
		}
		const containerWidth = container.clientWidth ?? 0;
		if (containerWidth <= 0) {
			return [];
		}
		let autoSized: ColumnAutoSizeResult[] | null = null;
		if (options?.overrideManual) {
			const candidates = columns.filter((column) => {
				const colId = column.getColId();
				return typeof colId === 'string' && colId.length > 0 && !isDisplayedSystemColumn(colId);
			});
			if (candidates.length > 0) {
				autoSized = this.autoSizeColumns(gridApi, candidates);
			}
		}
		const adjusted = this.ensureMinimumFill(gridApi, columns, containerWidth, autoSized, options);
		if (adjusted) {
			return adjusted;
		}
		return autoSized ?? [];
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
		context.tlbWidthSource = 'auto';
		colDef.context = context;
	}

	applyWidthClamping(gridApi: GridApi, columns: Column[]): boolean {
		let adjusted = false;
		for (const column of columns) {
			const colId = column.getColId();
			if (isDisplayedSystemColumn(colId)) {
				continue;
			}

			const colDef = (column.getColDef() ?? {}) as any;
			const context = (colDef.context ?? {}) as Record<string, unknown>;
			const widthSource = typeof context.tlbWidthSource === 'string' ? context.tlbWidthSource : null;
			const clampMax = widthSource === 'manual' ? false : true;

			const current = column.getActualWidth();
			const clamped = clampColumnWidth(current, { clampMax });
			if (Math.abs(clamped - current) > 0.5) {
				gridApi.setColumnWidths([{ key: colId, newWidth: clamped }]);
				context.tlbStoredWidth = clamped;
				if (clampMax) {
					context.tlbWidthSource = widthSource ?? 'auto';
				} else {
					context.tlbWidthSource = 'manual';
				}
				colDef.context = context;
				adjusted = true;
			}
		}
		return adjusted;
	}

	private ensureMinimumFill(
		gridApi: GridApi,
		columns: Column[],
		containerWidth: number,
		autoSized: ColumnAutoSizeResult[] | null,
		options?: { overrideManual?: boolean }
	): ColumnAutoSizeResult[] | null {
		const overrideManual = options?.overrideManual === true;
		const targetWidth = Math.floor(containerWidth * MINIMUM_AUTO_FILL_RATIO);
		if (targetWidth <= 0) {
			return autoSized;
		}

		const nonSystemColumns = columns.filter((column) => {
			const colId = column.getColId();
			return typeof colId === 'string' && colId.length > 0 && !isDisplayedSystemColumn(colId);
		});

		if (nonSystemColumns.length === 0) {
			return autoSized;
		}

		const currentWidth = nonSystemColumns.reduce((total, column) => total + column.getActualWidth(), 0);
		if (currentWidth >= targetWidth) {
			return autoSized;
		}

		const autoSizedKeys = autoSized ? new Set(autoSized.map((entry) => entry.key)) : null;
		const adjustableColumns = nonSystemColumns.filter((column) => {
			const colId = column.getColId();
			if (!colId) {
				return false;
			}
			if (autoSizedKeys) {
				return autoSizedKeys.has(colId);
			}
			const colDef = (column.getColDef() ?? {}) as any;
			const context = (colDef.context ?? {}) as Record<string, unknown>;
			const widthSource = typeof context.tlbWidthSource === 'string' ? context.tlbWidthSource : null;
			if (widthSource === 'manual' && !overrideManual) {
				return false;
			}
			return true;
		});

		if (adjustableColumns.length === 0) {
			return autoSized;
		}

		const desiredExtra = targetWidth - currentWidth;
		if (desiredExtra <= 0) {
			return autoSized;
		}

		const adjustableWidth = adjustableColumns.reduce((total, column) => total + column.getActualWidth(), 0);
		if (adjustableWidth <= 0) {
			return autoSized;
		}

		const updates: Array<{ key: string; newWidth: number }> = [];
		const updatedAutoSized = autoSized ? autoSized.map((entry) => ({ ...entry })) : [];
		let remainingExtra = desiredExtra;

		for (let index = 0; index < adjustableColumns.length && remainingExtra > 0; index++) {
			const column = adjustableColumns[index];
			const colId = column.getColId();
			if (!colId) {
				continue;
			}

			const baseWidth = column.getActualWidth();
			const ratio = baseWidth / adjustableWidth;
			const plannedIncrement = index === adjustableColumns.length - 1 ? remainingExtra : desiredExtra * ratio;
			if (!Number.isFinite(plannedIncrement) || plannedIncrement <= 0) {
				continue;
			}

			const desiredWidth = baseWidth + Math.min(plannedIncrement, remainingExtra);
			const newWidth = clampColumnWidth(desiredWidth);
			const appliedIncrement = Math.max(0, newWidth - baseWidth);
			if (appliedIncrement <= 0) {
				continue;
			}

			updates.push({ key: colId, newWidth });
			remainingExtra = Math.max(0, remainingExtra - appliedIncrement);

			const colDef = (column.getColDef() ?? {}) as any;
			const context = (colDef.context ?? {}) as Record<string, unknown>;
			context.tlbStoredWidth = newWidth;
			context.tlbWidthSource = 'auto';
			colDef.context = context;
			this.storeMeasuredWidth(column, newWidth);

			const autoSizedIndex = updatedAutoSized.findIndex((entry) => entry.key === colId);
			if (autoSizedIndex >= 0) {
				updatedAutoSized[autoSizedIndex] = { key: colId, width: newWidth };
			} else {
				updatedAutoSized.push({ key: colId, width: newWidth });
			}
		}

		if (updates.length > 0) {
			gridApi.setColumnWidths(updates);
			if (updatedAutoSized.length > 0) {
				return updatedAutoSized;
			}
			return updates.map((entry) => ({ key: entry.key, width: entry.newWidth }));
		}

		return autoSized;
	}
}
