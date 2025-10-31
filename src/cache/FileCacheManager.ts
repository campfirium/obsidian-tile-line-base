import type TileLineBasePlugin from '../main';
import type { ConfigCacheEntry, TlbConfigBlock } from '../types/config';
import { getLogger } from '../utils/logger';

const logger = getLogger('cache:file');

/**
 * 文件配置缓存管理器
 * 使用插件 data.json 存储缓存，避免手动管理文件路径
 */
export class FileCacheManager {
	private plugin: TileLineBasePlugin;
	private cache: Record<string, ConfigCacheEntry> = {};

	constructor(plugin: TileLineBasePlugin) {
		this.plugin = plugin;
	}

	/**
	 * 从插件 settings 加载缓存
	 */
	async load(): Promise<void> {
		// 缓存已经在 plugin.settings.configCache 中
		this.cache = (this.plugin as any).settings.configCache ?? {};
	}

	/**
	 * 保存缓存到插件 settings
	 */
	private async save(): Promise<void> {
		(this.plugin as any).settings.configCache = this.cache;
		await (this.plugin as any).saveSettings();
	}

	/**
	 * 获取缓存
	 */
	getCache(fileId: string): TlbConfigBlock | null {
		const cached = this.cache[fileId];
		if (!cached) return null;
		return cached.config;
	}

	/**
	 * 获取缓存的版本号
	 */
	getCachedVersion(fileId: string): number | null {
		const cached = this.cache[fileId];
		return cached?.version ?? null;
	}

	/**
	 * 设置缓存
	 */
	setCache(fileId: string, filePath: string, version: number, config: TlbConfigBlock): void {
		this.cache[fileId] = {
			filePath,
			version,
			config
		};
		// 异步保存
		this.save().catch((error) => {
			logger.error('Failed to save config cache', error);
		});
	}

	/**
	 * 使缓存失效
	 */
	invalidateCache(fileId: string): void {
		delete this.cache[fileId];
		this.save().catch((error) => {
			logger.error('Failed to save config cache', error);
		});
	}

	/**
	 * 清理所有缓存
	 */
	clearAll(): void {
		this.cache = {};
		this.save().catch((error) => {
			logger.error('Failed to clear config cache', error);
		});
	}

	listEntries(): Array<{ fileId: string; entry: ConfigCacheEntry }> {
		return Object.entries(this.cache).map(([fileId, entry]) => ({ fileId, entry }));
	}

	listFilePaths(): string[] {
		return Object.values(this.cache)
			.map((entry) => entry.filePath)
			.filter((path, index, all) => typeof path === 'string' && path.length > 0 && all.indexOf(path) === index);
	}
}
