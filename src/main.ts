import { App, Menu, Plugin, TFile, Workspace, WorkspaceLeaf, WorkspaceWindow, MarkdownView } from 'obsidian';
import { TableView, TABLE_VIEW_TYPE } from './TableView';
import { debugLog, isDebugEnabled } from './utils/logger';

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

interface TileLineBaseSettings {
	fileViewPrefs: Record<string, 'markdown' | 'table'>;
}

const DEFAULT_SETTINGS: TileLineBaseSettings = {
	fileViewPrefs: {}
};

export default class TileLineBasePlugin extends Plugin {
	private readonly windowContexts = new Map<Window, WindowContext>();
	private readonly windowIds = new WeakMap<Window, string>();
	private mainContext: WindowContext | null = null;
	private settings: TileLineBaseSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();
		debugLog('========== Plugin onload 开始 ==========');
		debugLog('Registering TableView view');
		debugLog('TABLE_VIEW_TYPE =', TABLE_VIEW_TYPE);

		this.registerView(
			TABLE_VIEW_TYPE,
			(leaf) => {
				const leafWindow = this.getLeafWindow(leaf);
				debugLog('========== registerView 工厂函数被调用 ==========');
				debugLog('leaf:', this.describeLeaf(leaf));
				debugLog('leaf 所在窗口:', this.describeWindow(leafWindow));
				debugLog('leaf 所在窗口是否已注册:', this.windowContexts.has(leafWindow ?? window));

				const view = new TableView(leaf);
				debugLog('TableView 实例已创建');
				return view;
			}
		);
		debugLog('registerView 完成');

		this.mainContext = this.registerWindow(window) ?? { window, app: this.app };
		this.captureExistingWindows();

		this.registerEvent(
			this.app.workspace.on('file-open', (openedFile) => {
				debugLog('file-open event received', { file: openedFile?.path ?? null });
				if (openedFile instanceof TFile) {
					window.setTimeout(() => {
						void this.maybeSwitchToTableView(openedFile);
					}, 0);
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				const markdownView = leaf?.view instanceof MarkdownView ? leaf.view : null;
				const file = markdownView?.file ?? null;
				if (!file) {
					return;
				}

				if (!this.shouldAutoOpenForFile(file)) {
					return;
				}

				debugLog('active-leaf-change: auto switch candidate', {
					file: file.path,
					leaf: this.describeLeaf(leaf ?? null)
				});

				window.setTimeout(() => {
					void this.openTableView(file, {
						leaf: leaf ?? null,
						preferredWindow: this.getLeafWindow(leaf ?? null),
						workspace: this.getWorkspaceForLeaf(leaf ?? null) ?? this.app.workspace
					});
				}, 0);
			})
		);
		// 全局注册一次 file-menu 事件（不在 registerWindow 里重复注册）
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu: Menu, file: TFile) => {
				// 动态找到当前活跃窗口的 context
				const activeLeaf = this.app.workspace.activeLeaf;
				const activeWindow = this.getLeafWindow(activeLeaf) ?? window;
				const context = this.getWindowContext(activeWindow) ?? this.mainContext ?? { window, app: this.app };

				debugLog('file-menu 事件触发 (main console)');
				this.handleFileMenu(menu, file, context);
			})
		);

		this.addCommand({
			id: 'toggle-table-view',
			name: '切换 TileLineBase 表格视图',
			checkCallback: (checking: boolean) => {
				const activeLeaf = this.app.workspace.activeLeaf;
				debugLog('toggle-table-view command', {
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
				debugLog('========== WINDOW-OPEN EVENT ==========');
				debugLog('window:', this.describeWindow(win));

				// 探查 WorkspaceWindow 的 API
				debugLog('WorkspaceWindow 对象:', workspaceWindow);
				debugLog('WorkspaceWindow 可用属性:', Object.keys(workspaceWindow));
				debugLog('WorkspaceWindow 原型方法:', Object.getOwnPropertyNames(Object.getPrototypeOf(workspaceWindow)));

				// 验证 app 是否共享
				const winApp = (win as any).app;
				debugLog('win.app === this.app:', winApp === this.app);
				debugLog('win.app 存在:', !!winApp);

				// 尝试访问可能的 API
				if ('getRoot' in workspaceWindow) {
					try {
						const root = (workspaceWindow as any).getRoot();
						debugLog('workspaceWindow.getRoot() 成功:', root);
						debugLog('root 可用方法:', Object.getOwnPropertyNames(Object.getPrototypeOf(root)));

						// 尝试通过 root 获取 leaf
						if (typeof (root as any).getLeaf === 'function') {
							debugLog('root.getLeaf 方法存在');
						}
					} catch (e) {
						console.warn(LOG_PREFIX, 'workspaceWindow.getRoot() 失败:', e);
					}
				} else {
					debugLog('workspaceWindow 没有 getRoot 方法');
				}

				if ('activeLeaf' in workspaceWindow) {
					debugLog('workspaceWindow.activeLeaf:', (workspaceWindow as any).activeLeaf);
				} else {
					debugLog('workspaceWindow 没有 activeLeaf 属性');
				}

				// 测试 workspace.getLeaf 在哪个窗口创建 leaf
				debugLog('测试 workspace.getLeaf(true) 行为:');
				const beforeLeafCount = this.countLeaves();
				debugLog('创建前 leaf 总数:', beforeLeafCount);

				debugLog('========================================');

				this.registerWindow(win, workspaceWindow);
			})
		);

		this.registerEvent(
			this.app.workspace.on('window-close', (_workspaceWindow: WorkspaceWindow, win: Window) => {
				debugLog('window-close', {
					window: this.describeWindow(win)
				});
				this.unregisterWindow(win);
			})
		);
	}

	async onunload() {
		debugLog('Detaching all table views');
		this.app.workspace.detachLeavesOfType(TABLE_VIEW_TYPE);
	}

	private registerWindow(win: Window, workspaceWindow?: WorkspaceWindow): WindowContext | null {
		const existing = this.windowContexts.get(win);
		if (existing) {
			existing.workspaceWindow = workspaceWindow ?? existing.workspaceWindow;
			debugLog('registerWindow: 窗口已存在，更新 workspaceWindow', {
				window: this.describeWindow(win)
			});
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

		debugLog('========== registerWindow 新窗口 ==========');
		debugLog('window:', this.describeWindow(win));
		debugLog('windowContexts.size:', this.windowContexts.size);
		debugLog('==========================================');

		return context;
	}

	private unregisterWindow(win: Window) {
		if (this.windowContexts.delete(win)) {
			debugLog('unregisterWindow', {
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
		// 使用正确的窗口上下文输出日志
		const targetWindow = context.window;
		const debugEnabled = isDebugEnabled();
		const targetConsole = debugEnabled ? ((targetWindow as any).console || console) : null;

		// 在目标窗口的控制台输出（这样在弹出窗口右键时，日志会出现在弹出窗口的 DevTools）
		if (debugEnabled) {
			targetConsole?.log(LOG_PREFIX, '========== handleFileMenu 被调用 ==========');
		}
		if (debugEnabled) {
			targetConsole?.log(LOG_PREFIX, 'file:', file.path);
		}
		if (debugEnabled) {
			targetConsole?.log(LOG_PREFIX, 'context.window.isMain:', targetWindow === window);
		}

		// 同时在主窗口也输出一份（方便调试）
		if (debugEnabled) {
			debugLog('handleFileMenu 被调用 (context.window.isMain:', targetWindow === window, ')');
		}

		if (!(file instanceof TFile)) {
			if (debugEnabled) {
				targetConsole?.log(LOG_PREFIX, 'handleFileMenu: file is not TFile, returning');
			}
			return;
		}

		menu.addItem((item) => {
			if (debugEnabled) {
				targetConsole?.log(LOG_PREFIX, 'menu.addItem: 正在添加菜单项...');
			}

			const clickHandler = async (evt: MouseEvent) => {
				// onClick 时使用事件所在窗口的 console
				const eventWindow = (evt?.view as Window) || targetWindow;
				const eventConsole = debugEnabled ? ((eventWindow as any).console || console) : null;

				if (debugEnabled) {
					eventConsole?.log(LOG_PREFIX, '========== file-menu onClick 触发 ==========');
					eventConsole?.log(LOG_PREFIX, 'file:', file.path);
					eventConsole?.log(LOG_PREFIX, 'eventType:', evt?.type);
					eventConsole?.log(LOG_PREFIX, 'event.view === context.window:', evt?.view === context.window);
				}

				// 同时在主窗口也输出
				if (debugEnabled) {
					debugLog('onClick 触发 (event.view === context.window:', evt?.view === context.window, ')');
				}

				const resolution = this.resolveLeafFromEvent(evt, context);
				if (debugEnabled) {
					eventConsole?.log(LOG_PREFIX, 'onClick: resolution 结果:', {
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

				if (debugEnabled) {
					eventConsole?.log(LOG_PREFIX, '========== file-menu onClick 完成 ==========');
				}
			};

			item
				.setTitle('用 TileLineBase 表格打开')
				.setIcon('table')
				.onClick(clickHandler);

			if (debugEnabled) {
				targetConsole?.log(LOG_PREFIX, 'menu.addItem: 菜单项添加完成，onClick handler 已设置');
			}
		});
		if (debugEnabled) {
			targetConsole?.log(LOG_PREFIX, '========== handleFileMenu 完成 ==========');
		}
	}

	private async openTableView(file: TFile, options?: OpenContext) {
		const requestedLeaf = options?.leaf ?? null;
		const preferredWindow = options?.preferredWindow ?? this.getLeafWindow(requestedLeaf);
		const workspace = options?.workspace ?? this.getWorkspaceForLeaf(requestedLeaf) ?? this.app.workspace;

		debugLog('openTableView start', {
			file: file.path,
			requestedLeaf: this.describeLeaf(requestedLeaf),
			preferredWindow: this.describeWindow(preferredWindow),
			workspaceIsMain: workspace === this.app.workspace
		});

		let leaf = requestedLeaf;
		if (leaf && preferredWindow) {
			const leafWindow = this.getLeafWindow(leaf);
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
			console.warn(LOG_PREFIX, 'No leaf available, aborting openTableView');
			return;
		}

		debugLog('openTableView 即将调用 leaf.setViewState', {
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
			debugLog('openTableView setViewState 成功完成', this.describeLeaf(leaf));
			await this.updateFileViewPreference(file, 'table');
		} catch (error) {
			console.error(LOG_PREFIX, 'openTableView setViewState 失败:', error);
			throw error;
		}

		await workspace.revealLeaf(leaf);
		debugLog('openTableView finish');
	}

	private async toggleTableView(leaf: WorkspaceLeaf, context: WindowContext | null) {
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
				debugLog('createLeafInWindow via workspace.getLeaf(true)', this.describeLeaf(newLeaf));
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

		debugLog('createLeafInWindow unavailable', this.describeWindow(targetWindow));
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
		debugLog('selectLeaf', {
			preferredWindow: this.describeWindow(preferredWindow),
			workspaceIsMain: workspace === this.app.workspace
		});

		const activeLeaf = workspace.activeLeaf;
		if (activeLeaf && (!preferredWindow || this.getLeafWindow(activeLeaf) === preferredWindow)) {
			debugLog('selectLeaf -> activeLeaf');
			return activeLeaf;
		}

		const mostRecent = workspace.getMostRecentLeaf();
		if (mostRecent && (!preferredWindow || this.getLeafWindow(mostRecent) === preferredWindow)) {
			debugLog('selectLeaf -> mostRecent');
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

	private async maybeSwitchToTableView(file: TFile): Promise<void> {
		if (!this.shouldAutoOpenForFile(file)) {
			debugLog('maybeSwitchToTableView: skipped (preference not table)', { file: file.path });
			return;
		}

		const activeLeaf = this.app.workspace.activeLeaf;
		if (!activeLeaf) {
			debugLog('maybeSwitchToTableView: skipped (no active leaf)', { file: file.path });
			return;
		}

		const viewType = activeLeaf.getViewState().type;
		if (viewType === TABLE_VIEW_TYPE) {
			debugLog('maybeSwitchToTableView: already table view', { file: file.path });
			return;
		}

		if (viewType !== 'markdown' && viewType !== 'empty') {
			debugLog('maybeSwitchToTableView: skipped (current view not markdown/empty)', {
				file: file.path,
				viewType
			});
			return;
		}

		const preferredWindow = this.getLeafWindow(activeLeaf);
		const workspace = this.getWorkspaceForLeaf(activeLeaf) ?? this.app.workspace;

		try {
			debugLog('maybeSwitchToTableView: switching to table view', {
				file: file.path,
				targetLeaf: this.describeLeaf(activeLeaf)
			});
			await this.openTableView(file, {
				leaf: activeLeaf,
				preferredWindow,
				workspace
			});
		} catch (error) {
			console.error(LOG_PREFIX, '自动打开表格视图失败', error);
		}
	}

	private shouldAutoOpenForFile(file: TFile): boolean {
		return this.settings.fileViewPrefs[file.path] === 'table';
	}

	private async updateFileViewPreference(file: TFile, view: 'markdown' | 'table'): Promise<void> {
		const current = this.settings.fileViewPrefs[file.path];
		if (current === view) {
			return;
		}
		this.settings.fileViewPrefs[file.path] = view;
		await this.saveSettings();
		debugLog('updateFileViewPreference', { file: file.path, view });
	}

	private async loadSettings(): Promise<void> {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

		const legacyList = (data as { autoTableFiles?: unknown } | undefined)?.autoTableFiles;
		if (Array.isArray(legacyList)) {
			for (const path of legacyList) {
				if (typeof path === 'string') {
					this.settings.fileViewPrefs[path] = 'table';
				}
			}
			await this.saveData(this.settings);
		}
	}

	private async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private countLeaves(): number {
		let count = 0;
		this.app.workspace.iterateAllLeaves(() => {
			count++;
		});
		return count;
	}
}
