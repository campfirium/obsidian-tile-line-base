/* eslint-disable max-lines */
import { Menu, Plugin, TFile, WorkspaceLeaf, WorkspaceWindow, MarkdownView } from 'obsidian';
import { TableView, TABLE_VIEW_TYPE } from './TableView';
import { TableViewTitleRefresher } from './plugin/TableViewTitleRefresher';
import { TableCreationController } from './table-view/TableCreationController';
import { exportTableToCsv, importCsvAsNewTable, importTableFromCsv } from './table-view/TableCsvController';
import { applyStripeStyles } from './table-view/stripeStyles';
import type { BorderColorMode, StripeColorMode } from './types/appearance';
import {
	applyLoggingConfig,
	getLogger,
	installLoggerConsoleBridge,
	setGlobalLogLevel,
	subscribeLoggingConfig
} from './utils/logger';
import { setPluginContext } from './pluginContext';
import type { FileFilterViewState } from './types/filterView';
import type { FileTagGroupState } from './types/tagGroup';
import type { KanbanBoardState } from './types/kanban';
import type { SlideViewConfig } from './types/slide';
import { SettingsService, DEFAULT_SETTINGS, TileLineBaseSettings } from './services/SettingsService';
import { BackupManager } from './services/BackupManager';
import { WindowContextManager } from './plugin/WindowContextManager';
import type { WindowContext } from './plugin/WindowContextManager';
import { registerViewCommands } from './plugin/registerViewCommands';
import { ViewSwitchCoordinator } from './plugin/ViewSwitchCoordinator';
import type { LogLevelName } from './utils/logger';
import { TileLineBaseSettingTab } from './settings/TileLineBaseSettingTab';
import { t, type LocaleCode } from './i18n';
import { ViewActionManager } from './plugin/ViewActionManager';
import { OnboardingManager } from './plugin/OnboardingManager';
import { snapshotLeaf } from './plugin/utils/snapshotLeaf';
import { syncLocale } from './plugin/LocaleSync';
import { RightSidebarController } from './plugin/RightSidebarController';
import { resolveEnvironmentLocale } from './i18n/localeEnvironment';
import { NavigatorCompatibilityPatcher } from './plugin/NavigatorCompatibilityPatcher';

const logger = getLogger('plugin:main');

export default class TileLineBasePlugin extends Plugin {
	private windowContextManager!: WindowContextManager;
	private mainContext: WindowContext | null = null;
	private settings: TileLineBaseSettings = DEFAULT_SETTINGS;
	private settingsService!: SettingsService;
	private suppressAutoSwitchUntil = new Map<string, number>();
	private viewCoordinator!: ViewSwitchCoordinator;
	private backupManager: BackupManager | null = null;
	private viewActionManager!: ViewActionManager;
	private tableTitleRefresher!: TableViewTitleRefresher;
	private unsubscribeLogging: (() => void) | null = null;
	private rightSidebarController!: RightSidebarController;
	private activeLocale: LocaleCode = 'en';
	private onboardingManager: OnboardingManager | null = null;
	private commandTableCreationController: TableCreationController | null = null;
	private navigatorCompatibilityPatcher: NavigatorCompatibilityPatcher | null = null;

	async onload() {
		setPluginContext(this);
		this.settingsService = new SettingsService(this);
		this.windowContextManager = new WindowContextManager(this.app);
		this.viewCoordinator = new ViewSwitchCoordinator(this.app, this.settingsService, this.windowContextManager, this.suppressAutoSwitchUntil);
		this.viewActionManager = new ViewActionManager(this.app, this.viewCoordinator, this.windowContextManager);
		this.tableTitleRefresher = new TableViewTitleRefresher(this.app, this.windowContextManager);
		this.rightSidebarController = new RightSidebarController(this.app);
		this.navigatorCompatibilityPatcher = new NavigatorCompatibilityPatcher(this.app, this.windowContextManager);
		await this.loadSettings();
		await this.updateLocalizedLocalePreferenceFromEnvironment();

		this.backupManager = new BackupManager({
			plugin: this,
			getSettings: () => this.settingsService.getBackupSettings()
		});
		try {
			await this.backupManager.initialize();
		} catch (error) {
			logger.error('Failed to initialize backup manager', error);
			this.backupManager = null;
		}

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

		logger.info('Plugin onload start');
		logger.debug('Registering TableView view', { viewType: TABLE_VIEW_TYPE });

		this.registerView(TABLE_VIEW_TYPE, (leaf) => {
			const leafWindow = this.windowContextManager.getLeafWindow(leaf);
			logger.debug('registerView factory invoked', {
				leaf: snapshotLeaf(this.windowContextManager, leaf),
				windowRegistered: this.windowContextManager.hasWindow(leafWindow ?? window)
			});

			const view = new TableView(leaf);
			logger.debug('TableView instance created');
			return view;
		});
		logger.debug('registerView completed');

		this.mainContext = this.windowContextManager.registerWindow(window) ?? { window, app: this.app };
		this.windowContextManager.captureExistingWindows();
		this.viewActionManager.refreshAll();
		this.navigatorCompatibilityPatcher?.enable();
		this.registerNavigatorPluginListener();

		this.app.workspace.onLayoutReady(() => {
			this.tableTitleRefresher.refreshAll();
			void this.applyLocaleSettings();
			void this.updateLocalizedLocalePreferenceFromEnvironment();
			this.navigatorCompatibilityPatcher?.enable();
		});
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.tableTitleRefresher.refreshAll();
			})
		);

		this.onboardingManager = new OnboardingManager({
			app: this.app,
			settingsService: this.settingsService,
			viewSwitch: this.viewCoordinator
		});
		await this.onboardingManager.runInitialOnboarding();

		this.registerEvent(this.app.workspace.on('file-open', (openedFile) => {
			logger.debug('file-open event received', { file: openedFile?.path ?? null });
			if (openedFile instanceof TFile) {
				window.setTimeout(() => {
					void this.viewCoordinator.maybeSwitchToTableView(openedFile);
				}, 0);
			}
		}));
		this.registerEvent(
			this.app.vault.on('rename', (abstractFile, oldPath) => {
				if (!(abstractFile instanceof TFile) || abstractFile.extension !== 'md') {
					return;
				}
				void this.settingsService
					.migrateFileScopedSettings(oldPath, abstractFile.path)
					.catch((error) => {
						logger.error('Failed to migrate file-scoped settings after rename', error);
					});
			})
		);
		this.registerEvent(
			this.app.vault.on('delete', (abstractFile) => {
				const targetPath = abstractFile?.path ?? '';
				if (!targetPath) {
					return;
				}
				if (abstractFile instanceof TFile && abstractFile.extension !== 'md') {
					return;
				}
				void this.settingsService
					.scheduleFileSettingsCleanup(targetPath)
					.catch((error) => {
						logger.error('Failed to schedule file-scoped settings cleanup after delete', error);
					});
			})
		);

		this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
			this.viewActionManager.ensureActionsForLeaf(leaf ?? null);
			this.applyRightSidebarForLeaf(leaf ?? null);

			const markdownView = leaf?.view instanceof MarkdownView ? leaf.view : null;
			const file = markdownView?.file ?? null;
			if (!file) {
				return;
			}

			const suppressUntil = this.suppressAutoSwitchUntil.get(file.path);
			if (suppressUntil && suppressUntil > Date.now()) {
				logger.debug('active-leaf-change: suppressed auto switch', { file: file.path });
				return;
			}
			this.suppressAutoSwitchUntil.delete(file.path);

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
					workspace: this.windowContextManager.getWorkspaceForLeaf(leaf ?? null) ?? this.app.workspace,
					trigger: 'auto' as const
				};
				void this.viewCoordinator.openTableView(file, openContext);
			}, 0);
		}));
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.viewActionManager.refreshAll();
			})
		);
		// Register file-menu handler once (avoid duplicate registration per window)
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu: Menu, file: TFile) => {
				const activeLeaf = this.getMostRecentLeaf();
				const activeWindow = this.windowContextManager.getLeafWindow(activeLeaf ?? null) ?? window;
				const context = this.windowContextManager.getWindowContext(activeWindow) ?? this.mainContext ?? { window, app: this.app };

				logger.debug('file-menu event received');
				this.viewCoordinator.handleFileMenu(menu, file, context);
			})
		);

		this.addCommand({
			id: 'toggle-table-view',
			name: t('commands.toggleTableView'),
			checkCallback: (checking: boolean) => {
				const activeLeaf = this.getMostRecentLeaf();
				logger.debug('toggle-table-view command', {
					checking,
					activeLeaf: snapshotLeaf(this.windowContextManager, activeLeaf)
				});

				if (!activeLeaf) {
					return false;
				}

				if (!checking) {
					void this.toggleLeafView(activeLeaf);
				}
				return true;
			}
		});
		registerViewCommands({
			addCommand: (config) => { this.addCommand(config); },
			getActiveTableView: () => this.getActiveTableView(),
			getActiveContext: () => ({
				leaf: this.getMostRecentLeaf(),
				activeFile: this.app.workspace.getActiveFile()
			}),
			openWithMode: (mode, file, leaf) => {
				const preferredWindow = this.windowContextManager.getLeafWindow(leaf ?? null);
				const workspace = this.windowContextManager.getWorkspaceForLeaf(leaf ?? null) ?? this.app.workspace;
				return this.viewCoordinator.openTableView(file, {
					leaf: leaf ?? undefined,
					preferredWindow,
					workspace,
					mode,
					trigger: 'manual'
				});
			}
		});

		this.addCommand({
			id: 'table-history-undo',
			name: t('commands.undoTableHistory'),
			checkCallback: (checking: boolean) => {
				const view = this.getActiveTableView();
				const canUndo = Boolean(view?.historyManager.canUndo());
				if (checking) {
					return canUndo;
				}
				if (canUndo && view) {
					view.historyManager.undo();
				}
				return canUndo;
			}
		});

		this.addCommand({
			id: 'table-history-redo',
			name: t('commands.redoTableHistory'),
			checkCallback: (checking: boolean) => {
				const view = this.getActiveTableView();
				const canRedo = Boolean(view?.historyManager.canRedo());
				if (checking) {
					return canRedo;
				}
				if (canRedo && view) {
					view.historyManager.redo();
				}
				return canRedo;
			}
		});

		this.addCommand({
			id: 'table-open-creation-modal',
			name: t('commands.createTable'),
			callback: () => {
				const activeView = this.getActiveTableView();
				if (activeView?.tableCreationController) {
					activeView.tableCreationController.openCreationModal(null);
					return;
				}
				this.getCommandTableCreationController().openCreationModal(null);
			}
		});
		this.addCommand({
			id: 'table-export-csv',
			name: t('commands.exportCsv'),
			checkCallback: (checking: boolean) => {
				const view = this.getActiveTableView();
				if (checking) return Boolean(view);
				if (!view) return false;
				void exportTableToCsv(view);
				return true;
			}
		});
		this.addCommand({
			id: 'table-import-csv',
			name: t('commands.importCsv'),
			checkCallback: (checking: boolean) => {
				const view = this.getActiveTableView();
				if (checking) return Boolean(view);
				if (!view) return false;
				void importTableFromCsv(view);
				return true;
			}
		});
		this.addCommand({
			id: 'table-import-csv-as-table',
			name: t('commands.importCsvAsTable'),
			callback: () => {
				importCsvAsNewTable(this.app, {
					referenceFile: this.app.workspace.getActiveFile() ?? null
				});
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

		this.addSettingTab(new TileLineBaseSettingTab(this.app, this));
		this.applyRightSidebarForLeaf(this.getMostRecentLeaf());
	}

	onunload(): void {
		setPluginContext(null);
		this.viewActionManager.clearInjectedActions();
		logger.info('Plugin unload: cleaning up resources');
		this.rightSidebarController.restoreIfNeeded();
		this.navigatorCompatibilityPatcher?.dispose();

		this.onboardingManager = null;
		this.commandTableCreationController = null;

		if (this.unsubscribeLogging) {
			this.unsubscribeLogging();
			this.unsubscribeLogging = null;
		}
	}

	getSettingsService(): SettingsService {
		return this.settingsService;
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
		logger.debug('saveFilterViewsForFile', { filePath, viewCount: sanitized.views.length, activeView: sanitized.activeViewId });
	}

	getTagGroupsForFile(filePath: string): FileTagGroupState {
		return this.settingsService.getTagGroupsForFile(filePath);
	}

	async saveTagGroupsForFile(filePath: string, state: FileTagGroupState): Promise<void> {
		const sanitized = await this.settingsService.saveTagGroupsForFile(filePath, state);
		logger.debug('saveTagGroupsForFile', { filePath, groupCount: sanitized.groups.length, activeGroup: sanitized.activeGroupId });
	}

	getKanbanBoardsForFile(filePath: string): KanbanBoardState {
		return this.settingsService.getKanbanBoardsForFile(filePath);
	}

	async saveKanbanBoardsForFile(filePath: string, state: KanbanBoardState): Promise<void> {
		const sanitized = await this.settingsService.saveKanbanBoardsForFile(filePath, state);
		logger.debug('saveKanbanBoardsForFile', { filePath, boardCount: sanitized.boards.length, activeBoard: sanitized.activeBoardId });
	}

	getDefaultSlideConfig(): SlideViewConfig | null {
		return this.settingsService.getDefaultSlideConfig();
	}

	getDefaultGalleryConfig(): SlideViewConfig | null {
		return this.settingsService.getDefaultGalleryConfig();
	}

	async setDefaultSlideConfig(config: SlideViewConfig | null): Promise<void> {
		await this.settingsService.setDefaultSlideConfig(config);
		this.settings = this.settingsService.getSettings();
	}

	async setDefaultGalleryConfig(config: SlideViewConfig | null): Promise<void> {
		await this.settingsService.setDefaultGalleryConfig(config);
		this.settings = this.settingsService.getSettings();
	}

	isHideRightSidebarEnabled(): boolean {
		return this.settings.hideRightSidebar === true;
	}

	async setHideRightSidebarEnabled(value: boolean): Promise<void> {
		const changed = await this.settingsService.setHideRightSidebar(value);
		if (!changed) { return; }
		this.settings = this.settingsService.getSettings();
		this.applyRightSidebarForLeaf(this.getMostRecentLeaf());
	}

	getStripeColorMode(): StripeColorMode {
		return this.settingsService.getStripeColorMode();
	}

	getStripeCustomColor(): string | null {
		return this.settingsService.getStripeCustomColor();
	}

	async setStripeColorMode(mode: StripeColorMode): Promise<void> {
		const changed = await this.settingsService.setStripeColorMode(mode);
		if (!changed) { return; }
		this.settings = this.settingsService.getSettings();
		this.refreshTableVisualVars();
	}

	async setStripeCustomColor(value: string | null): Promise<void> {
		const changed = await this.settingsService.setStripeCustomColor(value);
		if (!changed) { return; }
		this.settings = this.settingsService.getSettings();
		this.refreshTableVisualVars();
	}

	getBorderContrast(): number {
		return this.settingsService.getBorderContrast();
	}

	async setBorderContrast(value: number): Promise<void> {
		const changed = await this.settingsService.setBorderContrast(value);
		if (!changed) { return; }
		this.settings = this.settingsService.getSettings();
		this.refreshTableVisualVars();
	}

	getBorderColorMode(): BorderColorMode {
		return this.settingsService.getBorderColorMode();
	}

	getBorderCustomColor(): string | null {
		return this.settingsService.getBorderCustomColor();
	}

	async setBorderColorMode(mode: BorderColorMode): Promise<void> {
		const changed = await this.settingsService.setBorderColorMode(mode);
		if (!changed) { return; }
		this.settings = this.settingsService.getSettings();
		this.refreshTableVisualVars();
	}

	async setBorderCustomColor(value: string | null): Promise<void> {
		const changed = await this.settingsService.setBorderCustomColor(value);
		if (!changed) { return; }
		this.settings = this.settingsService.getSettings();
		this.refreshTableVisualVars();
	}

	private refreshTableVisualVars(): void {
		const border = this.settingsService.getBorderContrast();
		const stripeMode = this.settingsService.getStripeColorMode();
		const stripeCustom = this.settingsService.getStripeCustomColor();
		const borderMode = this.settingsService.getBorderColorMode();
		const borderCustom = this.settingsService.getBorderCustomColor();
		this.windowContextManager.forEachWindowContext((context) => {
			const doc = context.window?.document;
			if (!doc) return;
			const isDarkMode = doc.body.classList.contains('theme-dark');
			doc.querySelectorAll<HTMLElement>('.tlb-table-container').forEach((el) => {
				applyStripeStyles({
					container: el,
					ownerDocument: doc,
					stripeColorMode: stripeMode,
					stripeCustomColor: stripeCustom,
					borderColorMode: borderMode,
					borderCustomColor: borderCustom,
					borderContrast: border,
					isDarkMode
				});
			});
		});
	}
	async toggleLeafView(leaf: WorkspaceLeaf): Promise<void> {
		const leafWindow = this.windowContextManager.getLeafWindow(leaf);
		const context = this.windowContextManager.getWindowContext(leafWindow) ?? this.mainContext;
		await this.viewCoordinator.toggleTableView(leaf, context ?? null);
	}

	async openFileInTableView(file: TFile): Promise<void> {
		const activeLeaf = this.getMostRecentLeaf();
		const preferredWindow = this.windowContextManager.getLeafWindow(activeLeaf ?? null);
		const workspace = this.windowContextManager.getWorkspaceForLeaf(activeLeaf ?? null) ?? this.app.workspace;

		await this.viewCoordinator.openTableView(file, {
			leaf: activeLeaf,
			preferredWindow,
			workspace,
			trigger: 'manual'
		});
	}

	getBackupManager(): BackupManager | null {
		return this.backupManager;
	}

	isBackupEnabled(): boolean {
		return this.settingsService.getBackupSettings().enabled;
	}

	async setBackupEnabled(value: boolean): Promise<void> {
		const changed = await this.settingsService.setBackupEnabled(value);
		if (!changed) { return; }
		this.settings = this.settingsService.getSettings();
	}

	getBackupCapacityLimit(): number {
		return this.settingsService.getBackupSettings().maxSizeMB;
	}

	async setBackupCapacityLimit(value: number): Promise<void> {
		const changed = await this.settingsService.setBackupMaxSizeMB(value);
		if (!changed) { return; }
		this.settings = this.settingsService.getSettings();
		if (this.backupManager) {
			try {
				await this.backupManager.enforceCapacity();
			} catch (error) {
				logger.warn('Failed to enforce backup capacity after update', error);
			}
		}
	}

	getLoggingLevel(): LogLevelName {
		return this.settingsService.getLoggingConfig().globalLevel;
	}

	async setLoggingLevel(level: LogLevelName): Promise<void> {
		const current = this.settingsService.getLoggingConfig().globalLevel;
		if (current === level) {
			return;
		}
		const config = setGlobalLogLevel(level);
		this.settings.logging = config;
	}

	getLocaleOverride(): LocaleCode | null {
		return this.settingsService.getLocalePreference();
	}

	getLocalizedLocalePreference(): LocaleCode {
		return this.settingsService.getLocalizedLocalePreference();
	}

	async setLocaleOverride(locale: LocaleCode | null): Promise<void> {
		const changed = await this.settingsService.setLocalePreference(locale);
		if (!changed) {
			return;
		}
		this.settings = this.settingsService.getSettings();
		await this.applyLocaleSettings();
	}

	async useLocalizedLocalePreference(): Promise<void> {
		await this.setLocaleOverride(null);
	}

	getResolvedLocale(): LocaleCode {
		return this.activeLocale;
	}

	private getCommandTableCreationController(): TableCreationController {
		if (!this.commandTableCreationController) {
			this.commandTableCreationController = new TableCreationController({
				app: this.app,
				getCurrentFile: () => this.app.workspace.getActiveFile() ?? null
			});
		}
		return this.commandTableCreationController;
	}

	private getActiveTableView(): TableView | null {
		const view = this.app.workspace.getActiveViewOfType(TableView);
		return view ?? null;
	}

	private getMostRecentLeaf(): WorkspaceLeaf | null {
		const getLeaf = (this.app.workspace as any).getMostRecentLeaf;
		if (typeof getLeaf === 'function') {
			return getLeaf.call(this.app.workspace) ?? null;
		}
		return null;
	}

	private applyRightSidebarForLeaf(leaf: WorkspaceLeaf | null | undefined): void {
		this.rightSidebarController.applyForLeaf(leaf, this.isHideRightSidebarEnabled());
	}

	private registerNavigatorPluginListener(): void {
		const pluginManager = (this.app as any)?.plugins;
		if (!pluginManager || typeof pluginManager.on !== 'function') {
			return;
		}
		const handler = (pluginId: string) => {
			if (pluginId === 'notebook-navigator') {
				this.navigatorCompatibilityPatcher?.enable();
			}
		};
		try {
			pluginManager.on('load', handler);
			this.register(() => {
				try {
					pluginManager.off?.('load', handler);
				} catch (error) {
					logger.debug('navigator-compat: failed to remove plugin-load listener', error);
				}
			});
		} catch (error) {
			logger.debug('navigator-compat: plugin-load listener unavailable', { error });
		}
	}

	private async loadSettings(): Promise<void> {
		const loaded = await this.settingsService.load();
		this.settings = loaded;
		await this.applyLocaleSettings();
	}

	private async applyLocaleSettings(): Promise<void> {
		const result = syncLocale({
			app: this.app,
			settings: this.settings,
			titleRefresher: this.tableTitleRefresher ?? null,
			viewActionManager: this.viewActionManager ?? null
		});
		if (result.locale !== this.activeLocale) {
			this.activeLocale = result.locale;
			await this.refreshLocaleForOpenViews();
		}
		void this.updateLocalizedLocalePreferenceFromEnvironment();
	}

	private async refreshLocaleForOpenViews(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(TABLE_VIEW_TYPE);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof TableView) {
				try {
					await view.render();
				} catch (error) {
					logger.warn('Failed to refresh table view after locale change', {
						error,
						file: view.file?.path ?? null
					});
				}
			}
		}
	}

	private async updateLocalizedLocalePreferenceFromEnvironment(): Promise<void> {
		const autoLocale = this.getAutoLocaleCode();
		logger.info('localized-locale-update', {
			autoLocale,
			activeLocale: this.activeLocale,
			override: this.settings.locale ?? null
		});
		if (autoLocale === 'en') {
			return;
		}
		const changed = await this.settingsService.setLocalizedLocalePreference(autoLocale);
		if (changed) {
			this.settings = this.settingsService.getSettings();
		}
	}

	getAutoLocaleCode(): LocaleCode {
		const snapshot = { ...this.settings, locale: null };
		const result = resolveEnvironmentLocale(this.app, snapshot);
		logger.info('auto-locale-resolution', {
			settingsLocale: snapshot.locale ?? null,
			resolved: result.locale,
			candidates: result.candidates
		});
		return result.locale;
	}
}
