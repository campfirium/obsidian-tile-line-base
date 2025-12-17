import type { TileLineBaseSettings } from './SettingsService';
import type { KanbanViewPreferenceConfig } from '../types/kanban';
import {
	DEFAULT_KANBAN_FONT_SCALE,
	DEFAULT_KANBAN_HEIGHT_MODE,
	sanitizeKanbanFontScale
} from '../types/kanban';
import type { SlideViewConfig } from '../types/slide';
import {
	DEFAULT_SLIDE_VIEW_CONFIG,
	isDefaultSlideViewConfig,
	normalizeSlideViewConfig
} from '../types/slide';

type PersistFn = () => Promise<void>;

export function getColumnConfigs(settings: TileLineBaseSettings, filePath: string): string[] | null {
	const stored = settings.columnConfigs[filePath];
	if (!Array.isArray(stored) || stored.length === 0) {
		return null;
	}
	return stored.map((entry) => (typeof entry === 'string' ? entry : '')).filter((entry) => entry.length > 0);
}

export async function saveColumnConfigs(
	settings: TileLineBaseSettings,
	filePath: string,
	configs: string[] | null,
	persist: PersistFn
): Promise<string[] | null> {
	const sanitized = sanitizeColumnConfigList(configs);
	if (!sanitized) {
		if (settings.columnConfigs[filePath]) {
			delete settings.columnConfigs[filePath];
			await persist();
		}
		return null;
	}
	settings.columnConfigs[filePath] = sanitized;
	await persist();
	return sanitized;
}

export function getCopyTemplate(settings: TileLineBaseSettings, filePath: string): string | null {
	const template = settings.copyTemplates[filePath];
	if (typeof template !== 'string') {
		return null;
	}
	const normalized = template.replace(/\r\n/g, '\n').trimEnd();
	return normalized.length > 0 ? normalized : null;
}

export async function saveCopyTemplate(
	settings: TileLineBaseSettings,
	filePath: string,
	template: string | null,
	persist: PersistFn
): Promise<string | null> {
	const normalized = typeof template === 'string' ? template.replace(/\r\n/g, '\n') : '';
	if (normalized.trim().length === 0) {
		if (settings.copyTemplates[filePath]) {
			delete settings.copyTemplates[filePath];
			await persist();
		}
		return null;
	}
	settings.copyTemplates[filePath] = normalized;
	await persist();
	return normalized;
}

export function getKanbanPreferences(
	settings: TileLineBaseSettings,
	filePath: string
): KanbanViewPreferenceConfig | null {
	const stored = settings.kanbanPreferences[filePath];
	if (!stored) {
		return null;
	}
	return cloneKanbanPreferences(stored);
}

export async function saveKanbanPreferences(
	settings: TileLineBaseSettings,
	filePath: string,
	preferences: KanbanViewPreferenceConfig | null | undefined,
	persist: PersistFn
): Promise<KanbanViewPreferenceConfig | null> {
	const sanitized = sanitizeKanbanPreferences(preferences);
	if (!sanitized) {
		if (settings.kanbanPreferences[filePath]) {
			delete settings.kanbanPreferences[filePath];
			await persist();
		}
		return null;
	}
	settings.kanbanPreferences[filePath] = sanitized;
	await persist();
	return sanitized;
}

export function applyColumnLayout(
	settings: TileLineBaseSettings,
	filePath: string,
	layout: Record<string, number> | null | undefined
): { changed: boolean; next: Record<string, number> | undefined } {
	if (!filePath) {
		return { changed: false, next: undefined };
	}
	if (!layout || Object.keys(layout).length === 0) {
		const existed = Boolean(settings.columnLayouts[filePath]);
		if (existed) {
			delete settings.columnLayouts[filePath];
		}
		return { changed: existed, next: undefined };
	}
	const sanitized: Record<string, number> = {};
	for (const [field, width] of Object.entries(layout)) {
		if (!field) {
			continue;
		}
		const numeric = typeof width === 'number' && Number.isFinite(width) ? Math.round(width) : Number.NaN;
		if (!Number.isNaN(numeric)) {
			sanitized[field] = numeric;
		}
	}
	settings.columnLayouts[filePath] = sanitized;
	return { changed: true, next: sanitized };
}

function sanitizeColumnConfigList(source: string[] | null | undefined): string[] | null {
	if (!Array.isArray(source)) {
		return null;
	}
	const sanitized = source
		.map((entry) => (typeof entry === 'string' ? entry : ''))
		.filter((entry) => entry.length > 0);
	return sanitized.length > 0 ? sanitized : null;
}

export function getSlidePreferences(settings: TileLineBaseSettings, filePath: string): SlideViewConfig | null {
	const stored = settings.slidePreferences[filePath];
	if (!stored) {
		return null;
	}
	return normalizeSlideViewConfig(stored);
}

export async function saveSlidePreferences(
	settings: TileLineBaseSettings,
	filePath: string,
	preferences: SlideViewConfig | null | undefined,
	persist: PersistFn
): Promise<SlideViewConfig | null> {
	const normalized = normalizeSlideViewConfig(preferences ?? DEFAULT_SLIDE_VIEW_CONFIG);
	const globalDefault = settings.defaultSlideConfig ? normalizeSlideViewConfig(settings.defaultSlideConfig) : null;
	const matchesGlobalDefault =
		globalDefault ? JSON.stringify(normalized) === JSON.stringify(globalDefault) : false;
	if (isDefaultSlideViewConfig(normalized) || matchesGlobalDefault) {
		if (settings.slidePreferences[filePath]) {
			delete settings.slidePreferences[filePath];
			await persist();
		}
		return null;
	}
	settings.slidePreferences[filePath] = normalized;
	await persist();
	return normalized;
}

export function getGalleryPreferences(settings: TileLineBaseSettings, filePath: string): SlideViewConfig | null {
	const stored = settings.galleryPreferences[filePath];
	if (!stored) {
		return null;
	}
	return normalizeSlideViewConfig(stored);
}

export async function saveGalleryPreferences(
	settings: TileLineBaseSettings,
	filePath: string,
	preferences: SlideViewConfig | null | undefined,
	persist: PersistFn
): Promise<SlideViewConfig | null> {
	const normalized = normalizeSlideViewConfig(preferences ?? DEFAULT_SLIDE_VIEW_CONFIG);
	const globalDefault = settings.defaultGalleryConfig ? normalizeSlideViewConfig(settings.defaultGalleryConfig) : null;
	const matchesGlobalDefault = globalDefault ? JSON.stringify(normalized) === JSON.stringify(globalDefault) : false;
	if (isDefaultSlideViewConfig(normalized) || matchesGlobalDefault) {
		if (settings.galleryPreferences[filePath]) {
			delete settings.galleryPreferences[filePath];
			await persist();
		}
		return null;
	}
	settings.galleryPreferences[filePath] = normalized;
	await persist();
	return normalized;
}

function sanitizeKanbanPreferences(
	source: KanbanViewPreferenceConfig | null | undefined
): KanbanViewPreferenceConfig | null {
	if (!source || typeof source !== 'object') {
		return null;
	}
	const laneField = typeof source.laneField === 'string' ? source.laneField.trim() : '';
	if (!laneField) {
		return null;
	}
	const result: KanbanViewPreferenceConfig = { laneField };
	const sortField = typeof source.sortField === 'string' ? source.sortField.trim() : '';
	if (sortField) {
		result.sortField = sortField;
	}
	const sortDirection = source.sortDirection === 'desc' ? 'desc' : source.sortDirection === 'asc' ? 'asc' : null;
	if (sortDirection && sortField) {
		result.sortDirection = sortDirection;
	}
	const heightMode = source.heightMode === 'viewport' ? 'viewport' : source.heightMode === 'auto' ? 'auto' : null;
	if (heightMode && heightMode !== DEFAULT_KANBAN_HEIGHT_MODE) {
		result.heightMode = heightMode;
	}
	if (source.fontScale !== undefined) {
		const sanitizedScale = sanitizeKanbanFontScale(source.fontScale);
		if (Math.abs(sanitizedScale - DEFAULT_KANBAN_FONT_SCALE) > 0.001) {
			result.fontScale = sanitizedScale;
		}
	}
	if (source.multiRow === false) {
		result.multiRow = false;
	}
	return result;
}

function cloneKanbanPreferences(source: KanbanViewPreferenceConfig): KanbanViewPreferenceConfig {
	return {
		laneField: source.laneField,
		sortField: typeof source.sortField === 'string' ? source.sortField : undefined,
		sortDirection: source.sortDirection === 'desc' ? 'desc' : source.sortDirection === 'asc' ? 'asc' : undefined,
		heightMode: source.heightMode === 'viewport' ? 'viewport' : source.heightMode === 'auto' ? 'auto' : undefined,
		fontScale: typeof source.fontScale === 'number' ? source.fontScale : undefined,
		multiRow: source.multiRow === false ? false : undefined
	};
}
