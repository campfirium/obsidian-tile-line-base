/**
 * AgGridAdapter - AG Grid Community 适配器实现
 *
 * 使用 AG Grid Community 实现 GridAdapter 接口。
 */

import {
	AllCommunityModule,
	CellEditingStoppedEvent,
	ColumnState,
	GridApi,
	ModuleRegistry
} from 'ag-grid-community';
import { CellEditEvent, ColumnDef, GridAdapter, HeaderEditEvent, RowData, SortModelEntry } from './GridAdapter';
import { t } from '../i18n';
import { AgGridColumnService } from './column/AgGridColumnService';
import { AgGridInteractionController } from './interactions/AgGridInteractionController';
import type { GridInteractionContext } from './interactions/types';
import { AgGridLifecycleManager } from './lifecycle/AgGridLifecycleManager';
import { createAgGridOptions } from './options/createAgGridOptions';
import { AgGridSelectionController } from './selection/AgGridSelectionController';
import { AgGridStateService } from './state/AgGridStateService';
import { SideBarController } from './sidebar/SideBarController';
import { OverflowTooltipController } from './tooltip/OverflowTooltipController';

ModuleRegistry.registerModules([AllCommunityModule]);

export class AgGridAdapter implements GridAdapter {
	private cellEditCallback?: (event: CellEditEvent) => void;
	private columnHeaderContextMenuCallback?: (event: { field: string; domEvent: MouseEvent }) => void;
	private enterAtLastRowCallback?: (field: string) => void;
	private gridContext?: GridInteractionContext;
	private containerEl: HTMLElement | null = null;
	private sideBarVisible = true;
	private readonly columnService = new AgGridColumnService({
		getContainer: () => this.containerEl
	});
	private readonly lifecycle = new AgGridLifecycleManager();
	private readonly sideBar = new SideBarController({
		getGridApi: () => this.lifecycle.getGridApi()
	});
	private readonly interaction: AgGridInteractionController;
	private readonly selection: AgGridSelectionController;
	private readonly state: AgGridStateService;
	private readonly overflowTooltip = new OverflowTooltipController();

	get gridApi(): GridApi | null {
		return this.lifecycle.getGridApi();
	}

	get columnApi(): unknown {
		return this.lifecycle.getColumnApi();
	}

	constructor() {
		this.interaction = new AgGridInteractionController({
			getGridApi: () => this.lifecycle.getGridApi(),
			getGridContext: () => this.gridContext,
			getCellEditCallback: () => this.cellEditCallback,
			getEnterAtLastRowCallback: () => this.enterAtLastRowCallback,
			translate: (key: string) => t(key as any)
		});
		this.interaction.onViewportResize(reason => {
			if (reason === 'resize') {
				this.columnService.resizeColumns();
			}
		});

		this.lifecycle.onReady(({ gridApi, columnApi }) => {
			this.columnService.attachApis(gridApi, (columnApi ?? null) as any);
		});

		this.lifecycle.onModelUpdated(() => {
			this.interaction.onLayoutInvalidated();
		});

		this.selection = new AgGridSelectionController({
			getGridApi: () => this.lifecycle.getGridApi()
		});

		this.state = new AgGridStateService({
			getGridApi: () => this.lifecycle.getGridApi(),
			runWhenReady: callback => this.lifecycle.runWhenReady(callback),
			columnService: this.columnService
		});
	}

	runWhenReady(callback: () => void): void {
		this.lifecycle.runWhenReady(callback);
	}

	onModelUpdated(callback: () => void): void {
		this.lifecycle.onModelUpdated(callback);
	}

	mount(
		container: HTMLElement,
		columns: ColumnDef[],
		rows: RowData[],
		context?: GridInteractionContext
	): void {
		const sideBarVisible = context?.sideBarVisible !== false;
		this.sideBarVisible = sideBarVisible;
		this.sideBar.reset();
		this.containerEl = container;
		this.gridContext = context;
		this.interaction.setContainer(container);
		this.overflowTooltip.attach(container);
		this.columnService.configureCallbacks({
			onColumnResize: context?.onColumnResize,
			onColumnOrderChange: context?.onColumnOrderChange
		});
		this.columnService.setContainer(container);

		const ownerDocument = container.ownerDocument ?? document;
		const popupParent = this.ensurePopupParent(ownerDocument);

		const colDefs = this.columnService.buildColumnDefs(columns);
		const gridOptions = createAgGridOptions({
			ownerDocument,
			popupParent,
			columnService: this.columnService,
			interaction: this.interaction,
			getGridContext: () => this.gridContext,
			onCellEditingStopped: (event: CellEditingStoppedEvent) => this.handleCellEdit(event),
			getColumnHeaderContextMenu: () => this.columnHeaderContextMenuCallback,
			resizeColumns: () => this.resizeColumns()
		});

		this.lifecycle.mountGrid(container, colDefs, rows, gridOptions);
		this.interaction.bindViewportListeners(container);
		if (!sideBarVisible) {
			this.setSideBarVisible(false);
		}
	}

	updateData(rows: RowData[]): void {
		this.lifecycle.withGridApi(api => {
			api.setGridOption('rowData', rows);
			api.refreshCells({ force: true });
		});
	}

	getFilterModel(): any | null {
		return this.state.getFilterModel();
	}

	setFilterModel(model: any | null): void {
		this.state.setFilterModel(model);
	}

	setSortModel(sortModel: SortModelEntry[]): void {
		this.state.setSortModel(sortModel);
	}

	setQuickFilter(value: string | null): void {
		this.state.setQuickFilter(value);
	}

	setSideBarVisible(visible: boolean): void {
		if (this.sideBarVisible === visible) {
			return;
		}
		this.sideBarVisible = visible;
		this.lifecycle.runWhenReady(() => {
			this.sideBar.setVisible(visible);
		});
	}

	getColumnState(): ColumnState[] | null {
		return this.state.getColumnState();
	}

	applyColumnState(state: ColumnState[] | null): void {
		this.state.applyColumnState(state);
	}

	markLayoutDirty(): void {
		this.columnService.markLayoutDirty();
		this.interaction.onLayoutInvalidated();
	}

	selectRow(blockIndex: number, options?: { ensureVisible?: boolean }): void {
		this.selection.selectRow(blockIndex, options);
	}

	onCellEdit(callback: (event: CellEditEvent) => void): void {
		this.cellEditCallback = callback;
	}

	onHeaderEdit(_callback: (event: HeaderEditEvent) => void): void {
		// Header editing is not yet supported by the AG Grid adapter.
	}

	onColumnHeaderContextMenu(
		callback: (event: { field: string; domEvent: MouseEvent }) => void
	): void {
		this.columnHeaderContextMenuCallback = callback;
	}

	destroy(): void {
		this.overflowTooltip.detach();
		this.lifecycle.destroy();
		this.sideBar.reset();
		this.columnService.detachApis();
		this.columnService.configureCallbacks(undefined);
		this.columnService.setContainer(null);
		this.interaction.destroy();
		this.interaction.setContainer(null);
		this.cellEditCallback = undefined;
		this.enterAtLastRowCallback = undefined;
		this.columnHeaderContextMenuCallback = undefined;
		this.gridContext = undefined;
		this.containerEl = null;
	}

	getSelectedRows(): number[] {
		return this.selection.getSelectedRows();
	}

	getRowIndexFromEvent(event: MouseEvent): number | null {
		return this.selection.getRowIndexFromEvent(event);
	}

	resizeColumns(): void {
		this.columnService.resizeColumns();
	}

	fillColumnsToMinimumWidth(): void {
		this.columnService.fillColumnsToMinimumWidth();
	}

	startEditingFocusedCell(): void {
		this.selection.startEditingFocusedCell();
	}

	getFocusedCell(): { rowIndex: number; field: string } | null {
		return this.selection.getFocusedCell();
	}

	onEnterAtLastRow(callback: (field: string) => void): void {
		this.enterAtLastRowCallback = callback;
	}

	private handleCellEdit(event: CellEditingStoppedEvent): void {
		this.interaction.handleCellEditingStopped();

		if (!this.cellEditCallback) {
			return;
		}

		const field = event.colDef.field;
		const rowIndex = event.node.rowIndex;
		const newValue = event.newValue;
		const oldValue = event.oldValue;

		if (field && rowIndex !== null && rowIndex !== undefined) {
			const newStr = String(newValue ?? '');
			const oldStr = String(oldValue ?? '');

			if (newStr !== oldStr) {
				this.cellEditCallback({
					rowIndex,
					field,
					newValue: newStr,
					oldValue: oldStr,
					rowData: event.data as RowData
				});
			}
		}
	}

	private ensurePopupParent(doc: Document): HTMLElement {
		const className = 'tlb-grid-popup-root';
		const existing = doc.body.querySelector<HTMLElement>(`.${className}`);
		if (existing) {
			return existing;
		}
		const root = doc.createElement('div');
		root.classList.add(className);
		doc.body.appendChild(root);
		return root;
	}
}
