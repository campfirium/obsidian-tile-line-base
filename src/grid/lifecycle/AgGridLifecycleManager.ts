import { createGrid } from 'ag-grid-community';
import type { GridReadyEvent, ModelUpdatedEvent, RowDataUpdatedEvent } from 'ag-grid-community';
import { getLogger } from '../../utils/logger';
import type { Logger } from '../../utils/logger';
import type { RowData } from '../GridAdapter';
import type { TlbColDef, TlbGridApi, TlbGridOptions } from '../agGridTypes';

export interface LifecycleApis {
	gridApi: TlbGridApi;
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
	createGrid?: (container: HTMLElement, options: TlbGridOptions) => TlbGridApi;
	logger?: Pick<Logger, 'error' | 'warn'>;
}

const defaultLifecycleLogger = getLogger('grid:lifecycle');

/**
 * AgGridLifecycleManager centralizes grid mounting, API exposure, and teardown.
 * It owns the GridApi/ColumnApi references, run-when-ready queue, and lifecycle
 * attach/detach hooks that allow the adapter to bind DOM listeners safely.
 */
export class AgGridLifecycleManager {
	private readonly createGridImpl: (container: HTMLElement, options: TlbGridOptions) => TlbGridApi;
	private readonly logger: Pick<Logger, 'error' | 'warn'>;
	private gridApi: TlbGridApi | null = null;
	private columnApi: unknown = null;
	private container: HTMLElement | null = null;
	private readonly readyHandlers: ReadyHandler[] = [];
	private readonly modelUpdatedHandlers: Array<() => void> = [];
	private readonly attachHandlers: AttachHandler[] = [];
	private detachCallbacks: Array<() => void> = [];

	constructor(deps?: LifecycleManagerDependencies) {
		this.createGridImpl = deps?.createGrid ?? createGrid;
		this.logger = deps?.logger ?? defaultLifecycleLogger;
	}

	mountGrid(
		container: HTMLElement,
			columnDefs: TlbColDef[],
			rowData: RowData[],
			options: TlbGridOptions
		): void {
		this.teardown(false);
		this.container = container;

			const mergedOptions: TlbGridOptions = {
			...options,
			columnDefs,
			rowData
		};

			mergedOptions.onGridReady = (event: GridReadyEvent<RowData>) => {
				this.gridApi = event.api;
				const eventWithColumnApi = event as GridReadyEvent<RowData> & { columnApi?: unknown };
				this.columnApi = eventWithColumnApi.columnApi ?? null;
				try {
					options.onGridReady?.(event);
				} finally {
					this.flushReadyHandlers();
				}
			};

			mergedOptions.onModelUpdated = (event: ModelUpdatedEvent<RowData>) => {
				try {
					options.onModelUpdated?.(event);
				} finally {
					this.flushModelUpdatedHandlers();
				}
			};

			mergedOptions.onRowDataUpdated = (event: RowDataUpdatedEvent<RowData>) => {
				try {
					options.onRowDataUpdated?.(event);
				} finally {
					this.flushModelUpdatedHandlers();
				}
			};

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

	withGridApi(handler: (gridApi: TlbGridApi) => void): void {
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

	getGridApi(): TlbGridApi | null {
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
				this.logger.error('[AgGridLifecycle] onReady handler failed', error);
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
				this.logger.error('[AgGridLifecycle] onModelUpdated handler failed', error);
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


