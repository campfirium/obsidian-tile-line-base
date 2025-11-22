export type SlideThemeId = 'basic';

export interface SlideTemplateConfig {
	titleTemplate: string;
	bodyTemplate: string;
}

export interface SlideViewConfig {
	template: SlideTemplateConfig;
	theme: SlideThemeId;
}

export const DEFAULT_SLIDE_THEME: SlideThemeId = 'basic';

export const DEFAULT_SLIDE_TEMPLATE: SlideTemplateConfig = {
	titleTemplate: '',
	bodyTemplate: ''
};

export const DEFAULT_SLIDE_VIEW_CONFIG: SlideViewConfig = {
	template: DEFAULT_SLIDE_TEMPLATE,
	theme: DEFAULT_SLIDE_THEME
};

const normalizeTemplateString = (value: unknown): string => {
	if (typeof value !== 'string') {
		return '';
	}
	return value.replace(/\r\n/g, '\n').trimEnd();
};

export function sanitizeSlideTemplateConfig(config: unknown): SlideTemplateConfig {
	if (!config || typeof config !== 'object') {
		return { ...DEFAULT_SLIDE_TEMPLATE };
	}
	return {
		titleTemplate: normalizeTemplateString((config as Record<string, unknown>).titleTemplate),
		bodyTemplate: normalizeTemplateString((config as Record<string, unknown>).bodyTemplate)
	};
}

export function normalizeSlideViewConfig(config: unknown): SlideViewConfig {
	if (!config || typeof config !== 'object') {
		return { ...DEFAULT_SLIDE_VIEW_CONFIG, template: { ...DEFAULT_SLIDE_TEMPLATE } };
	}

	const template = sanitizeSlideTemplateConfig((config as Record<string, unknown>).template);
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
	return (
		(config.theme ?? DEFAULT_SLIDE_THEME) === DEFAULT_SLIDE_THEME &&
		(template.titleTemplate ?? '') === DEFAULT_SLIDE_TEMPLATE.titleTemplate &&
		(template.bodyTemplate ?? '') === DEFAULT_SLIDE_TEMPLATE.bodyTemplate
	);
}
