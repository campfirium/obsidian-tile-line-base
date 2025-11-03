import { MarkdownView } from 'obsidian';
import { t } from '../../i18n';
import type { TableView } from '../../TableView';
import type { Command, TFile, WorkspaceLeaf } from 'obsidian';

interface KanbanCommandDeps {
	addCommand: (config: Command) => void;
	getActiveTableView(): TableView | null;
	getActiveContext(): { leaf: WorkspaceLeaf | null; activeFile: TFile | null };
	openKanbanView(file: TFile, leaf: WorkspaceLeaf | null): Promise<void>;
}

export function registerKanbanViewCommand(deps: KanbanCommandDeps): void {
	deps.addCommand({
		id: 'table-open-kanban-view',
		name: t('commands.openKanbanView'),
		checkCallback: (checking) => {
			const activeTable = deps.getActiveTableView();
			if (activeTable) {
				if (!checking) {
					void activeTable.setActiveViewMode('kanban');
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
			void deps.openKanbanView(file, leaf);
			return true;
		}
	});
}
