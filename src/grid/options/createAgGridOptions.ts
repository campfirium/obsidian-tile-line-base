import type {
	CellDoubleClickedEvent,
	CellEditingStoppedEvent,
	CellFocusedEvent,
	CellKeyDownEvent,
	GridOptions,
	PasteEndEvent
} from 'ag-grid-community';
import { normalizeStatus } from '../../renderers/StatusCellRenderer';
import { createTextCellEditor } from '../editors/TextCellEditor';
import type { AgGridColumnService } from '../column/AgGridColumnService';
import type { AgGridInteractionController } from '../interactions/AgGridInteractionController';
import type { GridInteractionContext } from '../interactions/types';
import type { RowData } from '../GridAdapter';
import { ROW_ID_FIELD } from '../GridAdapter';

const DEFAULT_ROW_HEIGHT = 40;

interface GridOptionsParams {
	ownerDocument: Document | null | undefined;
	popupParent: HTMLElement | null | undefined;
	columnService: AgGridColumnService;
	interaction: AgGridInteractionController;
	getGridContext: () => GridInteractionContext | undefined;
	onCellEditingStopped: (event: CellEditingStoppedEvent) => void;
	getColumnHeaderContextMenu: () => ((event: { field: string; domEvent: MouseEvent }) => void) | undefined;
	resizeColumns: () => void;
}

export function createAgGridOptions({
	ownerDocument,
	popupParent,
	columnService,
	interaction,
	getGridContext,
	onCellEditingStopped,
	getColumnHeaderContextMenu,
	resizeColumns
}: GridOptionsParams): GridOptions {
	return {
		popupParent: popupParent ?? ownerDocument?.body ?? document.body,
		rowHeight: DEFAULT_ROW_HEIGHT,
		onFirstDataRendered: () => {
			resizeColumns();
		},
		getRowId: params => String((params.data as RowData)[ROW_ID_FIELD]),
		context: getGridContext() || {},
		enableBrowserTooltips: false,
		tooltipShowDelay: 0,
		tooltipHideDelay: 2147483647,
		onCellKeyDown: (event: CellKeyDownEvent) => {
			interaction.handleGridCellKeyDown(event);
		},
		singleClickEdit: false,
		stopEditingWhenCellsLoseFocus: true,
		enterNavigatesVertically: true,
		enterNavigatesVerticallyAfterEdit: true,
		rowSelection: {
			mode: 'multiRow',
			enableClickSelection: true,
			enableSelectionWithoutKeys: false,
			checkboxes: false,
			checkboxLocation: 'autoGroupColumn'
		},
		selectionColumnDef: {
			width: 0,
			minWidth: 0,
			maxWidth: 0,
			resizable: false,
			suppressSizeToFit: true,
			headerName: '',
			suppressHeaderMenuButton: true,
			suppressHeaderContextMenu: true
		},
		onCellEditingStopped: onCellEditingStopped,
		onCellEditingStarted: () => {
			interaction.handleCellEditingStarted();
		},
		onCellFocused: (event: CellFocusedEvent) => {
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
		onCellDoubleClicked: (event: CellDoubleClickedEvent) => {
			const colId = event.column?.getColId?.() ?? null;
			if (colId !== '#') {
				return;
			}
			const data = event.data as RowData | undefined;
			const raw = data ? data[ROW_ID_FIELD] : undefined;
			const blockIndex = raw !== undefined ? parseInt(String(raw), 10) : NaN;
			if (Number.isNaN(blockIndex)) {
				return;
			}
			const context = getGridContext();
			context?.onCopyH2Section?.(blockIndex);
		},
		onColumnHeaderContextMenu: (params: any) => {
			const column = params?.column ?? null;
			const field = column && typeof column.getColId === 'function' ? column.getColId() : null;
			const domEvent = (params?.event ?? params?.mouseEvent) as MouseEvent | undefined;
			if (!field || !domEvent) {
				return;
			}
			const callback = getColumnHeaderContextMenu();
			callback?.({ field, domEvent });
		},
		defaultColDef: {
			tooltipValueGetter: params => {
				const value = params.value;
				return value == null ? '' : String(value);
			},
			editable: true,
			sortable: true,
			filter: false,
			resizable: true,
			cellEditor: createTextCellEditor(),
			suppressKeyboardEvent: (params: any) => {
				return interaction.handleSuppressKeyboardEvent(params);
			}
		},
		enableCellTextSelection: true,
		suppressAnimationFrame: false,
		suppressColumnVirtualisation: false,
		rowClassRules: {
			'tlb-row-completed': params => {
				const status = normalizeStatus(params.data?.status);
				return status === 'done' || status === 'canceled';
			}
		}
	};
}
