export type SlideThemeId = 'basic';

export interface SlideTemplateConfig {
	titleField: string | null;
	bodyFields: string[];
	tagFields: string[];
	includeEmptyFields: boolean;
	showIndex: boolean;
	fieldClassNames?: Record<string, string>;
}

export interface SlideViewConfig {
	template: SlideTemplateConfig;
	theme: SlideThemeId;
}

export const DEFAULT_SLIDE_THEME: SlideThemeId = 'basic';

export const DEFAULT_SLIDE_TEMPLATE: SlideTemplateConfig = {
	titleField: null,
	bodyFields: [],
	tagFields: [],
	includeEmptyFields: false,
	showIndex: true,
	fieldClassNames: {}
};

export const DEFAULT_SLIDE_VIEW_CONFIG: SlideViewConfig = {
	template: DEFAULT_SLIDE_TEMPLATE,
	theme: DEFAULT_SLIDE_THEME
};

const RESERVED_FIELDS = new Set(['#', '__tlb_row_id', '__tlb_status', '__tlb_index', 'statusChanged']);

const normalizeFieldList = (source: unknown, availableFields?: string[]): string[] => {
	if (!Array.isArray(source)) {
		return [];
	}
	const allowed = new Set(
		(availableFields ?? []).filter((field) => typeof field === 'string' && field.trim().length > 0)
	);
	const result: string[] = [];
	const seen = new Set<string>();
	for (const entry of source) {
		if (typeof entry !== 'string') {
			continue;
		}
		const trimmed = entry.trim();
		if (!trimmed || RESERVED_FIELDS.has(trimmed)) {
			continue;
		}
		if (allowed.size > 0 && !allowed.has(trimmed)) {
			continue;
		}
		if (seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		result.push(trimmed);
	}
	return result;
};

const normalizeFieldClassNames = (
	source: unknown,
	allowedFields: Set<string>
): Record<string, string> | undefined => {
	if (!source || typeof source !== 'object') {
		return undefined;
	}
	const entries: Array<[string, string]> = [];
	for (const [rawKey, rawValue] of Object.entries(source as Record<string, unknown>)) {
		if (typeof rawKey !== 'string' || typeof rawValue !== 'string') {
			continue;
		}
		const key = rawKey.trim();
		const value = rawValue.trim();
		if (!key || !value || RESERVED_FIELDS.has(key)) {
			continue;
		}
		if (allowedFields.size > 0 && !allowedFields.has(key)) {
			continue;
		}
		entries.push([key, value]);
	}
	if (entries.length === 0) {
		return undefined;
	}
	return Object.fromEntries(entries);
};

export function sanitizeSlideTemplateConfig(
	config: unknown,
	availableFields?: string[]
): SlideTemplateConfig {
	const template: SlideTemplateConfig = { ...DEFAULT_SLIDE_TEMPLATE, fieldClassNames: {} };
	if (!config || typeof config !== 'object') {
		return template;
	}

	const allowedSet = new Set(
		(availableFields ?? []).filter((field) => typeof field === 'string' && field.trim().length > 0)
	);

	if (typeof (config as Record<string, unknown>).titleField === 'string') {
		const titleCandidate = (config as Record<string, unknown>).titleField as string;
		const trimmed = titleCandidate.trim();
		if (trimmed && !RESERVED_FIELDS.has(trimmed) && (allowedSet.size === 0 || allowedSet.has(trimmed))) {
			template.titleField = trimmed;
		}
	}

	template.bodyFields = normalizeFieldList((config as Record<string, unknown>).bodyFields, availableFields);
	template.tagFields = normalizeFieldList((config as Record<string, unknown>).tagFields, availableFields);

	if (typeof (config as Record<string, unknown>).includeEmptyFields === 'boolean') {
		template.includeEmptyFields = (config as Record<string, unknown>).includeEmptyFields as boolean;
	}
	if (typeof (config as Record<string, unknown>).showIndex === 'boolean') {
		template.showIndex = (config as Record<string, unknown>).showIndex as boolean;
	}

	const allowedForClass = new Set<string>([
		...template.bodyFields,
		...template.tagFields,
		template.titleField ?? ''
	].filter(Boolean));
	const classNames = normalizeFieldClassNames(
		(config as Record<string, unknown>).fieldClassNames,
		allowedForClass
	);
	template.fieldClassNames = classNames ?? {};

	return template;
}

export function normalizeSlideViewConfig(
	config: unknown,
	availableFields?: string[]
): SlideViewConfig {
	if (!config || typeof config !== 'object') {
		return { ...DEFAULT_SLIDE_VIEW_CONFIG, template: { ...DEFAULT_SLIDE_TEMPLATE, fieldClassNames: {} } };
	}

	const template = sanitizeSlideTemplateConfig(
		(config as Record<string, unknown>).template,
		availableFields
	);
	const theme =
		(config as Record<string, unknown>).theme === 'basic'
			? 'basic'
			: DEFAULT_SLIDE_THEME;

	return {
		template,
		theme
	};
}

export function isDefaultSlideViewConfig(config: SlideViewConfig | null | undefined): boolean {
	if (!config) {
		return true;
	}
	const template = config.template ?? DEFAULT_SLIDE_TEMPLATE;
	const classNames = template.fieldClassNames ?? {};
	const classNameKeys = Object.keys(classNames);
	return (
		(config.theme ?? DEFAULT_SLIDE_THEME) === DEFAULT_SLIDE_THEME &&
		(template.titleField ?? null) === DEFAULT_SLIDE_TEMPLATE.titleField &&
		(template.includeEmptyFields ?? false) === DEFAULT_SLIDE_TEMPLATE.includeEmptyFields &&
		(template.showIndex ?? true) === DEFAULT_SLIDE_TEMPLATE.showIndex &&
		(template.bodyFields?.length ?? 0) === 0 &&
		(template.tagFields?.length ?? 0) === 0 &&
		classNameKeys.length === 0
	);
}
