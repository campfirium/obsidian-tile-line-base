import { Notice } from 'obsidian';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';
import { isReservedColumnId } from '../grid/systemColumnUtils';
import type { TableDataStore } from './TableDataStore';
import type { RowInteractionController } from './RowInteractionController';

const logger = getLogger('table-view:grid-cell-clipboard');

interface ClipboardDeps {
	dataStore: TableDataStore;
	rowInteraction: RowInteractionController;
	getOwnerDocument: () => Document;
	writeClipboard: (
		payload: string | null | undefined,
		successKey: Parameters<typeof t>[0],
		options?: { allowEmpty?: boolean }
	) => Promise<void>;
}

export class GridCellClipboardController {
	constructor(private readonly deps: ClipboardDeps) {}

	canCopy(field: string | null | undefined): field is string {
		return typeof field === 'string' && !isReservedColumnId(field);
	}

	canPaste(field: string | null | undefined): field is string {
		return this.canCopy(field) && !this.deps.dataStore.isFormulaColumn(field);
	}

	async copyCellValue(blockIndex: number, field: string): Promise<void> {
		if (!this.canCopy(field)) {
			return;
		}
		const blocks = this.deps.dataStore.getBlocks();
		if (blockIndex < 0 || blockIndex >= blocks.length) {
			return;
		}
		const rawValue = blocks[blockIndex]?.data?.[field];
		const normalized = typeof rawValue === 'string' ? rawValue : rawValue == null ? '' : String(rawValue);
		await this.deps.writeClipboard(normalized, 'gridInteraction.copyCellSuccess', { allowEmpty: true });
	}

	async pasteCellValue(blockIndex: number, field: string): Promise<void> {
		if (!this.canCopy(field)) {
			return;
		}
		if (!this.canPaste(field)) {
			new Notice(t('gridInteraction.pasteCellFormulaDisabled'));
			return;
		}

		const ownerDoc = this.deps.getOwnerDocument();
		const navigatorLike = ownerDoc.defaultView?.navigator ?? navigator;
		const clipboard = navigatorLike?.clipboard;
		if (!clipboard?.readText) {
			logger.warn('Clipboard read not supported for pasteCellValue');
			new Notice(t('gridInteraction.pasteCellFailed'));
			return;
		}

		try {
			const text = await clipboard.readText();
			const normalized = typeof text === 'string' ? text : '';
			this.deps.rowInteraction.fillColumnWithValue([blockIndex], field, normalized, {
				focusField: field,
				focusRowIndex: blockIndex
			});
		} catch (error) {
			logger.error(t('gridInteraction.pasteCellFailedLog'), error);
			new Notice(t('gridInteraction.pasteCellFailed'));
		}
	}
}
