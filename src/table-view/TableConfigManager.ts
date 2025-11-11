import type { TFile } from 'obsidian';
import { getPluginContext } from '../pluginContext';
import type { FileFilterViewState } from '../types/filterView';
import type { FileTagGroupState } from '../types/tagGroup';
import type { KanbanBoardState, KanbanViewPreferenceConfig } from '../types/kanban';
import { getLogger } from '../utils/logger';

const logger = getLogger('table-view:config');

export interface TableConfigData {
	filterViews?: FileFilterViewState | null;
	tagGroups?: FileTagGroupState | null;
	columnWidths?: Record<string, number>;
	columnConfigs?: string[] | null;
	viewPreference?: 'table' | 'kanban';
	copyTemplate?: string | null;
	kanban?: KanbanViewPreferenceConfig | null;
	kanbanBoards?: KanbanBoardState | null;
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
		if (viewPreference === 'table' || viewPreference === 'kanban') {
			snapshot.viewPreference = viewPreference;
		}
		const kanbanPrefs = settingsService.getKanbanPreferencesForFile(filePath);
		if (kanbanPrefs) {
			snapshot.kanban = kanbanPrefs;
		}
		const storedBoards = settings.kanbanBoards[filePath];
		if (storedBoards && storedBoards.boards.length > 0) {
			snapshot.kanbanBoards = plugin.getKanbanBoardsForFile(filePath);
		}

		return Object.keys(snapshot).length > 0 ? snapshot : null;
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

		const serializedConfigs =
			Array.isArray(data.columnConfigs) && data.columnConfigs.length > 0 ? data.columnConfigs : null;
		tasks.push(settingsService.saveColumnConfigsForFile(filePath, serializedConfigs));

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

		await Promise.all(
			tasks.map((task) =>
				task.catch((error) => {
					logger.error('Failed to persist table config payload', error);
				})
			)
		);
	}
}
