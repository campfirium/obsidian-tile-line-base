import type {
	CellDoubleClickedEvent,
	CellEditingStoppedEvent,
	CellFocusedEvent,
	CellKeyDownEvent,
	ColumnHeaderContextMenuEvent,
	PasteEndEvent,
	RowDragCancelEvent,
	RowDragEnterEvent
} from 'ag-grid-community';
import { normalizeStatus } from '../../renderers/StatusCellRenderer';
import { createTextCellEditor } from '../editors/TextCellEditor';
import type { AgGridColumnService } from '../column/AgGridColumnService';
import type { AgGridInteractionController } from '../interactions/AgGridInteractionController';
import type { GridInteractionContext } from '../interactions/types';
import type { RowData } from '../GridAdapter';
import { ROW_ID_FIELD } from '../GridAdapter';
import { postSortNodesPreservingHierarchy } from '../../table-view/HierarchySort';
import type { TlbGridOptions, TlbRowDragEndEvent, TlbSuppressKeyboardEventParams } from '../agGridTypes';

const DEFAULT_ROW_HEIGHT = 40;

interface GridOptionsParams {
	ownerDocument: Document | null | undefined;
	popupParent: HTMLElement | null | undefined;
	columnService: AgGridColumnService;
	interaction: AgGridInteractionController;
	getGridContext: () => GridInteractionContext | undefined;
	onCellEditingStopped: (event: CellEditingStoppedEvent<RowData>) => void;
	getColumnHeaderContextMenu: () => ((event: { field: string; domEvent: MouseEvent }) => void) | undefined;
	resizeColumns: () => void;
	onRowDragEnd: (event: TlbRowDragEndEvent) => void;
}

export function createAgGridOptions({
	ownerDocument,
	popupParent,
	columnService,
	interaction,
	getGridContext,
	onCellEditingStopped,
	getColumnHeaderContextMenu,
	resizeColumns,
	onRowDragEnd
}: GridOptionsParams): TlbGridOptions {
	let isRowDragActive = false;

	return {
		popupParent: popupParent ?? ownerDocument?.body ?? activeDocument.body,
		rowHeight: DEFAULT_ROW_HEIGHT,
		rowDragManaged: true,
		rowDragMultiRow: false,
		rowDragEntireRow: true,
		undoRedoCellEditing: false,
		undoRedoCellEditingLimit: 0,
		onFirstDataRendered: () => {
			resizeColumns();
		},
			getRowId: params => String(params.data[ROW_ID_FIELD]),
		context: getGridContext() || {},
		enableBrowserTooltips: false,
		tooltipShowDelay: 0,
		tooltipHideDelay: 0,
			onCellKeyDown: (event: CellKeyDownEvent<RowData>) => {
			interaction.handleGridCellKeyDown(event);
		},
		singleClickEdit: false,
		stopEditingWhenCellsLoseFocus: true,
		enterNavigatesVertically: true,
		enterNavigatesVerticallyAfterEdit: true,
		rowSelection: {
			mode: 'multiRow',
			checkboxes: false,
			headerCheckbox: false,
			enableSelectionWithoutKeys: false,
			enableClickSelection: true
		},
		onCellEditingStopped: onCellEditingStopped,
		onCellEditingStarted: () => {
			interaction.handleCellEditingStarted();
		},
			onCellFocused: (event: CellFocusedEvent<RowData>) => {
			interaction.handleCellFocused(event);
		},
		onColumnResized: event => {
			columnService.handleColumnResized(event);
		},
		onColumnMoved: event => {
			columnService.handleColumnMoved(event);
		},
		onPasteEnd: (_event: PasteEndEvent) => {
			interaction.handlePasteEnd();
		},
			onCellDoubleClicked: (event: CellDoubleClickedEvent<RowData>) => {
			const colId = event.column?.getColId?.() ?? null;
			if (colId !== '#') {
				return;
			}
				const data = event.data;
			const raw = data ? data[ROW_ID_FIELD] : undefined;
			const blockIndex = raw !== undefined ? parseInt(String(raw), 10) : NaN;
			if (Number.isNaN(blockIndex)) {
				return;
			}
			const context = getGridContext();
			if (context?.onCopySelectionAsTemplate) {
				context.onCopySelectionAsTemplate(blockIndex);
				return;
			}
			context?.onCopyH2Section?.(blockIndex);
		},
		onColumnHeaderContextMenu: (params: ColumnHeaderContextMenuEvent) => {
			const column = params?.column ?? null;
			const columnWithId = column as { getColId?: () => string } | null;
			const field = columnWithId?.getColId?.() ?? null;
			const paramsWithEvent = params as { event?: MouseEvent; mouseEvent?: MouseEvent };
			const domEvent = paramsWithEvent.event ?? paramsWithEvent.mouseEvent;
			if (!field || !domEvent) {
				return;
			}
			const callback = getColumnHeaderContextMenu();
			callback?.({ field, domEvent });
		},
		onRowDragEnter: (_event: RowDragEnterEvent) => {
			isRowDragActive = true;
		},
			onRowDragEnd: (event: TlbRowDragEndEvent) => {
			try {
				onRowDragEnd(event);
			} finally {
				isRowDragActive = false;
			}
		},
		onRowDragCancel: (_event: RowDragCancelEvent) => {
			isRowDragActive = false;
		},
			postSortRows: (params) => {
			if (isRowDragActive) {
				return;
			}
			postSortNodesPreservingHierarchy(params);
		},
		defaultColDef: {
			tooltipValueGetter: () => null,
			editable: true,
			sortable: true,
			filter: false,
			resizable: true,
			cellEditor: createTextCellEditor(),
				suppressKeyboardEvent: (params: TlbSuppressKeyboardEventParams) => {
				return interaction.handleSuppressKeyboardEvent(params);
			}
		},
		enableCellTextSelection: true,
		suppressAnimationFrame: false,
		suppressColumnVirtualisation: false,
		getRowClass: params => {
			const status = normalizeStatus(params.data?.status);
			const classes = [`tlb-row-status-${status}`];
			if (status === 'done' || status === 'canceled') {
				classes.push('tlb-row-completed');
			}
			return classes;
		}
	};
}
