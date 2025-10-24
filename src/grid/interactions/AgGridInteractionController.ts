import {
	CellKeyDownEvent,
	CellFocusedEvent,
	GridApi
} from 'ag-grid-community';
import { CompositionCaptureManager } from './internal/CompositionCaptureManager';
import { GridClipboardService } from './internal/GridClipboardService';
import { FocusNavigator } from './internal/FocusNavigator';
import { EnterKeyCoordinator } from './internal/EnterKeyCoordinator';
import { normalizeKeyboardEvent } from './internal/keyboardUtils';
import { ViewportManager } from './internal/ViewportManager';
import {
	InteractionControllerDeps,
	ViewportResizeReason,
	FocusStateAccess,
	FocusShift
} from './types';

export class AgGridInteractionController {
	private readonly deps: InteractionControllerDeps;
	private container: HTMLElement | null = null;

	private focusedDoc: Document | null = null;
	private focusedRowIndex: number | null = null;
	private focusedColId: string | null = null;
	private pendingFocusShift: FocusShift | null = null;
	private editing = false;

	private readonly focusAccess: FocusStateAccess;
	private readonly clipboard: GridClipboardService;
	private readonly navigator: FocusNavigator;
	private readonly composition: CompositionCaptureManager;
	private readonly enterCoordinator: EnterKeyCoordinator;
	private readonly viewport: ViewportManager;

	constructor(deps: InteractionControllerDeps) {
		this.deps = deps;

		this.focusAccess = {
			getCoordinates: () => ({
				rowIndex: this.focusedRowIndex,
				colId: this.focusedColId
			}),
			setCoordinates: (rowIndex, colId) => {
				this.focusedRowIndex = rowIndex;
				this.focusedColId = colId;
			},
			getDocument: () => this.focusedDoc,
			setDocument: (doc) => {
				this.focusedDoc = doc;
			},
			isEditing: () => this.editing,
			setEditing: (editing) => {
				this.editing = editing;
			},
			getPendingFocusShift: () => this.pendingFocusShift,
			setPendingFocusShift: (shift) => {
				this.pendingFocusShift = shift;
			}
		};

		this.clipboard = new GridClipboardService({
			getGridApi: () => this.deps.getGridApi(),
			getFocusedDocument: () => this.focusedDoc,
			getGridContext: () => this.deps.getGridContext(),
			translate: (key) => this.deps.translate(key),
			debug: (...args) => this.debug(...args)
		});

		this.viewport = new ViewportManager((...args) => this.debug(...args));

		const compositionHolder: { current?: CompositionCaptureManager } = {};

		this.navigator = new FocusNavigator({
			focus: this.focusAccess,
			getGridApi: () => this.deps.getGridApi(),
			navigation: {
				cancelPendingCapture: (reason?: string) => {
					compositionHolder.current?.cancelPendingCapture(reason);
				},
				armProxyForCurrentCell: () => {
					compositionHolder.current?.armProxyForCurrentCell();
				}
			},
			deps: {
				getCellEditCallback: () => this.deps.getCellEditCallback(),
				getEnterAtLastRowCallback: () => this.deps.getEnterAtLastRowCallback()
			},
			debug: (...args) => this.debug(...args)
		});

		this.composition = new CompositionCaptureManager({
			focus: this.focusAccess,
			getGridApi: () => this.deps.getGridApi(),
			translate: (key) => this.deps.translate(key),
			debug: (...args) => this.debug(...args),
			clipboard: this.clipboard,
			navigator: this.navigator
		});
		compositionHolder.current = this.composition;

		this.enterCoordinator = new EnterKeyCoordinator({
			focus: this.focusAccess,
			getGridApi: () => this.deps.getGridApi(),
			getEnterAtLastRowCallback: () => this.deps.getEnterAtLastRowCallback(),
			debug: (...args) => this.debug(...args),
			shiftController: this.navigator
		});
	}

	setContainer(container: HTMLElement | null): void {
		this.debug('setContainer', { hasContainer: Boolean(container) });
		if (this.container !== container) {
			this.viewport.unbind();
		}
		this.container = container;
		this.composition.setContainer(container);
		if (container) {
			this.focusAccess.setDocument(container.ownerDocument || document);
		}
	}

	onViewportResize(callback: (reason: ViewportResizeReason) => void): () => void {
		return this.viewport.onViewportResize(callback);
	}

	bindViewportListeners(container: HTMLElement): void {
		this.viewport.bind(container, (reason) => this.handleViewportActivity(reason));
	}

	handleGridCellKeyDown(event: CellKeyDownEvent): void {
		const keyEvent = normalizeKeyboardEvent(event.event);
		if (!keyEvent) {
			return;
		}

		if ((keyEvent.metaKey || keyEvent.ctrlKey) && keyEvent.key.toLowerCase() === 'c') {
			this.clipboard.handleCopyShortcut(keyEvent, event);
			return;
		}

		const handled = this.enterCoordinator.handleEnterAtLastRow(
			event.api,
			event.column?.getColId?.() ?? null,
			event.node?.rowIndex ?? null,
			keyEvent
		);
		if (handled) {
			this.debug('handleGridCellKeyDown:enterAtLastRow', keyEvent.key);
		}
	}

	handleSuppressKeyboardEvent(params: {
		api: GridApi;
		column?: { getColId?: () => string };
		node?: { rowIndex?: number | null };
		event: KeyboardEvent;
	}): boolean {
		const keyEvent = normalizeKeyboardEvent(params.event);
		if (!keyEvent) {
			return false;
		}
		const handled = this.enterCoordinator.handleEnterAtLastRow(
			params.api,
			params.column?.getColId?.() ?? null,
			params.node?.rowIndex ?? null,
			keyEvent
		);
		if (handled) {
			this.debug('handleSuppressKeyboardEvent', { key: keyEvent.key });
		}
		return handled;
	}

	handleCellFocused(event: CellFocusedEvent): void {
		const columnId = (event as any).column?.getColId?.() ?? (event as any).columnId ?? null;
		this.debug('handleCellFocused', {
			rowIndex: event.rowIndex,
			columnId
		});

		this.focusAccess.setDocument(this.container?.ownerDocument || document);

		if (event.rowIndex == null || columnId == null) {
			this.focusAccess.setCoordinates(null, null);
			this.composition.cancelPendingCapture('focus-cleared');
			return;
		}

		this.focusAccess.setCoordinates(event.rowIndex, columnId);

		if (this.editing) {
			return;
		}

		this.composition.armProxyForCurrentCell();
	}

	handleCellEditingStarted(): void {
		this.composition.handleEditingStarted();
	}

	handleCellEditingStopped(): void {
		this.composition.handleEditingStopped();
	}

	onLayoutInvalidated(): void {
		this.composition.handleLayoutInvalidated();
	}

	destroy(): void {
		this.debug('destroy');
		this.composition.destroy();
		this.viewport.unbind();
		this.viewport.clearListeners();
		this.container = null;
	}

	private handleViewportActivity(reason: ViewportResizeReason): void {
		this.debug('handleViewportActivity', reason);
		this.composition.requestProxyRealign(reason);
	}

	private debug(...args: unknown[]): void {
		const globalRef = globalThis as unknown as {
			__TLB_DEBUG_INTERACTION__?: boolean;
			console?: Console;
		};
		if (!globalRef.__TLB_DEBUG_INTERACTION__ || !globalRef.console?.debug) {
			return;
		}
		globalRef.console.debug('[AgGridInteraction]', ...args);
	}
}
