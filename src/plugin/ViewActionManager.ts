import type { App, WorkspaceLeaf } from 'obsidian';
import { MarkdownView } from 'obsidian';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';
import type { ViewSwitchCoordinator } from './ViewSwitchCoordinator';
import type { WindowContextManager } from './WindowContextManager';

const logger = getLogger('plugin:view-actions');

export class ViewActionManager {
	private readonly actionAttribute = 'data-tlb-action';
	private readonly markdownActionId = 'open-table-view';

	constructor(
		private readonly app: App,
		private readonly coordinator: ViewSwitchCoordinator,
		private readonly windowContextManager: WindowContextManager
	) {}

	refreshAll(): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			this.ensureActionsForLeaf(leaf);
		});
	}

	ensureActionsForLeaf(leaf: WorkspaceLeaf | null | undefined): void {
		if (!leaf) {
			return;
		}
		if (leaf.view instanceof MarkdownView) {
			this.ensureMarkdownAction(leaf, leaf.view);
		}
	}

	clearInjectedActions(): void {
		const selector = `[${this.actionAttribute}]`;
		document.querySelectorAll(selector).forEach((element) => {
			const el = element as HTMLElement;
			if (el.getAttribute(this.actionAttribute) === this.markdownActionId) {
				el.remove();
			}
		});
	}

	private ensureMarkdownAction(leaf: WorkspaceLeaf, view: MarkdownView): void {
		const container = view.containerEl;
		const existing = container.querySelector(`[${this.actionAttribute}="${this.markdownActionId}"]`);
		if (existing) {
			return;
		}

		const label = t('viewControls.openTableView');
		const button = view.addAction('table', label, async (evt) => {
			const file = view.file;
			if (!file) {
				logger.warn('Markdown view header action triggered without file');
				return;
			}

			const preferredWindow = this.windowContextManager.getLeafWindow(leaf);
			const workspace = this.windowContextManager.getWorkspaceForLeaf(leaf) ?? this.app.workspace;

			logger.debug('Switching from markdown to table view via header action', {
				file: file.path,
				preferredWindow: this.windowContextManager.describeWindow(preferredWindow),
				workspaceIsMain: workspace === this.app.workspace
			});

			try {
				await this.coordinator.openTableView(file, {
					leaf,
					preferredWindow,
					workspace
				});
			} catch (error) {
				logger.error('Failed to switch to table view from markdown header action', error);
			}
			evt?.preventDefault();
			evt?.stopPropagation();
		});

		button.setAttribute(this.actionAttribute, this.markdownActionId);
		button.setAttribute('aria-label', label);
		button.setAttribute('title', label);
	}
}
