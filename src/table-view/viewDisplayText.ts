import type { WorkspaceLeaf } from 'obsidian';
import { buildTableViewTabTitle } from '../utils/viewTitle';
import type { TableView } from '../TableView';

export function refreshTableViewDisplayText(view: TableView): void {
	const tabTitle = buildTableViewTabTitle({
		file: view.file,
		filePath: view.file?.path ?? null
	});
	const displayText = view.getDisplayText();
	const leafWithTab = view.leaf as WorkspaceLeaf & { tabHeaderInnerTitleEl?: HTMLElement | null };
	setElementText(leafWithTab?.tabHeaderInnerTitleEl ?? null, tabTitle);

	const leafEl = view.containerEl.closest('.workspace-leaf');
	const headerTitleEl = (leafEl?.querySelector('.view-header-title') as HTMLElement | null) ?? null;
	setElementText(headerTitleEl, displayText);
}

function setElementText(element: HTMLElement | null | undefined, text: string): void {
	if (!element) {
		return;
	}
	const setText = (element as any).setText;
	if (typeof setText === 'function') {
		setText.call(element, text);
		return;
	}
	element.textContent = text;
}
