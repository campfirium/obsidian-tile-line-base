import { App, Menu, TFile, Workspace, WorkspaceLeaf } from 'obsidian';
import { TableView, TABLE_VIEW_TYPE } from '../TableView';
import { debugLog, isDebugEnabled } from '../utils/logger';
import type { SettingsService } from '../services/SettingsService';
import type { WindowContext, WindowContextManager } from './WindowContextManager';

export interface ViewOpenContext {
	leaf?: WorkspaceLeaf | null;
	preferredWindow?: Window | null;
	workspace?: Workspace | null;
}

export class ViewSwitchCoordinator {
	private readonly app: App;

	constructor(
		app: App,
		private readonly settingsService: SettingsService,
		private readonly windowContextManager: WindowContextManager,
		private readonly suppressAutoSwitchUntil: Map<string, number>
	) {
		this.app = app;
	}

	handleFileMenu(menu: Menu, file: TFile, context: WindowContext): void {
		const targetWindow = context.window;
		const debugEnabled = isDebugEnabled();
		const targetConsole = debugEnabled ? ((targetWindow as any).console || console) : null;

		if (!(file instanceof TFile)) {
			if (debugEnabled) {
				targetConsole?.log('[TileLineBase]', 'handleFileMenu: not a file target');
			}
			return;
		}

		menu.addItem((item) => {
			if (debugEnabled) {
				targetConsole?.log('[TileLineBase]', 'handleFileMenu: registering menu item');
			}

			const clickHandler = async (evt: MouseEvent) => {
				const eventWindow = (evt?.view as Window) || targetWindow;
				const eventConsole = debugEnabled ? ((eventWindow as any).console || console) : null;

				if (debugEnabled) {
					eventConsole?.log('[TileLineBase]', 'file-menu onClick', {
						file: file.path,
						eventType: evt?.type,
						sameWindow: evt?.view === context.window
					});
				}

				const resolution = this.resolveLeafFromEvent(evt, context);

				if (debugEnabled) {
					eventConsole?.log('[TileLineBase]', 'file-menu resolution', {
						leaf: this.describeLeaf(resolution.leaf),
						preferredWindow: this.describeWindow(resolution.preferredWindow),
						workspace: resolution.workspace === this.app.workspace ? 'main' : 'other'
					});
				}

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

			if (debugEnabled) {
				targetConsole?.log('[TileLineBase]', 'handleFileMenu: menu item ready');
			}
		});
	}

	async maybeSwitchToTableView(file: TFile): Promise<void> {
		const suppressUntil = this.suppressAutoSwitchUntil.get(file.path);
		if (suppressUntil && suppressUntil > Date.now()) {
			debugLog('maybeSwitchToTableView: suppressed due to manual switch', { file: file.path });
			return;
		}
		this.suppressAutoSwitchUntil.delete(file.path);

		if (!this.settingsService.shouldAutoOpen(file.path)) {
			debugLog('maybeSwitchToTableView: skipped preference', { file: file.path });
			return;
		}

		const activeLeaf = this.app.workspace.activeLeaf;
		if (!activeLeaf) {
			debugLog('maybeSwitchToTableView: no active leaf', { file: file.path });
			return;
		}

		const viewType = activeLeaf.getViewState().type;
		if (viewType === TABLE_VIEW_TYPE) {
			debugLog('maybeSwitchToTableView: already in table view', { file: file.path });
			return;
		}
		if (viewType !== 'markdown' && viewType !== 'empty') {
			debugLog('maybeSwitchToTableView: view type not eligible', { file: file.path, viewType });
			return;
		}

		const preferredWindow = this.windowContextManager.getLeafWindow(activeLeaf);
		const workspace = this.windowContextManager.getWorkspaceForLeaf(activeLeaf) ?? this.app.workspace;

		try {
			debugLog('maybeSwitchToTableView: switching', {
				file: file.path,
				targetLeaf: this.describeLeaf(activeLeaf)
			});
			await this.openTableView(file, { leaf: activeLeaf, preferredWindow, workspace });
		} catch (error) {
			console.error('[TileLineBase]', 'Failed to auto switch to table view', error);
		}
	}

	async openTableView(file: TFile, options?: ViewOpenContext): Promise<void> {
		const requestedLeaf = options?.leaf ?? null;
		const preferredWindow = options?.preferredWindow ?? this.windowContextManager.getLeafWindow(requestedLeaf);
		const workspace = options?.workspace ?? this.windowContextManager.getWorkspaceForLeaf(requestedLeaf) ?? this.app.workspace;

		if (requestedLeaf?.view instanceof TableView && requestedLeaf.view.file?.path === file.path) {
			debugLog('openTableView reuse requested table leaf', this.describeLeaf(requestedLeaf));
			await this.settingsService.setFileViewPreference(file.path, 'table');
			await workspace.revealLeaf(requestedLeaf);
			return;
		}

		const existingTableLeaf = this.findLeafForFile(file, TABLE_VIEW_TYPE, preferredWindow);
		if (existingTableLeaf) {
			debugLog('openTableView reuse existing table leaf', this.describeLeaf(existingTableLeaf));
			await this.settingsService.setFileViewPreference(file.path, 'table');
			if (requestedLeaf && requestedLeaf !== existingTableLeaf) {
				try {
					requestedLeaf.detach?.();
				} catch (error) {
					console.warn('[TileLineBase]', 'Failed to detach redundant leaf', this.describeLeaf(requestedLeaf), error);
				}
			}
			await workspace.revealLeaf(existingTableLeaf);
			return;
		}

		debugLog('openTableView start', {
			file: file.path,
			requestedLeaf: this.describeLeaf(requestedLeaf),
			preferredWindow: this.describeWindow(preferredWindow),
			workspaceIsMain: workspace === this.app.workspace
		});

		let leaf = requestedLeaf ?? this.findLeafForFile(file, undefined, preferredWindow) ?? null;
		if (leaf && preferredWindow) {
			const leafWindow = this.windowContextManager.getLeafWindow(leaf);
			if (leafWindow && leafWindow !== preferredWindow) {
				debugLog('requested leaf window mismatch', {
					requestedLeaf: this.describeLeaf(leaf),
					targetWindow: this.describeWindow(preferredWindow)
				});
				leaf = null;
			}
		}

		if (!leaf) {
			leaf = this.selectLeaf(workspace, preferredWindow);
			debugLog('openTableView selectLeaf result', this.describeLeaf(leaf));
		}

		if (!leaf && preferredWindow) {
			leaf = this.createLeafInWindow(workspace, preferredWindow);
			debugLog('openTableView createLeafInWindow result', this.describeLeaf(leaf));
		}

		if (!leaf) {
			leaf = this.selectLeaf(this.app.workspace);
			debugLog('openTableView global fallback leaf', this.describeLeaf(leaf));
		}

		if (!leaf) {
			console.warn('[TileLineBase]', 'No leaf available, aborting openTableView');
			return;
		}

		debugLog('openTableView preparing leaf.setViewState', {
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
			debugLog('openTableView setViewState completed', this.describeLeaf(leaf));
			await this.settingsService.setFileViewPreference(file.path, 'table');
		} catch (error) {
			console.error('[TileLineBase]', 'openTableView setViewState failed', error);
			throw error;
		}

		await workspace.revealLeaf(leaf);
		debugLog('openTableView finish');
	}

	async toggleTableView(leaf: WorkspaceLeaf, context: WindowContext | null): Promise<void> {
		const currentView = leaf.view;
		debugLog('toggleTableView', this.describeLeaf(leaf));

		if (currentView.getViewType() === TABLE_VIEW_TYPE) {
			const tableView = currentView as TableView;
			const file = tableView.file;

			if (file) {
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

		debugLog('resolveLeafFromEvent', {
			eventType: evt?.type,
			targetWindow: this.describeWindow(targetWindow),
			workspaceIsMain: workspace === this.app.workspace
		});

		if (!targetWindow) {
			const leaf = this.selectLeaf(workspace);
			debugLog('resolveLeafFromEvent default leaf', this.describeLeaf(leaf));
			return { leaf, preferredWindow: null, workspace };
		}

		const matched = this.findLeafForWindow(workspace, targetWindow);
		if (matched) {
			debugLog('resolveLeafFromEvent matched leaf', this.describeLeaf(matched));
			return { leaf: matched, preferredWindow: targetWindow, workspace };
		}

		const fallback = this.selectLeaf(workspace, targetWindow);
		debugLog('resolveLeafFromEvent fallback leaf', this.describeLeaf(fallback));
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
				debugLog('createLeafInWindow via workspace.getLeaf(true)', this.describeLeaf(leaf));
				const leafWindow = this.windowContextManager.getLeafWindow(leaf);
				if (leafWindow && leafWindow !== targetWindow) {
					console.warn('[TileLineBase]', 'createLeafInWindow leaf belongs to another window', {
						targetWindow: this.describeWindow(targetWindow),
						leafWindow: this.describeWindow(leafWindow)
					});
				}
				return leaf;
			}
		} catch (error) {
			console.warn('[TileLineBase]', 'workspace.getLeaf(true) failed', error);
		}

		debugLog('createLeafInWindow unavailable', this.describeWindow(targetWindow));
		return null;
	}

	private selectLeaf(workspace: Workspace, preferredWindow?: Window | null): WorkspaceLeaf | null {
		debugLog('selectLeaf', {
			preferredWindow: this.describeWindow(preferredWindow),
			workspaceIsMain: workspace === this.app.workspace
		});

		const activeLeaf = workspace.activeLeaf;
		if (activeLeaf && (!preferredWindow || this.windowContextManager.getLeafWindow(activeLeaf) === preferredWindow)) {
			debugLog('selectLeaf -> activeLeaf');
			return activeLeaf;
		}

		const mostRecent = workspace.getMostRecentLeaf();
		if (mostRecent && (!preferredWindow || this.windowContextManager.getLeafWindow(mostRecent) === preferredWindow)) {
			debugLog('selectLeaf -> mostRecent');
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
				debugLog('selectLeaf -> candidateFromIteration', this.describeLeaf(candidate));
				return candidate;
			}
			return null;
		}

		const fallback = workspace.getLeaf(false);
		debugLog('selectLeaf -> workspace.getLeaf(false)', this.describeLeaf(fallback));
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
			} else if ((view as any)?.file instanceof TFile) {
				leafFile = (view as any).file as TFile;
			}

			if (leafFile?.path === file.path) {
				match = leaf;
			}
		});
		return match;
	}
}

