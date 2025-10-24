import { CellKeyDownEvent, GridApi } from 'ag-grid-community';
import { KeyboardEventLike } from '../types';
import { ROW_ID_FIELD, RowData } from '../../GridAdapter';
import { ClipboardOptions } from '../types';

export class GridClipboardService {
	private readonly getGridApi: () => GridApi | null;
	private readonly getFocusedDocument: () => Document | null;
	private readonly getGridContext: ClipboardOptions['getGridContext'];
	private readonly translate: ClipboardOptions['translate'];
	private readonly debug: ClipboardOptions['debug'];

	constructor(options: ClipboardOptions) {
		this.getGridApi = options.getGridApi;
		this.getFocusedDocument = options.getFocusedDocument;
		this.getGridContext = options.getGridContext;
		this.translate = options.translate;
		this.debug = options.debug;
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
			if (colId === '#') {
				const rowData = cellEvent.node?.data as RowData | undefined;
				if (rowData) {
					const blockIndex = parseInt(String(rowData[ROW_ID_FIELD]), 10);
					if (!Number.isNaN(blockIndex)) {
						const context = this.getGridContext();
						if (context?.onCopyH2Section) {
							event.preventDefault?.();
							event.stopPropagation?.();
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
			nav.clipboard.writeText(text).catch(() => {
				this.copyViaHiddenTextarea(doc, text);
			});
			return;
		}

		this.copyViaHiddenTextarea(doc, text);
	}

	private copyViaHiddenTextarea(doc: Document, text: string): void {
		const textarea = doc.createElement('textarea');
		textarea.value = text;
		textarea.setAttribute('readonly', 'true');
		Object.assign(textarea.style, {
			position: 'fixed',
			left: '-9999px',
			top: '0',
			width: '1px',
			height: '1px',
			opacity: '0'
		});

		doc.body.appendChild(textarea);
		textarea.focus();
		textarea.select();
		try {
			doc.execCommand('copy');
		} catch (error) {
			console.warn(this.translate('agGrid.copyFailed'), error);
		}
		textarea.blur();
		doc.body.removeChild(textarea);
	}
}
