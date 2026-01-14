import { GridApi, type EditableCallbackParams } from 'ag-grid-community';
import { InteractionControllerDeps } from '../types';
import { FocusStateAccess, NavigationCallbacks, DebugLogger } from '../types';
import { ROW_ID_FIELD, RowData } from '../../GridAdapter';
import { isReservedColumnId } from '../../systemColumnUtils';

interface FocusNavigatorOptions {
	focus: FocusStateAccess;
	getGridApi: () => GridApi | null;
	navigation: NavigationCallbacks;
	deps: Pick<InteractionControllerDeps, 'getCellEditCallback' | 'getEnterAtLastRowCallback'>;
	debug: DebugLogger;
}

export class FocusNavigator {
	private readonly focus: FocusStateAccess;
	private readonly getGridApi: () => GridApi | null;
	private readonly navigation: NavigationCallbacks;
	private readonly deps: FocusNavigatorOptions['deps'];
	private readonly debug: DebugLogger;

	constructor(options: FocusNavigatorOptions) {
		this.focus = options.focus;
		this.getGridApi = options.getGridApi;
		this.navigation = options.navigation;
		this.deps = options.deps;
		this.debug = options.debug;
	}

	handleProxyEnter(shift: boolean): void {
		const coords = this.focus.getCoordinates();
		const gridApi = this.getGridApi();
		if (!gridApi || coords.rowIndex == null || !coords.colId) return;

		this.debug('navigator:handleProxyEnter', {
			shift,
			rowIndex: coords.rowIndex,
			colId: coords.colId
		});

		if (shift) {
			this.moveFocus(-1, 0);
			return;
		}

		const totalRows = gridApi.getDisplayedRowCount();
		if (totalRows === 0) return;

		if (coords.rowIndex === totalRows - 1) {
			const callback = this.deps.getEnterAtLastRowCallback();
			if (callback) {
				callback(coords.colId);
			}
			this.debug('navigator:handleProxyEnter:lastRow', { colId: coords.colId });
			return;
		}

		this.moveFocus(1, 0);
	}

	handleDeleteKey(): void {
		const gridApi = this.getGridApi();
		if (!gridApi) return;

		const focusedCell = gridApi.getFocusedCell();
		if (!focusedCell) return;

		this.debug('navigator:handleDeleteKey:start', {
			rowIndex: focusedCell.rowIndex,
			colId: focusedCell.column.getColId()
		});

		const field = focusedCell.column.getColId();
		if (isReservedColumnId(field)) {
			return;
		}

		const rowNode = gridApi.getDisplayedRowAtIndex(focusedCell.rowIndex);
		if (!rowNode) return;

		const colDef =
			typeof focusedCell.column.getColDef === 'function'
				? focusedCell.column.getColDef()
				: null;
		if (colDef && colDef.editable === false) {
			this.debug('navigator:handleDeleteKey:nonEditable', {
				rowIndex: focusedCell.rowIndex,
				colId: field
			});
			return;
		}

		const data = rowNode.data as RowData | undefined;
		if (!data) return;

		if (colDef && typeof colDef.editable === 'function') {
			const gridApiWithContext = gridApi as GridApi & { context?: unknown };
			const editableParams: EditableCallbackParams<RowData, string, unknown> = {
				api: gridApi,
				column: focusedCell.column,
				colDef,
				context: gridApiWithContext.context,
				data,
				node: rowNode,
			};
			const editableResult = colDef.editable(editableParams);
			if (!editableResult) {
				this.debug('navigator:handleDeleteKey:nonEditableFn', {
					rowIndex: focusedCell.rowIndex,
					colId: field
				});
				return;
			}
		}

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

		this.navigation.armProxyForCurrentCell();
		this.debug('navigator:handleDeleteKey:cleared', { blockIndex });
	}

	applyPendingFocusShift(): void {
		const shift = this.focus.getPendingFocusShift();
		if (!shift) {
			return;
		}
		const success = this.moveFocus(shift.rowDelta, shift.colDelta);
		if (success) {
			this.debug('navigator:pendingFocusShift:applied', shift);
			this.focus.setPendingFocusShift(null);
		} else {
			this.debug('navigator:pendingFocusShift:pending', shift);
		}
	}

	moveFocus(rowDelta: number, colDelta: number): boolean {
		const gridApi = this.getGridApi();
		const coords = this.focus.getCoordinates();
		if (!gridApi || coords.rowIndex == null || !coords.colId) return false;

		const displayedColumns = gridApi.getAllDisplayedColumns();
		if (!displayedColumns || displayedColumns.length === 0) return false;

		const currentColIndex = displayedColumns.findIndex((col) => col.getColId() === coords.colId);
		if (currentColIndex === -1) return false;

		const targetColIndex = Math.max(0, Math.min(displayedColumns.length - 1, currentColIndex + colDelta));
		const targetCol = displayedColumns[targetColIndex];

		const rowCount = gridApi.getDisplayedRowCount();
		if (rowCount === 0) return false;
		const targetRowIndex = Math.max(0, Math.min(rowCount - 1, coords.rowIndex + rowDelta));

		this.navigation.cancelPendingCapture('focus-move');
		gridApi.ensureIndexVisible(targetRowIndex);
		gridApi.setFocusedCell(targetRowIndex, targetCol.getColId());
		this.focus.setCoordinates(targetRowIndex, targetCol.getColId());
		this.navigation.armProxyForCurrentCell();
		this.debug('navigator:moveFocus', {
			targetRowIndex,
			targetColId: targetCol.getColId(),
			rowDelta,
			colDelta
		});
		return true;
	}
}
