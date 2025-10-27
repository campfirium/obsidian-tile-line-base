import type { App, TFile } from 'obsidian';
import { getPluginContext } from '../pluginContext';
import type { FileFilterViewState } from '../types/filterView';
import type { FileTagGroupState } from '../types/tagGroup';
import { getLogger } from '../utils/logger';

const logger = getLogger('table-view:config');

export interface TableConfigData {
	filterViews?: FileFilterViewState | null;
	tagGroups?: FileTagGroupState | null;
	columnWidths?: Record<string, number>;
	columnConfigs?: string[] | null;
	viewPreference?: 'table';
	copyTemplate?: string | null;
}

interface CachedConfigMeta {
	fileId: string;
	version: number;
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
		const meta = this.extractMetadataFromHeadings(file);
		if (!meta) {
			this.fileId = null;
			return null;
		}

		this.fileId = meta.fileId;
		const plugin = getPluginContext();
		const cacheManager = plugin?.cacheManager;
		const cachedVersion = cacheManager?.getCachedVersion(meta.fileId);

		if (cachedVersion === meta.version) {
			const cached = cacheManager?.getCache(meta.fileId);
			if (cached) {
				logger.trace('Cache hit for file', file.path);
				return cached as Record<string, any>;
			}
		}

		logger.trace('Cache miss, parsing config block...');
		const content = await this.app.vault.read(file);
		const config = this.parseConfigBlock(content, meta.fileId);

		if (config && cacheManager) {
			cacheManager.setCache(meta.fileId, file.path, meta.version, config);
		}

		return config;
	}

	async save(file: TFile, data: TableConfigData): Promise<void> {
		const fileId = this.ensureFileId();
		const version = Date.now();

		const lines: string[] = [];
		if (data.filterViews) {
			lines.push(`filterViews:${JSON.stringify(data.filterViews)}`);
		}
		if (data.tagGroups && (data.tagGroups.groups.length > 0 || data.tagGroups.activeGroupId)) {
			lines.push(`tagGroups:${JSON.stringify(data.tagGroups)}`);
		}
		if (data.columnWidths && Object.keys(data.columnWidths).length > 0) {
			lines.push(`columnWidths:${JSON.stringify(data.columnWidths)}`);
		}
		if (data.columnConfigs && data.columnConfigs.length > 0) {
			lines.push(`columnConfigs:${JSON.stringify(data.columnConfigs)}`);
		}
		if (data.copyTemplate && data.copyTemplate.trim().length > 0) {
			lines.push(`copyTemplate:${JSON.stringify(data.copyTemplate)}`);
		}
		if (data.viewPreference) {
			lines.push(`viewPreference:${data.viewPreference}`);
		}

		const configBlock = `\`\`\`tlb\n${lines.join('\n')}\n\`\`\``;
		const content = await this.app.vault.read(file);

		const targetBlockRegex = new RegExp(
			`## tlb ${fileId} \\d+\\s*\\n\`\`\`tlb\\s*\\n[\\s\\S]*?\\n\`\`\``,
			'g'
		);
		let newContent = content.replace(targetBlockRegex, '');

		if (newContent === content) {
			newContent = content.replace(/## tlb \w+ \d+\s*\n```tlb\s*\n[\s\S]*?\n```/g, '');
		}

		const fullConfigBlock = `## tlb ${fileId} ${version}\n${configBlock}`;
		newContent = `${newContent.trimEnd()}\n\n${fullConfigBlock}\n`;

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
				viewPreference: data.viewPreference ?? 'table'
			});
		}

		if (plugin) {
			if (data.filterViews) {
				await plugin.saveFilterViewsForFile(file.path, data.filterViews);
			}
			if (data.tagGroups) {
				await plugin.saveTagGroupsForFile(file.path, data.tagGroups);
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

	private extractMetadataFromHeadings(file: TFile): CachedConfigMeta | null {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache?.headings) {
			return null;
		}
		const tlbHeading = cache.headings
			.filter((heading) => heading.level === 2 && heading.heading.startsWith('tlb '))
			.pop();
		if (!tlbHeading) {
			return null;
		}
		const parts = tlbHeading.heading.split(' ');
		if (parts.length !== 3) {
			return null;
		}
		const fileId = parts[1];
		const version = parseInt(parts[2], 10);
		if (!fileId || Number.isNaN(version)) {
			return null;
		}
		return { fileId, version };
	}

	private parseConfigBlock(content: string, fileId: string): Record<string, any> | null {
		const headerRegex = new RegExp(`^## tlb ${fileId} \\d+$`, 'gm');
		let lastMatch: RegExpExecArray | null = null;
		let match: RegExpExecArray | null;

		while ((match = headerRegex.exec(content)) !== null) {
			lastMatch = match;
		}

		if (!lastMatch) {
			return null;
		}

		const afterHeader = content.substring(lastMatch.index);
		const blockRegex = /```tlb\s*\n([\s\S]*?)\n```/;
		const blockMatch = afterHeader.match(blockRegex);
		if (!blockMatch) {
			return null;
		}

		const config: Record<string, any> = {};
		const lines = blockMatch[1].split(/\r?\n/);
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			const colonIndex = trimmed.indexOf(':');
			if (colonIndex === -1) {
				continue;
			}
			const key = trimmed.substring(0, colonIndex);
			const valueJson = trimmed.substring(colonIndex + 1);
			try {
				config[key] = JSON.parse(valueJson);
			} catch (error) {
				logger.error(`Failed to parse config line: ${key}`, error);
			}
		}

		return config;
	}
}
