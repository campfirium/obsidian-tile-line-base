import type { GridAdapter } from '../grid/GridAdapter';
import type { RowInteractionController } from './RowInteractionController';
import type { TableHistoryManager } from './TableHistoryManager';
import type { Logger } from '../utils/logger';

interface GridKeybindingContext {
	container: HTMLElement | null;
	logger: Logger;
	getGridAdapter: () => GridAdapter | null;
	rowInteraction: RowInteractionController;
	history: TableHistoryManager;
	isElementWithinGrid: (element: HTMLElement, container: HTMLElement) => boolean;
	copySectionAsTemplate: (blockIndex: number) => Promise<void>;
}

export function handleGridKeydown(event: KeyboardEvent, context: GridKeybindingContext): void {
	const container = context.container;
	if (!container) {
		return;
	}

	const ownerDoc = container.ownerDocument;
	const target = event.target as HTMLElement | null;
	const activeElement = ownerDoc.activeElement as HTMLElement | null;
	const targetInside = target ? context.isElementWithinGrid(target, container) : false;
	const activeInside = activeElement ? context.isElementWithinGrid(activeElement, container) : false;
	if (!targetInside && !activeInside) {
		context.logger.warn('undo-skip-outside', { key: event.key });
		return;
	}
	if (activeElement?.classList.contains('ag-cell-edit-input')) {
		context.logger.warn('undo-skip-editor', { key: event.key });
		return;
	}

	const gridAdapter = context.getGridAdapter();
	const selectedRows = gridAdapter?.getSelectedRows?.() || [];
	const ctrlLike = event.metaKey || event.ctrlKey;
	if (ctrlLike && !event.altKey) {
		if (event.key === 'z' || event.key === 'Z') {
			event.preventDefault();
			event.stopPropagation();
			if (event.shiftKey) {
				const applied = context.history.redo();
				if (!applied) {
					context.logger.warn('redo:empty');
				} else {
					context.logger.warn('redo:applied', { reason: 'shift+ctrl+z' });
				}
			} else {
				const applied = context.history.undo();
				if (!applied) {
					context.logger.warn('undo:empty');
				} else {
					context.logger.warn('undo:applied', { reason: 'ctrl+z' });
				}
			}
			return;
		}
		if (event.key === 'c' || event.key === 'C') {
			const focusedCell = gridAdapter?.getFocusedCell?.() ?? null;
			if (focusedCell?.field === '#') {
				event.preventDefault();
				event.stopPropagation();
				const blockIndex = focusedCell.rowIndex ?? (selectedRows.length > 0 ? selectedRows[0] : null);
				if (blockIndex !== null && blockIndex !== undefined) {
					void context.copySectionAsTemplate(blockIndex);
				}
				return;
			}
		}
		if (event.key === 'y' || event.key === 'Y') {
			event.preventDefault();
			event.stopPropagation();
			const applied = context.history.redo();
			if (!applied) {
				context.logger.warn('redo:empty');
			} else {
				context.logger.warn('redo:applied', { reason: 'ctrl+y' });
			}
			return;
		}
	}

	if ((event.metaKey || event.ctrlKey) && event.key === 'd' && selectedRows.length > 0) {
		event.preventDefault();
		if (selectedRows.length > 1) {
			context.rowInteraction.duplicateRows(selectedRows);
		} else {
			context.rowInteraction.duplicateRow(selectedRows[0]);
		}
	}
}
