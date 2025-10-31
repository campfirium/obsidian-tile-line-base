import type { GridAdapter } from '../grid/GridAdapter';
import type { RowInteractionController } from './RowInteractionController';
import type { TableHistoryManager } from './TableHistoryManager';

interface GridKeydownContext {
	container: HTMLElement | null;
	getGridAdapter: () => GridAdapter | null;
	history: TableHistoryManager;
	rowInteraction: RowInteractionController;
	logger: { warn: (message: string, payload?: Record<string, unknown>) => void };
	isElementWithinGrid: (element: HTMLElement, container: HTMLElement) => boolean;
}

/**
 * Extracted keyboard handler to keep GridInteractionController within the max line budget.
 */
export function handleGridKeydownEvent(event: KeyboardEvent, context: GridKeydownContext): void {
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

	const ctrlLike = event.metaKey || event.ctrlKey;
	if (ctrlLike && !event.altKey) {
		if (event.key === 'z' || event.key === 'Z') {
			event.preventDefault();
			event.stopPropagation();
			if (event.shiftKey) {
				const applied = context.history.redo();
				context.logger.warn(applied ? 'redo:applied' : 'redo:empty', { reason: 'shift+ctrl+z' });
			} else {
				const applied = context.history.undo();
				context.logger.warn(applied ? 'undo:applied' : 'undo:empty', { reason: 'ctrl+z' });
			}
			return;
		}
		if (event.key === 'y' || event.key === 'Y') {
			event.preventDefault();
			event.stopPropagation();
			const applied = context.history.redo();
			context.logger.warn(applied ? 'redo:applied' : 'redo:empty', { reason: 'ctrl+y' });
			return;
		}
	}

	const gridAdapter = context.getGridAdapter();
	const selectedRows = gridAdapter?.getSelectedRows?.() || [];
	if ((event.metaKey || event.ctrlKey) && event.key === 'd' && selectedRows.length > 0) {
		event.preventDefault();
		if (selectedRows.length > 1) {
			context.rowInteraction.duplicateRows(selectedRows);
		} else {
			context.rowInteraction.duplicateRow(selectedRows[0]);
		}
	}
}
