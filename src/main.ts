import { Menu, Plugin, TFile, WorkspaceLeaf, WorkspaceWindow, MarkdownView } from 'obsidian';
import { TableView, TABLE_VIEW_TYPE } from './TableView';
import { debugLog } from './utils/logger';
import { setPluginContext } from './pluginContext';
import type { FileFilterViewState } from './types/filterView';
import { FileCacheManager } from './cache/FileCacheManager';
import { SettingsService, DEFAULT_SETTINGS, TileLineBaseSettings } from './services/SettingsService';
import { WindowContextManager } from './plugin/WindowContextManager';
import type { WindowContext } from './plugin/WindowContextManager';
import { ViewSwitchCoordinator } from './plugin/ViewSwitchCoordinator';

function snapshotLeaf(manager: WindowContextManager, leaf: WorkspaceLeaf | null | undefined): Record<string, unknown> | null {
	if (!leaf) {
		return null;
	}
	let type: string | undefined;
	try {
		type = leaf.getViewState().type;
	} catch {
		type = undefined;
	}
	const leafWindow = manager.getLeafWindow(leaf);
	return {
		id: (leaf as any).id ?? undefined,
		type,
		window: manager.describeWindow(leafWindow)
	};
}

export default class TileLineBasePlugin extends Plugin {
	private windowContextManager!: WindowContextManager;
	private mainContext: WindowContext | null = null;
	private settings: TileLineBaseSettings = DEFAULT_SETTINGS;
	private settingsService!: SettingsService;
	private suppressAutoSwitchUntil = new Map<string, number>();
	private viewCoordinator!: ViewSwitchCoordinator;
	public cacheManager: FileCacheManager | null = null;

	async onload() {
		setPluginContext(this);
		this.settingsService = new SettingsService(this);
		this.windowContextManager = new WindowContextManager(this.app);
		this.viewCoordinator = new ViewSwitchCoordinator(this.app, this.settingsService, this.windowContextManager, this.suppressAutoSwitchUntil);
		await this.loadSettings();

		// Initialise cache manager
		this.cacheManager = new FileCacheManager(this);
		await this.cacheManager.load();

		debugLog('========== Plugin onload start ==========');
		debugLog('Registering TableView view');
		debugLog('TABLE_VIEW_TYPE =', TABLE_VIEW_TYPE);

		this.registerView(
			TABLE_VIEW_TYPE,
			(leaf) => {
				const leafWindow = this.windowContextManager.getLeafWindow(leaf);
				debugLog('========== registerView factory invoked ==========' );
				debugLog('leaf snapshot', snapshotLeaf(this.windowContextManager, leaf));
				debugLog('leaf window already registered:', this.windowContextManager.hasWindow(leafWindow ?? window));

				const view = new TableView(leaf);
				debugLog('TableView instance created');
				return view;
			}
		);
		debugLog('registerView completed');

		this.mainContext = this.windowContextManager.registerWindow(window) ?? { window, app: this.app };
		this.windowContextManager.captureExistingWindows();

		this.registerEvent(
			this.app.workspace.on('file-open', (openedFile) => {
				debugLog('file-open event received', { file: openedFile?.path ?? null });
				if (openedFile instanceof TFile) {
					window.setTimeout(() => {
						void this.viewCoordinator.maybeSwitchToTableView(openedFile);
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

				if (!this.settingsService.shouldAutoOpen(file.path)) {
					return;
				}

				debugLog('active-leaf-change: auto switch candidate', {
					file: file.path,
					leaf: snapshotLeaf(this.windowContextManager, leaf ?? null)
				});

				window.setTimeout(() => {
					const openContext = {
						leaf: leaf ?? null,
						preferredWindow: this.windowContextManager.getLeafWindow(leaf ?? null),
						workspace: this.windowContextManager.getWorkspaceForLeaf(leaf ?? null) ?? this.app.workspace
					};
					void this.viewCoordinator.openTableView(file, openContext);
				}, 0);
			})
		);
		// Register file-menu handler once (avoid duplicate registration per window)
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu: Menu, file: TFile) => {
				const activeLeaf = this.app.workspace.activeLeaf;
				const activeWindow = this.windowContextManager.getLeafWindow(activeLeaf) ?? window;
				const context = this.windowContextManager.getWindowContext(activeWindow) ?? this.mainContext ?? { window, app: this.app };

				debugLog('file-menu event received');
				this.viewCoordinator.handleFileMenu(menu, file, context);
			})
		);

		this.addCommand({
			id: 'toggle-table-view',
			name: 'Toggle TileLineBase table view',
			checkCallback: (checking: boolean) => {
				const activeLeaf = this.app.workspace.activeLeaf;
				debugLog('toggle-table-view command', {
					checking,
					activeLeaf: snapshotLeaf(this.windowContextManager, activeLeaf)
				});

				if (!activeLeaf) {
					return false;
				}

				if (!checking) {
					const leafWindow = this.windowContextManager.getLeafWindow(activeLeaf);
					const context = this.windowContextManager.getWindowContext(leafWindow) ?? this.mainContext;
					void this.viewCoordinator.toggleTableView(activeLeaf, context ?? null);
				}
				return true;
			}
		});

		this.registerEvent(
			this.app.workspace.on('window-open', (workspaceWindow: WorkspaceWindow, win: Window) => {
				debugLog('window-open', { window: this.windowContextManager.describeWindow(win) });
				this.windowContextManager.registerWindow(win, workspaceWindow);
			})
		);

		this.registerEvent(
			this.app.workspace.on('window-close', (_workspaceWindow: WorkspaceWindow, win: Window) => {
				debugLog('window-close', { window: this.windowContextManager.describeWindow(win) });
				this.windowContextManager.unregisterWindow(win);
			})
		);
	}

	async onunload() {
		setPluginContext(null);
		debugLog('Detaching all table views');
		this.app.workspace.detachLeavesOfType(TABLE_VIEW_TYPE);
	}

	getColumnLayout(filePath: string): Record<string, number> | undefined {
		return this.settingsService.getColumnLayout(filePath);
	}

	updateColumnWidthPreference(filePath: string, field: string, width: number): void {
		if (!filePath || !field || Number.isNaN(width)) {
			return;
		}
		const rounded = Math.round(width);
		const changed = this.settingsService.updateColumnWidthPreference(filePath, field, width);
		if (changed) {
			debugLog('updateColumnWidthPreference', { filePath, field, width: rounded });
		}
	}

	getFilterViewsForFile(filePath: string): FileFilterViewState {
		return this.settingsService.getFilterViewsForFile(filePath);
	}

	async saveFilterViewsForFile(filePath: string, state: FileFilterViewState): Promise<void> {
		const sanitized = await this.settingsService.saveFilterViewsForFile(filePath, state);
		debugLog('saveFilterViewsForFile', {
			filePath,
			viewCount: sanitized.views.length,
			activeView: sanitized.activeViewId
		});
	}

	private async loadSettings(): Promise<void> {
		this.settings = await this.settingsService.load();
	}

	private async saveSettings(): Promise<void> {
		await this.settingsService.persist();
		this.settings = this.settingsService.getSettings();
	}

}
