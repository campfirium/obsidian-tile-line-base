import type { Plugin } from 'obsidian';
import type { FileFilterViewState, FilterViewDefinition, FilterViewMetadata, SortRule } from '../types/filterView';
import type { FileTagGroupState, TagGroupDefinition } from '../types/tagGroup';
import type { ConfigCacheEntry } from '../types/config';
import type { LogLevelName, LoggingConfig } from '../utils/logger';
import { getLogger } from '../utils/logger';

const logger = getLogger('service:settings');

export interface BackupSettings {
	enabled: boolean;
	maxSizeMB: number;
}

export interface OnboardingState {
	completed: boolean;
	helpFilePath: string | null;
}

export interface TileLineBaseSettings {
	fileViewPrefs: Record<string, 'markdown' | 'table'>;
	columnLayouts: Record<string, Record<string, number>>;
	filterViews: Record<string, FileFilterViewState>;
	tagGroups: Record<string, FileTagGroupState>;
	configCache: Record<string, ConfigCacheEntry>;
	hideRightSidebar: boolean;
	logging: LoggingConfig;
	backups: BackupSettings;
	onboarding: OnboardingState;
}

export const DEFAULT_SETTINGS: TileLineBaseSettings = {
	fileViewPrefs: {},
	columnLayouts: {},
	filterViews: {},
	tagGroups: {},
	configCache: {},
	hideRightSidebar: false,
	logging: {
		globalLevel: 'warn',
		scopeLevels: {}
	},
	backups: {
		enabled: true,
		maxSizeMB: 200
	},
	onboarding: {
		completed: false,
		helpFilePath: null
	}
};

export class SettingsService {
	private settings: TileLineBaseSettings = DEFAULT_SETTINGS;
	private readonly plugin: Plugin;

	constructor(plugin: Plugin) {
		this.plugin = plugin;
	}

	async load(): Promise<TileLineBaseSettings> {
		const data = await this.plugin.loadData();
		const merged = Object.assign({}, DEFAULT_SETTINGS, data);
		merged.fileViewPrefs = { ...DEFAULT_SETTINGS.fileViewPrefs, ...(merged.fileViewPrefs ?? {}) };
		merged.columnLayouts = { ...DEFAULT_SETTINGS.columnLayouts, ...(merged.columnLayouts ?? {}) };
		merged.filterViews = { ...DEFAULT_SETTINGS.filterViews, ...(merged.filterViews ?? {}) };
		merged.tagGroups = { ...DEFAULT_SETTINGS.tagGroups, ...(merged.tagGroups ?? {}) };
		merged.configCache = { ...DEFAULT_SETTINGS.configCache, ...(merged.configCache ?? {}) };
		merged.hideRightSidebar = typeof (merged as TileLineBaseSettings).hideRightSidebar === 'boolean'
			? (merged as TileLineBaseSettings).hideRightSidebar
			: DEFAULT_SETTINGS.hideRightSidebar;
		merged.logging = this.sanitizeLoggingConfig((merged as TileLineBaseSettings).logging);
		merged.backups = this.sanitizeBackupSettings((merged as TileLineBaseSettings).backups);
		merged.onboarding = this.sanitizeOnboardingState((merged as TileLineBaseSettings).onboarding);

		const legacyList = (data as { autoTableFiles?: unknown } | undefined)?.autoTableFiles;
		if (Array.isArray(legacyList)) {
			for (const path of legacyList) {
				if (typeof path === 'string') {
					merged.fileViewPrefs[path] = 'table';
				}
			}
			await this.plugin.saveData(merged);
		}

		this.settings = merged;
		return this.settings;
	}

	getSettings(): TileLineBaseSettings {
		return this.settings;
	}

	getHideRightSidebar(): boolean {
		return this.settings.hideRightSidebar;
	}

	async setHideRightSidebar(value: boolean): Promise<boolean> {
		if (this.settings.hideRightSidebar === value) {
			return false;
		}
		this.settings.hideRightSidebar = value;
		await this.persist();
		return true;
	}

	async persist(): Promise<void> {
		await this.plugin.saveData(this.settings);
	}

	shouldAutoOpen(filePath: string): boolean {
		return this.settings.fileViewPrefs[filePath] === 'table';
	}

	async setFileViewPreference(filePath: string, view: 'markdown' | 'table'): Promise<boolean> {
		const current = this.settings.fileViewPrefs[filePath];
		if (current === view) {
			return false;
		}
		this.settings.fileViewPrefs[filePath] = view;
		await this.persist();
		return true;
	}

	getColumnLayout(filePath: string): Record<string, number> | undefined {
		const layout = this.settings.columnLayouts[filePath];
		return layout ? { ...layout } : undefined;
	}

	updateColumnWidthPreference(filePath: string, field: string, width: number): boolean {
		if (!filePath || !field || Number.isNaN(width)) {
			return false;
		}
		const rounded = Math.round(width);
		const layout = this.settings.columnLayouts[filePath] ?? {};
		if (layout[field] === rounded) {
			return false;
		}
		layout[field] = rounded;
		this.settings.columnLayouts[filePath] = layout;
		this.persist().catch((error) => {
			logger.error('Failed to persist column width preference', error);
		});
		return true;
	}

	getFilterViewsForFile(filePath: string): FileFilterViewState {
		const stored = this.settings.filterViews[filePath];
		if (!stored) {
			return { views: [], activeViewId: null, metadata: {} };
		}
		return {
			activeViewId: stored.activeViewId ?? null,
			views: stored.views.map((view) => this.cloneFilterViewDefinition(view)),
			metadata: this.cloneFilterViewMetadata(stored.metadata)
		};
	}

	async saveFilterViewsForFile(filePath: string, state: FileFilterViewState): Promise<FileFilterViewState> {
		const sanitized: FileFilterViewState = {
			activeViewId: state.activeViewId ?? null,
			views: state.views.map((view) => this.cloneFilterViewDefinition(view)),
			metadata: this.cloneFilterViewMetadata(state.metadata)
		};
		this.settings.filterViews[filePath] = sanitized;
		await this.persist();
		return sanitized;
	}

	getTagGroupsForFile(filePath: string): FileTagGroupState {
		const stored = this.settings.tagGroups[filePath];
		return this.cloneTagGroupState(stored ?? null);
	}

	async saveTagGroupsForFile(filePath: string, state: FileTagGroupState): Promise<FileTagGroupState> {
		const sanitized = this.cloneTagGroupState(state);
		this.settings.tagGroups[filePath] = sanitized;
		await this.persist();
		return sanitized;
	}

	getConfigCache(): Record<string, ConfigCacheEntry> {
		return this.settings.configCache;
	}

	setConfigCache(cache: Record<string, ConfigCacheEntry>): void {
		this.settings.configCache = cache;
	}

	private cloneFilterViewDefinition(source: FilterViewDefinition): FilterViewDefinition {
		const rawSortRules = Array.isArray((source as any).sortRules)
			? (source as any).sortRules
			: [];
		const sortRules: SortRule[] = rawSortRules
			.map((rule: any) => {
				const column = typeof rule?.column === 'string' ? rule.column : '';
				if (!column) {
					return null;
				}
				const direction: 'asc' | 'desc' = rule?.direction === 'desc' ? 'desc' : 'asc';
				return { column, direction };
			})
			.filter((rule: SortRule | null): rule is SortRule => rule !== null);
		return {
			id: source.id,
			name: source.name,
			filterRule: source.filterRule != null ? this.deepClone(source.filterRule) : null,
			sortRules,
			columnState: source.columnState != null ? this.deepClone(source.columnState) : null,
			quickFilter: source.quickFilter ?? null
		};
	}

	private deepClone<T>(value: T): T {
		if (value == null) {
			return value;
		}
		try {
			return JSON.parse(JSON.stringify(value)) as T;
		} catch (error) {
			logger.warn('deepClone fallback failed, returning original reference', error);
			return value;
		}
	}

	private cloneFilterViewMetadata(metadata: FilterViewMetadata | null | undefined): FilterViewMetadata {
		if (!metadata) {
			return {};
		}
		return { ...metadata };
	}

	getLoggingConfig(): LoggingConfig {
		return {
			globalLevel: this.settings.logging.globalLevel,
			scopeLevels: { ...this.settings.logging.scopeLevels }
		};
	}

	async saveLoggingConfig(config: LoggingConfig): Promise<void> {
		this.settings.logging = this.sanitizeLoggingConfig(config);
		await this.persist();
	}

	private sanitizeLoggingConfig(raw: Partial<LoggingConfig> | undefined): LoggingConfig {
		const defaultConfig: LoggingConfig = {
			globalLevel: DEFAULT_SETTINGS.logging.globalLevel,
			scopeLevels: { ...DEFAULT_SETTINGS.logging.scopeLevels }
		};
		if (!raw) {
			return defaultConfig;
		}
		const normalize = (level: unknown): LogLevelName | null => {
			if (typeof level !== 'string') {
				return null;
			}
			switch (level) {
				case 'error':
				case 'warn':
				case 'info':
				case 'debug':
				case 'trace':
					return level;
				default:
					return null;
			}
		};

		const scopeLevels: Record<string, LogLevelName> = {};
		if (raw.scopeLevels && typeof raw.scopeLevels === 'object') {
			for (const [scope, level] of Object.entries(raw.scopeLevels)) {
				const normalized = normalize(level);
				if (normalized) {
					scopeLevels[scope] = normalized;
				}
			}
		}

		const globalLevel = normalize(raw.globalLevel) ?? defaultConfig.globalLevel;
		return {
			globalLevel,
			scopeLevels
		};
	}

	getBackupSettings(): BackupSettings {
		return {
			enabled: this.settings.backups.enabled,
			maxSizeMB: this.settings.backups.maxSizeMB
		};
	}

	async setBackupEnabled(enabled: boolean): Promise<boolean> {
		if (this.settings.backups.enabled === enabled) {
			return false;
		}
		this.settings.backups.enabled = enabled;
		await this.persist();
		return true;
	}

	async setBackupMaxSizeMB(value: number): Promise<boolean> {
		const sanitized = this.sanitizeBackupSettings({ enabled: this.settings.backups.enabled, maxSizeMB: value });
		if (sanitized.maxSizeMB === this.settings.backups.maxSizeMB) {
			return false;
		}
		this.settings.backups.maxSizeMB = sanitized.maxSizeMB;
		await this.persist();
		return true;
	}

	getOnboardingState(): OnboardingState {
		return {
			completed: this.settings.onboarding.completed,
			helpFilePath: this.settings.onboarding.helpFilePath
		};
	}

	async updateOnboardingState(updates: Partial<OnboardingState>): Promise<OnboardingState> {
		this.settings.onboarding = {
			...this.settings.onboarding,
			...updates
		};
		await this.persist();
		return this.getOnboardingState();
	}

	private cloneTagGroupState(source: FileTagGroupState | null): FileTagGroupState {
		if (!source) {
			return { activeGroupId: null, groups: [] };
		}
		const seenIds = new Set<string>();
		const groups: TagGroupDefinition[] = [];

		for (const entry of source.groups ?? []) {
			if (!entry) {
				continue;
			}
			const id = typeof entry.id === 'string' ? entry.id.trim() : '';
			if (!id || seenIds.has(id)) {
				continue;
			}
			const name = typeof entry.name === 'string' ? entry.name.trim() : '';
			const rawViewIds = Array.isArray(entry.viewIds) ? entry.viewIds : [];
			const viewIds: string[] = [];
			const seenViewIds = new Set<string>();
			for (const raw of rawViewIds) {
				if (typeof raw !== 'string') {
					continue;
				}
				const trimmed = raw.trim();
				if (!trimmed || seenViewIds.has(trimmed)) {
					continue;
				}
				seenViewIds.add(trimmed);
				viewIds.push(trimmed);
			}
			groups.push({
				id,
				name: name.length > 0 ? name : id,
				viewIds
			});
			seenIds.add(id);
		}

		const activeGroupId = groups.some((group) => group.id === source.activeGroupId) ? source.activeGroupId : null;

		return {
			activeGroupId,
			groups
		};
	}

	private sanitizeBackupSettings(raw: Partial<BackupSettings> | undefined): BackupSettings {
		const base = DEFAULT_SETTINGS.backups;
		const enabled = typeof raw?.enabled === 'boolean' ? raw.enabled : base.enabled;
		const value = raw?.maxSizeMB;
		let maxSize = typeof value === 'number' ? value : base.maxSizeMB;
		if (!Number.isFinite(maxSize) || maxSize <= 0) {
			maxSize = base.maxSizeMB;
		}
		maxSize = Math.min(10_240, Math.max(1, Math.floor(maxSize)));
		return {
			enabled,
			maxSizeMB: maxSize
		};
	}

	private sanitizeOnboardingState(raw: Partial<OnboardingState> | undefined): OnboardingState {
		const base = DEFAULT_SETTINGS.onboarding;
		const completed = typeof raw?.completed === 'boolean' ? raw.completed : base.completed;
		const helpFilePath = typeof raw?.helpFilePath === 'string' && raw.helpFilePath.trim().length > 0
			? raw.helpFilePath.trim()
			: base.helpFilePath;
		return {
			completed,
			helpFilePath
		};
	}
}
