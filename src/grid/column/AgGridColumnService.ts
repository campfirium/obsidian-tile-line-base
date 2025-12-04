import { ColDef, Column, ColumnMovedEvent, ColumnResizedEvent, ColumnState, GridApi } from 'ag-grid-community';

import { ColumnDef as SchemaColumnDef, ROW_ID_FIELD, SortModelEntry } from '../GridAdapter';
import { clampColumnWidth } from '../columnSizing';
import { buildAgGridColumnDefs } from './ColumnDefinitionBuilder';
import { ColumnAutoSizeResult, ColumnLayoutManager } from './ColumnLayoutManager';
import { applyQuickFilter as applyQuickFilterToGrid } from './QuickFilterManager';
import { buildSortState, cloneColumnState } from './ColumnStateManager';
import { isDisplayedSystemColumn } from '../systemColumnUtils';

export interface ColumnServiceCallbacks {
	onColumnResize?: (field: string, width: number) => void;
	onColumnOrderChange?: (fields: string[]) => void;
}

interface ColumnServiceDependencies {
	getContainer: () => HTMLElement | null;
}

/**
 * AgGridColumnService encapsulates column-related behaviors for AgGridAdapter.
 * Responsibilities include:
 * - Transforming TileLineBase column schema into AG Grid column definitions.
 * - Managing column sizing heuristics and resize persistence.
 * - Exposing helper methods for column state persistence and sort model updates.
 * - Relaying resize/reorder callbacks to the hosting TableView layer.
 */
type ColumnApiLike = {
	applyColumnState?: (params: { state?: ColumnState[]; applyOrder?: boolean; defaultState?: { sort?: string | null; sortIndex?: number | null } }) => void;
	getColumnState?: () => ColumnState[];
	resetColumnState?: () => void;
	getAllGridColumns?: () => Column[] | null;
};

export class AgGridColumnService {
	private readonly columnLayoutManager: ColumnLayoutManager;
	private gridApi: GridApi | null = null;
	private columnApi: ColumnApiLike | null = null;
	private columnLayoutInitialized = false;
	private quickFilterText = '';
	private callbacks: ColumnServiceCallbacks = {};
	private lastContainer: HTMLElement | null = null;

	constructor(private readonly deps: ColumnServiceDependencies) {
		this.columnLayoutManager = new ColumnLayoutManager({ getContainer: deps.getContainer });
	}

	configureCallbacks(callbacks: ColumnServiceCallbacks | undefined): void {
		this.callbacks = callbacks ?? {};
	}

	setContainer(container: HTMLElement | null): void {
		if (container !== this.lastContainer) {
			this.lastContainer = container;
			this.columnLayoutInitialized = false;
		}
	}

	attachApis(gridApi: GridApi | null, columnApi: ColumnApiLike | null): void {
		this.gridApi = gridApi;
		this.columnApi = columnApi;
		if (this.quickFilterText) {
			this.applyQuickFilter();
		}
	}

	detachApis(): void {
		this.gridApi = null;
		this.columnApi = null;
		this.columnLayoutInitialized = false;
		this.lastContainer = null;
	}

	markLayoutDirty(): void {
		this.columnLayoutInitialized = false;
	}

	buildColumnDefs(columns: SchemaColumnDef[]): ColDef[] {
		return buildAgGridColumnDefs(columns);
	}

	resizeColumns(): void {
		const gridApi = this.gridApi;
		if (!gridApi) {
			return;
		}

		const container = this.deps.getContainer();
		if (!container) {
			return;
		}

		const containerWidth = container.clientWidth ?? 0;
		const containerHeight = container.clientHeight ?? 0;
		if (containerWidth <= 0 || containerHeight <= 0) {
			return;
		}

		const gridApiAny = gridApi as GridApi & {
			doLayout?: () => void;
			checkGridSize?: () => void;
		};
		gridApiAny?.doLayout?.();
		gridApiAny?.checkGridSize?.();

		const columns = gridApi.getAllDisplayedColumns() || [];
		if (!this.columnLayoutInitialized) {
			const initResult = this.columnLayoutManager.initialize(gridApi, columns);
			if (initResult.applied) {
				this.columnLayoutInitialized = true;
			}
			if (initResult.autoSized.length > 0) {
				this.handleAutoSizedColumns(initResult.autoSized);
			}
			return;
		}

		const adjusted = this.columnLayoutManager.applyWidthClamping(gridApi, columns);
		if (adjusted) {
			gridApi.refreshHeader();
			gridApi.refreshCells({ force: true });
		}
	}

	fillColumnsToMinimumWidth(): void {
		const gridApi = this.gridApi;
		if (!gridApi) {
			return;
		}
		const columns = gridApi.getAllDisplayedColumns() || [];
		if (columns.length === 0) {
			return;
		}
		const updated = this.columnLayoutManager.fillToMinimumWidth(gridApi, columns, { overrideManual: true });
		if (updated.length > 0) {
			gridApi.refreshHeader();
			gridApi.refreshCells({ force: true });
			this.handleAutoSizedColumns(updated);
		}
	}

	handleColumnResized(event: ColumnResizedEvent): void {
		if (!event.finished || !event.column) {
			return;
		}

		const gridApi = this.gridApi;
		const source = event.source as string | undefined;
		if (source !== 'uiColumnDragged' && source !== 'uiColumnResized') {
			return;
		}

		const colId = event.column.getColId();
		if (isDisplayedSystemColumn(colId)) {
			return;
		}

		const clamped = clampColumnWidth(event.column.getActualWidth(), { clampMax: false });
		if (Math.abs(clamped - event.column.getActualWidth()) > 0.5 && gridApi) {
			gridApi.setColumnWidths([{ key: colId, newWidth: clamped }]);
		}

		const colDef = event.column.getColDef() as any;
		const context = colDef.context ?? {};
		context.tlbStoredWidth = clamped;
		context.tlbWidthSource = 'manual';
		colDef.context = context;

		this.callbacks.onColumnResize?.(colId, clamped);
	}

	handleColumnMoved(event: ColumnMovedEvent): void {
		if (!event.finished) {
			return;
		}

		const column = event.column ?? null;
		const columnId = typeof column?.getColId === 'function' ? column.getColId() : null;
		if (isDisplayedSystemColumn(columnId) || columnId === ROW_ID_FIELD) {
			return;
		}

		const columnApi = this.columnApi;
		if (!columnApi || typeof columnApi.getAllGridColumns !== 'function') {
			return;
		}

		const orderedColumns: Column[] = columnApi.getAllGridColumns() ?? [];
		const orderedFields: string[] = [];

		for (const gridColumn of orderedColumns) {
			if (!gridColumn) {
				continue;
			}

			const colDef = typeof gridColumn.getColDef === 'function' ? gridColumn.getColDef() : null;
			const field = colDef?.field;
			const fallback = typeof gridColumn.getColId === 'function' ? gridColumn.getColId() : null;
			const value = field ?? fallback;
			if (!value || isDisplayedSystemColumn(value) || value === ROW_ID_FIELD) {
				continue;
			}
			if (!orderedFields.includes(value)) {
				orderedFields.push(value);
			}
		}

		if (orderedFields.length === 0) {
			return;
		}

		this.callbacks.onColumnOrderChange?.(orderedFields);
	}

	getColumnState(): ColumnState[] | null {
		if (!this.columnApi || typeof this.columnApi.getColumnState !== 'function') {
			return null;
		}
		return cloneColumnState(this.columnApi.getColumnState());
	}

	applyColumnState(state: ColumnState[] | null): void {
		const columnApi = this.columnApi;
		if (!columnApi || typeof columnApi.applyColumnState !== 'function') {
			return;
		}

		if (!state) {
			columnApi.resetColumnState?.();
			this.applyQuickFilter();
			return;
		}

		columnApi.applyColumnState({
			state: cloneColumnState(state) ?? undefined,
			applyOrder: true
		});
		this.applyQuickFilter();
	}

	setSortModel(sortModel: SortModelEntry[]): void {
		const columnApi = this.columnApi;
		if (!columnApi || typeof columnApi.applyColumnState !== 'function') {
			return;
		}

		const state = buildSortState(sortModel);

		columnApi.applyColumnState({
			defaultState: { sort: null, sortIndex: null },
			state
		});

		if (this.gridApi && typeof this.gridApi.refreshClientSideRowModel === 'function') {
			this.gridApi.refreshClientSideRowModel('sort');
		}
	}

	setQuickFilterText(value: string | null): void {
		this.quickFilterText = value?.trim() ?? '';
	}

	applyQuickFilter(): void {
		applyQuickFilterToGrid(this.gridApi, this.quickFilterText);
	}

	private handleAutoSizedColumns(columns: ColumnAutoSizeResult[]): void {
		if (!this.callbacks.onColumnResize) {
			return;
		}
		for (const column of columns) {
			if (!column.key || isDisplayedSystemColumn(column.key)) {
				continue;
			}
			this.callbacks.onColumnResize(column.key, column.width);
		}
	}

}
