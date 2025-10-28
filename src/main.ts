import { Menu, Notice, Plugin, TFile, WorkspaceLeaf, WorkspaceWindow, MarkdownView } from 'obsidian';
import { TableView, TABLE_VIEW_TYPE } from './TableView';
import { EditorConfigBlockController } from './editor/EditorConfigBlockController';
import { EditorHiddenFieldsController } from './editor/EditorHiddenFieldsController';
import {
	applyLoggingConfig,
	getLogger,
	getLoggingConfig,
	installLoggerConsoleBridge,
	setGlobalLogLevel,
	subscribeLoggingConfig
} from './utils/logger';
import { setPluginContext } from './pluginContext';
import type { FileFilterViewState } from './types/filterView';
import type { FileTagGroupState } from './types/tagGroup';
import { FileCacheManager } from './cache/FileCacheManager';
import { SettingsService, DEFAULT_SETTINGS, TileLineBaseSettings } from './services/SettingsService';
import { WindowContextManager } from './plugin/WindowContextManager';
import type { WindowContext } from './plugin/WindowContextManager';
import { ViewSwitchCoordinator } from './plugin/ViewSwitchCoordinator';
import type { LogLevelName } from './utils/logger';
import { TileLineBaseSettingTab } from './settings/TileLineBaseSettingTab';
import { registerCollapsedFieldPresenter } from './plugin/CollapsedFieldPresenter';

const logger = getLogger('plugin:main');
const VERBOSITY_SEQUENCE: LogLevelName[] = ['warn', 'info', 'debug', 'trace'];

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
	private editorConfigController: EditorConfigBlockController | null = null;
	private editorHiddenFieldsController: EditorHiddenFieldsController | null = null;
	public cacheManager: FileCacheManager | null = null;
	private unsubscribeLogging: (() => void) | null = null;
	private rightSidebarState = { applied: false, wasCollapsed: false };

	async onload() {
		setPluginContext(this);
		this.settingsService = new SettingsService(this);
		this.windowContextManager = new WindowContextManager(this.app);
		this.viewCoordinator = new ViewSwitchCoordinator(this.app, this.settingsService, this.windowContextManager, this.suppressAutoSwitchUntil);
		this.editorConfigController = new EditorConfigBlockController(this.app);
		this.editorHiddenFieldsController = new EditorHiddenFieldsController(this.app);
		await this.loadSettings();

		applyLoggingConfig(this.settings.logging);
		this.unsubscribeLogging = subscribeLoggingConfig((config) => {
			this.settingsService.saveLoggingConfig(config).catch((error) => {
				logger.error('Failed to persist logging configuration', error);
			});
		});
		this.register(() => {
			if (this.unsubscribeLogging) {
				this.unsubscribeLogging();
				this.unsubscribeLogging = null;
			}
		});
		installLoggerConsoleBridge();

		// Initialise cache manager
		this.cacheManager = new FileCacheManager(this);
		await this.cacheManager.load();

		registerCollapsedFieldPresenter(this);

		logger.info('Plugin onload start');
		logger.debug('Registering TableView view', { viewType: TABLE_VIEW_TYPE });

		this.registerView(
			TABLE_VIEW_TYPE,
			(leaf) => {
				const leafWindow = this.windowContextManager.getLeafWindow(leaf);
				logger.debug('registerView factory invoked', {
					leaf: snapshotLeaf(this.windowContextManager, leaf),
					windowRegistered: this.windowContextManager.hasWindow(leafWindow ?? window)
				});

				const view = new TableView(leaf);
				logger.debug('TableView instance created');
				return view;
			}
		);
		logger.debug('registerView completed');

		this.mainContext = this.windowContextManager.registerWindow(window) ?? { window, app: this.app };
		this.windowContextManager.captureExistingWindows();

		this.registerEvent(
			this.app.workspace.on('file-open', (openedFile) => {
				logger.debug('file-open event received', { file: openedFile?.path ?? null });
				if (openedFile instanceof TFile) {
					window.setTimeout(() => {
						void this.viewCoordinator.maybeSwitchToTableView(openedFile);
					}, 0);
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				this.applyRightSidebarForLeaf(leaf ?? null);

				const markdownView = leaf?.view instanceof MarkdownView ? leaf.view : null;
				const file = markdownView?.file ?? null;
				if (!file) {
					return;
				}

				if (!this.settingsService.shouldAutoOpen(file.path)) {
					return;
				}

				logger.debug('active-leaf-change: auto switch candidate', {
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

				logger.debug('file-menu event received');
				this.viewCoordinator.handleFileMenu(menu, file, context);
			})
		);

		this.addCommand({
			id: 'toggle-table-view',
			name: 'Toggle TileLineBase table view',
			checkCallback: (checking: boolean) => {
				const activeLeaf = this.app.workspace.activeLeaf;
				logger.debug('toggle-table-view command', {
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
				logger.debug('window-open', { window: this.windowContextManager.describeWindow(win) });
				this.windowContextManager.registerWindow(win, workspaceWindow);
			})
		);

		this.registerEvent(
			this.app.workspace.on('window-close', (_workspaceWindow: WorkspaceWindow, win: Window) => {
				logger.debug('window-close', { window: this.windowContextManager.describeWindow(win) });
				this.windowContextManager.unregisterWindow(win);
			})
		);

		this.addCommand({
			id: 'cycle-logging-verbosity',
			name: 'Cycle TileLineBase logging verbosity',
			callback: () => this.cycleLoggingVerbosity()
		});

		this.addSettingTab(new TileLineBaseSettingTab(this.app, this));
		if (this.editorConfigController) {
			this.editorConfigController.start(this);
		}
		if (this.editorHiddenFieldsController) {
			this.editorHiddenFieldsController.start(this);
		}
		this.applyRightSidebarForLeaf(this.app.workspace.activeLeaf ?? null);
	}

	async onunload() {
		setPluginContext(null);
		logger.info('Plugin unload: detaching all table views');
		this.restoreRightSidebarIfNeeded();
		this.app.workspace.detachLeavesOfType(TABLE_VIEW_TYPE);

		if (this.editorConfigController) {
			this.editorConfigController.dispose();
			this.editorConfigController = null;
		}

		if (this.editorHiddenFieldsController) {
			this.editorHiddenFieldsController.dispose();
			this.editorHiddenFieldsController = null;
		}

		if (this.unsubscribeLogging) {
			this.unsubscribeLogging();
			this.unsubscribeLogging = null;
		}
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
			logger.debug('updateColumnWidthPreference', { filePath, field, width: rounded });
		}
	}

	getFilterViewsForFile(filePath: string): FileFilterViewState {
		return this.settingsService.getFilterViewsForFile(filePath);
	}

	async saveFilterViewsForFile(filePath: string, state: FileFilterViewState): Promise<void> {
		const sanitized = await this.settingsService.saveFilterViewsForFile(filePath, state);
		logger.debug('saveFilterViewsForFile', {
			filePath,
			viewCount: sanitized.views.length,
			activeView: sanitized.activeViewId
		});
	}

	getTagGroupsForFile(filePath: string): FileTagGroupState {
		return this.settingsService.getTagGroupsForFile(filePath);
	}

	async saveTagGroupsForFile(filePath: string, state: FileTagGroupState): Promise<void> {
		const sanitized = await this.settingsService.saveTagGroupsForFile(filePath, state);
		logger.debug('saveTagGroupsForFile', {
			filePath,
			groupCount: sanitized.groups.length,
			activeGroup: sanitized.activeGroupId
		});
	}

	isHideRightSidebarEnabled(): boolean {
		return this.settings.hideRightSidebar === true;
	}

	async setHideRightSidebarEnabled(value: boolean): Promise<void> {
		const changed = await this.settingsService.setHideRightSidebar(value);
		if (!changed) {
			return;
		}
		this.settings = this.settingsService.getSettings();
		this.applyRightSidebarForLeaf(this.app.workspace.activeLeaf ?? null);
	}

	private async loadSettings(): Promise<void> {
		this.settings = await this.settingsService.load();
	}

	private async saveSettings(): Promise<void> {
		await this.settingsService.persist();
		this.settings = this.settingsService.getSettings();
	}

	private cycleLoggingVerbosity(): void {
		const current = getLoggingConfig().globalLevel;
		const index = VERBOSITY_SEQUENCE.indexOf(current);
		const next = VERBOSITY_SEQUENCE[(index + 1) % VERBOSITY_SEQUENCE.length];
		setGlobalLogLevel(next);
		new Notice(`TileLineBase logging level: ${next.toUpperCase()}`);
	}

	private applyRightSidebarForLeaf(leaf: WorkspaceLeaf | null | undefined): void {
		if (!this.isHideRightSidebarEnabled()) {
			this.restoreRightSidebarIfNeeded();
			return;
		}

		const isTableView = leaf?.view instanceof TableView;
		if (isTableView) {
			this.hideRightSidebar();
		} else {
			this.restoreRightSidebarIfNeeded();
		}
	}

	private hideRightSidebar(): void {
		const split = this.getRightSplit();
		if (!split) {
			return;
		}
		const wasCollapsed = this.isRightSplitCollapsed(split);
		if (wasCollapsed) {
			this.rightSidebarState = { applied: false, wasCollapsed: true };
			return;
		}

		if (typeof split.collapse === 'function') {
			try {
				split.collapse();
				this.rightSidebarState = { applied: true, wasCollapsed };
				return;
			} catch (error) {
				logger.warn('Failed to collapse right sidebar via API', error);
			}
		}

		const toggled = this.toggleRightSidebarViaCommand();
		this.rightSidebarState = { applied: toggled, wasCollapsed };
	}

	private restoreRightSidebarIfNeeded(): void {
		if (!this.rightSidebarState.applied) {
			return;
		}
		const split = this.getRightSplit();
		if (!split) {
			this.rightSidebarState = { applied: false, wasCollapsed: false };
			return;
		}
		if (!this.rightSidebarState.wasCollapsed) {
			if (typeof split.expand === 'function') {
				try {
					split.expand();
				} catch (error) {
					logger.warn('Failed to expand right sidebar via API', error);
					this.toggleRightSidebarViaCommand();
				}
			} else {
				this.toggleRightSidebarViaCommand();
			}
		}
		this.rightSidebarState = { applied: false, wasCollapsed: false };
	}

	private getRightSplit(): { collapsed?: boolean; collapse?: () => void; expand?: () => void } | null {
		const workspaceAny = this.app.workspace as unknown as { rightSplit?: { collapsed?: boolean; collapse?: () => void; expand?: () => void } };
		return workspaceAny?.rightSplit ?? null;
	}

	private isRightSplitCollapsed(split: { collapsed?: boolean }): boolean {
		if (typeof split?.collapsed === 'boolean') {
			return split.collapsed;
		}
		return false;
	}

	private toggleRightSidebarViaCommand(): boolean {
		const beforeSplit = this.getRightSplit();
		const before = beforeSplit ? this.isRightSplitCollapsed(beforeSplit) : undefined;
		const commandManager = (this.app as any).commands;
		const executed = typeof commandManager?.executeCommandById === 'function'
			? commandManager.executeCommandById('workspace:toggle-right-sidebar')
			: false;
		const afterSplit = this.getRightSplit();
		const after = afterSplit ? this.isRightSplitCollapsed(afterSplit) : undefined;
		if (executed) {
			return true;
		}
		return before !== after;
	}

}
