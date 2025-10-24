import type { GridApi, IRowNode } from 'ag-grid-community';
import type { RowData } from '../GridAdapter';
import { ROW_ID_FIELD } from '../GridAdapter';

interface SelectionControllerDeps {
	getGridApi(): GridApi | null;
}

export class AgGridSelectionController {
	private readonly deps: SelectionControllerDeps;

	constructor(deps: SelectionControllerDeps) {
		this.deps = deps;
	}

	selectRow(blockIndex: number, options?: { ensureVisible?: boolean }): void {
		const gridApi = this.getGridApi();
		if (!gridApi) {
			return;
		}
		const node = this.findRowNodeByBlockIndex(blockIndex);
		if (!node) {
			return;
		}

		gridApi.deselectAll();
		node.setSelected(true, true);

		if (options?.ensureVisible !== false) {
			const rowIndex = node.rowIndex ?? null;
			if (rowIndex !== null) {
				gridApi.ensureIndexVisible(rowIndex, 'middle');
			}
		}
	}

	getSelectedRows(): number[] {
		const gridApi = this.getGridApi();
		if (!gridApi) {
			return [];
		}

		const selectedNodes = [...gridApi.getSelectedNodes()] as Array<IRowNode<RowData>>;
		selectedNodes.sort((a, b) => this.resolveSortKey(a) - this.resolveSortKey(b));

		const blockIndexes: number[] = [];
		for (const node of selectedNodes) {
			const parsed = this.parseBlockIndex(node.data?.[ROW_ID_FIELD]);
			if (parsed !== null) {
				blockIndexes.push(parsed);
			}
		}
		return blockIndexes;
	}

	getRowIndexFromEvent(event: MouseEvent): number | null {
		const gridApi = this.getGridApi();
		if (!gridApi) {
			return null;
		}

		const target = event.target as HTMLElement | null;
		const rowElement = target?.closest('.ag-row') as HTMLElement | null;
		if (!rowElement) {
			return null;
		}

		const rowIndexAttr = rowElement.getAttribute('row-index');
		if (rowIndexAttr === null) {
			return null;
		}

		const displayIndex = parseInt(rowIndexAttr, 10);
		if (Number.isNaN(displayIndex)) {
			return null;
		}

		const rowNode = gridApi.getDisplayedRowAtIndex(displayIndex);
		const parsed = this.parseBlockIndex((rowNode?.data as RowData | undefined)?.[ROW_ID_FIELD]);
		return parsed;
	}

	startEditingFocusedCell(): void {
		const gridApi = this.getGridApi();
		if (!gridApi) {
			return;
		}

		const focusedCell = gridApi.getFocusedCell();
		if (!focusedCell) {
			return;
		}

		gridApi.startEditingCell({
			rowIndex: focusedCell.rowIndex,
			colKey: focusedCell.column.getColId()
		});
	}

	getFocusedCell(): { rowIndex: number; field: string } | null {
		const gridApi = this.getGridApi();
		if (!gridApi) {
			return null;
		}

		const focusedCell = gridApi.getFocusedCell();
		if (!focusedCell) {
			return null;
		}

		const rowNode = gridApi.getDisplayedRowAtIndex(focusedCell.rowIndex);
		const blockIndex = this.parseBlockIndex((rowNode?.data as RowData | undefined)?.[ROW_ID_FIELD]);
		if (blockIndex === null) {
			return null;
		}

		return {
			rowIndex: blockIndex,
			field: focusedCell.column.getColId()
		};
	}

	private getGridApi(): GridApi | null {
		return this.deps.getGridApi();
	}

	private findRowNodeByBlockIndex(blockIndex: number): IRowNode<RowData> | null {
		const gridApi = this.getGridApi();
		if (!gridApi) {
			return null;
		}

		let match: IRowNode<RowData> | null = null;
		gridApi.forEachNode(node => {
			if (match) {
				return;
			}
			const parsed = this.parseBlockIndex((node.data as RowData | undefined)?.[ROW_ID_FIELD]);
			if (parsed === blockIndex) {
				match = node as IRowNode<RowData>;
			}
		});

		return match;
	}

	private resolveSortKey(node: IRowNode<RowData>): number {
		const baseIndex = node.rowIndex ?? 0;
		if (node.rowPinned === 'top') {
			return baseIndex - 1_000_000_000;
		}
		if (node.rowPinned === 'bottom') {
			return baseIndex + 1_000_000_000;
		}
		return baseIndex;
	}

	private parseBlockIndex(value: unknown): number | null {
		if (value === null || value === undefined) {
			return null;
		}
		const parsed = parseInt(String(value), 10);
		return Number.isNaN(parsed) ? null : parsed;
	}
}
