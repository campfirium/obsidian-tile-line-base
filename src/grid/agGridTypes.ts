import type {
	CellEditingStoppedEvent,
	CellKeyDownEvent,
	ColDef,
	GridApi,
	GridOptions,
	ICellEditorParams,
	ICellRendererParams,
	RowDragEndEvent,
	SuppressKeyboardEventParams
} from 'ag-grid-community';

import type { GridInteractionContext } from './interactions/types';
import type { RowData } from './GridAdapter';

export type TlbGridApi = GridApi<RowData>;
export type TlbGridOptions = GridOptions<RowData>;
export type TlbColDef<TValue = unknown> = ColDef<RowData, TValue>;
export type TlbCellEditingStoppedEvent<TValue = unknown> = CellEditingStoppedEvent<RowData, TValue>;
export type TlbCellKeyDownEvent<TValue = unknown> = CellKeyDownEvent<RowData, TValue>;
export type TlbRowDragEndEvent = RowDragEndEvent<RowData>;
export type TlbSuppressKeyboardEventParams<TValue = unknown> = SuppressKeyboardEventParams<RowData, TValue>;
export type TlbCellEditorParams<TValue = unknown> = ICellEditorParams<RowData, TValue, GridInteractionContext>;
export type TlbCellRendererParams<TValue = unknown> = ICellRendererParams<RowData, TValue, GridInteractionContext>;
