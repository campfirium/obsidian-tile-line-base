import { Menu, Plugin, TFile, WorkspaceLeaf, WorkspaceWindow, MarkdownView, Modal } from 'obsidian';
import { TableView, TABLE_VIEW_TYPE } from './TableView';
import { TableViewTitleRefresher } from './plugin/TableViewTitleRefresher';
import { TableCreationController } from './table-view/TableCreationController';
import { exportTableToCsv, importCsvAsNewTable, importTableFromCsv } from './table-view/TableCsvController';
import { applyStripeStyles } from './table-view/stripeStyles';
import { notifyNavigatorFocus } from './table-view/NavigatorDebugProbe';
import { syncGridContainerTheme, syncGridPopupRoot } from './grid/themeSync';
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
import { initializeDragDebugLog } from './utils/dragDebugLog';

const logger = getLogger('plugin:main');

interface StartupProfileEntry {
	label: string;
	elapsedMs: number;
	deltaMs: number;
}

function isStartupProfilingEnabled(): boolean {
	if (typeof window === 'undefined') {
		return false;
	}
	const scope = window as Window & { __TLB_STARTUP_PROFILE__?: boolean };
	if (scope.__TLB_STARTUP_PROFILE__) {
		return true;
	}
	try {
		return window.localStorage?.getItem('tlbStartupProfile') === '1';
	} catch {
		return false;
	}
}

function createStartupProfiler() {
	const enabled = isStartupProfilingEnabled();
	const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
	let last = start;
	const entries: StartupProfileEntry[] = [];
	const scope = typeof window !== 'undefined'
		? window as Window & { __TLB_STARTUP_PROFILE_ENTRIES__?: StartupProfileEntry[] }
		: null;

	const step = (label: string): void => {
		if (!enabled) {
			return;
		}
		const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
		const entry = {
			label,
			elapsedMs: now - start,
			deltaMs: now - last
		};
		last = now;
		entries.push(entry);
		if (scope) {
			scope.__TLB_STARTUP_PROFILE_ENTRIES__ = entries;
		}
		try {
			performance.mark(`tlb-startup:${label}`);
		} catch {
			// Performance marks are diagnostic-only.
		}
	};

	return { step };
}

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
	private navigatorCompatModalShown = false;

	async onload() {
		const startupProfile = createStartupProfiler();
		startupProfile.step('onload:start');
		setPluginContext(this);
		startupProfile.step('plugin-context');
		await initializeDragDebugLog(this);
		startupProfile.step('drag-debug-log');
		this.settingsService = new SettingsService(this);
		this.windowContextManager = new WindowContextManager(this.app);
		this.viewCoordinator = new ViewSwitchCoordinator(this.app, this.settingsService, this.windowContextManager, this.suppressAutoSwitchUntil);
		this.viewActionManager = new ViewActionManager(
			this.app,
			this.viewCoordinator,
			this.windowContextManager,
			() => this.isHideMarkdownViewButtonsEnabled()
		);
		this.tableTitleRefresher = new TableViewTitleRefresher(this.app, this.windowContextManager);
		this.rightSidebarController = new RightSidebarController(this.app);
		startupProfile.step('controllers-created');
		await this.loadSettings();
		startupProfile.step('settings-loaded');
		this.maybeNotifyNavigatorCompatibility();
		startupProfile.step('navigator-compat-checked');

		this.backupManager = new BackupManager({
			plugin: this,
			getSettings: () => this.settingsService.getBackupSettings()
		});
		startupProfile.step('backup-created');

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
		startupProfile.step('logging-configured');
		this.scheduleBackupInitialization(() => startupProfile.step('backup-initialized'));
		startupProfile.step('backup-scheduled');

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
		startupProfile.step('view-registered');

		this.mainContext = this.windowContextManager.registerWindow(window) ?? { window, app: this.app };
		this.windowContextManager.captureExistingWindows();
		this.viewActionManager.refreshAll();
		startupProfile.step('window-context-ready');

		this.app.workspace.onLayoutReady(() => {
			startupProfile.step('layout-ready:start');
			this.tableTitleRefresher.refreshAll();
			void this.applyLocaleSettings();
			startupProfile.step('layout-ready:scheduled');
		});
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.tableTitleRefresher.refreshAll();
				this.applyRightSidebarForLeaf(this.getMostRecentLeaf());
			})
		);
		this.registerNavigatorPluginListener();

		this.onboardingManager = new OnboardingManager({
			app: this.app,
			settingsService: this.settingsService,
			viewSwitch: this.viewCoordinator
		});
		await this.onboardingManager.runInitialOnboarding();
		startupProfile.step('onboarding-complete');

		this.registerEvent(this.app.workspace.on('file-open', (openedFile) => {
			logger.debug('file-open event received', { file: openedFile?.path ?? null });
			this.applyRightSidebarForLeaf(this.getMostRecentLeaf());
			if (openedFile instanceof TFile) {
				void this.viewCoordinator.maybeSwitchToTableView(openedFile);
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

			const tableView = leaf?.view instanceof TableView ? leaf.view : null;
			if (tableView?.file && this.getNavigatorCompatibilityEnabled()) {
				notifyNavigatorFocus(this.app, tableView.file);
			}

			const markdownView = leaf?.view instanceof MarkdownView ? leaf.view : null;
			const file = markdownView?.file ?? null;
			if (!file) {
				return;
			}
			if (this.getNavigatorCompatibilityEnabled()) {
				notifyNavigatorFocus(this.app, file);
			}

		}));
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.viewActionManager.refreshAll();
			})
		);
		this.registerEvent(
			this.app.workspace.on('css-change', () => {
				this.refreshTableVisualVars();
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
		this.addCommand({
			id: 'append-from-clipboard',
			name: t('commands.appendFromClipboard'),
			checkCallback: (checking: boolean) => {
				const view = this.getActiveTableView();
				const canAppend = Boolean(view?.file);
				if (checking) {
					return canAppend;
				}
				if (!view || !canAppend) {
					return false;
				}
				void view.appendFromClipboard();
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

		this.addSettingTab(new TileLineBaseSettingTab(this.app, this));
		this.applyRightSidebarForLeaf(this.getMostRecentLeaf());
		startupProfile.step('onload:end');
	}

	onunload(): void {
		setPluginContext(null);
		this.viewActionManager.clearInjectedActions();
		logger.info('Plugin unload: cleaning up resources');
		this.rightSidebarController.restoreIfNeeded();

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

	getGalleryFilterViewsForFile(filePath: string): FileFilterViewState {
		return this.settingsService.getGalleryFilterViewsForFile(filePath);
	}

	async saveGalleryFilterViewsForFile(filePath: string, state: FileFilterViewState): Promise<void> {
		const sanitized = await this.settingsService.saveGalleryFilterViewsForFile(filePath, state);
		logger.debug('saveGalleryFilterViewsForFile', {
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
		logger.debug('saveTagGroupsForFile', { filePath, groupCount: sanitized.groups.length, activeGroup: sanitized.activeGroupId });
	}

	getGalleryTagGroupsForFile(filePath: string): FileTagGroupState {
		return this.settingsService.getGalleryTagGroupsForFile(filePath);
	}

	async saveGalleryTagGroupsForFile(filePath: string, state: FileTagGroupState): Promise<void> {
		const sanitized = await this.settingsService.saveGalleryTagGroupsForFile(filePath, state);
		logger.debug('saveGalleryTagGroupsForFile', {
			filePath,
			groupCount: sanitized.groups.length,
			activeGroup: sanitized.activeGroupId
		});
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

	getDefaultGalleryCardSize(): { width: number; height: number } | null {
		return this.settingsService.getDefaultGalleryCardSize();
	}

	async setDefaultSlideConfig(config: SlideViewConfig | null): Promise<void> {
		await this.settingsService.setDefaultSlideConfig(config);
		this.settings = this.settingsService.getSettings();
	}

	async setDefaultGalleryConfig(
		config: SlideViewConfig | null,
		cardSize?: { width?: number | null; height?: number | null } | null
	): Promise<void> {
		await this.settingsService.setDefaultGalleryConfig(config, cardSize);
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

	isHideMarkdownViewButtonsEnabled(): boolean {
		return this.settingsService.getHideMarkdownViewButtons();
	}

	async setHideMarkdownViewButtonsEnabled(value: boolean): Promise<void> {
		const changed = await this.settingsService.setHideMarkdownViewButtons(value);
		if (!changed) {
			return;
		}
		this.settings = this.settingsService.getSettings();
		if (value) {
			this.viewActionManager.clearInjectedActions();
			return;
		}
		this.viewActionManager.refreshAll();
	}

	isSaveConfigBlockInNoteEnabled(): boolean {
		return this.settingsService.getSaveConfigBlockInNote();
	}

	async setSaveConfigBlockInNoteEnabled(value: boolean): Promise<void> {
		const changed = await this.settingsService.setSaveConfigBlockInNote(value);
		if (!changed) {
			return;
		}
		this.settings = this.settingsService.getSettings();
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
			const containers = Array.from(doc.querySelectorAll<HTMLElement>('.tlb-table-container'));
			if (containers.length === 0) {
				return;
			}
			containers.forEach((el) => {
				const { isDarkMode } = syncGridContainerTheme(el, { ownerDocument: doc });
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
				syncGridPopupRoot(el, { ownerDocument: doc, isDarkMode });
			});
		});
	}
	async toggleLeafView(leaf: WorkspaceLeaf): Promise<void> {
		const leafWindow = this.windowContextManager.getLeafWindow(leaf);
		const context = this.windowContextManager.getWindowContext(leafWindow) ?? this.mainContext;
		await this.viewCoordinator.toggleTableView(leaf, context ?? null);
		this.applyRightSidebarForLeaf(this.getMostRecentLeaf());
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

	setLoggingLevel(level: LogLevelName): Promise<void> {
		const current = this.settingsService.getLoggingConfig().globalLevel;
		if (current === level) {
			return Promise.resolve();
		}
		const config = setGlobalLogLevel(level);
		this.settings.logging = config;
		return Promise.resolve();
	}

	getNavigatorCompatibilityEnabled(): boolean {
		return this.settingsService.getNavigatorCompatibilityEnabled();
	}

	async setNavigatorCompatibilityEnabled(enabled: boolean): Promise<void> {
		const changed = await this.settingsService.setNavigatorCompatibilityEnabled(enabled);
		if (changed) {
			this.settings = this.settingsService.getSettings();
		}
	}

	private maybeNotifyNavigatorCompatibility(): void {
		if (this.navigatorCompatModalShown || this.settingsService.getNavigatorCompatNoticeShown()) {
			return;
		}
		const pluginManager = (this.app as { plugins?: { enabledPlugins?: Set<string>; on?: (event: string, handler: (pluginId: string) => void) => void; off?: (event: string, handler: (pluginId: string) => void) => void } }).plugins;
		if (!pluginManager?.enabledPlugins?.has?.('notebook-navigator')) {
			return;
		}
		if (!this.getNavigatorCompatibilityEnabled()) {
			return;
		}
		this.navigatorCompatModalShown = true;
		const modal = new NavigatorCompatModal(this.app, async () => {
			await this.settingsService.setNavigatorCompatNoticeShown(true);
		});
		modal.open();
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
		const workspaceWithRecent = this.app.workspace as typeof this.app.workspace & { getMostRecentLeaf?: () => WorkspaceLeaf | null };
		if (typeof workspaceWithRecent.getMostRecentLeaf === 'function') {
			return workspaceWithRecent.getMostRecentLeaf() ?? null;
		}
		return null;
	}

	private applyRightSidebarForLeaf(leaf: WorkspaceLeaf | null | undefined): void {
		this.rightSidebarController.applyForLeaf(leaf, this.isHideRightSidebarEnabled());
	}

	private registerNavigatorPluginListener(): void {
		const pluginManager = (this.app as { plugins?: { enabledPlugins?: Set<string>; on?: (event: string, handler: (pluginId: string) => void) => void; off?: (event: string, handler: (pluginId: string) => void) => void } }).plugins;
		if (!pluginManager || typeof pluginManager.on !== 'function') {
			return;
		}
		const handler = (pluginId: string) => {
			if (pluginId === 'notebook-navigator') {
				this.maybeNotifyNavigatorCompatibility();
			}
		};
		try {
			pluginManager.on('load', handler);
			this.register(() => {
				try {
					pluginManager.off?.('load', handler);
				} catch (error: unknown) {
					logger.debug('navigator-compat: failed to remove plugin-load listener', { error });
				}
			});
		} catch (error: unknown) {
			logger.debug('navigator-compat: plugin-load listener unavailable', { error });
		}
	}

	private scheduleBackupInitialization(onInitialized?: () => void): void {
		const schedule = () => {
			const handle = window.setTimeout(() => {
				const manager = this.backupManager;
				if (!manager) {
					return;
				}
				void manager.initialize()
					.then(() => {
						onInitialized?.();
					})
					.catch((error: unknown) => {
						logger.error('Failed to initialize backup manager', error);
						if (this.backupManager === manager) {
							this.backupManager = null;
						}
					});
			}, 1000);
			this.register(() => {
				window.clearTimeout(handle);
			});
		};
		this.app.workspace.onLayoutReady(schedule);
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
					} catch (error: unknown) {
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

class NavigatorCompatModal extends Modal {
	private readonly onResult: () => Promise<void> | void;

	constructor(app: Plugin['app'], onResult: () => Promise<void> | void) {
		super(app);
		this.onResult = onResult;
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		contentEl.empty();
		titleEl.setText(t('settings.navigatorCompatModalTitle'));

		const header = contentEl.createEl('h2', { text: t('settings.navigatorCompatModalHeading') });
		header.addClass('tlb-compat-title');

		const body = contentEl.createDiv({ cls: 'tlb-compat-body' });
		body.createEl('p', {
			text: t('settings.navigatorCompatModalBody1')
		});
		body.createEl('p', {
			text: t('settings.navigatorCompatModalBody2')
		});
		body.createEl('p', {
			text: t('settings.navigatorCompatModalBody3')
		}).addClass('mod-muted');
	}

	onClose(): void {
		void this.onResult();
		this.contentEl.empty();
	}
}
