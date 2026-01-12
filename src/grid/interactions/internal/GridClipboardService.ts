import { CellKeyDownEvent, GridApi } from 'ag-grid-community';
import { getLogger } from '../../../utils/logger';
import { KeyboardEventLike } from '../types';
import { ROW_ID_FIELD, RowData } from '../../GridAdapter';
import { ClipboardOptions } from '../types';

const logger = getLogger('grid:clipboard');

export class GridClipboardService {
	private readonly getGridApi: () => GridApi | null;
	private readonly getFocusedDocument: () => Document | null;
	private readonly getGridContext: ClipboardOptions['getGridContext'];
	private readonly stopCellEditing: ClipboardOptions['stopCellEditing'];
	private readonly translate: ClipboardOptions['translate'];
	private readonly debug: ClipboardOptions['debug'];

	constructor(options: ClipboardOptions) {
		this.getGridApi = () => options.getGridApi();
		this.getFocusedDocument = () => options.getFocusedDocument();
		this.getGridContext = () => options.getGridContext();
		this.stopCellEditing = () => options.stopCellEditing();
		this.translate = (...args) => options.translate(...args);
		this.debug = (...args) => options.debug(...args);
	}

	handleCopyShortcut(event: KeyboardEventLike, cellEvent?: CellKeyDownEvent): void {
		const gridApi = this.getGridApi();
		if (!gridApi) {
			return;
		}

		this.debug('clipboard:handleCopyShortcut', {
			hasCellEvent: Boolean(cellEvent),
			focusedCell: gridApi.getFocusedCell()
		});

		if (cellEvent) {
			const colId = cellEvent.column?.getColId?.() ?? null;
			const target = cellEvent.event?.target as HTMLElement | null;
			const targetCell = target?.closest?.('.ag-cell') as HTMLElement | null;
			const targetColId = targetCell?.getAttribute('col-id') ?? null;
			if (colId === '#') {
				if (targetColId && targetColId !== '#') {
					return;
				}
				const rowData = cellEvent.node?.data as RowData | undefined;
				if (rowData) {
					const blockIndex = parseInt(String(rowData[ROW_ID_FIELD]), 10);
					if (!Number.isNaN(blockIndex)) {
						const context = this.getGridContext();
						if (context?.onCopySelectionAsTemplate) {
							event.preventDefault?.();
							event.stopPropagation?.();
							this.stopCellEditing();
							context.onCopySelectionAsTemplate(blockIndex);
							return;
						}
						if (context?.onCopyH2Section) {
							event.preventDefault?.();
							event.stopPropagation?.();
							this.stopCellEditing();
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
		const doc = this.getFocusedDocument() || document;
		this.copyTextToClipboard(doc, text);
		this.stopCellEditing();
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
			nav.clipboard.writeText(text).catch((error) => {
				logger.warn(this.translate('agGrid.copyFailed'), error);
			});
			return;
		}

		logger.warn(this.translate('agGrid.copyFailed'));
	}
}
