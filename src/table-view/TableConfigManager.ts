import type { TFile } from 'obsidian';
import { getPluginContext } from '../pluginContext';
import type { FileFilterViewState } from '../types/filterView';
import type { FileTagGroupState } from '../types/tagGroup';
import type { KanbanBoardState, KanbanViewPreferenceConfig } from '../types/kanban';
import type { SlideViewConfig } from '../types/slide';
import { getLogger } from '../utils/logger';
import { readConfigCallout, stripExistingConfigBlock } from './config/ConfigBlockIO';

const logger = getLogger('table-view:config');

export interface TableConfigData {
	filterViews?: FileFilterViewState | null;
	tagGroups?: FileTagGroupState | null;
	columnWidths?: Record<string, number>;
	columnConfigs?: string[] | null;
	viewPreference?: 'table' | 'kanban' | 'slide';
	copyTemplate?: string | null;
	kanban?: KanbanViewPreferenceConfig | null;
	kanbanBoards?: KanbanBoardState | null;
	slide?: SlideViewConfig | null;
}

export class TableConfigManager {
	constructor() {}

	reset(): void {
		// Config now persists via plugin settings; nothing to reset.
	}

	async load(file: TFile): Promise<Record<string, any> | null> {
		const plugin = getPluginContext();
		if (!plugin) {
			logger.warn('Plugin context unavailable when loading table config');
			return null;
		}

		const settingsService = plugin.getSettingsService();
		await settingsService.ensureFileSettingsForPath(file.path);

		const imported = await this.tryImportFromConfigBlock(file);
		if (imported) {
			return imported;
		}

		const settings = settingsService.getSettings();
		const filePath = file.path;
		const snapshot: TableConfigData = {};

		if (settings.filterViews[filePath]) {
			snapshot.filterViews = plugin.getFilterViewsForFile(filePath);
		}
		if (settings.tagGroups[filePath]) {
			snapshot.tagGroups = plugin.getTagGroupsForFile(filePath);
		}
		const layout = settings.columnLayouts[filePath];
		if (layout && Object.keys(layout).length > 0) {
			snapshot.columnWidths = { ...layout };
		}
		const columnConfigs = settingsService.getColumnConfigsForFile(filePath);
		if (columnConfigs && columnConfigs.length > 0) {
			snapshot.columnConfigs = columnConfigs;
		}
		const copyTemplate = settingsService.getCopyTemplateForFile(filePath);
		if (copyTemplate) {
			snapshot.copyTemplate = copyTemplate;
		}
		const viewPreference = settingsService.getFileViewPreference(filePath);
		if (viewPreference === 'table' || viewPreference === 'kanban' || viewPreference === 'slide') {
			snapshot.viewPreference = viewPreference;
		}
		const kanbanPrefs = settingsService.getKanbanPreferencesForFile(filePath);
		if (kanbanPrefs) {
			snapshot.kanban = kanbanPrefs;
		}
		const slidePrefs = settingsService.getSlidePreferencesForFile(filePath);
		if (slidePrefs) {
			snapshot.slide = slidePrefs;
		}
		const storedBoards = settings.kanbanBoards[filePath];
		if (storedBoards && storedBoards.boards.length > 0) {
			snapshot.kanbanBoards = plugin.getKanbanBoardsForFile(filePath);
		}

		if (Object.keys(snapshot).length > 0) {
			return snapshot;
		}

		return null;
	}

	async save(file: TFile, data: TableConfigData): Promise<void> {
		const plugin = getPluginContext();
		if (!plugin) {
			logger.warn('Plugin context unavailable when saving table config');
			return;
		}
		const filePath = file.path;

		const settingsService = plugin.getSettingsService();
		const tasks: Array<Promise<unknown>> = [];
		const filterViews = data.filterViews ?? { views: [], activeViewId: null, metadata: {} };
		tasks.push(plugin.saveFilterViewsForFile(filePath, filterViews));
		if (data.tagGroups) {
			tasks.push(plugin.saveTagGroupsForFile(filePath, data.tagGroups));
		}
		tasks.push(settingsService.setColumnLayout(filePath, data.columnWidths ?? null));

		if (data.columnConfigs !== undefined) {
			const serializedConfigs =
				Array.isArray(data.columnConfigs) && data.columnConfigs.length > 0 ? data.columnConfigs : null;
			tasks.push(settingsService.saveColumnConfigsForFile(filePath, serializedConfigs));
		}

		const copyTemplate =
			typeof data.copyTemplate === 'string' && data.copyTemplate.trim().length > 0 ? data.copyTemplate : null;
		tasks.push(settingsService.saveCopyTemplateForFile(filePath, copyTemplate));

		const viewPreference = data.viewPreference ?? 'table';
		tasks.push(settingsService.setFileViewPreference(filePath, viewPreference));

		const kanbanPreference =
			data.kanban && data.kanban.laneField?.trim().length ? (data.kanban as KanbanViewPreferenceConfig) : null;
		tasks.push(settingsService.saveKanbanPreferencesForFile(filePath, kanbanPreference));

		if (data.kanbanBoards && data.kanbanBoards.boards.length > 0) {
			tasks.push(plugin.saveKanbanBoardsForFile(filePath, data.kanbanBoards));
		}
		tasks.push(settingsService.saveSlidePreferencesForFile(filePath, data.slide));

		await Promise.all(
			tasks.map((task) =>
				task.catch((error) => {
					logger.error('Failed to persist table config payload', error);
				})
			)
		);
	}

	private async tryImportFromConfigBlock(file: TFile): Promise<TableConfigData | null> {
		const plugin = getPluginContext();
		if (!plugin) {
			return null;
		}

		try {
			await plugin.getSettingsService().ensureFileSettingsForPath(file.path);
			const content = await plugin.app.vault.read(file);
			const callout = readConfigCallout(content);
			if (!callout?.data) {
				return null;
			}
			const normalized = this.normalizeConfigData(callout.data);
			if (!normalized) {
				return null;
			}
			await this.save(file, normalized);
			const cleaned = stripExistingConfigBlock(content);
			const finalContent =
				cleaned.length === 0 ? '' : cleaned.endsWith('\n') ? cleaned : `${cleaned}\n`;
			if (finalContent !== content) {
				await plugin.app.vault.modify(file, finalContent);
			}
			return normalized;
		} catch (error) {
			logger.error('Failed to import config block', error);
			return null;
		}
	}

	private normalizeConfigData(source: Record<string, any>): TableConfigData | null {
		if (!isRecord(source)) {
			return null;
		}
		const result: TableConfigData = {};
		let hasData = false;

		if (isRecord(source.filterViews)) {
			result.filterViews = source.filterViews as FileFilterViewState;
			hasData = true;
		}
		if (isRecord(source.tagGroups)) {
			result.tagGroups = source.tagGroups as FileTagGroupState;
			hasData = true;
		}
		if (isRecord(source.columnWidths)) {
			const widths: Record<string, number> = {};
			for (const [field, value] of Object.entries(source.columnWidths)) {
				if (typeof value === 'number' && Number.isFinite(value)) {
					widths[field] = value;
				}
			}
			if (Object.keys(widths).length > 0) {
				result.columnWidths = widths;
				hasData = true;
			}
		}
		if (Array.isArray(source.columnConfigs)) {
			const configs = source.columnConfigs.filter((entry: unknown): entry is string => typeof entry === 'string');
			if (configs.length > 0) {
				result.columnConfigs = configs;
				hasData = true;
			}
		}
		if (typeof source.copyTemplate === 'string' && source.copyTemplate.trim().length > 0) {
			result.copyTemplate = source.copyTemplate;
			hasData = true;
		}
		if (source.viewPreference === 'table' || source.viewPreference === 'kanban' || source.viewPreference === 'slide') {
			result.viewPreference = source.viewPreference;
			hasData = true;
		}
		if (isRecord(source.kanban)) {
			result.kanban = source.kanban as KanbanViewPreferenceConfig;
			hasData = true;
		}
		if (isRecord(source.kanbanBoards)) {
			result.kanbanBoards = source.kanbanBoards as KanbanBoardState;
			hasData = true;
		}
		if (isRecord(source.slide)) {
			result.slide = source.slide as SlideViewConfig;
			hasData = true;
		}

		return hasData ? result : null;
	}
}

function isRecord(value: unknown): value is Record<string, any> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
