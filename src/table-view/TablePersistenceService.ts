import type { App } from 'obsidian';
import { Notice, TFile } from 'obsidian';
import type { FileFilterViewState } from '../types/filterView';
import type { FileTagGroupState } from '../types/tagGroup';
import type { TableDataStore } from './TableDataStore';
import type { ColumnLayoutStore } from './ColumnLayoutStore';
import type { TableConfigData, TableConfigManager } from './TableConfigManager';
import type { FilterStateStore } from './filter/FilterStateStore';
import type { BackupManager } from '../services/BackupManager';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';
import { getPluginContext } from '../pluginContext';
import type { KanbanBoardState, KanbanHeightMode, KanbanSortDirection } from '../types/kanban';
import {
	DEFAULT_KANBAN_FONT_SCALE,
	DEFAULT_KANBAN_HEIGHT_MODE,
	DEFAULT_KANBAN_SORT_DIRECTION
} from '../types/kanban';
import type { SlideViewConfig } from '../types/slide';
import { isDefaultSlideViewConfig, normalizeSlideViewConfig } from '../types/slide';
import { buildConfigCalloutBlock, hasConfigBlock, stripExistingConfigBlock } from './config/ConfigBlockIO';

import { mergeConfigEdits, runConfigOperation } from './config/ConfigOperations';

const logger = getLogger('table-view:persistence');

interface TablePersistenceDeps {
	app: App;
	dataStore: TableDataStore;
	columnLayoutStore: ColumnLayoutStore;
	configManager: TableConfigManager;
	filterStateStore: FilterStateStore;
	galleryFilterStateStore?: FilterStateStore;
	getFile: () => TFile | null;
	getFilterViewState: () => FileFilterViewState;
	getTagGroupState: () => FileTagGroupState;
	getGalleryFilterViewState?: () => FileFilterViewState;
	getGalleryTagGroupState?: () => FileTagGroupState;
	getCopyTemplate: () => string | null;
	isCopyTemplateLoaded?: () => boolean;
	getPersistedCopyTemplate?: (filePath: string) => string | null;
	getBackupManager: () => BackupManager | null;
	getViewPreference: () => 'table' | 'kanban' | 'slide' | 'gallery';
	getKanbanConfig: () => {
		laneField: string | null;
		sortField: string | null;
		sortDirection: KanbanSortDirection | null;
		heightMode: KanbanHeightMode | null;
		fontScale: number | null;
		multiRow: boolean | null;
	} | null;
	getKanbanBoards?: () => KanbanBoardState | null;
	getSlideConfig?: () => SlideViewConfig | null;
	getGalleryConfig?: () => SlideViewConfig | null;
	getGalleryViews?: () => { views: Array<{ id: string; name: string; template: SlideViewConfig; cardWidth?: number | null; cardHeight?: number | null; groupField?: string | null }>; activeViewId: string | null } | null;
	getGlobalSlideConfig?: () => SlideViewConfig | null;
	getGlobalGalleryConfig?: () => SlideViewConfig | null;
	markSelfMutation?: (file: TFile) => void;
	replaceConversionBaseline?: (content: string) => void;
	shouldAllowSave?: () => boolean;
	onSaveSettled?: () => void;
	getSaveDelayMs?: () => number;
}

/**
 * 统一管理 Markdown 与配置块的加载/保存，并提供去抖写入能力。
 */
export class TablePersistenceService {
	private saveTimeout: number | null = null;
	private pendingSave = false;
	private saveTask: Promise<void> | null = null;
	private saveVersion = 0;
	private disposed = false;
	private configBaseline: TableConfigData | null = null;
	private configBaselinePath: string | null = null;
	private configTasks = new Set<Promise<void>>();

	constructor(private readonly deps: TablePersistenceDeps) {}

	async loadConfig(file: TFile | null = this.deps.getFile()): Promise<TableConfigData | null> {
		if (!file) {
			return null;
		}
		return this.deps.configManager.load(file);
	}

	scheduleSave(): void {
		if (this.disposed) return;
		if (this.deps.shouldAllowSave && !this.deps.shouldAllowSave()) {
			logger.debug('scheduleSave:blocked');
			return;
		}
		if (this.saveTimeout !== null) {
			window.clearTimeout(this.saveTimeout);
		}
		this.pendingSave = true;
		this.saveVersion += 1;
		if (this.saveTask) return;
		const delay = this.deps.getSaveDelayMs?.() ?? 500;
		this.saveTimeout = window.setTimeout(() => {
			this.saveTimeout = null;
			void this.save();
		}, delay);
	}

	cancelScheduledSave(options?: { resolvePending?: boolean; suppressCallback?: boolean }): void {
		if (this.saveTimeout !== null) {
			window.clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
		}
		if (options?.resolvePending === false) {
			return;
		}
		if (this.pendingSave) {
			this.pendingSave = false;
			if (!options?.suppressCallback) {
				this.deps.onSaveSettled?.();
			}
		}
	}

	hasPendingSave(): boolean {
		return this.pendingSave || this.saveTask !== null || this.configTasks.size > 0;
	}

	async save(): Promise<void> {
		if (this.disposed) return;
		await Promise.all([...this.configTasks]);
		this.cancelScheduledSave({ resolvePending: false });
		this.pendingSave = true;
		this.saveVersion += 1;
		if (!this.saveTask) {
			// Drain edits made during any awaited backup, note, or config write.
			this.saveTask = Promise.resolve().then(async () => {
				try {
					do {
						const version = this.saveVersion;
						await this.saveSnapshot(version);
						if (version === this.saveVersion) break;
					} while (this.pendingSave && !this.disposed);
				} finally {
					// Settle in the same microtask as the version check, leaving no
					// gap in which a new edit could join an already completed writer.
					this.saveTask = null;
					this.cancelScheduledSave();
				}
			});
		}
		await this.saveTask;
	}

	private async saveSnapshot(version: number): Promise<void> {
		if (this.deps.shouldAllowSave && !this.deps.shouldAllowSave()) {
			logger.debug('save:blocked');
			this.cancelScheduledSave();
			return;
		}
		this.pendingSave = true;

		const file = this.deps.getFile();
		if (!file) {
			this.cancelScheduledSave();
			return;
		}
		const path = file.path;
		const targetFile = this.deps.app.vault.getAbstractFileByPath(path);
		if (!(targetFile instanceof TFile) || targetFile !== file) {
			logger.warn('save:aborted file missing or replaced', { path: file.path });
			this.cancelScheduledSave();
			return;
		}

		try {
			const localPayload = this.getConfigPayload();
			const markdown = this.deps.dataStore.blocksToMarkdown().trimEnd();
			await runConfigOperation(path, async () => {
				const configPayload = this.mergeLatestConfig(file, localPayload);
				const backupManager = this.deps.getBackupManager();
				if (backupManager) {
					try {
						await backupManager.ensureBackup(
							targetFile,
							this.buildPersistedContent(markdown, configPayload, this.shouldPersistConfigBlockInNote())
						);
					} catch (error) {
						logger.warn('Backup snapshot failed before save', error);
					}
				}
				if (this.disposed || file.path !== path || this.deps.getFile() !== targetFile ||
					this.deps.app.vault.getAbstractFileByPath(targetFile.path) !== targetFile) return;
				const nextContent = this.buildPersistedContent(markdown, configPayload, this.shouldPersistConfigBlockInNote());
				await this.deps.app.vault.process(targetFile, current => {
					if (current !== nextContent) this.deps.markSelfMutation?.(targetFile);
					return nextContent;
				});
				await this.saveConfigState(targetFile, configPayload);
				await this.deps.configManager.acknowledgeContent(targetFile, nextContent);
				// Replacing the baseline clears the session's dirty flag, so only the
				// newest fully persisted snapshot may acknowledge user mutations.
				if (version === this.saveVersion && this.deps.getFile() === targetFile && !this.disposed) {
					this.deps.replaceConversionBaseline?.(nextContent);
					this.configBaseline = localPayload;
				}
			});
		} catch (error) {
			logger.error('Failed to save file', error);
			new Notice(t('tablePersistence.saveFailed'));
		}
	}

	getConfigPayload(): TableConfigData {
		const copyTemplateLoaded = this.deps.isCopyTemplateLoaded?.() ?? true;
		let copyTemplate: string | null | undefined = this.deps.getCopyTemplate?.() ?? null;
		if (!copyTemplateLoaded) {
			const filePath = this.deps.getFile()?.path ?? null;
			copyTemplate =
				filePath && this.deps.getPersistedCopyTemplate
					? this.deps.getPersistedCopyTemplate(filePath) ?? undefined
					: undefined;
		}
		const schema = this.deps.dataStore.getSchema();
		const serializedColumnConfigs = schema?.columnConfigs
			?.filter((config) => this.deps.dataStore.hasColumnConfigContent(config))
			?.map((config) => this.deps.dataStore.serializeColumnConfig(config));
		const columnConfigs =
			serializedColumnConfigs && serializedColumnConfigs.length > 0 ? serializedColumnConfigs : null;

		const viewPreference = this.deps.getViewPreference?.() ?? 'table';
		const kanbanConfig = this.deps.getKanbanConfig?.();
		const laneField = kanbanConfig?.laneField ?? null;
		const sortField = kanbanConfig?.sortField ?? null;
		const sortDirection = kanbanConfig?.sortDirection ?? null;
		const heightMode = kanbanConfig?.heightMode ?? null;
		const fontScale = kanbanConfig?.fontScale ?? null;
		const multiRow = kanbanConfig?.multiRow ?? null;
		const kanbanBoards = this.deps.getKanbanBoards?.() ?? null;
		const hasKanbanBoards =
			kanbanBoards != null &&
			Array.isArray(kanbanBoards.boards) &&
			kanbanBoards.boards.length > 0;

		const slideConfig = this.deps.getSlideConfig?.() ?? null;
		const normalizedSlideConfig = slideConfig ? normalizeSlideViewConfig(slideConfig) : null;
		const globalSlideConfig = this.deps.getGlobalSlideConfig?.() ?? null;
		const normalizedGlobalSlideConfig = globalSlideConfig ? normalizeSlideViewConfig(globalSlideConfig) : null;
		const matchesGlobalSlideConfig =
			normalizedSlideConfig && normalizedGlobalSlideConfig
				? JSON.stringify(normalizedSlideConfig) === JSON.stringify(normalizedGlobalSlideConfig)
				: false;
		const hasSlideConfig = normalizedSlideConfig && !isDefaultSlideViewConfig(normalizedSlideConfig) && !matchesGlobalSlideConfig;
		const galleryConfig = this.deps.getGalleryConfig?.() ?? null;
		const normalizedGalleryConfig = galleryConfig ? normalizeSlideViewConfig(galleryConfig) : null;
		const galleryViews = this.deps.getGalleryViews?.() ?? null;
			const normalizedGalleryViews = galleryViews && Array.isArray(galleryViews.views) && galleryViews.views.length > 0
			? {
				activeViewId: galleryViews.activeViewId ?? null,
				views: galleryViews.views.map((entry) => ({
					...entry,
					template: normalizeSlideViewConfig(entry.template ?? null),
					cardWidth: typeof entry.cardWidth === 'number' ? entry.cardWidth : undefined,
					cardHeight: typeof entry.cardHeight === 'number' ? entry.cardHeight : undefined,
					groupField: typeof (entry as { groupField?: unknown }).groupField === 'string'
						? ((entry as { groupField: string }).groupField.trim() || undefined)
						: undefined
				}))
			}
			: null;
		const activeGalleryTemplate = normalizedGalleryViews
			? normalizedGalleryViews.views.find((entry) => entry.id === normalizedGalleryViews.activeViewId)?.template || normalizedGalleryViews.views[0]?.template || null
			: normalizedGalleryConfig;
		const globalGalleryConfig = this.deps.getGlobalGalleryConfig?.() ?? null;
		const normalizedGlobalGalleryConfig = globalGalleryConfig ? normalizeSlideViewConfig(globalGalleryConfig) : null;
		const matchesGlobalGalleryConfig =
			activeGalleryTemplate && normalizedGlobalGalleryConfig
				? JSON.stringify(activeGalleryTemplate) === JSON.stringify(normalizedGlobalGalleryConfig)
				: false;
		const hasGalleryConfig =
			activeGalleryTemplate && !isDefaultSlideViewConfig(activeGalleryTemplate) && !matchesGlobalGalleryConfig;

		return {
			filterViews: this.deps.filterStateStore.getPersistableState(),
			tagGroups: this.deps.getTagGroupState(),
			galleryFilterViews: this.deps.galleryFilterStateStore?.getPersistableState()
				?? (this.deps.getGalleryFilterViewState ? this.deps.getGalleryFilterViewState() : undefined),
			galleryTagGroups: this.deps.getGalleryTagGroupState ? this.deps.getGalleryTagGroupState() : undefined,
			columnWidths: this.deps.columnLayoutStore.exportPreferences(),
			columnConfigs,
			viewPreference,
			copyTemplate,
			kanban:
				laneField && laneField.trim().length > 0
					? {
							laneField,
							sortField: sortField && sortField.trim().length > 0 ? sortField : undefined,
							sortDirection:
								sortDirection && sortDirection !== DEFAULT_KANBAN_SORT_DIRECTION
									? sortDirection
									: undefined,
							heightMode: heightMode && heightMode !== DEFAULT_KANBAN_HEIGHT_MODE ? heightMode : undefined,
							fontScale:
								typeof fontScale === 'number' && Math.abs(fontScale - DEFAULT_KANBAN_FONT_SCALE) > 0.001
								? fontScale
								: undefined,
							multiRow: multiRow === false ? false : undefined
						}
					: undefined,
			kanbanBoards: hasKanbanBoards ? kanbanBoards : undefined,
			slide: hasSlideConfig ? normalizedSlideConfig : undefined,
			gallery: hasGalleryConfig ? activeGalleryTemplate : undefined,
			galleryViews: normalizedGalleryViews ?? undefined
		};
	}

	beginConfigEdit(): () => void {
		const snapshot = structuredClone(this.getConfigPayload());
		const file = this.deps.getFile();
		return () => {
			if (this.deps.getFile() === file) {
				this.configBaseline = snapshot;
				this.configBaselinePath = file?.path ?? null;
			}
		};
	}

	captureConfigBaseline(): void {
		if (!this.hasPendingSave()) {
			this.configBaseline = this.getConfigPayload();
			this.configBaselinePath = this.deps.getFile()?.path ?? null;
		}
	}

	private mergeLatestConfig(file: TFile, local: TableConfigData): TableConfigData {
		if (!this.configBaseline || this.configBaselinePath !== file.path) return local;
		return mergeConfigEdits(this.configBaseline, local, this.deps.configManager.getStoredConfig(file) ?? {});
	}

	async saveConfig(options: { writeNote: boolean } = { writeNote: true }): Promise<void> {
		const file = this.deps.getFile();
		if (!file || this.disposed) return;
		const path = file.path;
		const local = this.getConfigPayload();
		const task = runConfigOperation(path, async () => {
			if (this.disposed || this.deps.getFile() !== file || file.path !== path ||
				this.deps.app.vault.getAbstractFileByPath(path) !== file) return;
			const payload = this.mergeLatestConfig(file, local);
			await this.saveConfigState(file, payload);
			if (options.writeNote && this.deps.getFile() === file && !this.disposed &&
				this.deps.app.vault.getAbstractFileByPath(path) === file) {
				let written = '';
				await this.deps.app.vault.process(file, current => {
					written = this.buildConfigOnlyPersistedContent(current, payload, this.shouldPersistConfigBlockInNote());
					if (written !== current) this.deps.markSelfMutation?.(file);
					return written;
				});
				await this.deps.configManager.acknowledgeContent(file, written);
			}
			if (this.deps.getFile() === file) this.configBaseline = local;
		});
		this.configTasks.add(task);
		try {
			await task;
		} catch (error) {
			logger.error('Failed to save config', error);
			if (options.writeNote) new Notice(t('tablePersistence.saveFailed'));
		} finally {
			this.configTasks.delete(task);
			this.deps.onSaveSettled?.();
		}
	}

	private async saveConfigState(file: TFile, payload: TableConfigData): Promise<void> {
		await this.deps.configManager.save(file, payload);
	}

	private shouldPersistConfigBlockInNote(): boolean {
		const plugin = getPluginContext();
		return plugin?.getSettingsService().getSaveConfigBlockInNote() === true;
	}

	private buildPersistedContent(markdown: string, payload: TableConfigData, includeConfigBlock: boolean): string {
		const segments: string[] = [];
		if (markdown.trim().length > 0) {
			segments.push(markdown);
		}
		if (includeConfigBlock) {
			segments.push(buildConfigCalloutBlock(payload));
		}
		return `${segments.join('\n\n').trimEnd()}\n`;
	}

	private buildConfigOnlyPersistedContent(content: string, payload: TableConfigData, includeConfigBlock: boolean): string {
		if (!includeConfigBlock && !hasConfigBlock(content)) return content;
		const identity = this.deps.configManager.getContentIdentity(content);
		const candidate = buildConfigCalloutBlock(payload);
		if (includeConfigBlock && identity !== null && identity === this.deps.configManager.getContentIdentity(candidate)) return content;
		const stripped = stripExistingConfigBlock(content);
		if (!includeConfigBlock && stripped === content && identity === null) return content;
		const base = stripped.trimEnd();
		if (!includeConfigBlock) {
			return `${base}\n`;
		}
		const configBlock = candidate;
		if (base.length === 0) {
			return `${configBlock}\n`;
		}
		return `${base}\n\n${configBlock}\n`;
	}

	getMarkdownSnapshot(): string {
		return this.deps.dataStore.blocksToMarkdown().trimEnd();
	}

	dispose(): void {
		this.disposed = true;
		this.cancelScheduledSave({ suppressCallback: true });
	}
}
