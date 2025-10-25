import {
	CellFocusedEvent,
	GridApi
} from 'ag-grid-community';
import { CellEditEvent } from '../GridAdapter';
import { TaskStatus } from '../../renderers/StatusCellRenderer';

export interface GridInteractionContext {
	onStatusChange?: (rowId: string, newStatus: TaskStatus) => void;
	onColumnResize?: (field: string, width: number) => void;
	onCopyH2Section?: (rowIndex: number) => void;
	onColumnOrderChange?: (fields: string[]) => void;
	sideBarVisible?: boolean;
}

export interface InteractionControllerDeps {
	getGridApi(): GridApi | null;
	getGridContext(): GridInteractionContext | undefined;
	getCellEditCallback(): ((event: CellEditEvent) => void) | undefined;
	getEnterAtLastRowCallback(): ((field: string) => void) | undefined;
	translate(key: string): string;
}

export type ViewportResizeReason = 'scroll' | 'resize';

export type KeyboardEventLike = {
	key: string;
	ctrlKey?: boolean;
	altKey?: boolean;
	metaKey?: boolean;
	shiftKey?: boolean;
	preventDefault?: () => void;
	stopPropagation?: () => void;
};

export type FocusShift = { rowDelta: number; colDelta: number };

export interface FocusCoordinates {
	rowIndex: number | null;
	colId: string | null;
}

export interface FocusStateAccess {
	getCoordinates(): FocusCoordinates;
	setCoordinates(rowIndex: number | null, colId: string | null): void;
	getDocument(): Document | null;
	setDocument(doc: Document | null): void;
	isEditing(): boolean;
	setEditing(editing: boolean): void;
	getPendingFocusShift(): FocusShift | null;
	setPendingFocusShift(shift: FocusShift | null): void;
}

export type DebugLogger = (...args: unknown[]) => void;

export interface KeyboardHandlerHost {
	handleProxyEnter(shift: boolean): void;
	handleDeleteKey(): void;
	moveFocus(rowDelta: number, colDelta: number): boolean;
}

export interface NavigationCallbacks {
	cancelPendingCapture(reason?: string): void;
	armProxyForCurrentCell(): void;
}

export interface EnterAtLastRowHandler {
	pendingEnterAtLastRow: boolean;
	setPendingEnterAtLastRow(value: boolean): void;
}

export interface FocusShiftController {
	applyPendingFocusShift(): void;
}

export interface FocusLifecycle {
	handleCellFocused(event: CellFocusedEvent): void;
	handleCellEditingStarted(): void;
	handleCellEditingStopped(): void;
}

export interface ClipboardOptions {
	getGridApi(): GridApi | null;
	getFocusedDocument(): Document | null;
	getGridContext(): GridInteractionContext | undefined;
	stopCellEditing(): void;
	translate(key: string): string;
	debug: DebugLogger;
}
