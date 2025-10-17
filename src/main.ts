import { App, Menu, Plugin, TFile, Workspace, WorkspaceLeaf, WorkspaceWindow } from 'obsidian';
import { TableView, TABLE_VIEW_TYPE } from './TableView';

const LOG_PREFIX = '[TileLineBase]';

interface WindowContext {
	readonly window: Window;
	readonly app: App;
	workspaceWindow?: WorkspaceWindow;
}

interface OpenContext {
	leaf?: WorkspaceLeaf | null;
	preferredWindow?: Window | null;
	workspace?: Workspace | null;
}

export default class TileLineBasePlugin extends Plugin {
	private readonly windowContexts = new Map<Window, WindowContext>();
	private readonly windowIds = new WeakMap<Window, string>();
	private mainContext: WindowContext | null = null;

	async onload() {
		console.log(LOG_PREFIX, 'Registering TableView view');
		console.log(LOG_PREFIX, 'TABLE_VIEW_TYPE =', TABLE_VIEW_TYPE);
		this.registerView(
			TABLE_VIEW_TYPE,
			(leaf) => {
				console.log(LOG_PREFIX, 'Instantiate TableView', this.describeLeaf(leaf));
				return new TableView(leaf);
			}
		);

		this.mainContext = this.registerWindow(window) ?? { window, app: this.app };
		this.captureExistingWindows();

		this.addCommand({
			id: 'toggle-table-view',
			name: '切换 TileLineBase 表格视图',
			checkCallback: (checking: boolean) => {
				const activeLeaf = this.app.workspace.activeLeaf;
				console.log(LOG_PREFIX, 'toggle-table-view command', {
					checking,
					activeLeaf: this.describeLeaf(activeLeaf)
				});

				if (!activeLeaf) {
					return false;
				}

				if (!checking) {
					const leafWindow = this.getLeafWindow(activeLeaf);
					const context = this.getWindowContext(leafWindow) ?? this.mainContext;
					this.toggleTableView(activeLeaf, context);
				}
				return true;
			}
		});

		this.registerEvent(
			this.app.workspace.on('window-open', (workspaceWindow: WorkspaceWindow, win: Window) => {
				console.log(LOG_PREFIX, 'window-open', {
					window: this.describeWindow(win)
				});
				this.registerWindow(win, workspaceWindow);
			})
		);

		this.registerEvent(
			this.app.workspace.on('window-close', (_workspaceWindow: WorkspaceWindow, win: Window) => {
				console.log(LOG_PREFIX, 'window-close', {
					window: this.describeWindow(win)
				});
				this.unregisterWindow(win);
			})
		);
	}

	async onunload() {
		console.log(LOG_PREFIX, 'Detaching all table views');
		this.app.workspace.detachLeavesOfType(TABLE_VIEW_TYPE);
	}

	private registerWindow(win: Window, workspaceWindow?: WorkspaceWindow): WindowContext | null {
		const existing = this.windowContexts.get(win);
		if (existing) {
			existing.workspaceWindow = workspaceWindow ?? existing.workspaceWindow;
			return existing;
		}

		const winApp = (win as any).app as App | undefined;
		const app = winApp ?? this.app;
		if (!app) {
			console.warn(LOG_PREFIX, 'registerWindow: app not found', this.describeWindow(win));
			return null;
		}

		const context: WindowContext = { window: win, app, workspaceWindow };
		this.windowContexts.set(win, context);

		console.log(LOG_PREFIX, 'registerWindow', {
			window: this.describeWindow(win)
		});

		const fileMenuRef = app.workspace.on('file-menu', (menu: Menu, file: TFile) => {
			this.handleFileMenu(menu, file, context);
		});
		this.registerEvent(fileMenuRef);

		return context;
	}

	private unregisterWindow(win: Window) {
		if (this.windowContexts.delete(win)) {
			console.log(LOG_PREFIX, 'unregisterWindow', {
				window: this.describeWindow(win)
			});
		}
	}

	private captureExistingWindows(): void {
		const seen = new Set<Window>();
		this.app.workspace.iterateAllLeaves((leaf) => {
			const win = this.getLeafWindow(leaf);
			if (win && !seen.has(win)) {
				seen.add(win);
				this.registerWindow(win);
			}
		});
	}

	private handleFileMenu(menu: Menu, file: TFile, context: WindowContext): void {
		if (!(file instanceof TFile)) {
			return;
		}

		menu.addItem((item) => {
			item
				.setTitle('用 TileLineBase 表格打开')
				.setIcon('table')
				.onClick(async (evt) => {
					console.log(LOG_PREFIX, 'file-menu onClick triggered', {
						file: file.path,
						eventType: evt?.type,
						window: this.describeWindow(context.window)
					});

					const resolution = this.resolveLeafFromEvent(evt, context);
					await this.openTableView(file, {
						leaf: resolution.leaf,
						preferredWindow: resolution.preferredWindow ?? context.window,
						workspace: resolution.workspace ?? context.app.workspace
					});
				});
		});
	}

	private async openTableView(file: TFile, options?: OpenContext) {
		const requestedLeaf = options?.leaf ?? null;
		const preferredWindow = options?.preferredWindow ?? this.getLeafWindow(requestedLeaf);
		const workspace = options?.workspace ?? this.getWorkspaceForLeaf(requestedLeaf) ?? this.app.workspace;

		console.log(LOG_PREFIX, 'openTableView start', {
			file: file.path,
			requestedLeaf: this.describeLeaf(requestedLeaf),
			preferredWindow: this.describeWindow(preferredWindow),
			workspaceIsMain: workspace === this.app.workspace
		});

		let leaf = requestedLeaf;
		if (leaf && preferredWindow) {
			const leafWindow = this.getLeafWindow(leaf);
			if (leafWindow && leafWindow !== preferredWindow) {
				console.log(LOG_PREFIX, 'requested leaf window mismatch', {
					requestedLeaf: this.describeLeaf(leaf),
					targetWindow: this.describeWindow(preferredWindow)
				});
				leaf = null;
			}
		}

		if (!leaf) {
			leaf = this.selectLeaf(workspace, preferredWindow);
			console.log(LOG_PREFIX, 'openTableView selectLeaf result', this.describeLeaf(leaf));
		}

		if (!leaf && preferredWindow) {
			leaf = this.createLeafInWindow(workspace, preferredWindow);
			console.log(LOG_PREFIX, 'openTableView createLeafInWindow result', this.describeLeaf(leaf));
		}

		if (!leaf) {
			leaf = this.selectLeaf(this.app.workspace);
			console.log(LOG_PREFIX, 'openTableView global fallback leaf', this.describeLeaf(leaf));
		}

		if (!leaf) {
			console.warn(LOG_PREFIX, 'No leaf available, aborting openTableView');
			return;
		}

		await leaf.setViewState({
			type: TABLE_VIEW_TYPE,
			active: true,
			state: {
				filePath: file.path
			}
		});
		console.log(LOG_PREFIX, 'openTableView setViewState done', this.describeLeaf(leaf));

		await workspace.revealLeaf(leaf);
		console.log(LOG_PREFIX, 'openTableView finish');
	}

	private async toggleTableView(leaf: WorkspaceLeaf, context: WindowContext | null) {
		const currentView = leaf.view;
		console.log(LOG_PREFIX, 'toggleTableView', this.describeLeaf(leaf));

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
			}
		} else {
			const workspace = context?.app.workspace ?? this.getWorkspaceForLeaf(leaf) ?? this.app.workspace;
			const activeFile = workspace.getActiveFile();
			if (activeFile) {
				await this.openTableView(activeFile, {
					leaf,
					preferredWindow: this.getLeafWindow(leaf),
					workspace
				});
			}
		}
	}

	private resolveLeafFromEvent(evt: MouseEvent | KeyboardEvent | null | undefined, fallbackContext?: WindowContext | null): { leaf: WorkspaceLeaf | null; preferredWindow: Window | null; workspace: Workspace | null } {
		const targetWindow = this.getEventWindow(evt) ?? fallbackContext?.window ?? null;
		const context = (targetWindow ? this.getWindowContext(targetWindow) : null) ?? fallbackContext ?? this.mainContext;
		const workspace = context?.app.workspace ?? this.app.workspace;

		console.log(LOG_PREFIX, 'resolveLeafFromEvent', {
			eventType: evt?.type,
			targetWindow: this.describeWindow(targetWindow),
			workspaceIsMain: workspace === this.app.workspace
		});

		if (!targetWindow) {
			const leaf = this.selectLeaf(workspace);
			console.log(LOG_PREFIX, 'resolveLeafFromEvent default leaf', this.describeLeaf(leaf));
			return { leaf, preferredWindow: null, workspace };
		}

		const matched = this.findLeafForWindow(workspace, targetWindow);
		if (matched) {
			console.log(LOG_PREFIX, 'resolveLeafFromEvent matched leaf', this.describeLeaf(matched));
			return { leaf: matched, preferredWindow: targetWindow, workspace };
		}

		const fallback = this.selectLeaf(workspace, targetWindow);
		console.log(LOG_PREFIX, 'resolveLeafFromEvent fallback leaf', this.describeLeaf(fallback));
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
			const leafWindow = this.getLeafWindow(leaf);
			if (leafWindow === targetWindow) {
				resolved = leaf;
			}
		});
		return resolved;
	}

	private createLeafInWindow(workspace: Workspace, targetWindow: Window): WorkspaceLeaf | null {
		try {
			const newLeaf = workspace.getLeaf(true);
			if (newLeaf) {
				console.log(LOG_PREFIX, 'createLeafInWindow via workspace.getLeaf(true)', this.describeLeaf(newLeaf));
				const newLeafWindow = this.getLeafWindow(newLeaf);
				if (newLeafWindow && newLeafWindow !== targetWindow) {
					console.warn(LOG_PREFIX, 'createLeafInWindow leaf belongs to another window', {
						targetWindow: this.describeWindow(targetWindow),
						leafWindow: this.describeWindow(newLeafWindow)
					});
				}
				return newLeaf;
			}
		} catch (error) {
			console.warn(LOG_PREFIX, 'createLeafInWindow workspace.getLeaf(true) failed', error);
		}

		console.log(LOG_PREFIX, 'createLeafInWindow unavailable', this.describeWindow(targetWindow));
		return null;
	}

	private getLeafWindow(leaf: WorkspaceLeaf | null | undefined): Window | null {
		return leaf?.view?.containerEl?.ownerDocument?.defaultView ?? null;
	}

	private getWorkspaceForLeaf(leaf: WorkspaceLeaf | null | undefined): Workspace | null {
		const win = this.getLeafWindow(leaf);
		return this.getWindowContext(win)?.app.workspace ?? null;
	}

	private getWindowContext(win: Window | null | undefined): WindowContext | null {
		if (!win) {
			return null;
		}
		return this.windowContexts.get(win) ?? null;
	}

	private selectLeaf(workspace: Workspace, preferredWindow?: Window | null): WorkspaceLeaf | null {
		console.log(LOG_PREFIX, 'selectLeaf', {
			preferredWindow: this.describeWindow(preferredWindow),
			workspaceIsMain: workspace === this.app.workspace
		});

		const activeLeaf = workspace.activeLeaf;
		if (activeLeaf && (!preferredWindow || this.getLeafWindow(activeLeaf) === preferredWindow)) {
			console.log(LOG_PREFIX, 'selectLeaf -> activeLeaf');
			return activeLeaf;
		}

		const mostRecent = workspace.getMostRecentLeaf();
		if (mostRecent && (!preferredWindow || this.getLeafWindow(mostRecent) === preferredWindow)) {
			console.log(LOG_PREFIX, 'selectLeaf -> mostRecent');
			return mostRecent;
		}

		if (preferredWindow) {
			let candidate: WorkspaceLeaf | null = null;
			workspace.iterateAllLeaves((leaf) => {
				if (candidate) {
					return;
				}
				if (this.getLeafWindow(leaf) === preferredWindow) {
					candidate = leaf;
				}
			});
			if (candidate) {
				console.log(LOG_PREFIX, 'selectLeaf -> candidateFromIteration', this.describeLeaf(candidate));
				return candidate;
			}
			return null;
		}

		const fallback = workspace.getLeaf(false);
		console.log(LOG_PREFIX, 'selectLeaf -> workspace.getLeaf(false)', this.describeLeaf(fallback));
		return fallback;
	}

	private describeLeaf(leaf: WorkspaceLeaf | null | undefined): Record<string, unknown> | null {
		if (!leaf) {
			return null;
		}

		let type: string | undefined;
		try {
			type = leaf.getViewState().type;
		} catch (err) {
			type = undefined;
		}

		const leafWindow = this.getLeafWindow(leaf);

		return {
			id: (leaf as any).id ?? undefined,
			type,
			window: this.describeWindow(leafWindow)
		};
	}

	private describeWindow(win: Window | null | undefined): Record<string, unknown> | null {
		if (!win) {
			return null;
		}

		let href: string | undefined;
		try {
			href = win.location?.href;
		} catch (err) {
			href = undefined;
		}

		return {
			id: this.getWindowId(win),
			href,
			isMain: win === window,
			managed: this.windowContexts.has(win)
		};
	}

	private getWindowId(win: Window): string {
		let id = this.windowIds.get(win);
		if (!id) {
			id = `win-${Math.random().toString(36).slice(2, 8)}`;
			this.windowIds.set(win, id);
		}
		return id;
	}
}
