import { ColDef, Column, ColumnMovedEvent, ColumnResizedEvent, ColumnState, GridApi } from 'ag-grid-community';
import { ColumnDef as SchemaColumnDef, ROW_ID_FIELD, SortModelEntry } from '../GridAdapter';
import { COLUMN_MAX_WIDTH, COLUMN_MIN_WIDTH, clampColumnWidth } from '../columnSizing';
import { IconHeaderComponent } from '../headers/IconHeaderComponent';
import { StatusCellRenderer } from '../../renderers/StatusCellRenderer';

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
	private gridApi: GridApi | null = null;
	private columnApi: ColumnApiLike | null = null;
	private columnLayoutInitialized = false;
	private quickFilterText = '';
	private callbacks: ColumnServiceCallbacks = {};
	private lastContainer: HTMLElement | null = null;

	constructor(private readonly deps: ColumnServiceDependencies) {}

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
		const colDefs: ColDef[] = columns.map((col) => {
			if (col.field === '#') {
				return {
					field: col.field,
					headerName: col.headerName,
					editable: false,
					pinned: 'left',
					lockPinned: true,
					lockPosition: true,
					suppressMovable: true,
					width: 60,
					maxWidth: 80,
					sortable: true,
					filter: false,
					resizable: false,
					suppressSizeToFit: true,
					cellStyle: { textAlign: 'center' },
					headerComponent: IconHeaderComponent,
					headerComponentParams: {
						icon: 'hashtag',
						fallbacks: ['hash'],
						tooltip: col.headerTooltip || col.headerName || 'Index'
					}
				};
			}

			if (col.field === 'status') {
				const headerName = col.headerName ?? 'Status';
				const tooltipFallback =
					typeof headerName === 'string' && headerName.trim().length > 0 ? headerName : 'Status';

				return {
					field: col.field,
					headerName,
					headerTooltip: col.headerTooltip ?? tooltipFallback,
					editable: false,
					pinned: 'left',
					lockPinned: true,
					lockPosition: true,
					suppressMovable: true,
					width: 60,
					resizable: false,
					sortable: true,
					filter: false,
					suppressSizeToFit: true,
					suppressNavigable: true,
					cellRenderer: StatusCellRenderer,
					cellStyle: {
						textAlign: 'center',
						cursor: 'pointer',
						padding: '10px var(--ag-cell-horizontal-padding)'
					},
					headerComponent: IconHeaderComponent,
					headerComponentParams: {
						icon: 'list-checks',
						fallbacks: ['checklist', 'check-square'],
						tooltip: col.headerTooltip ?? tooltipFallback
					}
				};
			}

			const baseColDef: ColDef = {
				field: col.field,
				headerName: col.headerName,
				editable: col.editable,
				sortable: true,
				filter: false,
				resizable: true,
				cellClass: 'tlb-cell-truncate'
			};

			const mergedColDef = { ...baseColDef, ...(col as any) };
			if (typeof col.field === 'string' && col.field !== '#' && col.field !== 'status') {
				mergedColDef.minWidth =
					typeof mergedColDef.minWidth === 'number'
						? clampColumnWidth(mergedColDef.minWidth)
						: COLUMN_MIN_WIDTH;
				mergedColDef.maxWidth =
					typeof mergedColDef.maxWidth === 'number'
						? clampColumnWidth(mergedColDef.maxWidth)
						: COLUMN_MAX_WIDTH;
			}

			const pinnedFields = new Set(['任务', '任务名称', 'task', 'taskName', 'title', '标题']);
			if (typeof col.field === 'string' && pinnedFields.has(col.field)) {
				mergedColDef.pinned = 'left';
				mergedColDef.lockPinned = true;
			}

			const explicitWidth = (mergedColDef as any).width;
			if (typeof explicitWidth === 'number') {
				const clamped = clampColumnWidth(explicitWidth);
				(mergedColDef as any).width = clamped;
				(mergedColDef as any).suppressSizeToFit = true;
			}

			return mergedColDef;
		});

		const statusColDef = colDefs.find((def) => def.field === 'status');
		if (statusColDef) {
			statusColDef.width = 80;
			statusColDef.minWidth = 72;
			statusColDef.maxWidth = 96;
		}

		return colDefs;
	}

	resizeColumns(): void {
		const gridApi = this.gridApi;
		const container = this.deps.getContainer();
		if (!gridApi || !container) {
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

		const allColumns = gridApi.getAllDisplayedColumns() || [];
		if (!this.columnLayoutInitialized) {
			this.initializeColumnSizing(allColumns);
			return;
		}

		this.applyWidthClamping(allColumns);
		this.distributeSparseSpace(allColumns);
		gridApi.refreshHeader();
		gridApi.refreshCells({ force: true });
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
		if (!colId || colId === '#' || colId === 'status') {
			return;
		}

		const clamped = clampColumnWidth(event.column.getActualWidth());
		if (Math.abs(clamped - event.column.getActualWidth()) > 0.5 && gridApi) {
			gridApi.setColumnWidths([{ key: colId, newWidth: clamped }]);
		}

		const colDef = event.column.getColDef() as any;
		colDef.__tlbStoredWidth = clamped;

		this.callbacks.onColumnResize?.(colId, clamped);
	}

	handleColumnMoved(event: ColumnMovedEvent): void {
		if (!event.finished) {
			return;
		}

		const column = event.column ?? null;
		const columnId = typeof column?.getColId === 'function' ? column.getColId() : null;
		if (columnId === '#' || columnId === 'status' || columnId === ROW_ID_FIELD) {
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
			if (!value || value === '#' || value === 'status' || value === ROW_ID_FIELD) {
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
		return this.cloneColumnState(this.columnApi.getColumnState());
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
			state: this.cloneColumnState(state) ?? undefined,
			applyOrder: true
		});
		this.applyQuickFilter();
	}

	setSortModel(sortModel: SortModelEntry[]): void {
		const columnApi = this.columnApi;
		if (!columnApi || typeof columnApi.applyColumnState !== 'function') {
			return;
		}

		const state: ColumnState[] = Array.isArray(sortModel)
			? sortModel
					.filter((item) => typeof item?.field === 'string' && item.field.length > 0)
					.map((item, index) => ({
						colId: item.field,
						sort: (item.direction === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc',
						sortIndex: index
					}))
			: [];

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
		if (!this.gridApi) {
			return;
		}
		const api = this.gridApi as GridApi & {
			setQuickFilter?: (value: string) => void;
			setQuickFilterColumns?: (columns: string[]) => void;
			getColumns?: () => Column[] | null;
			setGridOption?: (key: string, value: unknown) => void;
			onFilterChanged?: () => void;
		};

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
			api.setQuickFilter(this.quickFilterText);
		} else if (typeof api.setGridOption === 'function') {
			api.setGridOption('quickFilterText', this.quickFilterText);
			if (typeof api.onFilterChanged === 'function') {
				api.onFilterChanged();
			}
		}
	}

	private initializeColumnSizing(columns: Column[]): void {
		const gridApi = this.gridApi;
		const container = this.deps.getContainer();
		if (!gridApi || !container) {
			return;
		}

		const containerWidth = container.clientWidth ?? 0;
		const containerHeight = container.clientHeight ?? 0;
		if (containerWidth <= 0 || containerHeight <= 0) {
			return;
		}

		if (columns.length === 0) {
			this.columnLayoutInitialized = true;
			return;
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
			const stored = colDef.__tlbStoredWidth;
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

		this.columnLayoutInitialized = true;
		this.applyWidthClamping(columns);
		this.distributeSparseSpace(columns);
		gridApi.refreshHeader();
		gridApi.refreshCells({ force: true });
	}

	private applyWidthClamping(columns: Column[]): void {
		const gridApi = this.gridApi;
		if (!gridApi) {
			return;
		}

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

	private distributeSparseSpace(columns: Column[]): void {
		const gridApi = this.gridApi;
		const container = this.deps.getContainer();
		if (!gridApi || !container) {
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

	private cloneColumnState(state: ColumnState[] | null | undefined): ColumnState[] | null {
		if (!state) {
			return null;
		}
		return state.map((item) => ({ ...item }));
	}
}
