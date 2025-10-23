import { AgGridAdapter } from '../grid/AgGridAdapter';
import type { GridAdapter, ColumnDef, RowData, CellEditEvent, HeaderEditEvent } from '../grid/GridAdapter';
import type { TaskStatus } from '../renderers/StatusCellRenderer';

export interface GridControllerHandlers {
	onStatusChange: (rowId: string, newStatus: TaskStatus) => void;
	onColumnResize: (field: string, width: number) => void;
	onCopyH2Section: (rowIndex: number) => void;
	onColumnOrderChange: (fields: string[]) => void;
	onModelUpdated?: () => void;
	onCellEdit: (event: CellEditEvent) => void;
	onHeaderEdit?: (event: HeaderEditEvent) => void;
	onColumnHeaderContextMenu?: (field: string, event: MouseEvent) => void;
	onEnterAtLastRow?: (field: string | null) => void;
}

export interface GridMountResult {
	gridAdapter: GridAdapter;
	container: HTMLElement;
}

/**
 * 负责管理表格适配器的生命周期与事件绑定。
 * 将挂载/销毁、初始列宽补偿等操作集中到单独模块，降低 TableView 复杂度。
 */
export class GridController {
	private gridAdapter: GridAdapter | null = null;
	private tableContainer: HTMLElement | null = null;
	private initialResizeTimers: Array<ReturnType<typeof setTimeout>> = [];

	mount(
		container: HTMLElement,
		columns: ColumnDef[],
		rows: RowData[],
		handlers: GridControllerHandlers
	): GridMountResult {
		this.destroy();

		const adapter = new AgGridAdapter();
		adapter.mount(container, columns, rows, {
			onStatusChange: handlers.onStatusChange,
			onColumnResize: handlers.onColumnResize,
			onCopyH2Section: handlers.onCopyH2Section,
			onColumnOrderChange: handlers.onColumnOrderChange
		});

		adapter.onCellEdit((event) => {
			handlers.onCellEdit(event);
		});

		if (handlers.onHeaderEdit && adapter.onHeaderEdit) {
			adapter.onHeaderEdit((event) => {
				handlers.onHeaderEdit?.(event);
			});
		}

		if (handlers.onColumnHeaderContextMenu && adapter.onColumnHeaderContextMenu) {
			adapter.onColumnHeaderContextMenu(({ field, domEvent }) => {
				handlers.onColumnHeaderContextMenu?.(field, domEvent);
			});
		}

		if (handlers.onEnterAtLastRow && adapter.onEnterAtLastRow) {
			adapter.onEnterAtLastRow((field) => {
				handlers.onEnterAtLastRow?.(field ?? null);
			});
		}

		if (handlers.onModelUpdated && adapter.onModelUpdated) {
			adapter.onModelUpdated(() => {
				handlers.onModelUpdated?.();
			});
		}

		this.gridAdapter = adapter;
		this.tableContainer = container;
		this.scheduleInitialResizes();

		return {
			gridAdapter: adapter,
			container
		};
	}

	getAdapter(): GridAdapter | null {
		return this.gridAdapter;
	}

	getContainer(): HTMLElement | null {
		return this.tableContainer;
	}

	markLayoutDirty(): void {
		this.gridAdapter?.markLayoutDirty?.();
	}

	resizeColumns(): void {
		this.gridAdapter?.resizeColumns?.();
	}

	destroy(): void {
		this.clearResizeTimers();
		if (this.gridAdapter) {
			this.gridAdapter.destroy();
			this.gridAdapter = null;
		}
		this.tableContainer = null;
	}

	private scheduleInitialResizes(): void {
		this.clearResizeTimers();
		const attemptResize = () => {
			this.resizeColumns();
		};
		for (const delay of [100, 300, 800]) {
			const handle = setTimeout(attemptResize, delay);
			this.initialResizeTimers.push(handle);
		}
	}

	private clearResizeTimers(): void {
		if (this.initialResizeTimers.length === 0) {
			return;
		}
		for (const handle of this.initialResizeTimers) {
			clearTimeout(handle);
		}
		this.initialResizeTimers = [];
	}
}
