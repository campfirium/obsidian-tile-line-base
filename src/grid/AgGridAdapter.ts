/**
 * AgGridAdapter - AG Grid Community 适配器实现
 *
 * 使用 AG Grid Community 实现 GridAdapter 接口。
 */

import {
	createGrid,
	GridApi,
	GridOptions,
	CellEditingStoppedEvent,
	CellEditingStartedEvent,
	CellFocusedEvent,
	CellKeyDownEvent,
	CellDoubleClickedEvent,
	ModuleRegistry,
	AllCommunityModule,
	IRowNode,
	ColumnState
} from 'ag-grid-community';
import {
	GridAdapter,
	ColumnDef,
	RowData,
	CellEditEvent,
	HeaderEditEvent,
	ROW_ID_FIELD,
	SortModelEntry
} from './GridAdapter';
import { normalizeStatus } from '../renderers/StatusCellRenderer';
import { createTextCellEditor } from './editors/TextCellEditor';
import { t } from '../i18n';
import { AgGridColumnService } from './column/AgGridColumnService';
import {
	AgGridInteractionController,
	GridInteractionContext
} from './interactions/AgGridInteractionController';

const DEFAULT_ROW_HEIGHT = 40;

// 注册 AG Grid Community 模块
ModuleRegistry.registerModules([AllCommunityModule]);

export class AgGridAdapter implements GridAdapter {
	private gridApi: GridApi | null = null;
	private cellEditCallback?: (event: CellEditEvent) => void;
	private headerEditCallback?: (event: HeaderEditEvent) => void;
	private columnHeaderContextMenuCallback?: (event: { field: string; domEvent: MouseEvent }) => void;
	private enterAtLastRowCallback?: (field: string) => void;
	private gridContext?: GridInteractionContext;
	private containerEl: HTMLElement | null = null;
	private readonly columnService = new AgGridColumnService({
		getContainer: () => this.containerEl
	});
	private readonly interaction: AgGridInteractionController;
	private ready = false;
	private readyCallbacks: Array<() => void> = [];
	private modelUpdatedCallbacks: Array<() => void> = [];

	constructor() {
		this.interaction = new AgGridInteractionController({
			getGridApi: () => this.gridApi,
			getGridContext: () => this.gridContext,
			getCellEditCallback: () => this.cellEditCallback,
			getEnterAtLastRowCallback: () => this.enterAtLastRowCallback,
			translate: (key: string) => t(key as any)
		});
	}


	private emitModelUpdated(): void {
		if (this.modelUpdatedCallbacks.length === 0) {
			return;
		}
		for (const callback of this.modelUpdatedCallbacks) {
			try {
				callback();
			} catch (error) {
				console.error('[AgGridAdapter] onModelUpdated callback failed', error);
			}
		}
	}

	runWhenReady(callback: () => void): void {
		if (this.ready) {
			callback();
			return;
		}
		this.readyCallbacks.push(callback);
	}

	onModelUpdated(callback: () => void): void {
		this.modelUpdatedCallbacks.push(callback);
	}

	mount(
		container: HTMLElement,
		columns: ColumnDef[],
		rows: RowData[],
		context?: GridInteractionContext
	): void {
		this.containerEl = container;
		this.interaction.setContainer(container);
		this.gridContext = context;
		this.columnService.configureCallbacks({
			onColumnResize: context?.onColumnResize,
			onColumnOrderChange: context?.onColumnOrderChange
		});
		this.columnService.setContainer(container);

		const colDefs = this.columnService.buildColumnDefs(columns);
		const ownerDoc = container.ownerDocument;

		const gridOptions: GridOptions = {
			popupParent: ownerDoc?.body ?? document.body,
			onGridReady: (params: any) => {
				this.gridApi = params.api;
				this.columnService.attachApis(params.api, params.columnApi ?? null);
				this.ready = true;
				if (this.readyCallbacks.length > 0) {
					const queue = [...this.readyCallbacks];
					this.readyCallbacks.length = 0;
					for (const callback of queue) {
						try {
							callback();
						} catch (error) {
							console.error('[AgGridAdapter] runWhenReady callback failed', error);
						}
					}
				}
			},
			columnDefs: colDefs,
			rowData: rows,
			rowHeight: DEFAULT_ROW_HEIGHT,
			onFirstDataRendered: () => {
				this.resizeColumns();
			},
			onModelUpdated: () => {
				this.emitModelUpdated();
			},
			onRowDataUpdated: () => {
				this.emitModelUpdated();
			},
			getRowId: (params) => String(params.data[ROW_ID_FIELD]),
			context: context || {},
			enableBrowserTooltips: true,
			tooltipShowDelay: 0,
			tooltipHideDelay: 200,
			onCellKeyDown: (event: CellKeyDownEvent) => {
				this.interaction.handleGridCellKeyDown(event);
			},
			singleClickEdit: false,
			stopEditingWhenCellsLoseFocus: true,
			enterNavigatesVertically: true,
			enterNavigatesVerticallyAfterEdit: true,
			rowSelection: {
				mode: 'multiRow',
				enableClickSelection: true,
				enableSelectionWithoutKeys: false,
				checkboxes: false,
				checkboxLocation: 'autoGroupColumn'
			},
			selectionColumnDef: {
				width: 0,
				minWidth: 0,
				maxWidth: 0,
				resizable: false,
				suppressSizeToFit: true,
				headerName: '',
				suppressHeaderMenuButton: true,
				suppressHeaderContextMenu: true
			},
			onCellEditingStopped: (event: CellEditingStoppedEvent) => {
				this.handleCellEdit(event);
			},
			onCellEditingStarted: (_event: CellEditingStartedEvent) => {
				this.interaction.handleCellEditingStarted();
			},
			onCellFocused: (event: CellFocusedEvent) => {
				this.interaction.handleCellFocused(event);
			},
			onColumnResized: (event) => {
				this.columnService.handleColumnResized(event);
			},
			onColumnMoved: (event) => {
				this.columnService.handleColumnMoved(event);
			},
			onCellDoubleClicked: (event: CellDoubleClickedEvent) => {
				const colId = event.column?.getColId?.() ?? null;
				if (colId !== '#') {
					return;
				}
				const data = event.data as RowData | undefined;
				const raw = data ? data[ROW_ID_FIELD] : undefined;
				const blockIndex = raw !== undefined ? parseInt(String(raw), 10) : NaN;
				if (Number.isNaN(blockIndex)) {
					return;
				}
				this.gridContext?.onCopyH2Section?.(blockIndex);
			},
			onColumnHeaderContextMenu: (params: any) => {
				const column = params?.column ?? null;
				const field =
					column && typeof column.getColId === 'function' ? column.getColId() : null;
				const domEvent = (params?.event ?? params?.mouseEvent) as MouseEvent | undefined;
				if (!field || !domEvent) {
					return;
				}
				this.columnHeaderContextMenuCallback?.({ field, domEvent });
			},
			defaultColDef: {
				tooltipValueGetter: (params) => {
					const value = params.value;
					return value == null ? '' : String(value);
				},
				editable: true,
				sortable: true,
				filter: false,
				resizable: true,
				cellEditor: createTextCellEditor(),
				suppressKeyboardEvent: (params: any) => {
					return this.interaction.handleSuppressKeyboardEvent(params);
				}
			},
			enableCellTextSelection: true,
			suppressAnimationFrame: false,
			suppressColumnVirtualisation: false,
			rowClassRules: {
				'tlb-row-completed': (params) => {
					const status = normalizeStatus(params.data?.status);
					return status === 'done' || status === 'canceled';
				}
			}
		};

		this.gridApi = createGrid(container, gridOptions);
		this.interaction.bindViewportListeners(container);
	}

	updateData(rows: RowData[]): void {
		if (this.gridApi) {
			this.gridApi.setGridOption('rowData', rows);
			this.gridApi.refreshCells({ force: true });
		}
	}

	private deepClone<T>(value: T): T {
		if (value == null) {
			return value;
		}
		return JSON.parse(JSON.stringify(value)) as T;
	}

	getFilterModel(): any | null {
		if (!this.gridApi || typeof this.gridApi.getFilterModel !== 'function') {
			return null;
		}
		return this.deepClone(this.gridApi.getFilterModel());
	}

	setFilterModel(model: any | null): void {
		this.runWhenReady(() => {
			if (!this.gridApi || typeof this.gridApi.setFilterModel !== 'function') {
				return;
			}
			const cloned = model == null ? null : this.deepClone(model);
			this.gridApi.setFilterModel(cloned);
			if (typeof this.gridApi.onFilterChanged === 'function') {
				this.gridApi.onFilterChanged();
			}
		});
	}

	setSortModel(sortModel: SortModelEntry[]): void {
		this.runWhenReady(() => {
			this.columnService.setSortModel(sortModel);
		});
	}

	setQuickFilter(value: string | null): void {
		this.columnService.setQuickFilterText(value);
		this.runWhenReady(() => {
			this.columnService.applyQuickFilter();
		});
	}

	getColumnState(): ColumnState[] | null {
		return this.columnService.getColumnState();
	}

	applyColumnState(state: ColumnState[] | null): void {
		this.runWhenReady(() => {
			this.columnService.applyColumnState(state);
		});
	}
	markLayoutDirty(): void {
		this.columnService.markLayoutDirty();
		this.interaction.onLayoutInvalidated();
	}

	selectRow(blockIndex: number, options?: { ensureVisible?: boolean }): void {
		if (!this.gridApi) return;
		const node = this.findRowNodeByBlockIndex(blockIndex);
		if (!node) return;

		this.gridApi.deselectAll();
		node.setSelected(true, true);

		if (options?.ensureVisible !== false) {
			const rowIndex = node.rowIndex ?? null;
			if (rowIndex !== null) {
				this.gridApi.ensureIndexVisible(rowIndex, 'middle');
			}
		}
	}

	private handleCellEdit(event: CellEditingStoppedEvent): void {
		this.interaction.handleCellEditingStopped();

		if (!this.cellEditCallback) return;

		const field = event.colDef.field;
		const rowIndex = event.node.rowIndex;
		const newValue = event.newValue;
		const oldValue = event.oldValue;

		if (field && rowIndex !== null && rowIndex !== undefined) {
			const newStr = String(newValue ?? '');
			const oldStr = String(oldValue ?? '');

			if (newStr !== oldStr) {
				this.cellEditCallback({
					rowIndex: rowIndex,
					field: field,
					newValue: newStr,
					oldValue: oldStr,
					rowData: event.data as RowData
				});
			}
		}
	}

	onCellEdit(callback: (event: CellEditEvent) => void): void {
		this.cellEditCallback = callback;
	}

	onHeaderEdit(callback: (event: HeaderEditEvent) => void): void {
		this.headerEditCallback = callback;
	}

	onColumnHeaderContextMenu(callback: (event: { field: string; domEvent: MouseEvent }) => void): void {
		this.columnHeaderContextMenuCallback = callback;
	}

	destroy(): void {
		if (this.gridApi) {
			this.gridApi.destroy();
			this.gridApi = null;
		}
		this.ready = false;
		this.readyCallbacks = [];
		this.modelUpdatedCallbacks = [];
		this.columnService.detachApis();
		this.columnService.configureCallbacks(undefined);
		this.columnService.setContainer(null);
		this.interaction.destroy();
		this.interaction.setContainer(null);
		this.columnHeaderContextMenuCallback = undefined;
		this.gridContext = undefined;
		this.containerEl = null;
	}

	getSelectedRows(): number[] {
		if (!this.gridApi) return [];

		const selectedNodes = [...this.gridApi.getSelectedNodes()] as Array<IRowNode<RowData>>;
		const resolveSortKey = (node: IRowNode<RowData>): number => {
			const baseIndex = node.rowIndex ?? 0;
			if (node.rowPinned === 'top') {
				return baseIndex - 1_000_000_000;
			}
			if (node.rowPinned === 'bottom') {
				return baseIndex + 1_000_000_000;
			}
			return baseIndex;
		};
		selectedNodes.sort((a, b) => resolveSortKey(a) - resolveSortKey(b));
		const blockIndexes: number[] = [];

		for (const node of selectedNodes) {
			const data = node.data as RowData | undefined;
			if (!data) continue;
			const raw = data[ROW_ID_FIELD];
			const parsed = raw !== undefined ? parseInt(String(raw), 10) : NaN;
			if (!Number.isNaN(parsed)) {
				blockIndexes.push(parsed);
			}
		}

		return blockIndexes;
	}

	getRowIndexFromEvent(event: MouseEvent): number | null {
		if (!this.gridApi) return null;

		const target = event.target as HTMLElement;
		const rowElement = target.closest('.ag-row');

		if (!rowElement) return null;

		const rowIndexAttr = rowElement.getAttribute('row-index');
		if (rowIndexAttr === null) return null;

		const displayIndex = parseInt(rowIndexAttr, 10);
		if (Number.isNaN(displayIndex)) return null;

		const rowNode = this.gridApi.getDisplayedRowAtIndex(displayIndex);
		const data = rowNode?.data as RowData | undefined;
		if (!data) return null;

		const raw = data[ROW_ID_FIELD];
		const parsed = raw !== undefined ? parseInt(String(raw), 10) : NaN;
		return Number.isNaN(parsed) ? null : parsed;
	}

	resizeColumns(): void {
		this.columnService.resizeColumns();
	}
private findRowNodeByBlockIndex(blockIndex: number): IRowNode<RowData> | null {
		if (!this.gridApi) return null;

		let match: IRowNode<RowData> | null = null;
		this.gridApi.forEachNode(node => {
			if (match) return;
			const data = node.data as RowData | undefined;
			if (!data) return;
			const raw = data[ROW_ID_FIELD];
			const parsed = raw !== undefined ? parseInt(String(raw), 10) : NaN;
			if (!Number.isNaN(parsed) && parsed === blockIndex) {
				match = node as IRowNode<RowData>;
			}
		});

		return match;
	}

	/**
	 * 开始编辑当前聚焦的单元格
	 */
	startEditingFocusedCell(): void {
		if (!this.gridApi) return;

		const focusedCell = this.gridApi.getFocusedCell();
		if (!focusedCell) return;

		this.gridApi.startEditingCell({
			rowIndex: focusedCell.rowIndex,
			colKey: focusedCell.column.getColId()
		});
	}

	/**
	 * 获取当前聚焦的单元格信息
	 */
	getFocusedCell(): { rowIndex: number; field: string } | null {
		if (!this.gridApi) return null;

		const focusedCell = this.gridApi.getFocusedCell();
		if (!focusedCell) return null;

		// 获取块索引
		const rowNode = this.gridApi.getDisplayedRowAtIndex(focusedCell.rowIndex);
		const data = rowNode?.data as RowData | undefined;
		if (!data) return null;

		const raw = data[ROW_ID_FIELD];
		const blockIndex = raw !== undefined ? parseInt(String(raw), 10) : NaN;
		if (Number.isNaN(blockIndex)) return null;

		return {
			rowIndex: blockIndex,
			field: focusedCell.column.getColId()
		};
	}

	/**
	 * 监听 Enter 键在最后一行按下的事件
	 */
	onEnterAtLastRow(callback: (field: string) => void): void {
		this.enterAtLastRowCallback = callback;
	}

}














