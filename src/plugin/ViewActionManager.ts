import type { App, WorkspaceLeaf } from 'obsidian';
import { MarkdownView, setIcon } from 'obsidian';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';
import type { ViewSwitchCoordinator } from './ViewSwitchCoordinator';
import type { WindowContextManager } from './WindowContextManager';

const logger = getLogger('plugin:view-actions');

export class ViewActionManager {
	private readonly actionAttribute = 'data-tlb-action';
	private readonly markdownActionId = 'open-table-view';
	private readonly kanbanActionId = 'open-kanban-view';
	private readonly slideActionId = 'open-slide-view';

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
			const actionId = el.getAttribute(this.actionAttribute);
			if (
				actionId === this.markdownActionId ||
				actionId === this.kanbanActionId ||
				actionId === this.slideActionId
			) {
				el.remove();
			}
		});
	}

	private ensureMarkdownAction(leaf: WorkspaceLeaf, view: MarkdownView): void {
		const container = view.containerEl;
		const existing = container.querySelector(`[${this.actionAttribute}="${this.markdownActionId}"]`);
		if (!existing) {
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
						workspace,
						mode: 'table',
						trigger: 'manual'
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

		this.ensureKanbanAction(leaf, view);
		this.ensureSlideAction(leaf, view);
	}

	private ensureKanbanAction(leaf: WorkspaceLeaf, view: MarkdownView): void {
		const container = view.containerEl;
		const existing = container.querySelector(`[${this.actionAttribute}="${this.kanbanActionId}"]`);
		if (existing) {
			return;
		}

		const label = t('kanbanView.actions.openFromMarkdown');
		const button = view.addAction('layout-kanban', label, async (evt) => {
			const file = view.file;
			if (!file) {
				logger.warn('Markdown view header kanban action triggered without file');
				return;
			}

			const preferredWindow = this.windowContextManager.getLeafWindow(leaf);
			const workspace = this.windowContextManager.getWorkspaceForLeaf(leaf) ?? this.app.workspace;

			logger.debug('Switching from markdown to kanban view via header action', {
				file: file.path,
				preferredWindow: this.windowContextManager.describeWindow(preferredWindow),
				workspaceIsMain: workspace === this.app.workspace
			});

			try {
				await this.coordinator.openTableView(file, {
					leaf,
					preferredWindow,
					workspace,
					mode: 'kanban',
					trigger: 'manual'
				});
			} catch (error) {
				logger.error('Failed to switch to kanban view from markdown header action', error);
			}
			evt?.preventDefault();
			evt?.stopPropagation();
		});

		const iconEl = (button as any).iconEl ?? (button as any).containerEl ?? (button as any);
		setIcon(iconEl, 'layout-kanban');
		const svg = iconEl?.querySelector?.('svg');
		if (!svg) {
			setIcon(iconEl, 'layout-grid');
		}

		button.setAttribute(this.actionAttribute, this.kanbanActionId);
		button.setAttribute('aria-label', label);
		button.setAttribute('title', label);
	}

	private ensureSlideAction(leaf: WorkspaceLeaf, view: MarkdownView): void {
		const container = view.containerEl;
		const existing = container.querySelector(`[${this.actionAttribute}="${this.slideActionId}"]`);
		if (existing) {
			return;
		}

		const label = t('slideView.actions.switchToSlide');
		const button = view.addAction('presentation', label, async (evt) => {
			const file = view.file;
			if (!file) {
				logger.warn('Markdown view header slide action triggered without file');
				return;
			}

			const preferredWindow = this.windowContextManager.getLeafWindow(leaf);
			const workspace = this.windowContextManager.getWorkspaceForLeaf(leaf) ?? this.app.workspace;

			logger.debug('Switching from markdown to slide view via header action', {
				file: file.path,
				preferredWindow: this.windowContextManager.describeWindow(preferredWindow),
				workspaceIsMain: workspace === this.app.workspace
			});

			try {
				await this.coordinator.openTableView(file, {
					leaf,
					preferredWindow,
					workspace,
					mode: 'slide',
					trigger: 'manual'
				});
			} catch (error) {
				logger.error('Failed to switch to slide view from markdown header action', error);
			}
			evt?.preventDefault();
			evt?.stopPropagation();
		});

		const iconEl = (button as any).iconEl ?? (button as any).containerEl ?? (button as any);
		setIcon(iconEl, 'presentation');

		button.setAttribute(this.actionAttribute, this.slideActionId);
		button.setAttribute('aria-label', label);
		button.setAttribute('title', label);
	}
}
