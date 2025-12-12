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
import type { KanbanBoardState, KanbanHeightMode, KanbanSortDirection } from '../types/kanban';
import {
	DEFAULT_KANBAN_FONT_SCALE,
	DEFAULT_KANBAN_HEIGHT_MODE,
	DEFAULT_KANBAN_SORT_DIRECTION
} from '../types/kanban';
import type { SlideViewConfig } from '../types/slide';
import { isDefaultSlideViewConfig, normalizeSlideViewConfig } from '../types/slide';

const logger = getLogger('table-view:persistence');

interface TablePersistenceDeps {
	app: App;
	dataStore: TableDataStore;
	columnLayoutStore: ColumnLayoutStore;
	configManager: TableConfigManager;
	filterStateStore: FilterStateStore;
	getFile: () => TFile | null;
	getFilterViewState: () => FileFilterViewState;
	getTagGroupState: () => FileTagGroupState;
	getGalleryFilterViewState?: () => FileFilterViewState;
	getGalleryTagGroupState?: () => FileTagGroupState;
	getCopyTemplate: () => string | null;
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

	constructor(private readonly deps: TablePersistenceDeps) {}

	async loadConfig(): Promise<Record<string, any> | null> {
		const file = this.deps.getFile();
		if (!file) {
			return null;
		}
		return this.deps.configManager.load(file);
	}

	scheduleSave(): void {
		if (this.deps.shouldAllowSave && !this.deps.shouldAllowSave()) {
			logger.debug('scheduleSave:blocked');
			return;
		}
		if (this.saveTimeout !== null) {
			window.clearTimeout(this.saveTimeout);
		}
		this.pendingSave = true;
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
		return this.pendingSave;
	}

	async save(): Promise<void> {
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
		const targetFile = this.deps.app.vault.getAbstractFileByPath(file.path);
		if (!(targetFile instanceof TFile) || targetFile !== file) {
			logger.warn('save:aborted file missing or replaced', { path: file.path });
			this.cancelScheduledSave();
			return;
		}

		try {
			const markdown = this.deps.dataStore.blocksToMarkdown().trimEnd();
			const backupManager = this.deps.getBackupManager();
			if (backupManager) {
				try {
					await backupManager.ensureBackup(targetFile, `${markdown}\n`);
				} catch (error) {
					logger.warn('Backup snapshot failed before save', error);
				}
			}
			this.deps.markSelfMutation?.(targetFile);
			await this.deps.app.vault.modify(targetFile, `${markdown}\n`);
			await this.saveConfig({
				beforeWrite: (target) => this.deps.markSelfMutation?.(target)
			});
		} catch (error) {
			logger.error('Failed to save file', error);
			new Notice(t('tablePersistence.saveFailed'));
		} finally {
			this.cancelScheduledSave();
		}
	}

	getConfigPayload(): TableConfigData {
		const schema = this.deps.dataStore.getSchema();
		const columnConfigs = schema?.columnConfigs
			?.filter((config) => this.deps.dataStore.hasColumnConfigContent(config))
			?.map((config) => this.deps.dataStore.serializeColumnConfig(config));

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
			filterViews: this.deps.getFilterViewState(),
			tagGroups: this.deps.getTagGroupState(),
			galleryFilterViews: this.deps.getGalleryFilterViewState ? this.deps.getGalleryFilterViewState() : undefined,
			galleryTagGroups: this.deps.getGalleryTagGroupState ? this.deps.getGalleryTagGroupState() : undefined,
			columnWidths: this.deps.columnLayoutStore.exportPreferences(),
			columnConfigs,
			viewPreference,
			copyTemplate: this.deps.getCopyTemplate(),
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

	async saveConfig(_options?: { beforeWrite?: (file: TFile) => void }): Promise<void> {
		const file = this.deps.getFile();
		if (!file) {
			return;
		}

		await this.deps.configManager.save(file, this.getConfigPayload());
	}

	getMarkdownSnapshot(): string {
		return this.deps.dataStore.blocksToMarkdown().trimEnd();
	}

	dispose(): void {
		this.cancelScheduledSave({ suppressCallback: true });
	}
}
