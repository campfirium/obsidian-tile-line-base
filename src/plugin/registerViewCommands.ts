import type { Command, TFile, WorkspaceLeaf } from 'obsidian';
import { registerKanbanViewCommand } from './commands/registerKanbanViewCommand';
import { registerSlideViewCommand } from './commands/registerSlideViewCommand';

interface ViewCommandDeps {
	addCommand: (config: Command) => void;
	getActiveTableView(): any;
	getActiveContext(): { leaf: WorkspaceLeaf | null; activeFile: TFile | null };
	openWithMode: (mode: 'kanban' | 'slide', file: TFile, leaf: WorkspaceLeaf | null) => Promise<void>;
}

export function registerViewCommands(deps: ViewCommandDeps): void {
	registerKanbanViewCommand({
		addCommand: (config) => deps.addCommand(config),
		getActiveTableView: () => deps.getActiveTableView(),
		getActiveContext: () => deps.getActiveContext(),
		openKanbanView: (file, leaf) => deps.openWithMode('kanban', file, leaf)
	});

	registerSlideViewCommand({
		addCommand: (config) => deps.addCommand(config),
		getActiveTableView: () => deps.getActiveTableView(),
		getActiveContext: () => deps.getActiveContext(),
		openSlideView: (file, leaf) => deps.openWithMode('slide', file, leaf)
	});
}
