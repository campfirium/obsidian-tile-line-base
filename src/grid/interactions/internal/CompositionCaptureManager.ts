import { GridApi } from 'ag-grid-community';
import { CompositionProxy } from '../../utils/CompositionProxy';
import { getLogger } from '../../../utils/logger';
import { GridClipboardService } from './GridClipboardService';
import { FocusNavigator } from './FocusNavigator';
import {
	DebugLogger,
	FocusStateAccess,
	InteractionControllerDeps
} from '../types';
import { normalizeKeyboardEvent, isPrintableKey } from './keyboardUtils';

const logger = getLogger('grid:composition-capture');

interface CompositionManagerOptions {
	focus: FocusStateAccess;
	getGridApi: () => GridApi | null;
	translate: InteractionControllerDeps['translate'];
	debug: DebugLogger;
	clipboard: GridClipboardService;
	navigator: FocusNavigator;
}

export class CompositionCaptureManager {
	private readonly focus: FocusStateAccess;
	private readonly getGridApi: () => GridApi | null;
	private readonly translate: CompositionManagerOptions['translate'];
	private readonly debug: DebugLogger;
	private readonly clipboard: GridClipboardService;
	private readonly navigator: FocusNavigator;
	private container: HTMLElement | null = null;
	private proxyByDoc = new WeakMap<Document, CompositionProxy>();
	private readonly proxies = new Set<CompositionProxy>();
	private readonly lastArmedTargets = new WeakMap<Document, { rowIndex: number; colId: string }>();
	private pendingCaptureCancel?: (reason?: string) => void;
	private proxyRealignTimer: number | null = null;

	constructor(options: CompositionManagerOptions) {
		this.focus = options.focus;
		this.getGridApi = options.getGridApi;
		this.translate = options.translate;
		this.debug = options.debug;
		this.clipboard = options.clipboard;
		this.navigator = options.navigator;
	}

	setContainer(container: HTMLElement | null): void {
		this.debug('composition:setContainer', { hasContainer: Boolean(container) });
		this.container = container;
		if (container) {
			this.focus.setDocument(container.ownerDocument || document);
		}
	}

	cancelPendingCapture(reason?: string): void {
		this.debug('composition:cancelPendingCapture', reason);
		if (this.pendingCaptureCancel) {
			const cancel = this.pendingCaptureCancel;
			this.pendingCaptureCancel = undefined;
			cancel(reason);
		} else {
			const doc = this.focus.getDocument();
			if (doc) {
				this.getProxy(doc).cancel(reason);
			}
		}
	}

	requestProxyRealign(reason: string): void {
		if (this.focus.isEditing()) {
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
		this.debug('composition:requestProxyRealign scheduled', reason);
	}

	armProxyForCurrentCell(): void {
		this.debug('composition:armProxyForCurrentCell:start', {
			editMode: this.focus.isEditing(),
			hasFocusedDoc: Boolean(this.focus.getDocument()),
			coordinates: this.focus.getCoordinates()
		});

		const gridApi = this.getGridApi();
		const coords = this.focus.getCoordinates();

		if (!gridApi) return;
		if (this.focus.isEditing()) return;
		if (coords.rowIndex == null || !coords.colId) {
			this.cancelPendingCapture('focus-cleared');
			return;
		}

		const doc = this.focus.getDocument();
		if (!doc) {
			this.debug('composition:armProxyForCurrentCell:noDoc');
			return;
		}

		const cellEl = this.getCellElementFor(coords.rowIndex, coords.colId, doc);
		if (!cellEl) {
			this.debug('composition:armProxyForCurrentCell:cell-missing', coords);
			this.cancelPendingCapture('cell-missing');
			return;
		}

		const rect = cellEl.getBoundingClientRect();
		this.lastArmedTargets.set(doc, { rowIndex: coords.rowIndex, colId: coords.colId });
		const proxy = this.getProxy(doc);

		this.cancelPendingCapture('rearm');
		const capturePromise = proxy.captureOnceAt(rect);
		proxy.setKeyHandler((event) => this.handleProxyKeyDown(event));
		this.pendingCaptureCancel = (reason?: string) => proxy.cancel(reason);

		capturePromise
			.then((text) => {
				this.pendingCaptureCancel = undefined;
				if (this.focus.isEditing()) return;
				const latestCoords = this.focus.getCoordinates();
				if (latestCoords.rowIndex == null || !latestCoords.colId) return;
				this.debug('composition:armProxyForCurrentCell:captureResolved', {
					textLength: text?.length ?? 0
				});
				return this.startEditingWithCapturedText(
					doc,
					latestCoords.rowIndex,
					latestCoords.colId,
					text ?? ''
				);
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
					err === 'destroy' ||
					err === 'focus-move' ||
					err === 'scroll' ||
					err === 'resize'
				) {
					return;
				}
				this.debug('composition:armProxyForCurrentCell:captureError', err);
				logger.error(this.translate('agGrid.compositionCaptureFailed'), err);
			});
	}

	handleEditingStarted(): void {
		this.debug('composition:handleEditingStarted');
		this.focus.setEditing(true);
		this.cancelPendingCapture('editing-started');
		const doc = this.focus.getDocument();
		if (doc) {
			this.getProxy(doc).setKeyHandler(undefined);
		}
	}

	handleEditingStopped(): void {
		this.debug('composition:handleEditingStopped');
		this.focus.setEditing(false);
		this.armProxyForCurrentCell();
	}

	startEditingFromShortcut(source: string): boolean {
		const gridApi = this.getGridApi();
		if (!gridApi) {
			this.debug('composition:startEditingFromShortcut:noApi', { source });
			return false;
		}

		if (this.focus.isEditing()) {
			if (this.hasActiveGridEditor(gridApi)) {
				this.debug('composition:startEditingFromShortcut:alreadyEditing', { source });
				return false;
			}
			this.debug('composition:startEditingFromShortcut:resetEditingFlag', { source });
			this.focus.setEditing(false);
		}

		const doc = this.focus.getDocument() ?? this.container?.ownerDocument ?? document;
		const target = this.resolveEditingTarget(gridApi, doc);
		if (!target) {
			this.debug('composition:startEditingFromShortcut:noTarget', { source });
			return false;
		}

		if (!this.isTargetEditable(gridApi, target.rowIndex, target.colId)) {
			this.debug('composition:startEditingFromShortcut:notEditable', { source, colId: target.colId });
			return false;
		}

		void this.startEditingPreservingValue(doc, target.rowIndex, target.colId);
		return true;
	}

	handleLayoutInvalidated(): void {
		this.debug('composition:onLayoutInvalidated');
		this.armProxyForCurrentCell();
		this.navigator.applyPendingFocusShift();
	}

	handleProxyKeyDown(rawEvent: KeyboardEvent): void {
		const event = normalizeKeyboardEvent(rawEvent);
		if (!event) {
			return;
		}
		const gridApi = this.getGridApi();
		if (!gridApi) return;

		this.debug('composition:handleProxyKeyDown', {
			key: event.key,
			ctrlKey: event.ctrlKey,
			metaKey: event.metaKey,
			shiftKey: event.shiftKey
		});

		if (isPrintableKey(event)) {
			return;
		}

		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
			this.clipboard.handleCopyShortcut(event);
			return;
		}

		switch (event.key) {
			case 'F2':
				event.preventDefault?.();
				event.stopPropagation?.();
				this.startEditingFromShortcut('proxy');
				break;
			case 'Enter':
				event.preventDefault?.();
				event.stopPropagation?.();
				this.navigator.handleProxyEnter(Boolean(event.shiftKey));
				break;
			case 'Tab':
				event.preventDefault?.();
				event.stopPropagation?.();
				this.navigator.moveFocus(0, event.shiftKey ? -1 : 1);
				break;
			case 'ArrowUp':
			case 'Up':
				event.preventDefault?.();
				event.stopPropagation?.();
				this.navigator.moveFocus(-1, 0);
				break;
			case 'ArrowDown':
			case 'Down':
				event.preventDefault?.();
				event.stopPropagation?.();
				this.navigator.moveFocus(1, 0);
				break;
			case 'ArrowLeft':
			case 'Left':
				event.preventDefault?.();
				event.stopPropagation?.();
				this.navigator.moveFocus(0, -1);
				break;
			case 'ArrowRight':
			case 'Right':
				event.preventDefault?.();
				event.stopPropagation?.();
				this.navigator.moveFocus(0, 1);
				break;
			case 'Delete':
			case 'Backspace':
				event.preventDefault?.();
				event.stopPropagation?.();
				this.navigator.handleDeleteKey();
				break;
			default:
				break;
		}
	}

	private resolveEditingTarget(
		gridApi: GridApi,
		doc: Document
	): { rowIndex: number; colId: string } | null {
		const coords = this.focus.getCoordinates();
		if (coords.rowIndex != null && coords.colId) {
			return { rowIndex: coords.rowIndex, colId: coords.colId };
		}

		const focusedCell = typeof gridApi.getFocusedCell === 'function' ? gridApi.getFocusedCell() : null;
		const focusedColId = focusedCell?.column?.getColId?.() ?? null;
		if (focusedCell && typeof focusedCell.rowIndex === 'number' && focusedColId) {
			return {
				rowIndex: focusedCell.rowIndex,
				colId: focusedColId
			};
		}

		const root = (this.container ?? doc) as Document | Element;
		const focusedEl = (root as any).querySelector?.('.ag-cell-focus[col-id]') as HTMLElement | null;
		if (!focusedEl) {
			const lastArmed = this.lastArmedTargets.get(doc);
			if (lastArmed) {
				return {
					rowIndex: lastArmed.rowIndex,
					colId: lastArmed.colId
				};
			}
			return null;
		}

		const colId = focusedEl.getAttribute('col-id');
		if (!colId) {
			return null;
		}

		const rowIndexHolder = (focusedEl.closest('[row-index]') as HTMLElement | null) ?? focusedEl;
		const rowIndexValue = rowIndexHolder?.getAttribute('row-index') ?? null;
		if (!rowIndexValue) {
			return null;
		}

		const parsed = parseInt(rowIndexValue, 10);
		if (Number.isNaN(parsed)) {
			return null;
		}

		return {
			rowIndex: parsed,
			colId
		};
	}

	private hasActiveGridEditor(gridApi: GridApi): boolean {
		const editorInstances = (gridApi as any).getCellEditorInstances?.();
		if (Array.isArray(editorInstances)) {
			return editorInstances.length > 0;
		}

		const editingCells = (gridApi as any).getEditingCells?.();
		if (Array.isArray(editingCells)) {
			return editingCells.length > 0;
		}

		return false;
	}

	private isTargetEditable(gridApi: GridApi, rowIndex: number, colId: string): boolean {
		const column = typeof gridApi.getColumn === 'function' ? gridApi.getColumn(colId) : null;
		const colDef = column?.getColDef?.() as { editable?: boolean } | null;
		if (colDef?.editable === false) {
			return false;
		}

		if (colDef && typeof (colDef as any).editable === 'function') {
			const rowNode =
				typeof gridApi.getDisplayedRowAtIndex === 'function'
					? gridApi.getDisplayedRowAtIndex(rowIndex)
					: null;
			const data = (rowNode?.data as any) ?? null;
			if (rowNode && data) {
				const editableResult = (colDef as any).editable({
					api: gridApi,
					column,
					colDef,
					context: (gridApi as any)?.context,
					data,
					node: rowNode,
					value: data[colId]
				} as any);
				if (!editableResult) {
					return false;
				}
			}
		}

		return true;
	}

	destroy(): void {
		this.debug('composition:destroy');
		this.cancelPendingCapture('destroyed');
		if (this.proxyRealignTimer != null) {
			window.clearTimeout(this.proxyRealignTimer);
			this.proxyRealignTimer = null;
		}
		this.focus.setDocument(null);
		this.focus.setCoordinates(null, null);
		this.focus.setPendingFocusShift(null);
		this.focus.setEditing(false);
		this.container = null;
		this.destroyAllProxies();
	}

	private getProxy(doc: Document): CompositionProxy {
		let proxy = this.proxyByDoc.get(doc);
		if (!proxy) {
			proxy = new CompositionProxy(doc);
			this.proxyByDoc.set(doc, proxy);
			this.proxies.add(proxy);
		}
		return proxy;
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

		this.focus.setEditing(true);
		this.focus.setCoordinates(rowIndex, colKey);
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
				logger.warn(this.translate('agGrid.editorInputMissing'), err);
				this.recoverFromMissingEditor(gridApi);
			});
	}

	private startEditingPreservingValue(
		doc: Document,
		rowIndex: number,
		colKey: string
	): Promise<void> {
		const gridApi = this.getGridApi();
		if (!gridApi) {
			return Promise.resolve();
		}

		this.focus.setEditing(true);
		this.focus.setCoordinates(rowIndex, colKey);
		this.cancelPendingCapture('editing-started');
		this.getProxy(doc).setKeyHandler(undefined);

		if (typeof (gridApi as any).ensureIndexVisible === 'function') {
			(gridApi as any).ensureIndexVisible(rowIndex, 'middle');
		}
		if (typeof (gridApi as any).ensureColumnVisible === 'function') {
			(gridApi as any).ensureColumnVisible(colKey);
		}

		gridApi.setFocusedCell(rowIndex, colKey);
		gridApi.startEditingCell({ rowIndex, colKey });

		return this.waitForEditorInput(doc)
			.then((input) => {
				try {
					const len = input.value.length;
					input.setSelectionRange(len, len);
				} catch {
					// ignore caret placement errors for non-text controls
				}
				input.focus();
			})
			.catch((err) => {
				logger.warn(this.translate('agGrid.editorInputMissing'), err);
				this.recoverFromMissingEditor(gridApi);
			});
	}

	private recoverFromMissingEditor(gridApi: GridApi): void {
		const editorInstances = (gridApi as any).getCellEditorInstances?.();
		const hasEditorInstances = Array.isArray(editorInstances) && editorInstances.length > 0;
		const editingCells = (gridApi as any).getEditingCells?.();
		const hasEditingCells = Array.isArray(editingCells) && editingCells.length > 0;
		const hasSignal = Array.isArray(editorInstances) || Array.isArray(editingCells);
		if (hasSignal && !hasEditorInstances && !hasEditingCells) {
			this.focus.setEditing(false);
			this.armProxyForCurrentCell();
		}
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

	private destroyAllProxies(): void {
		for (const proxy of this.proxies) {
			proxy.destroy();
		}
		this.proxies.clear();
		this.proxyByDoc = new WeakMap();
	}
}
