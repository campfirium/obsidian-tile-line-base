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
		console.log(LOG_PREFIX, '========== Plugin onload 开始 ==========');
		console.log(LOG_PREFIX, 'Registering TableView view');
		console.log(LOG_PREFIX, 'TABLE_VIEW_TYPE =', TABLE_VIEW_TYPE);

		this.registerView(
			TABLE_VIEW_TYPE,
			(leaf) => {
				const leafWindow = this.getLeafWindow(leaf);
				console.log(LOG_PREFIX, '========== registerView 工厂函数被调用 ==========');
				console.log(LOG_PREFIX, 'leaf:', this.describeLeaf(leaf));
				console.log(LOG_PREFIX, 'leaf 所在窗口:', this.describeWindow(leafWindow));
				console.log(LOG_PREFIX, 'leaf 所在窗口是否已注册:', this.windowContexts.has(leafWindow ?? window));

				const view = new TableView(leaf);
				console.log(LOG_PREFIX, 'TableView 实例已创建');
				return view;
			}
		);
		console.log(LOG_PREFIX, 'registerView 完成');

		this.mainContext = this.registerWindow(window) ?? { window, app: this.app };
		this.captureExistingWindows();

		// 全局注册一次 file-menu 事件（不在 registerWindow 里重复注册）
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu: Menu, file: TFile) => {
				// 动态找到当前活跃窗口的 context
				const activeLeaf = this.app.workspace.activeLeaf;
				const activeWindow = this.getLeafWindow(activeLeaf) ?? window;
				const context = this.getWindowContext(activeWindow) ?? this.mainContext ?? { window, app: this.app };

				console.log(LOG_PREFIX, 'file-menu 事件触发 (main console)');
				this.handleFileMenu(menu, file, context);
			})
		);

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
				console.log(LOG_PREFIX, '========== WINDOW-OPEN EVENT ==========');
				console.log(LOG_PREFIX, 'window:', this.describeWindow(win));

				// 探查 WorkspaceWindow 的 API
				console.log(LOG_PREFIX, 'WorkspaceWindow 对象:', workspaceWindow);
				console.log(LOG_PREFIX, 'WorkspaceWindow 可用属性:', Object.keys(workspaceWindow));
				console.log(LOG_PREFIX, 'WorkspaceWindow 原型方法:', Object.getOwnPropertyNames(Object.getPrototypeOf(workspaceWindow)));

				// 验证 app 是否共享
				const winApp = (win as any).app;
				console.log(LOG_PREFIX, 'win.app === this.app:', winApp === this.app);
				console.log(LOG_PREFIX, 'win.app 存在:', !!winApp);

				// 尝试访问可能的 API
				if ('getRoot' in workspaceWindow) {
					try {
						const root = (workspaceWindow as any).getRoot();
						console.log(LOG_PREFIX, 'workspaceWindow.getRoot() 成功:', root);
						console.log(LOG_PREFIX, 'root 可用方法:', Object.getOwnPropertyNames(Object.getPrototypeOf(root)));

						// 尝试通过 root 获取 leaf
						if (typeof (root as any).getLeaf === 'function') {
							console.log(LOG_PREFIX, 'root.getLeaf 方法存在');
						}
					} catch (e) {
						console.warn(LOG_PREFIX, 'workspaceWindow.getRoot() 失败:', e);
					}
				} else {
					console.log(LOG_PREFIX, 'workspaceWindow 没有 getRoot 方法');
				}

				if ('activeLeaf' in workspaceWindow) {
					console.log(LOG_PREFIX, 'workspaceWindow.activeLeaf:', (workspaceWindow as any).activeLeaf);
				} else {
					console.log(LOG_PREFIX, 'workspaceWindow 没有 activeLeaf 属性');
				}

				// 测试 workspace.getLeaf 在哪个窗口创建 leaf
				console.log(LOG_PREFIX, '测试 workspace.getLeaf(true) 行为:');
				const beforeLeafCount = this.countLeaves();
				console.log(LOG_PREFIX, '创建前 leaf 总数:', beforeLeafCount);

				console.log(LOG_PREFIX, '========================================');

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
			console.log(LOG_PREFIX, 'registerWindow: 窗口已存在，更新 workspaceWindow', {
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

		console.log(LOG_PREFIX, '========== registerWindow 新窗口 ==========');
		console.log(LOG_PREFIX, 'window:', this.describeWindow(win));
		console.log(LOG_PREFIX, 'windowContexts.size:', this.windowContexts.size);
		console.log(LOG_PREFIX, '==========================================');

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
		// 使用正确的窗口上下文输出日志
		const targetWindow = context.window;
		const targetConsole = (targetWindow as any).console || console;

		// 在目标窗口的控制台输出（这样在弹出窗口右键时，日志会出现在弹出窗口的 DevTools）
		targetConsole.log(LOG_PREFIX, '========== handleFileMenu 被调用 ==========');
		targetConsole.log(LOG_PREFIX, 'file:', file.path);
		targetConsole.log(LOG_PREFIX, 'context.window.isMain:', targetWindow === window);

		// 同时在主窗口也输出一份（方便调试）
		console.log(LOG_PREFIX, 'handleFileMenu 被调用 (context.window.isMain:', targetWindow === window, ')');

		if (!(file instanceof TFile)) {
			targetConsole.log(LOG_PREFIX, 'handleFileMenu: file is not TFile, returning');
			return;
		}

		menu.addItem((item) => {
			targetConsole.log(LOG_PREFIX, 'menu.addItem: 正在添加菜单项...');

			const clickHandler = async (evt: MouseEvent) => {
				// onClick 时使用事件所在窗口的 console
				const eventWindow = (evt?.view as Window) || targetWindow;
				const eventConsole = (eventWindow as any).console || console;

				eventConsole.log(LOG_PREFIX, '========== file-menu onClick 触发 ==========');
				eventConsole.log(LOG_PREFIX, 'file:', file.path);
				eventConsole.log(LOG_PREFIX, 'eventType:', evt?.type);
				eventConsole.log(LOG_PREFIX, 'event.view === context.window:', evt?.view === context.window);

				// 同时在主窗口也输出
				console.log(LOG_PREFIX, 'onClick 触发 (event.view === context.window:', evt?.view === context.window, ')');

				const resolution = this.resolveLeafFromEvent(evt, context);
				eventConsole.log(LOG_PREFIX, 'onClick: resolution 结果:', {
					leaf: this.describeLeaf(resolution.leaf),
					preferredWindow: this.describeWindow(resolution.preferredWindow),
					workspace: resolution.workspace === this.app.workspace ? 'main' : 'other'
				});

				await this.openTableView(file, {
					leaf: resolution.leaf,
					preferredWindow: resolution.preferredWindow ?? context.window,
					workspace: resolution.workspace ?? context.app.workspace
				});

				eventConsole.log(LOG_PREFIX, '========== file-menu onClick 完成 ==========');
			};

			item
				.setTitle('用 TileLineBase 表格打开')
				.setIcon('table')
				.onClick(clickHandler);

			targetConsole.log(LOG_PREFIX, 'menu.addItem: 菜单项添加完成，onClick handler 已设置');
		});
		targetConsole.log(LOG_PREFIX, '========== handleFileMenu 完成 ==========');
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

		console.log(LOG_PREFIX, 'openTableView 即将调用 leaf.setViewState', {
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
			console.log(LOG_PREFIX, 'openTableView setViewState 成功完成', this.describeLeaf(leaf));
		} catch (error) {
			console.error(LOG_PREFIX, 'openTableView setViewState 失败:', error);
			throw error;
		}

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

	private countLeaves(): number {
		let count = 0;
		this.app.workspace.iterateAllLeaves(() => {
			count++;
		});
		return count;
	}
}
