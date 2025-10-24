import { GridApi } from 'ag-grid-community';
import {
	KeyboardEventLike,
	FocusStateAccess,
	DebugLogger,
	FocusShiftController
} from '../types';
import { InteractionControllerDeps } from '../types';

interface EnterKeyCoordinatorOptions {
	focus: FocusStateAccess;
	getGridApi: () => GridApi | null;
	getEnterAtLastRowCallback: InteractionControllerDeps['getEnterAtLastRowCallback'];
	debug: DebugLogger;
	shiftController: FocusShiftController;
}

export class EnterKeyCoordinator {
	private readonly focus: FocusStateAccess;
	private readonly getGridApi: () => GridApi | null;
	private readonly getEnterAtLastRowCallback: InteractionControllerDeps['getEnterAtLastRowCallback'];
	private readonly debug: DebugLogger;
	private readonly shiftController: FocusShiftController;
	private pendingEnterAtLastRow = false;

	constructor(options: EnterKeyCoordinatorOptions) {
		this.focus = options.focus;
		this.getGridApi = options.getGridApi;
		this.getEnterAtLastRowCallback = options.getEnterAtLastRowCallback;
		this.debug = options.debug;
		this.shiftController = options.shiftController;
	}

	handleEnterAtLastRow(
		api: GridApi,
		columnId: string | null | undefined,
		rowIndex: number | null | undefined,
		keyEvent: KeyboardEventLike
	): boolean {
		if (keyEvent.key !== 'Enter') {
			return false;
		}

		const callback = this.getEnterAtLastRowCallback();
		if (!callback) {
			return false;
		}

		const focusedCoords = this.focus.getCoordinates();

		this.debug('enterCoordinator:handleEnterAtLastRow', {
			columnId,
			rowIndex,
			focusedRowIndex: focusedCoords.rowIndex
		});

		const editingCells = typeof api.getEditingCells === 'function' ? api.getEditingCells() : [];
		const activeEditingCell = editingCells.length > 0 ? editingCells[0] : undefined;
		const focusedCell = api.getFocusedCell();

		const effectiveRowIndex =
			(rowIndex ?? undefined) ??
			(activeEditingCell?.rowIndex ?? undefined) ??
			(focusedCell?.rowIndex ?? undefined) ??
			(focusedCoords.rowIndex ?? undefined) ??
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
			this.debug('enterCoordinator:handleEnterAtLastRow:pending');
			return true;
		}
		this.pendingEnterAtLastRow = true;

		const resolvedColId =
			columnId ??
			activeEditingCell?.column?.getColId?.() ??
			focusedCell?.column.getColId() ??
			focusedCoords.colId ??
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
					this.focus.setPendingFocusShift({ rowDelta: 1, colDelta: 0 });
					this.debug('enterCoordinator:handleEnterAtLastRow:callback', { nextColId });
					this.shiftController.applyPendingFocusShift();
				} finally {
					this.pendingEnterAtLastRow = false;
				}
			}, 10);
		}, 0);

		return true;
	}
}
