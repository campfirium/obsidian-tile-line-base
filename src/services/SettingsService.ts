/* eslint-disable max-lines */
import type { Plugin } from 'obsidian';
import type {
	FileFilterViewState,
	FilterViewDefinition,
	FilterViewMetadata,
	SortRule,
	DefaultFilterViewPreferences
} from '../types/filterView';
import type { FileTagGroupState } from '../types/tagGroup';
import { type KanbanBoardState, type KanbanViewPreferenceConfig } from '../types/kanban';
import type { BorderColorMode, StripeColorMode } from '../types/appearance';
import type { SlideViewConfig } from '../types/slide';
import { isDefaultSlideViewConfig, normalizeSlideViewConfig } from '../types/slide';
import type { LocaleCode } from '../i18n';
import { normalizeLocaleCode } from '../i18n';
import type { LogLevelName, LoggingConfig } from '../utils/logger';
import { getLogger } from '../utils/logger';
import {
	applyColumnLayout,
	getColumnConfigs,
	getCopyTemplate,
	getKanbanPreferences,
	getSlidePreferences,
	saveColumnConfigs,
	saveCopyTemplate,
	saveKanbanPreferences,
	saveSlidePreferences
} from './fileConfigStore';
import { cloneTagGroupState, cloneKanbanBoardState } from './settingsCloneHelpers';

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
	fileViewPrefs: Record<string, 'markdown' | 'table' | 'kanban' | 'slide'>;
	columnLayouts: Record<string, Record<string, number>>;
	filterViews: Record<string, FileFilterViewState>;
	tagGroups: Record<string, FileTagGroupState>;
	kanbanBoards: Record<string, KanbanBoardState>;
	columnConfigs: Record<string, string[]>;
	copyTemplates: Record<string, string>;
	kanbanPreferences: Record<string, KanbanViewPreferenceConfig>;
	slidePreferences: Record<string, SlideViewConfig>;
	defaultSlideConfig: SlideViewConfig | null;
	hideRightSidebar: boolean;
	borderContrast: number;
	stripeColorMode: StripeColorMode;
	stripeCustomColor: string | null;
	borderColorMode: BorderColorMode;
	borderCustomColor: string | null;
	logging: LoggingConfig;
	backups: BackupSettings;
	onboarding: OnboardingState;
	locale: LocaleCode | null;
	localizedLocale: LocaleCode;
}

export const DEFAULT_SETTINGS: TileLineBaseSettings = {
	fileViewPrefs: {},
	columnLayouts: {},
	filterViews: {},
	tagGroups: {},
	kanbanBoards: {},
	columnConfigs: {},
	copyTemplates: {},
	kanbanPreferences: {},
	slidePreferences: {},
	defaultSlideConfig: null,
	hideRightSidebar: false,
	borderContrast: 0.4,
	stripeColorMode: 'recommended',
	stripeCustomColor: null,
	borderColorMode: 'recommended',
	borderCustomColor: null,
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
	},
	locale: null,
	localizedLocale: 'en'
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
		merged.kanbanBoards = { ...DEFAULT_SETTINGS.kanbanBoards, ...(merged.kanbanBoards ?? {}) };
		merged.columnConfigs = { ...DEFAULT_SETTINGS.columnConfigs, ...(merged.columnConfigs ?? {}) };
		merged.copyTemplates = { ...DEFAULT_SETTINGS.copyTemplates, ...(merged.copyTemplates ?? {}) };
		merged.kanbanPreferences = { ...DEFAULT_SETTINGS.kanbanPreferences, ...(merged.kanbanPreferences ?? {}) };
		merged.slidePreferences = { ...DEFAULT_SETTINGS.slidePreferences, ...(merged.slidePreferences ?? {}) };
		merged.defaultSlideConfig = this.sanitizeDefaultSlideConfig((merged as TileLineBaseSettings).defaultSlideConfig);
		merged.hideRightSidebar = typeof (merged as TileLineBaseSettings).hideRightSidebar === 'boolean'
			? (merged as TileLineBaseSettings).hideRightSidebar
			: DEFAULT_SETTINGS.hideRightSidebar;
		const borderCandidate = Number((merged as TileLineBaseSettings).borderContrast);
		merged.borderContrast =
			Number.isFinite(borderCandidate) && borderCandidate >= 0 && borderCandidate <= 1
				? borderCandidate
				: DEFAULT_SETTINGS.borderContrast;
		const legacyStripe = Number((merged as any).rowStripeStrength);
		const stripeColorMode = (merged as TileLineBaseSettings).stripeColorMode;
		const stripeCustomColor = (merged as TileLineBaseSettings).stripeCustomColor;
		const borderColorMode = (merged as TileLineBaseSettings).borderColorMode;
		const borderCustomColor = (merged as TileLineBaseSettings).borderCustomColor;
		merged.stripeColorMode =
			stripeColorMode === 'primary' || stripeColorMode === 'recommended' || stripeColorMode === 'custom'
				? stripeColorMode
				: legacyStripe <= 0 ? 'primary' : DEFAULT_SETTINGS.stripeColorMode;
		merged.stripeCustomColor = this.sanitizeColorValue(stripeCustomColor);
		merged.borderColorMode =
			borderColorMode === 'custom' || borderColorMode === 'recommended'
				? borderColorMode
				: DEFAULT_SETTINGS.borderColorMode;
		merged.borderCustomColor = this.sanitizeColorValue(borderCustomColor);
		merged.logging = this.sanitizeLoggingConfig((merged as TileLineBaseSettings).logging);
		merged.backups = this.sanitizeBackupSettings((merged as TileLineBaseSettings).backups);
		merged.onboarding = this.sanitizeOnboardingState((merged as TileLineBaseSettings).onboarding);
		const localeCandidate = typeof (merged as TileLineBaseSettings).locale === 'string'
			? (merged as TileLineBaseSettings).locale
			: null;
		merged.locale = normalizeLocaleCode(localeCandidate);
		const localizedCandidate = typeof (merged as TileLineBaseSettings).localizedLocale === 'string'
			? (merged as TileLineBaseSettings).localizedLocale
			: null;
		merged.localizedLocale = normalizeLocaleCode(localizedCandidate) ?? DEFAULT_SETTINGS.localizedLocale;

		if (merged.locale && merged.locale !== 'en') {
			merged.locale = null;
		}

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

	getLocalePreference(): LocaleCode | null {
		return this.settings.locale ?? null;
	}

	getLocalizedLocalePreference(): LocaleCode {
		return this.settings.localizedLocale ?? DEFAULT_SETTINGS.localizedLocale;
	}

	async setLocalePreference(locale: LocaleCode | null): Promise<boolean> {
		if ((this.settings.locale ?? null) === (locale ?? null)) {
			return false;
		}
		this.settings.locale = locale ?? null;
		await this.persist();
		return true;
	}

	async setLocalizedLocalePreference(locale: LocaleCode): Promise<boolean> {
		if (!locale) {
			return false;
		}
		if (this.settings.localizedLocale === locale) {
			return false;
		}
		this.settings.localizedLocale = locale;
		await this.persist();
		return true;
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

	getStripeColorMode(): StripeColorMode {
		return this.settings.stripeColorMode;
	}

	async setStripeColorMode(mode: StripeColorMode): Promise<boolean> {
		if (this.settings.stripeColorMode === mode) {
			return false;
		}
		this.settings.stripeColorMode = mode;
		await this.persist();
		return true;
	}

	getStripeCustomColor(): string | null {
		return this.settings.stripeCustomColor;
	}

	async setStripeCustomColor(value: string | null): Promise<boolean> {
		const sanitized = this.sanitizeColorValue(value);
		if (this.settings.stripeCustomColor === sanitized) {
			return false;
		}
		this.settings.stripeCustomColor = sanitized;
		await this.persist();
		return true;
	}

	getBorderContrast(): number {
		return this.settings.borderContrast;
	}

	async setBorderContrast(value: number): Promise<boolean> {
		const clamped = Math.min(1, Math.max(0, value));
		if (this.settings.borderContrast === clamped) {
			return false;
		}
		this.settings.borderContrast = clamped;
		await this.persist();
		return true;
	}

	getBorderColorMode(): BorderColorMode {
		return this.settings.borderColorMode;
	}

	async setBorderColorMode(mode: BorderColorMode): Promise<boolean> {
		if (this.settings.borderColorMode === mode) {
			return false;
		}
		this.settings.borderColorMode = mode;
		await this.persist();
		return true;
	}

	getBorderCustomColor(): string | null {
		return this.settings.borderCustomColor;
	}

	async setBorderCustomColor(value: string | null): Promise<boolean> {
		const sanitized = this.sanitizeColorValue(value);
		if (this.settings.borderCustomColor === sanitized) {
			return false;
		}
		this.settings.borderCustomColor = sanitized;
		await this.persist();
		return true;
	}

	async persist(): Promise<void> {
		await this.plugin.saveData(this.settings);
	}

	shouldAutoOpen(filePath: string): boolean {
		const pref = this.settings.fileViewPrefs[filePath];
		return pref === 'table' || pref === 'kanban' || pref === 'slide';
	}

	getFileViewPreference(filePath: string): 'markdown' | 'table' | 'kanban' | 'slide' | null {
		const pref = this.settings.fileViewPrefs[filePath];
		return typeof pref === 'string' ? pref : null;
	}

	async setFileViewPreference(
		filePath: string,
		view: 'markdown' | 'table' | 'kanban' | 'slide'
	): Promise<boolean> {
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

	async setColumnLayout(filePath: string, layout: Record<string, number> | null | undefined): Promise<void> {
		const { changed } = applyColumnLayout(this.settings, filePath, layout);
		if (changed) {
			await this.persist();
		}
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
		return cloneTagGroupState(stored ?? null);
	}

	async saveTagGroupsForFile(filePath: string, state: FileTagGroupState): Promise<FileTagGroupState> {
		const sanitized = cloneTagGroupState(state);
		this.settings.tagGroups[filePath] = sanitized;
		await this.persist();
		return sanitized;
	}

	getColumnConfigsForFile(filePath: string): string[] | null {
		return getColumnConfigs(this.settings, filePath);
	}

	async saveColumnConfigsForFile(filePath: string, configs: string[] | null): Promise<string[] | null> {
		return saveColumnConfigs(this.settings, filePath, configs, () => this.persist());
	}

	getCopyTemplateForFile(filePath: string): string | null {
		return getCopyTemplate(this.settings, filePath);
	}

	async saveCopyTemplateForFile(filePath: string, template: string | null): Promise<string | null> {
		return saveCopyTemplate(this.settings, filePath, template, () => this.persist());
	}
	getKanbanPreferencesForFile(filePath: string): KanbanViewPreferenceConfig | null {
		return getKanbanPreferences(this.settings, filePath);
	}

	async saveKanbanPreferencesForFile(
		filePath: string,
		preferences: KanbanViewPreferenceConfig | null | undefined
	): Promise<KanbanViewPreferenceConfig | null> {
		return saveKanbanPreferences(this.settings, filePath, preferences, () => this.persist());
	}

	getKanbanBoardsForFile(filePath: string): KanbanBoardState {
		const stored = this.settings.kanbanBoards[filePath];
		return cloneKanbanBoardState(stored ?? null, (value) => this.deepClone(value));
	}

	async saveKanbanBoardsForFile(filePath: string, state: KanbanBoardState): Promise<KanbanBoardState> {
		const sanitized = cloneKanbanBoardState(state, (value) => this.deepClone(value));
		this.settings.kanbanBoards[filePath] = sanitized;
		await this.persist();
		return sanitized;
	}

	getSlidePreferencesForFile(filePath: string): SlideViewConfig | null {
		const stored = getSlidePreferences(this.settings, filePath);
		if (stored) {
			return stored;
		}
		const globalDefault = this.getDefaultSlideConfig();
		return globalDefault ? normalizeSlideViewConfig(globalDefault) : null;
	}

	async saveSlidePreferencesForFile(
		filePath: string,
		preferences: SlideViewConfig | null | undefined
	): Promise<SlideViewConfig | null> {
		return saveSlidePreferences(this.settings, filePath, preferences, () => this.persist());
	}

	getDefaultSlideConfig(): SlideViewConfig | null {
		const stored = this.settings.defaultSlideConfig;
		return stored ? normalizeSlideViewConfig(stored) : null;
	}

	async setDefaultSlideConfig(preferences: SlideViewConfig | null): Promise<SlideViewConfig | null> {
		const normalized = preferences ? normalizeSlideViewConfig(preferences) : null;
		const next = normalized && !isDefaultSlideViewConfig(normalized) ? normalized : null;
		const previous = this.getDefaultSlideConfig();
		const unchanged =
			(next === null && previous === null) ||
			(next !== null && previous !== null && JSON.stringify(next) === JSON.stringify(previous));
		if (unchanged) {
			return previous;
		}
		this.settings.defaultSlideConfig = next;
		await this.persist();
		return next;
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
		const sanitizedIcon = this.sanitizeIconId(source.icon);
		return {
			id: source.id,
			name: source.name,
			filterRule: source.filterRule != null ? this.deepClone(source.filterRule) : null,
			sortRules,
			columnState: source.columnState != null ? this.deepClone(source.columnState) : null,
			quickFilter: source.quickFilter ?? null,
			icon: sanitizedIcon
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
		const result: FilterViewMetadata = {};
		if (metadata?.statusBaselineSeeded) {
			result.statusBaselineSeeded = true;
		}
		const defaultView = this.cloneDefaultViewPreferences(metadata?.defaultView);
		if (defaultView) {
			result.defaultView = defaultView;
		}
		return result;
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

	private sanitizeDefaultSlideConfig(raw: unknown): SlideViewConfig | null {
		if (!raw || typeof raw !== 'object') {
			return null;
		}
		const normalized = normalizeSlideViewConfig(raw as SlideViewConfig);
		return isDefaultSlideViewConfig(normalized) ? null : normalized;
	}

	private sanitizeIconId(icon: unknown): string | null {
		if (typeof icon !== 'string') {
			return null;
		}
		const trimmed = icon.trim();
		return trimmed.length > 0 ? trimmed : null;
	}

	private cloneDefaultViewPreferences(source: DefaultFilterViewPreferences | null | undefined): DefaultFilterViewPreferences | null {
		if (!source) {
			return null;
		}
		const result: DefaultFilterViewPreferences = {};
		const name = typeof source.name === 'string' ? source.name.trim() : '';
		if (name) {
			result.name = name;
		}
		const icon = this.sanitizeIconId(source.icon);
		if (icon) {
			result.icon = icon;
		}
		return Object.keys(result).length > 0 ? result : null;
	}

	private sanitizeColorValue(value: unknown): string | null {
		if (typeof value !== 'string') {
			return null;
		}
		const trimmed = value.trim();
		return trimmed.length === 0 ? null : trimmed;
	}



}
