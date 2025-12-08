import { MarkdownView } from 'obsidian';
import { t } from '../../i18n';
import type { TableView } from '../../TableView';
import type { Command, TFile, WorkspaceLeaf } from 'obsidian';

interface GalleryCommandDeps {
	addCommand: (config: Command) => void;
	getActiveTableView(): TableView | null;
	getActiveContext(): { leaf: WorkspaceLeaf | null; activeFile: TFile | null };
	openGalleryView(file: TFile, leaf: WorkspaceLeaf | null): Promise<void>;
}

export function registerGalleryViewCommand(deps: GalleryCommandDeps): void {
	deps.addCommand({
		id: 'table-open-gallery-view',
		name: t('commands.openGalleryView'),
		checkCallback: (checking) => {
			const activeTable = deps.getActiveTableView();
			if (activeTable) {
				if (!checking) {
					void activeTable.setActiveViewMode('gallery');
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
			void deps.openGalleryView(file, leaf);
			return true;
		}
	});
}
