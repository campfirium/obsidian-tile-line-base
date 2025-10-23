import { createGrid, GridApi, GridOptions } from 'ag-grid-community';
import type { ColDef, ModelUpdatedEvent, RowDataUpdatedEvent } from 'ag-grid-community';

export interface LifecycleApis {
	gridApi: GridApi;
	// ColumnApi is not exported in ag-grid-community typings, keep it loosely typed
	columnApi: unknown;
}

export interface LifecycleContext {
	container: HTMLElement;
	apis: LifecycleApis | null;
}

type ReadyHandler = (apis: LifecycleApis) => void;
type AttachHandler = (context: LifecycleContext) => void | (() => void);

interface LifecycleManagerDependencies {
	createGrid?: (container: HTMLElement, options: GridOptions) => GridApi;
	logger?: Pick<typeof console, 'error' | 'warn'>;
}

/**
 * AgGridLifecycleManager centralizes grid mounting, API exposure, and teardown.
 * It owns the GridApi/ColumnApi references, run-when-ready queue, and lifecycle
 * attach/detach hooks that allow the adapter to bind DOM listeners safely.
 */
export class AgGridLifecycleManager {
	private readonly createGridImpl: (container: HTMLElement, options: GridOptions) => GridApi;
	private readonly logger: Pick<typeof console, 'error' | 'warn'>;
	private gridApi: GridApi | null = null;
	private columnApi: unknown = null;
	private container: HTMLElement | null = null;
	private readonly readyHandlers: ReadyHandler[] = [];
	private readonly modelUpdatedHandlers: Array<() => void> = [];
	private readonly attachHandlers: AttachHandler[] = [];
	private detachCallbacks: Array<() => void> = [];

	constructor(deps?: LifecycleManagerDependencies) {
		this.createGridImpl = deps?.createGrid ?? createGrid;
		this.logger = deps?.logger ?? console;
	}

	mountGrid(
		container: HTMLElement,
		columnDefs: ColDef[],
		rowData: unknown[],
		options: GridOptions
	): void {
		this.teardown(false);
		this.container = container;

		const mergedOptions: GridOptions = {
			...options,
			columnDefs,
			rowData
		};

		const originalOnGridReady = mergedOptions.onGridReady;
		mergedOptions.onGridReady = (event: any) => {
			this.gridApi = event.api;
			this.columnApi = event.columnApi ?? null;
			try {
				originalOnGridReady?.(event);
			} finally {
				this.flushReadyHandlers();
			}
		};

		const wrapModelUpdated =
			(handler?: (event: ModelUpdatedEvent | RowDataUpdatedEvent) => void) =>
			(event: ModelUpdatedEvent | RowDataUpdatedEvent) => {
				try {
					handler?.(event);
				} finally {
					this.flushModelUpdatedHandlers();
				}
			};

		mergedOptions.onModelUpdated = wrapModelUpdated(mergedOptions.onModelUpdated);
		mergedOptions.onRowDataUpdated = wrapModelUpdated(mergedOptions.onRowDataUpdated);

		try {
			this.gridApi = this.createGridImpl(container, mergedOptions);
		} catch (error) {
			this.logger.error('[AgGridLifecycle] Failed to mount grid', error);
			this.gridApi = null;
			this.columnApi = null;
			this.container = null;
			throw error;
		}

		this.notifyAttach();
	}

	destroy(): void {
		this.teardown(true);
	}

	withApis(handler: ReadyHandler): void {
		const apis = this.getApis();
		if (apis) {
			handler(apis);
			return;
		}
		this.readyHandlers.push(handler);
	}

	onReady(handler: ReadyHandler): void {
		this.withApis(handler);
	}

	runWhenReady(callback: () => void): void {
		this.onReady(() => callback());
	}

	withGridApi(handler: (gridApi: GridApi) => void): void {
		this.withApis(({ gridApi }) => handler(gridApi));
	}

	withColumnApi(handler: (columnApi: unknown) => void): void {
		this.withApis(({ columnApi }) => handler(columnApi));
	}

	onModelUpdated(callback: () => void): void {
		this.modelUpdatedHandlers.push(callback);
	}

	getApis(): LifecycleApis | null {
		if (!this.gridApi) {
			return null;
		}
		return {
			gridApi: this.gridApi,
			columnApi: this.columnApi
		};
	}

	getGridApi(): GridApi | null {
		return this.gridApi;
	}

	getColumnApi(): unknown {
		return this.columnApi;
	}

	getContainer(): HTMLElement | null {
		return this.container;
	}

	onAttach(handler: AttachHandler): void {
		this.attachHandlers.push(handler);
		if (this.container) {
			this.invokeAttachHandler(handler);
		}
	}

	private invokeAttachHandler(handler: AttachHandler): void {
		const context: LifecycleContext = {
			container: this.container as HTMLElement,
			apis: this.getApis()
		};
		const cleanup = handler(context);
		if (typeof cleanup === 'function') {
			this.detachCallbacks.push(cleanup);
		}
	}

	private notifyAttach(): void {
		if (!this.container) {
			return;
		}
		for (const handler of this.attachHandlers) {
			this.invokeAttachHandler(handler);
		}
	}

	private flushReadyHandlers(): void {
		if (!this.gridApi || this.readyHandlers.length === 0) {
			return;
		}
		const apis = this.getApis();
		if (!apis) {
			return;
		}
		const queue = [...this.readyHandlers];
		this.readyHandlers.length = 0;
		for (const handler of queue) {
			try {
				handler(apis);
			} catch (error) {
				console.error('[AgGridLifecycle] onReady handler failed', error);
			}
		}
	}

	private flushModelUpdatedHandlers(): void {
		if (this.modelUpdatedHandlers.length === 0) {
			return;
		}
		for (const handler of this.modelUpdatedHandlers) {
			try {
				handler();
			} catch (error) {
				console.error('[AgGridLifecycle] onModelUpdated handler failed', error);
			}
		}
	}

	private teardown(resetHandlers: boolean): void {
		this.runDetach();
		if (this.gridApi) {
			try {
				this.gridApi.destroy();
			} catch (error) {
				this.logger.warn('[AgGridLifecycle] Failed to destroy grid', error);
			}
		}
		this.gridApi = null;
		this.columnApi = null;
		this.container = null;
		if (resetHandlers) {
			this.readyHandlers.length = 0;
			this.modelUpdatedHandlers.length = 0;
		}
	}

	private runDetach(): void {
		if (this.detachCallbacks.length === 0) {
			return;
		}
		const callbacks = [...this.detachCallbacks];
		this.detachCallbacks.length = 0;
		for (const callback of callbacks) {
			try {
				callback();
			} catch (error) {
				this.logger.error('[AgGridLifecycle] detach handler failed', error);
			}
		}
	}
}
