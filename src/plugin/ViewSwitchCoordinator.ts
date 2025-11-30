import { App, Menu, TFile, Workspace, WorkspaceLeaf } from 'obsidian';
import { TableView, TABLE_VIEW_TYPE } from '../TableView';
import { getLogger } from '../utils/logger';
import type { SettingsService } from '../services/SettingsService';
import type { WindowContext, WindowContextManager } from './WindowContextManager';

const logger = getLogger('plugin:view-switch');

export interface ViewOpenContext {
	leaf?: WorkspaceLeaf | null;
	preferredWindow?: Window | null;
	workspace?: Workspace | null;
	mode?: 'table' | 'kanban' | 'slide';
}

export class ViewSwitchCoordinator {
	private readonly app: App;
	private readonly autoSwitchStats = new Map<string, { hits: number; first: number }>();

	constructor(
		app: App,
		private readonly settingsService: SettingsService,
		private readonly windowContextManager: WindowContextManager,
		private readonly suppressAutoSwitchUntil: Map<string, number>
	) {
		this.app = app;
	}

	handleFileMenu(menu: Menu, file: TFile, context: WindowContext): void {
		if (!(file instanceof TFile)) {
			return;
		}

		menu.addItem((item) => {
			logger.debug('handleFileMenu: registering menu item', { file: file.path });

			const clickHandler = async (evt: MouseEvent) => {
				logger.debug('file-menu onClick', {
					file: file.path,
					eventType: evt?.type ?? null,
					sameWindow: evt?.view === context.window
				});

				const resolution = this.resolveLeafFromEvent(evt, context);

				logger.debug('file-menu resolution', {
					leaf: this.describeLeaf(resolution.leaf),
					preferredWindow: this.describeWindow(resolution.preferredWindow),
					workspace: resolution.workspace === this.app.workspace ? 'main' : 'other'
				});

				await this.openTableView(file, {
					leaf: resolution.leaf,
					preferredWindow: resolution.preferredWindow ?? context.window,
					workspace: resolution.workspace ?? context.app.workspace
				});
			};

			item
				.setTitle('Open in TileLineBase table view')
				.setIcon('table')
				.onClick(clickHandler);
			logger.debug('handleFileMenu: menu item ready', { file: file.path });
		});
	}

	async maybeSwitchToTableView(file: TFile): Promise<void> {
		const suppressUntil = this.suppressAutoSwitchUntil.get(file.path);
		if (suppressUntil && suppressUntil > Date.now()) {
			logger.debug('maybeSwitchToTableView: suppressed due to manual switch', { file: file.path });
			return;
		}
		this.suppressAutoSwitchUntil.delete(file.path);

		if (!this.settingsService.shouldAutoOpen(file.path)) {
			logger.debug('maybeSwitchToTableView: skipped preference', { file: file.path });
			return;
		}

		const activeLeaf = this.app.workspace.getMostRecentLeaf?.() ?? null;
		if (!activeLeaf) {
			logger.debug('maybeSwitchToTableView: no active leaf', { file: file.path });
			return;
		}

		const viewType = activeLeaf.getViewState().type;
		if (viewType === TABLE_VIEW_TYPE) {
			logger.debug('maybeSwitchToTableView: already in table view', { file: file.path });
			return;
		}
		if (viewType !== 'markdown' && viewType !== 'empty') {
			logger.debug('maybeSwitchToTableView: view type not eligible', { file: file.path, viewType });
			return;
		}
		if (this.recordAutoSwitchAttempt(file.path)) {
			return;
		}

		const preferredWindow = this.windowContextManager.getLeafWindow(activeLeaf);
		const workspace = this.windowContextManager.getWorkspaceForLeaf(activeLeaf) ?? this.app.workspace;

		try {
			logger.debug('maybeSwitchToTableView: switching', {
				file: file.path,
				targetLeaf: this.describeLeaf(activeLeaf)
			});
			await this.openTableView(file, { leaf: activeLeaf, preferredWindow, workspace });
		} catch (error) {
			logger.error('Failed to auto switch to table view', error);
		}
	}

	async openTableView(file: TFile, options?: ViewOpenContext): Promise<void> {
		this.markAutoSwitchCooldown(file.path);
		const requestedLeaf = options?.leaf ?? null;
		const preferredWindow = options?.preferredWindow ?? this.windowContextManager.getLeafWindow(requestedLeaf);
		const workspace = options?.workspace ?? this.windowContextManager.getWorkspaceForLeaf(requestedLeaf) ?? this.app.workspace;
		const requestedMode = options?.mode;
		const preferenceToSet: 'markdown' | 'table' | 'kanban' | 'slide' = requestedMode ?? 'table';

		if (requestedLeaf?.view instanceof TableView && requestedLeaf.view.file?.path === file.path) {
			logger.debug('openTableView reuse requested table leaf', this.describeLeaf(requestedLeaf));
			await this.settingsService.setFileViewPreference(file.path, preferenceToSet);
			await workspace.revealLeaf(requestedLeaf);
			await this.applyViewMode(requestedLeaf, requestedMode);
			return;
		}

		const existingTableLeaf = this.findLeafForFile(file, TABLE_VIEW_TYPE, preferredWindow);
		if (existingTableLeaf) {
			logger.debug('openTableView reuse existing table leaf', this.describeLeaf(existingTableLeaf));
			await this.settingsService.setFileViewPreference(file.path, preferenceToSet);
			await workspace.revealLeaf(existingTableLeaf);
			await this.applyViewMode(existingTableLeaf, requestedMode);
			return;
		}

		logger.debug('openTableView start', {
			file: file.path,
			requestedLeaf: this.describeLeaf(requestedLeaf),
			preferredWindow: this.describeWindow(preferredWindow),
			workspaceIsMain: workspace === this.app.workspace
		});

		let leaf = requestedLeaf ?? this.findLeafForFile(file, undefined, preferredWindow) ?? null;
		if (leaf && preferredWindow) {
			const leafWindow = this.windowContextManager.getLeafWindow(leaf);
			if (leafWindow && leafWindow !== preferredWindow) {
				logger.debug('requested leaf window mismatch', {
					requestedLeaf: this.describeLeaf(leaf),
					targetWindow: this.describeWindow(preferredWindow)
				});
				leaf = null;
			}
		}

		if (!leaf) {
			leaf = this.selectLeaf(workspace, preferredWindow);
			logger.debug('openTableView selectLeaf result', this.describeLeaf(leaf));
		}

		if (!leaf && preferredWindow) {
			leaf = this.createLeafInWindow(workspace, preferredWindow);
			logger.debug('openTableView createLeafInWindow result', this.describeLeaf(leaf));
		}

		if (!leaf) {
			leaf = this.selectLeaf(this.app.workspace);
			logger.debug('openTableView global fallback leaf', this.describeLeaf(leaf));
		}

		if (!leaf) {
			logger.warn('No leaf available, aborting openTableView');
			return;
		}

		logger.debug('openTableView preparing leaf.setViewState', {
			leaf: this.describeLeaf(leaf),
			viewType: TABLE_VIEW_TYPE,
			filePath: file.path
		});

		try {
			await leaf.setViewState({
				type: TABLE_VIEW_TYPE,
				active: true,
				state: {
					filePath: file.path
				}
			});
			logger.debug('openTableView setViewState completed', this.describeLeaf(leaf));
			await this.settingsService.setFileViewPreference(file.path, preferenceToSet);
			await this.applyViewMode(leaf, requestedMode);
		} catch (error) {
			logger.error('openTableView setViewState failed', error);
			throw error;
		}

		await workspace.revealLeaf(leaf);
		logger.debug('openTableView finish');
	}

	private async applyViewMode(leaf: WorkspaceLeaf | null, mode?: 'table' | 'kanban' | 'slide'): Promise<void> {
		if (!leaf || !mode) {
			return;
		}
		const view = leaf.view;
		if (view instanceof TableView) {
			await view.setActiveViewMode(mode);
		}
	}

	private recordAutoSwitchAttempt(filePath: string): boolean {
		const now = Date.now();
		const entry = this.autoSwitchStats.get(filePath);
		if (!entry || now - entry.first > 4000) {
			this.autoSwitchStats.set(filePath, { hits: 1, first: now });
			return false;
		}
		entry.hits += 1;
		if (entry.hits >= 3) {
			this.autoSwitchStats.delete(filePath);
			this.suppressAutoSwitchUntil.set(filePath, now + 5000);
			logger.warn('maybeSwitchToTableView: suppressed due to rapid auto-switch loop', { file: filePath });
			return true;
		}
		return false;
	}

	private markAutoSwitchCooldown(filePath: string): void {
		const now = Date.now();
		const suppressUntil = this.suppressAutoSwitchUntil.get(filePath) ?? 0;
		if (suppressUntil < now) {
			this.suppressAutoSwitchUntil.set(filePath, now + 800);
		}
	}

	async toggleTableView(leaf: WorkspaceLeaf, context: WindowContext | null): Promise<void> {
		const currentView = leaf.view;
		logger.debug('toggleTableView', this.describeLeaf(leaf));

		if (currentView.getViewType() === TABLE_VIEW_TYPE) {
			const tableView = currentView as TableView;
			const file = tableView.file;

			if (file) {
				await tableView.restoreSessionBaselineIfEligible();
				await leaf.setViewState({
					type: 'markdown',
					state: {
						file: file.path
					}
				});
				await this.settingsService.setFileViewPreference(file.path, 'markdown');
				this.suppressAutoSwitchUntil.set(file.path, Date.now() + 1000);
			}
		} else {
			const workspace = context?.app.workspace ?? this.windowContextManager.getWorkspaceForLeaf(leaf) ?? this.app.workspace;
			const activeFile = workspace.getActiveFile();
			if (activeFile) {
				await this.openTableView(activeFile, {
					leaf,
					preferredWindow: this.windowContextManager.getLeafWindow(leaf),
					workspace
				});
			}
		}
	}

	private resolveLeafFromEvent(evt: MouseEvent | KeyboardEvent | null | undefined, fallbackContext?: WindowContext | null): { leaf: WorkspaceLeaf | null; preferredWindow: Window | null; workspace: Workspace | null } {
		const targetWindow = this.getEventWindow(evt) ?? fallbackContext?.window ?? null;
		const context = (targetWindow ? this.windowContextManager.getWindowContext(targetWindow) : null) ?? fallbackContext ?? null;
		const workspace = context?.app.workspace ?? this.app.workspace;

		logger.debug('resolveLeafFromEvent', {
			eventType: evt?.type,
			targetWindow: this.describeWindow(targetWindow),
			workspaceIsMain: workspace === this.app.workspace
		});

		if (!targetWindow) {
			const leaf = this.selectLeaf(workspace);
			logger.debug('resolveLeafFromEvent default leaf', this.describeLeaf(leaf));
			return { leaf, preferredWindow: null, workspace };
		}

		const matched = this.findLeafForWindow(workspace, targetWindow);
		if (matched) {
			logger.debug('resolveLeafFromEvent matched leaf', this.describeLeaf(matched));
			return { leaf: matched, preferredWindow: targetWindow, workspace };
		}

		const fallback = this.selectLeaf(workspace, targetWindow);
		logger.debug('resolveLeafFromEvent fallback leaf', this.describeLeaf(fallback));
		return { leaf: fallback, preferredWindow: targetWindow, workspace };
	}

	private getEventWindow(evt?: MouseEvent | KeyboardEvent | null): Window | null {
		const eventView = (evt as UIEvent | undefined)?.view || null;
		if (eventView) {
			return eventView;
		}

		const maybeActiveWindow = (globalThis as any).activeWindow as Window | undefined;
		if (maybeActiveWindow) {
			return maybeActiveWindow;
		}

		if (typeof window !== 'undefined') {
			return window;
		}

		return null;
	}

	private findLeafForWindow(workspace: Workspace, targetWindow: Window): WorkspaceLeaf | null {
		let resolved: WorkspaceLeaf | null = null;
		workspace.iterateAllLeaves((leaf) => {
			if (resolved) {
				return;
			}
			const leafWindow = this.windowContextManager.getLeafWindow(leaf);
			if (leafWindow === targetWindow) {
				resolved = leaf;
			}
		});
		return resolved;
	}

	private createLeafInWindow(workspace: Workspace, targetWindow: Window): WorkspaceLeaf | null {
		try {
			const leaf = workspace.getLeaf(true);
			if (leaf) {
				logger.debug('createLeafInWindow via workspace.getLeaf(true)', this.describeLeaf(leaf));
				const leafWindow = this.windowContextManager.getLeafWindow(leaf);
				if (leafWindow && leafWindow !== targetWindow) {
					logger.warn('createLeafInWindow leaf belongs to another window', {
						targetWindow: this.describeWindow(targetWindow),
						leafWindow: this.describeWindow(leafWindow)
					});
				}
				return leaf;
			}
		} catch (error) {
			logger.warn('workspace.getLeaf(true) failed', error);
		}

		logger.debug('createLeafInWindow unavailable', this.describeWindow(targetWindow));
		return null;
	}

	private selectLeaf(workspace: Workspace, preferredWindow?: Window | null): WorkspaceLeaf | null {
		logger.debug('selectLeaf', {
			preferredWindow: this.describeWindow(preferredWindow),
			workspaceIsMain: workspace === this.app.workspace
		});

		const mostRecent = workspace.getMostRecentLeaf?.() ?? null;
		if (mostRecent && (!preferredWindow || this.windowContextManager.getLeafWindow(mostRecent) === preferredWindow)) {
			logger.debug('selectLeaf -> mostRecent');
			return mostRecent;
		}

		if (preferredWindow) {
			let candidate: WorkspaceLeaf | null = null;
			workspace.iterateAllLeaves((leaf) => {
				if (candidate) {
					return;
				}
				if (this.windowContextManager.getLeafWindow(leaf) === preferredWindow) {
					candidate = leaf;
				}
			});
			if (candidate) {
				logger.debug('selectLeaf -> candidateFromIteration', this.describeLeaf(candidate));
				return candidate;
			}
			return null;
		}

		const fallback = workspace.getLeaf(false);
		logger.debug('selectLeaf -> workspace.getLeaf(false)', this.describeLeaf(fallback));
		return fallback;
	}

	private describeLeaf(leaf: WorkspaceLeaf | null | undefined): Record<string, unknown> | null {
		if (!leaf) {
			return null;
		}

		let type: string | undefined;
		try {
			type = leaf.getViewState().type;
		} catch {
			type = undefined;
		}

		const leafWindow = this.windowContextManager.getLeafWindow(leaf);

		return {
			id: (leaf as any).id ?? undefined,
			type,
			window: this.describeWindow(leafWindow)
		};
	}

	private describeWindow(win: Window | null | undefined): Record<string, unknown> | null {
		return this.windowContextManager.describeWindow(win);
	}

	private findLeafForFile(file: TFile, type?: string, preferredWindow?: Window | null): WorkspaceLeaf | null {
		let match: WorkspaceLeaf | null = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (match) {
				return;
			}
			let viewType: string | undefined;
			try {
				viewType = leaf.getViewState().type;
			} catch {
				viewType = undefined;
			}
			if (type && viewType !== type) {
				return;
			}
			if (preferredWindow && this.windowContextManager.getLeafWindow(leaf) !== preferredWindow) {
				return;
			}

			let leafFile: TFile | null = null;
			const view = leaf.view;
			if (view instanceof TableView) {
				leafFile = view.file;
			} else {
				const possibleFile = (view as any)?.file;
				if (possibleFile instanceof TFile) {
					leafFile = possibleFile;
				}
			}

			if (leafFile?.path === file.path) {
				match = leaf;
			}
		});
		return match;
	}
}

