import type { App, TFile } from 'obsidian';
import { getPluginContext } from '../pluginContext';
import type { FileFilterViewState } from '../types/filterView';
import type { FileTagGroupState } from '../types/tagGroup';
import type { KanbanBoardState, KanbanHeightMode, KanbanSortDirection } from '../types/kanban';
import { getLogger } from '../utils/logger';
import {
	buildConfigCalloutBlock,
	readConfigCallout,
	stripExistingConfigBlock,
	type ConfigCalloutMeta
} from './config/ConfigBlockIO';

const logger = getLogger('table-view:config');

export interface TableConfigData {
	filterViews?: FileFilterViewState | null;
	tagGroups?: FileTagGroupState | null;
	columnWidths?: Record<string, number>;
	columnConfigs?: string[] | null;
	viewPreference?: 'table' | 'kanban';
	copyTemplate?: string | null;
	kanban?: {
		laneField: string;
		sortField?: string | null;
		sortDirection?: KanbanSortDirection | null;
		heightMode?: KanbanHeightMode | null;
		fontScale?: number | null;
		multiRow?: boolean | null;
	};
	kanbanBoards?: KanbanBoardState | null;
}

interface ParsedConfigBlock {
	meta: ConfigCalloutMeta;
	data: Record<string, any>;
}

export class TableConfigManager {
	private fileId: string | null = null;

	constructor(private readonly app: App) {}

	reset(): void {
		this.fileId = null;
	}

	getFileId(): string | null {
		return this.fileId;
	}

	setFileId(fileId: string | null): void {
		this.fileId = fileId;
	}

	async load(file: TFile): Promise<Record<string, any> | null> {
		const content = await this.app.vault.read(file);
		const parsed = this.parseConfigBlock(content);
		if (!parsed) {
			this.fileId = null;
			return null;
		}

		const { meta, data } = parsed;
		this.fileId = meta.fileId;

		const plugin = getPluginContext();
		const cacheManager = plugin?.cacheManager;
		if (cacheManager) {
			const cachedVersion = cacheManager.getCachedVersion(meta.fileId);
			if (cachedVersion === meta.version) {
				const cached = cacheManager.getCache(meta.fileId);
				if (cached) {
					logger.trace('Cache hit for file', file.path);
					return cached as Record<string, any>;
				}
			}
			cacheManager.setCache(meta.fileId, file.path, meta.version, data);
		}

		return data;
	}

	async save(file: TFile, data: TableConfigData, options?: { beforeWrite?: (file: TFile) => void }): Promise<void> {
		const fileId = this.ensureFileId();
		const version = Date.now();

		const payload: Record<string, unknown> = {};
		if (data.filterViews) {
			payload.filterViews = data.filterViews;
		}
		if (data.tagGroups && (data.tagGroups.groups.length > 0 || data.tagGroups.activeGroupId)) {
			payload.tagGroups = data.tagGroups;
		}
		if (data.columnWidths && Object.keys(data.columnWidths).length > 0) {
			payload.columnWidths = data.columnWidths;
		}
		if (data.columnConfigs && data.columnConfigs.length > 0) {
			payload.columnConfigs = data.columnConfigs;
		}
		if (data.copyTemplate && data.copyTemplate.trim().length > 0) {
			payload.copyTemplate = data.copyTemplate;
		}
		if (data.viewPreference) {
			payload.viewPreference = data.viewPreference;
		}
		if (data.kanban) {
			payload.kanban = data.kanban;
		}
		if (data.kanbanBoards && data.kanbanBoards.boards.length > 0) {
			payload.kanbanBoards = data.kanbanBoards;
		}

		const configBlock = buildConfigCalloutBlock(fileId, version, payload);
		const content = await this.app.vault.read(file);

		const cleaned = stripExistingConfigBlock(content).trimEnd();
		const newContent = cleaned.length > 0 ? `${cleaned}\n\n${configBlock}\n` : `${configBlock}\n`;

		options?.beforeWrite?.(file);
		await this.app.vault.modify(file, newContent);

		const plugin = getPluginContext();
		const cacheManager = plugin?.cacheManager;
		if (cacheManager) {
			cacheManager.setCache(fileId, file.path, version, {
				filterViews: data.filterViews ?? undefined,
				tagGroups: data.tagGroups ?? undefined,
				columnWidths: data.columnWidths ?? {},
				copyTemplate: data.copyTemplate ?? undefined,
				columnConfigs: data.columnConfigs ?? [],
				viewPreference: data.viewPreference ?? 'table',
				kanban: data.kanban ?? undefined,
				kanbanBoards: data.kanbanBoards ?? undefined
			});
		}

		if (plugin) {
			if (data.filterViews) {
				await plugin.saveFilterViewsForFile(file.path, data.filterViews);
			}
			if (data.tagGroups) {
				await plugin.saveTagGroupsForFile(file.path, data.tagGroups);
			}
			if (data.kanbanBoards) {
				await plugin.saveKanbanBoardsForFile(file.path, data.kanbanBoards);
			}
			if (data.columnWidths) {
				for (const [field, width] of Object.entries(data.columnWidths)) {
					plugin.updateColumnWidthPreference(file.path, field, width);
				}
			}
		}
	}

	private ensureFileId(): string {
		if (!this.fileId) {
			this.fileId = this.generateFileId();
		}
		return this.fileId;
	}

	private generateFileId(): string {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID().split('-')[0];
		}
		return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
	}

	private parseConfigBlock(content: string): ParsedConfigBlock | null {
		const payload = readConfigCallout(content);
		if (!payload?.meta) {
			return null;
		}
		return {
			meta: payload.meta,
			data: payload.data ?? {}
		};
	}
}
