import type { App, TFile } from 'obsidian';
import { Notice } from 'obsidian';
import type { FileFilterViewState } from '../types/filterView';
import type { FileTagGroupState } from '../types/tagGroup';
import type { TableDataStore } from './TableDataStore';
import type { ColumnLayoutStore } from './ColumnLayoutStore';
import type { TableConfigData, TableConfigManager } from './TableConfigManager';
import type { FilterStateStore } from './filter/FilterStateStore';
import type { BackupManager } from '../services/BackupManager';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';
import type { KanbanBoardState, KanbanSortDirection } from '../types/kanban';

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
	getCopyTemplate: () => string | null;
	getBackupManager: () => BackupManager | null;
	getViewPreference: () => 'table' | 'kanban';
	getKanbanConfig: () =>
		| {
				laneField: string | null;
				sortField: string | null;
				sortDirection: KanbanSortDirection | null;
		  }
		| null;
	getKanbanBoards?: () => KanbanBoardState | null;
	markSelfMutation?: (file: TFile) => void;
}

/**
 * 统一管理 Markdown 与配置块的加载/保存，并提供去抖写入能力。
 */
export class TablePersistenceService {
	private saveTimeout: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly deps: TablePersistenceDeps) {}

	async loadConfig(): Promise<Record<string, any> | null> {
		const file = this.deps.getFile();
		if (!file) {
			return null;
		}
		return this.deps.configManager.load(file);
	}

	scheduleSave(): void {
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
		}
		this.saveTimeout = setTimeout(() => {
			void this.save();
		}, 500);
	}

	cancelScheduledSave(): void {
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
		}
	}

	async save(): Promise<void> {
		const file = this.deps.getFile();
		if (!file) {
			return;
		}

		try {
			const markdown = this.deps.dataStore.blocksToMarkdown().trimEnd();
			const backupManager = this.deps.getBackupManager();
			if (backupManager) {
				try {
					await backupManager.ensureBackup(file, `${markdown}\n`);
				} catch (error) {
					logger.warn('Backup snapshot failed before save', error);
				}
			}
			this.deps.markSelfMutation?.(file);
			await this.deps.app.vault.modify(file, `${markdown}\n`);
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
		const columnConfigs =
			schema?.columnConfigs
				?.filter((config) => this.deps.dataStore.hasColumnConfigContent(config))
				?.map((config) => this.deps.dataStore.serializeColumnConfig(config)) ?? [];

		const viewPreference = this.deps.getViewPreference?.() ?? 'table';
		const kanbanConfig = this.deps.getKanbanConfig?.();
		const laneField = kanbanConfig?.laneField ?? null;
		const sortField = kanbanConfig?.sortField ?? null;
		const sortDirection = kanbanConfig?.sortDirection ?? null;
		const kanbanBoards = this.deps.getKanbanBoards?.() ?? null;
		const hasKanbanBoards =
			kanbanBoards != null &&
			Array.isArray(kanbanBoards.boards) &&
			kanbanBoards.boards.length > 0;

		return {
			filterViews: this.deps.getFilterViewState(),
			tagGroups: this.deps.getTagGroupState(),
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
								sortDirection === 'asc' || sortDirection === 'desc' ? sortDirection : undefined
						}
					: undefined,
			kanbanBoards: hasKanbanBoards ? kanbanBoards : undefined
		};
	}

	async saveConfig(options?: { beforeWrite?: (file: TFile) => void }): Promise<void> {
		const file = this.deps.getFile();
		if (!file) {
			return;
		}

		const beforeWrite =
			typeof options?.beforeWrite === 'function'
				? options.beforeWrite
				: (target: TFile) => this.deps.markSelfMutation?.(target);

		await this.deps.configManager.save(file, this.getConfigPayload(), {
			beforeWrite
		});
	}

	dispose(): void {
		this.cancelScheduledSave();
	}
}
