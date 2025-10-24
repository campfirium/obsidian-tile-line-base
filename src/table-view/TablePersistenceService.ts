import type { App, TFile } from 'obsidian';
import { Notice } from 'obsidian';
import type { FileFilterViewState } from '../types/filterView';
import type { TableDataStore } from './TableDataStore';
import type { ColumnLayoutStore } from './ColumnLayoutStore';
import type { TableConfigManager } from './TableConfigManager';
import type { FilterStateStore } from './filter/FilterStateStore';
import { t } from '../i18n';

interface TablePersistenceDeps {
	app: App;
	dataStore: TableDataStore;
	columnLayoutStore: ColumnLayoutStore;
	configManager: TableConfigManager;
	filterStateStore: FilterStateStore;
	getFile: () => TFile | null;
	getFilterViewState: () => FileFilterViewState;
	getCopyTemplate: () => string | null;
}

/**
 * 统一管理 Markdown 与配置块的加载/保存，并提供去抖写入能力。
 */
export class TablePersistenceService {
	private saveTimeout: NodeJS.Timeout | null = null;

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
			await this.deps.app.vault.modify(file, `${markdown}\n`);
			await this.saveConfig();
		} catch (error) {
            console.error('[TileLineBase] Failed to save file', error);
            new Notice(t('tablePersistence.saveFailed'));
		} finally {
			this.cancelScheduledSave();
		}
	}

	async saveConfig(): Promise<void> {
		const file = this.deps.getFile();
		if (!file) {
			return;
		}

		const schema = this.deps.dataStore.getSchema();
		const columnConfigs = schema?.columnConfigs
			?.filter((config) => this.deps.dataStore.hasColumnConfigContent(config))
			?.map((config) => this.deps.dataStore.serializeColumnConfig(config)) ?? [];

		const widthPrefs = this.deps.columnLayoutStore.exportPreferences();
		await this.deps.configManager.save(file, {
			filterViews: this.deps.getFilterViewState(),
			columnWidths: widthPrefs,
			columnConfigs,
			viewPreference: 'table',
			copyTemplate: this.deps.getCopyTemplate()
		});
	}

	dispose(): void {
		this.cancelScheduledSave();
	}
}
