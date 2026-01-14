import type { App, WorkspaceLeaf } from 'obsidian';
import { TFile } from 'obsidian';
import { TABLE_VIEW_TYPE, type TableViewState } from '../TableView';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';
import type { WindowContextManager } from './WindowContextManager';
import { snapshotLeaf } from './utils/snapshotLeaf';
import { buildTableViewTabTitle } from '../utils/viewTitle';

const logger = getLogger('plugin:tab-title');

export class TableViewTitleRefresher {
	constructor(
		private readonly app: App,
		private readonly windowContextManager: WindowContextManager
	) {}

	refreshAll(): void {
		const leaves = this.app.workspace.getLeavesOfType(TABLE_VIEW_TYPE);
		if (!leaves || leaves.length === 0) {
			return;
		}
		for (const leaf of leaves) {
			this.applyStoredTitleToLeaf(leaf);
		}
	}

	private applyStoredTitleToLeaf(leaf: WorkspaceLeaf): void {
		try {
			const state = leaf.getViewState();
			const tableState = (state?.state ?? null) as Partial<TableViewState> | null;
			const filePath = typeof tableState?.filePath === 'string' ? tableState.filePath : null;
			const title = this.resolveTitle(filePath);
			this.setLeafTitleElements(leaf, title);
		} catch (error) {
			logger.warn('Failed to refresh table tab title from state', {
				leaf: snapshotLeaf(this.windowContextManager, leaf)
			}, error);
		}
	}

	private resolveTitle(filePath: string | null): string {
		const file = filePath ? this.app.vault.getAbstractFileByPath(filePath) : null;
		return buildTableViewTabTitle({
			file: file instanceof TFile ? file : null,
			filePath
		});
	}

	private setLeafTitleElements(leaf: WorkspaceLeaf, title: string): void {
		const effectiveTitle = title || t('tableView.displayName');
		const leafWithTab = leaf as WorkspaceLeaf & { tabHeaderInnerTitleEl?: HTMLElement | null };
		this.setElementText(leafWithTab?.tabHeaderInnerTitleEl ?? null, effectiveTitle);
	}

	private setElementText(element: HTMLElement | null | undefined, text: string): void {
		if (!element) {
			return;
		}
		const elementWithSetText = element as HTMLElement & { setText?: (value: string) => void };
		const setText = elementWithSetText.setText;
		if (typeof setText === 'function') {
			setText.call(element, text);
			return;
		}
		element.textContent = text;
	}
}
