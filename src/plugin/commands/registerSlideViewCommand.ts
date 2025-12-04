import { MarkdownView } from 'obsidian';
import { t } from '../../i18n';
import type { TableView } from '../../TableView';
import type { Command, TFile, WorkspaceLeaf } from 'obsidian';

interface SlideCommandDeps {
	addCommand: (config: Command) => void;
	getActiveTableView(): TableView | null;
	getActiveContext(): { leaf: WorkspaceLeaf | null; activeFile: TFile | null };
	openSlideView(file: TFile, leaf: WorkspaceLeaf | null): Promise<void>;
}

export function registerSlideViewCommand(deps: SlideCommandDeps): void {
	deps.addCommand({
		id: 'table-open-slide-view',
		name: t('commands.openSlideView'),
		checkCallback: (checking) => {
			const activeTable = deps.getActiveTableView();
			if (activeTable) {
				if (!checking) {
					void activeTable.setActiveViewMode('slide');
				}
				return true;
			}

			const { leaf, activeFile } = deps.getActiveContext();
			const markdownView = leaf?.view instanceof MarkdownView ? leaf.view : null;
			const file = markdownView?.file ?? activeFile;
			if (!file) {
				return false;
			}
			if (checking) {
				return true;
			}
			void deps.openSlideView(file, leaf);
			return true;
		}
	});
}
