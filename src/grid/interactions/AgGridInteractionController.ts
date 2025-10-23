import {
	CellKeyDownEvent,
	CellFocusedEvent,
	GridApi
} from 'ag-grid-community';
import { CompositionProxy } from '../utils/CompositionProxy';
import { CellEditEvent, RowData, ROW_ID_FIELD } from '../GridAdapter';
import { TaskStatus } from '../../renderers/StatusCellRenderer';

export interface GridInteractionContext {
	onStatusChange?: (rowId: string, newStatus: TaskStatus) => void;
	onColumnResize?: (field: string, width: number) => void;
	onCopyH2Section?: (rowIndex: number) => void;
	onColumnOrderChange?: (fields: string[]) => void;
}

interface InteractionControllerDeps {
	getGridApi(): GridApi | null;
	getGridContext(): GridInteractionContext | undefined;
	getCellEditCallback(): ((event: CellEditEvent) => void) | undefined;
	getEnterAtLastRowCallback(): ((field: string) => void) | undefined;
	translate(key: string): string;
}

type ViewportResizeReason = 'scroll' | 'resize';

type KeyboardEventLike = {
	key: string;
	ctrlKey?: boolean;
	altKey?: boolean;
	metaKey?: boolean;
	shiftKey?: boolean;
	preventDefault?: () => void;
	stopPropagation?: () => void;
};

export class AgGridInteractionController {
	private readonly deps: InteractionControllerDeps;
	private container: HTMLElement | null = null;
	private proxyByDoc = new WeakMap<Document, CompositionProxy>();
	private focusedDoc: Document | null = null;
	private focusedRowIndex: number | null = null;
	private focusedColId: string | null = null;
	private pendingCaptureCancel?: (reason?: string) => void;
	private editing = false;
	private proxyRealignTimer: number | null = null;
	private viewportListenerCleanup: (() => void) | null = null;
	private readonly viewportResizeCallbacks: Array<(reason: ViewportResizeReason) => void> = [];
	private pendingEnterAtLastRow = false;

	constructor(deps: InteractionControllerDeps) {
		this.deps = deps;
	}

	setContainer(container: HTMLElement | null): void {
		if (this.container !== container) {
			this.unbindViewportListeners();
		}
		this.container = container;
		if (container) {
			this.focusedDoc = container.ownerDocument || document;
		}
	}

	onViewportResize(callback: (reason: ViewportResizeReason) => void): () => void {
		this.viewportResizeCallbacks.push(callback);
		return () => {
			const index = this.viewportResizeCallbacks.indexOf(callback);
			if (index >= 0) {
				this.viewportResizeCallbacks.splice(index, 1);
			}
		};
	}

	bindViewportListeners(container: HTMLElement): void {
		this.unbindViewportListeners();

		const onScroll = () => this.handleViewportActivity('scroll');
		const onWheel = () => this.handleViewportActivity('scroll');
		const ownerWin = container.ownerDocument?.defaultView ?? window;
		const onResize = () => this.handleViewportActivity('resize');

		const viewports = Array.from(
			container.querySelectorAll<HTMLElement>(
				'.ag-center-cols-viewport, .ag-pinned-left-cols-viewport, .ag-pinned-right-cols-viewport, .ag-body-viewport'
			)
		);
		if (!viewports.includes(container)) {
			viewports.push(container);
		}

		const removers: Array<() => void> = [];
		const attach = (
			el: EventTarget,
			type: string,
			handler: EventListenerOrEventListenerObject,
			options?: boolean
		) => {
			el.addEventListener(type, handler, options);
			removers.push(() => el.removeEventListener(type, handler, options));
		};

		for (const viewport of viewports) {
			attach(viewport, 'scroll', onScroll, false);
			attach(viewport, 'wheel', onWheel, true);
		}
		attach(ownerWin, 'resize', onResize, false);

		this.viewportListenerCleanup = () => {
			for (const remove of removers) {
				remove();
			}
		};
	}

	handleGridCellKeyDown(event: CellKeyDownEvent): void {
		const keyEvent = this.normalizeKeyboardEvent(event.event);
		if (!keyEvent) {
			return;
		}

		if ((keyEvent.metaKey || keyEvent.ctrlKey) && keyEvent.key.toLowerCase() === 'c') {
			this.handleCopyShortcut(keyEvent, event);
			return;
		}

		this.handleEnterAtLastRow(
			event.api,
			event.column?.getColId?.() ?? null,
			event.node?.rowIndex ?? null,
			keyEvent
		);
	}

	handleSuppressKeyboardEvent(params: {
		api: GridApi;
		column?: { getColId?: () => string };
		node?: { rowIndex?: number | null };
		event: KeyboardEvent;
	}): boolean {
		const keyEvent = this.normalizeKeyboardEvent(params.event);
		if (!keyEvent) {
			return false;
		}
		return this.handleEnterAtLastRow(
			params.api,
			params.column?.getColId?.() ?? null,
			params.node?.rowIndex ?? null,
			keyEvent
		);
	}

	handleCellFocused(event: CellFocusedEvent): void {
		this.focusedDoc = this.container?.ownerDocument || document;

		if (event.rowIndex == null || !event.column) {
			this.focusedRowIndex = null;
			this.focusedColId = null;
			this.cancelPendingCapture('focus-cleared');
			return;
		}

		this.focusedRowIndex = event.rowIndex;
		const colId = (event as any).column?.getColId?.() ?? (event as any).columnId ?? null;
		this.focusedColId = colId;

		if (this.editing) {
			return;
		}

		this.armProxyForCurrentCell();
	}

	handleCellEditingStarted(): void {
		this.editing = true;
		this.cancelPendingCapture('editing-started');
		if (this.focusedDoc) {
			this.getProxy(this.focusedDoc).setKeyHandler(undefined);
		}
	}

	handleCellEditingStopped(): void {
		this.editing = false;
		this.armProxyForCurrentCell();
	}

	onLayoutInvalidated(): void {
		this.armProxyForCurrentCell();
	}

	destroy(): void {
		this.cancelPendingCapture('destroy');
		this.unbindViewportListeners();
		if (this.proxyRealignTimer != null) {
			window.clearTimeout(this.proxyRealignTimer);
			this.proxyRealignTimer = null;
		}
		this.viewportResizeCallbacks.length = 0;
		this.focusedDoc = null;
		this.focusedColId = null;
		this.focusedRowIndex = null;
		this.pendingEnterAtLastRow = false;
		this.editing = false;
		this.container = null;
	}

	private handleViewportActivity(reason: ViewportResizeReason): void {
		this.notifyViewportResize(reason);
		this.requestProxyRealign(reason);
	}

	private getProxy(doc: Document): CompositionProxy {
		let proxy = this.proxyByDoc.get(doc);
		if (!proxy) {
			proxy = new CompositionProxy(doc);
			this.proxyByDoc.set(doc, proxy);
		}
		return proxy;
	}

	private getGridApi(): GridApi | null {
		return this.deps.getGridApi();
	}

	private translate(key: string): string {
		return this.deps.translate(key);
	}

	private normalizeKeyboardEvent(event: unknown): KeyboardEventLike | null {
		if (!event || typeof (event as { key?: unknown }).key !== 'string') {
			return null;
		}
		const keyEvent = event as KeyboardEventLike;
		if (typeof keyEvent.preventDefault !== 'function') {
			keyEvent.preventDefault = () => {};
		}
		if (typeof keyEvent.stopPropagation !== 'function') {
			keyEvent.stopPropagation = () => {};
		}
		keyEvent.ctrlKey = Boolean(keyEvent.ctrlKey);
		keyEvent.metaKey = Boolean(keyEvent.metaKey);
		keyEvent.altKey = Boolean(keyEvent.altKey);
		keyEvent.shiftKey = Boolean(keyEvent.shiftKey);
		return keyEvent;
	}

	private isPrintable(e: KeyboardEventLike): boolean {
		return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
	}

	private startEditingWithCapturedText(
		doc: Document,
		rowIndex: number,
		colKey: string,
		text: string
	): Promise<void> {
		const gridApi = this.getGridApi();
		if (!gridApi) {
			return Promise.resolve();
		}

		this.editing = true;
		this.focusedRowIndex = rowIndex;
		this.focusedColId = colKey;
		this.cancelPendingCapture('editing-started');
		this.getProxy(doc).setKeyHandler(undefined);

		gridApi.setFocusedCell(rowIndex, colKey);
		gridApi.startEditingCell({ rowIndex, colKey });

		return this.waitForEditorInput(doc)
			.then((input) => {
				input.value = text ?? '';
				const len = input.value.length;
				input.setSelectionRange(len, len);
				input.focus();
			})
			.catch((err) => {
				console.warn(this.translate('agGrid.editorInputMissing'), err);
			});
	}

	private waitForEditorInput(doc: Document): Promise<HTMLInputElement | HTMLTextAreaElement> {
		const selector =
			'.ag-cell-editor input, .ag-cell-editor textarea, .ag-cell-inline-editing input, .ag-cell-inline-editing textarea, .ag-cell-edit-input';
		return new Promise((resolve, reject) => {
			const lookup = () =>
				doc.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
			const immediate = lookup();
			if (immediate) {
				resolve(immediate);
				return;
			}

			const body = doc.body;
			if (!body) {
				reject(new Error(this.translate('agGrid.documentBodyUnavailable')));
				return;
			}

			const observer = new MutationObserver(() => {
				const candidate = lookup();
				if (candidate) {
					cleanup();
					resolve(candidate);
				}
			});

			const timeout = window.setTimeout(() => {
				cleanup();
				reject(new Error(this.translate('agGrid.editorWaitTimeout')));
			}, 1000);

			const cleanup = () => {
				window.clearTimeout(timeout);
				observer.disconnect();
			};

			observer.observe(body, { childList: true, subtree: true });
		});
	}

	private cancelPendingCapture(reason?: string): void {
		if (this.pendingCaptureCancel) {
			const cancel = this.pendingCaptureCancel;
			this.pendingCaptureCancel = undefined;
			cancel(reason);
		} else if (this.focusedDoc) {
			this.getProxy(this.focusedDoc).cancel(reason);
		}
	}

	private requestProxyRealign(reason: string): void {
		if (this.editing) {
			return;
		}

		this.cancelPendingCapture(reason);
		if (this.proxyRealignTimer != null) {
			window.clearTimeout(this.proxyRealignTimer);
		}

		this.proxyRealignTimer = window.setTimeout(() => {
			this.proxyRealignTimer = null;
			this.armProxyForCurrentCell();
		}, 80);
	}

	private notifyViewportResize(reason: ViewportResizeReason): void {
		if (this.viewportResizeCallbacks.length === 0) {
			return;
		}
		const listeners = [...this.viewportResizeCallbacks];
		for (const callback of listeners) {
			try {
				callback(reason);
			} catch (error) {
				console.error('[AgGridInteraction] viewport resize callback failed', error);
			}
		}
	}

	private unbindViewportListeners(): void {
		if (this.viewportListenerCleanup) {
			this.viewportListenerCleanup();
			this.viewportListenerCleanup = null;
		}
	}

	private getCellElementFor(rowIndex: number, colKey: string, doc: Document): HTMLElement | null {
		const root = (this.container ?? doc) as Document | Element;
		const gridApi = this.getGridApi();
		const column = gridApi?.getColumn(colKey);
		const pinned = column?.getPinned?.() ?? column?.isPinned?.();

		const containers: string[] = [];
		if (pinned === 'left') {
			containers.push('.ag-pinned-left-cols-container');
		} else if (pinned === 'right') {
			containers.push('.ag-pinned-right-cols-container');
		}
		containers.push('.ag-center-cols-container');

		for (const container of containers) {
			const selector = `${container} [row-index="${rowIndex}"] [col-id="${colKey}"]`;
			const match = (root as any).querySelector?.(selector) as HTMLElement | null;
			if (match) {
				return match;
			}
		}

		const fallbackContainers = ['.ag-pinned-left-cols-container', '.ag-pinned-right-cols-container'];
		for (const container of fallbackContainers) {
			const selector = `${container} [row-index="${rowIndex}"] [col-id="${colKey}"]`;
			const match = (root as any).querySelector?.(selector) as HTMLElement | null;
			if (match) {
				return match;
			}
		}

		return null;
	}

	private armProxyForCurrentCell(): void {
		const gridApi = this.getGridApi();
		if (!gridApi) return;
		if (this.editing) return;
		if (this.focusedDoc == null || this.focusedRowIndex == null || !this.focusedColId) {
			this.cancelPendingCapture('focus-cleared');
			return;
		}

		const doc = this.focusedDoc;
		const rowIndex = this.focusedRowIndex;
		const colKey = this.focusedColId;
		const cellEl = this.getCellElementFor(rowIndex, colKey, doc);
		if (!cellEl) {
			this.cancelPendingCapture('cell-missing');
			return;
		}

		const rect = cellEl.getBoundingClientRect();
		const proxy = this.getProxy(doc);

		this.cancelPendingCapture('rearm');
		const capturePromise = proxy.captureOnceAt(rect);
		proxy.setKeyHandler((event) => this.handleProxyKeyDown(event));
		this.pendingCaptureCancel = (reason?: string) => proxy.cancel(reason);

		capturePromise
			.then((text) => {
				this.pendingCaptureCancel = undefined;
				if (this.editing) return;
				if (this.focusedRowIndex == null || !this.focusedColId) return;
				return this.startEditingWithCapturedText(doc, this.focusedRowIndex, this.focusedColId, text);
			})
			.catch((err) => {
				this.pendingCaptureCancel = undefined;
				if (
					err === 'cancelled' ||
					err === 'rearm' ||
					err === 'editing-started' ||
					err === 'focus-cleared' ||
					err === 'cell-missing' ||
					err === 'destroyed' ||
					err === 'focus-move'
				) {
					return;
				}
				console.error(this.translate('agGrid.compositionCaptureFailed'), err);
			});
	}

	private handleProxyKeyDown(rawEvent: KeyboardEvent): void {
		const event = this.normalizeKeyboardEvent(rawEvent);
		if (!event) {
			return;
		}
		const gridApi = this.getGridApi();
		if (!gridApi) return;

		if (this.isPrintable(event)) {
			return;
		}

		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
			this.handleCopyShortcut(event);
			return;
		}

		switch (event.key) {
			case 'Enter':
				event.preventDefault?.();
				event.stopPropagation?.();
				this.handleProxyEnter(Boolean(event.shiftKey));
				break;
			case 'Tab':
				event.preventDefault?.();
				event.stopPropagation?.();
				this.moveFocus(0, event.shiftKey ? -1 : 1);
				break;
			case 'ArrowUp':
			case 'Up':
				event.preventDefault?.();
				event.stopPropagation?.();
				this.moveFocus(-1, 0);
				break;
			case 'ArrowDown':
			case 'Down':
				event.preventDefault?.();
				event.stopPropagation?.();
				this.moveFocus(1, 0);
				break;
			case 'ArrowLeft':
			case 'Left':
				event.preventDefault?.();
				event.stopPropagation?.();
				this.moveFocus(0, -1);
				break;
			case 'ArrowRight':
			case 'Right':
				event.preventDefault?.();
				event.stopPropagation?.();
				this.moveFocus(0, 1);
				break;
			case 'Delete':
			case 'Backspace':
				event.preventDefault?.();
				event.stopPropagation?.();
				this.handleDeleteKey();
				break;
			default:
				break;
		}
	}

	private handleCopyShortcut(event: KeyboardEventLike, cellEvent?: CellKeyDownEvent): void {
		const gridApi = this.getGridApi();
		if (!gridApi) {
			return;
		}

		if (cellEvent) {
			const colId = cellEvent.column?.getColId?.() ?? null;
			if (colId === '#') {
				const rowData = cellEvent.node?.data as RowData | undefined;
				if (rowData) {
					const blockIndex = parseInt(String(rowData[ROW_ID_FIELD]), 10);
					if (!Number.isNaN(blockIndex)) {
						const context = this.deps.getGridContext();
						if (context?.onCopyH2Section) {
							event.preventDefault?.();
							event.stopPropagation?.();
							context.onCopyH2Section(blockIndex);
							return;
						}
					}
				}
			}
		}

		const text = this.extractFocusedCellText();
		if (text == null) {
			return;
		}

		event.preventDefault?.();
		event.stopPropagation?.();
		const doc = this.focusedDoc || document;
		this.copyTextToClipboard(doc, text);
	}

	private extractFocusedCellText(): string | null {
		const gridApi = this.getGridApi();
		if (!gridApi) return null;

		const focusedCell = gridApi.getFocusedCell();
		if (!focusedCell) return null;

		const rowNode = gridApi.getDisplayedRowAtIndex(focusedCell.rowIndex);
		if (!rowNode) return null;

		const colId = focusedCell.column.getColId();
		const field = focusedCell.column.getColDef().field ?? colId;
		const rowData = rowNode.data as RowData | undefined;
		const raw = rowData ? (rowData[field] ?? rowData[colId]) : undefined;
		return raw == null ? '' : String(raw);
	}

	private copyTextToClipboard(doc: Document, text: string): void {
		const nav = doc.defaultView?.navigator;
		if (nav?.clipboard?.writeText) {
			nav.clipboard.writeText(text).catch(() => {
				this.copyViaHiddenTextarea(doc, text);
			});
			return;
		}

		this.copyViaHiddenTextarea(doc, text);
	}

	private copyViaHiddenTextarea(doc: Document, text: string): void {
		const textarea = doc.createElement('textarea');
		textarea.value = text;
		textarea.setAttribute('readonly', 'true');
		Object.assign(textarea.style, {
			position: 'fixed',
			left: '-9999px',
			top: '0',
			width: '1px',
			height: '1px',
			opacity: '0'
		});

		doc.body.appendChild(textarea);
		textarea.focus();
		textarea.select();
		try {
			doc.execCommand('copy');
		} catch (error) {
			console.warn(this.translate('agGrid.copyFailed'), error);
		}
		textarea.blur();
		doc.body.removeChild(textarea);
	}

	private handleProxyEnter(shift: boolean): void {
		const gridApi = this.getGridApi();
		if (!gridApi) return;
		if (this.focusedRowIndex == null || !this.focusedColId) return;

		if (shift) {
			this.moveFocus(-1, 0);
			return;
		}

		const rowIndex = this.focusedRowIndex;
		const totalRows = gridApi.getDisplayedRowCount();
		if (totalRows === 0) return;
		const colId = this.focusedColId;

		if (rowIndex === totalRows - 1) {
			const callback = this.deps.getEnterAtLastRowCallback();
			if (callback) {
				callback(colId);
			}
			return;
		}

		this.moveFocus(1, 0);
	}

	private handleDeleteKey(): void {
		const gridApi = this.getGridApi();
		if (!gridApi) return;

		const focusedCell = gridApi.getFocusedCell();
		if (!focusedCell) return;

		const field = focusedCell.column.getColId();
		if (field === '#' || field === ROW_ID_FIELD || field === 'status') {
			return;
		}

		const rowNode = gridApi.getDisplayedRowAtIndex(focusedCell.rowIndex);
		if (!rowNode) return;

		const data = rowNode.data as RowData | undefined;
		if (!data) return;

		const oldValue = String(data[field] ?? '');
		if (oldValue.length === 0) {
			return;
		}

		if (typeof rowNode.setDataValue === 'function') {
			rowNode.setDataValue(field, '');
		} else {
			data[field] = '';
		}

		const raw = data[ROW_ID_FIELD];
		const blockIndex = raw !== undefined ? parseInt(String(raw), 10) : NaN;
		if (!Number.isNaN(blockIndex)) {
			const callback = this.deps.getCellEditCallback();
			if (callback) {
				callback({
					rowIndex: blockIndex,
					field,
					newValue: '',
					oldValue,
					rowData: data
				});
			}
		}

		this.armProxyForCurrentCell();
	}

	private moveFocus(rowDelta: number, colDelta: number): void {
		const gridApi = this.getGridApi();
		if (!gridApi) return;
		if (this.focusedRowIndex == null || !this.focusedColId) return;

		const displayedColumns = gridApi.getAllDisplayedColumns();
		if (!displayedColumns || displayedColumns.length === 0) return;

		const currentColIndex = displayedColumns.findIndex((col) => col.getColId() === this.focusedColId);
		if (currentColIndex === -1) return;

		const targetColIndex = Math.max(0, Math.min(displayedColumns.length - 1, currentColIndex + colDelta));
		const targetCol = displayedColumns[targetColIndex];

		const rowCount = gridApi.getDisplayedRowCount();
		if (rowCount === 0) return;
		const targetRowIndex = Math.max(0, Math.min(rowCount - 1, this.focusedRowIndex + rowDelta));

		this.cancelPendingCapture('focus-move');
		gridApi.ensureIndexVisible(targetRowIndex);
		gridApi.setFocusedCell(targetRowIndex, targetCol.getColId());
		this.focusedRowIndex = targetRowIndex;
		this.focusedColId = targetCol.getColId();
		this.armProxyForCurrentCell();
	}

	private handleEnterAtLastRow(
		api: GridApi,
		columnId: string | null | undefined,
		rowIndex: number | null | undefined,
		keyEvent: KeyboardEventLike
	): boolean {
		if (keyEvent.key !== 'Enter') {
			return false;
		}

		const callback = this.deps.getEnterAtLastRowCallback();
		if (!callback) {
			return false;
		}

		const editingCells = typeof api.getEditingCells === 'function' ? api.getEditingCells() : [];
		const activeEditingCell = editingCells.length > 0 ? editingCells[0] : undefined;
		const focusedCell = api.getFocusedCell();

		const effectiveRowIndex =
			(rowIndex ?? undefined) ??
			(activeEditingCell?.rowIndex ?? undefined) ??
			(focusedCell?.rowIndex ?? undefined) ??
			this.focusedRowIndex ??
			null;

		if (effectiveRowIndex == null || effectiveRowIndex < 0) {
			return false;
		}

		const totalRows = api.getDisplayedRowCount();
		if (totalRows <= 0 || effectiveRowIndex !== totalRows - 1) {
			return false;
		}

		keyEvent.preventDefault?.();

		if (this.pendingEnterAtLastRow) {
			return true;
		}
		this.pendingEnterAtLastRow = true;

		const resolvedColId =
			columnId ??
			activeEditingCell?.column?.getColId?.() ??
			focusedCell?.column.getColId() ??
			this.focusedColId ??
			null;

		const fallbackColId = (() => {
			const gridApi = this.getGridApi();
			if (!gridApi) {
				return null;
			}
			const displayed =
				typeof gridApi.getAllDisplayedColumns === 'function'
					? gridApi.getAllDisplayedColumns()
					: [];
			for (const col of displayed) {
				const field = col.getColDef().field;
				if (field && field !== '#') {
					return col.getColId?.() ?? field;
				}
			}
			return null;
		})();

		const nextColId = resolvedColId ?? fallbackColId ?? '#';

		setTimeout(() => {
			if (typeof api.stopEditing === 'function') {
				api.stopEditing();
			}
			setTimeout(() => {
				try {
					callback(nextColId);
				} finally {
					this.pendingEnterAtLastRow = false;
				}
			}, 10);
		}, 0);

		return true;
	}
}
