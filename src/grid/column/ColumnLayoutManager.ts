import { Column, GridApi } from 'ag-grid-community';

import { COLUMN_MAX_WIDTH, COLUMN_MIN_WIDTH, clampColumnWidth } from '../columnSizing';

interface ColumnLayoutDependencies {
	getContainer: () => HTMLElement | null;
}

export class ColumnLayoutManager {
	constructor(private readonly deps: ColumnLayoutDependencies) {}

	initialize(gridApi: GridApi, columns: Column[]): boolean {
		const container = this.deps.getContainer();
		if (!container) {
			return false;
		}

		const containerWidth = container.clientWidth ?? 0;
		const containerHeight = container.clientHeight ?? 0;
		if (containerWidth <= 0 || containerHeight <= 0) {
			return false;
		}

		if (columns.length === 0) {
			return true;
		}

		const storedWidths = new Map<string, number>();
		const explicitWidths = new Map<string, number>();
		let requiresAutoSize = false;

		for (const column of columns) {
			const colId = column.getColId();
			if (!colId || colId === '#' || colId === 'status') {
				continue;
			}

			const colDef = column.getColDef() as any;
			const stored = colDef?.context?.tlbStoredWidth;
			const explicit = colDef.width;

			if (typeof stored === 'number') {
				storedWidths.set(colId, clampColumnWidth(stored));
			} else if (typeof explicit === 'number') {
				explicitWidths.set(colId, clampColumnWidth(explicit));
			} else {
				requiresAutoSize = true;
			}
		}

		if (requiresAutoSize && typeof gridApi.sizeColumnsToFit === 'function') {
			gridApi.sizeColumnsToFit({
				defaultMinWidth: COLUMN_MIN_WIDTH,
				defaultMaxWidth: COLUMN_MAX_WIDTH,
				columnLimits: columns
					.filter((column) => {
						const id = column.getColId();
						return id && id !== '#' && id !== 'status';
					})
					.map((column) => ({
						key: column.getColId(),
						minWidth: COLUMN_MIN_WIDTH,
						maxWidth: COLUMN_MAX_WIDTH
					}))
			});
		}

		for (const column of columns) {
			const colId = column.getColId();
			if (!colId || colId === '#' || colId === 'status') {
				continue;
			}

			if (storedWidths.has(colId)) {
				const storedWidth = storedWidths.get(colId);
				if (storedWidth !== undefined) {
					gridApi.setColumnWidths([{ key: colId, newWidth: storedWidth }]);
				}
				continue;
			}

			if (explicitWidths.has(colId)) {
				const explicitWidth = explicitWidths.get(colId);
				if (explicitWidth !== undefined) {
					gridApi.setColumnWidths([{ key: colId, newWidth: explicitWidth }]);
				}
			}
		}

		this.applyWidthClamping(gridApi, columns);
		this.distributeSparseSpace(gridApi, columns);
		gridApi.refreshHeader();
		gridApi.refreshCells({ force: true });

		return true;
	}

	applyWidthClamping(gridApi: GridApi, columns: Column[]): void {
		for (const column of columns) {
			const colId = column.getColId();
			if (!colId || colId === '#' || colId === 'status') {
				continue;
			}

			const current = column.getActualWidth();
			const clamped = clampColumnWidth(current);
			if (Math.abs(clamped - current) > 0.5) {
				gridApi.setColumnWidths([{ key: colId, newWidth: clamped }]);
			}
		}
	}

	distributeSparseSpace(gridApi: GridApi, columns: Column[]): void {
		const container = this.deps.getContainer();
		if (!container) {
			return;
		}

		const viewportWidth = container.clientWidth ?? 0;
		if (viewportWidth <= 0) {
			return;
		}

		const totalWidth = columns.reduce((sum, column) => sum + column.getActualWidth(), 0);
		let deficit = viewportWidth - totalWidth;
		if (deficit <= 1) {
			return;
		}

		const tolerance = 0.5;
		let adjustable = columns.filter((column) => {
			const id = column.getColId();
			return id && id !== '#' && id !== 'status' && column.isResizable();
		});

		if (adjustable.length === 0) {
			return;
		}

		while (deficit > tolerance && adjustable.length > 0) {
			const share = deficit / adjustable.length;
			let consumed = 0;
			const nextRound: Column[] = [];

			for (const column of adjustable) {
				const current = column.getActualWidth();
				const target = clampColumnWidth(current + share);
				const delta = target - current;

				if (delta > tolerance) {
					const colId = column.getColId();
					if (colId) {
						gridApi.setColumnWidths([{ key: colId, newWidth: target }]);
					}
					consumed += delta;
				}

				if (target < COLUMN_MAX_WIDTH - tolerance) {
					nextRound.push(column);
				}
			}

			if (consumed <= tolerance) {
				break;
			}

			deficit -= consumed;
			adjustable =
				nextRound.length > 0
					? nextRound
					: adjustable.filter((column) => column.getActualWidth() < COLUMN_MAX_WIDTH - tolerance);
		}
	}
}
