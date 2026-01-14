import type { Command, TFile, WorkspaceLeaf } from 'obsidian';
import type { TableView } from '../TableView';
import { registerKanbanViewCommand } from './commands/registerKanbanViewCommand';
import { registerSlideViewCommand } from './commands/registerSlideViewCommand';
import { registerGalleryViewCommand } from './commands/registerGalleryViewCommand';

interface ViewCommandDeps {
	addCommand: (config: Command) => void;
	getActiveTableView(): TableView | null;
	getActiveContext(): { leaf: WorkspaceLeaf | null; activeFile: TFile | null };
	openWithMode: (mode: 'kanban' | 'slide' | 'gallery', file: TFile, leaf: WorkspaceLeaf | null) => Promise<void>;
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

	registerGalleryViewCommand({
		addCommand: (config) => deps.addCommand(config),
		getActiveTableView: () => deps.getActiveTableView(),
		getActiveContext: () => deps.getActiveContext(),
		openGalleryView: (file, leaf) => deps.openWithMode('gallery', file, leaf)
	});
}
