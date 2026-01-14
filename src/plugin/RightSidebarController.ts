import type { App, WorkspaceLeaf } from 'obsidian';
import { TableView, TABLE_VIEW_TYPE } from '../TableView';
import { getLogger } from '../utils/logger';

interface RightSidebarState {
	applied: boolean;
	wasCollapsed: boolean;
}

const logger = getLogger('plugin:right-sidebar');

export class RightSidebarController {
	private state: RightSidebarState = { applied: false, wasCollapsed: false };
	private readonly app: App;

	constructor(app: App) {
		this.app = app;
	}

	applyForLeaf(leaf: WorkspaceLeaf | null | undefined, shouldHide: boolean): void {
		if (!shouldHide) {
			this.restoreIfNeeded();
			return;
		}

		if (this.isTileLineBaseLeaf(leaf)) {
			this.hide();
			return;
		}

		this.restoreIfNeeded();
	}

	restoreIfNeeded(): void {
		if (!this.state.applied) {
			return;
		}
		const split = this.getRightSplit();
		if (!split) {
			this.state = { applied: false, wasCollapsed: false };
			return;
		}
		if (!this.state.wasCollapsed) {
			if (typeof split.expand === 'function') {
				try {
					split.expand();
				} catch (error) {
					logger.warn('Failed to expand right sidebar via API', error);
					this.toggleViaCommand();
				}
			} else {
				this.toggleViaCommand();
			}
		}
		this.state = { applied: false, wasCollapsed: false };
	}

	private hide(): void {
		const split = this.getRightSplit();
		if (!split) {
			return;
		}

		const alreadyCollapsed = this.isCollapsed(split);
		if (alreadyCollapsed && this.state.applied && !this.state.wasCollapsed) {
			return;
		}

		if (alreadyCollapsed) {
			this.state = { applied: false, wasCollapsed: true };
			return;
		}

		const wasCollapsedBefore = this.state.applied ? this.state.wasCollapsed : alreadyCollapsed;

		if (typeof split.collapse === 'function') {
			try {
				split.collapse();
				this.state = { applied: true, wasCollapsed: wasCollapsedBefore };
				return;
			} catch (error) {
				logger.warn('Failed to collapse right sidebar via API', error);
			}
		}

		const toggled = this.toggleViaCommand();
		this.state = { applied: toggled || this.state.applied, wasCollapsed: wasCollapsedBefore };
	}

	private getRightSplit(): { collapsed?: boolean; collapse?: () => void; expand?: () => void } | null {
		const workspaceAny = this.app.workspace as unknown as {
			rightSplit?: { collapsed?: boolean; collapse?: () => void; expand?: () => void };
		};
		return workspaceAny?.rightSplit ?? null;
	}

	private isCollapsed(split: { collapsed?: boolean }): boolean {
		return typeof split?.collapsed === 'boolean' ? split.collapsed : false;
	}

	private isTileLineBaseLeaf(leaf: WorkspaceLeaf | null | undefined): boolean {
		if (!leaf) {
			return false;
		}
		if (leaf.view instanceof TableView) {
			return true;
		}
		const viewType = typeof leaf.view?.getViewType === 'function' ? leaf.view.getViewType() : null;
		return viewType === TABLE_VIEW_TYPE;
	}

	private toggleViaCommand(): boolean {
		const beforeSplit = this.getRightSplit();
		const before = beforeSplit ? this.isCollapsed(beforeSplit) : undefined;
		const commandManager = (this.app as { commands?: { executeCommandById?: (commandId: string) => boolean } }).commands;
		const executed = typeof commandManager?.executeCommandById === 'function'
			? commandManager.executeCommandById('workspace:toggle-right-sidebar')
			: false;
		const afterSplit = this.getRightSplit();
		const after = afterSplit ? this.isCollapsed(afterSplit) : undefined;
		if (executed) {
			return true;
		}
		return before !== after;
	}
}
