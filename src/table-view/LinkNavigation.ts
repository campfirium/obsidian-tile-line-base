import type { TableView } from '../TableView';
import type { CellLinkClickContext } from '../types/cellLinks';
import { getLogger } from '../utils/logger';

const logger = getLogger('table-view:link-navigation');

export function handleCellLinkOpen(view: TableView, context: CellLinkClickContext): void {
	const target = context.link.target.trim();
	if (!target) {
		return;
	}

	if (context.link.type === 'external') {
		try {
			const electron = (window as unknown as { require?: (module: string) => any }).require?.('electron');
			const shell = electron?.shell as { openExternal?: (url: string) => Promise<void> | void } | undefined;
			if (shell?.openExternal) {
				void shell.openExternal(target);
			} else {
				window.open(target, '_blank', 'noopener');
			}
		} catch (error) {
			logger.error('Failed to open external link', {
				error,
				target,
				field: context.field,
				rowId: context.rowId
			});
		}
		return;
	}

	const sourcePath = view.file?.path ?? '';
	try {
		view.app.workspace.openLinkText(target, sourcePath, true);
	} catch (error) {
		logger.error('Failed to open internal link', {
			error,
			target,
			field: context.field,
			rowId: context.rowId
		});
	}
}
