export type SlideThemeId = 'basic';

export interface SlideTemplateConfig {
	titleTemplate: string;
	bodyTemplate: string;
	textColor?: string;
	backgroundColor?: string;
	titleLayout?: SlideLayoutConfig;
	bodyLayout?: SlideLayoutConfig;
}

export interface SlideLayoutConfig {
	widthPct: number;
	topPct: number;
	align: 'left' | 'center' | 'right';
	lineHeight: number;
	fontSize: number;
	fontWeight: number;
}

export interface SlideViewConfig {
	template: SlideTemplateConfig;
	theme: SlideThemeId;
}

export const DEFAULT_SLIDE_THEME: SlideThemeId = 'basic';

export const DEFAULT_SLIDE_TEMPLATE: SlideTemplateConfig = {
	titleTemplate: '',
	bodyTemplate: '',
	textColor: '',
	backgroundColor: '',
	titleLayout: undefined,
	bodyLayout: undefined
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

const normalizeColorString = (value: unknown): string => {
	if (typeof value !== 'string') {
		return '';
	}
	return value.trim();
};

const clampPct = (value: number): number => Math.min(100, Math.max(0, value));

const normalizeNumber = (value: unknown, fallback: number): number => {
	const num = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(num) ? num : fallback;
};

const DEFAULT_TITLE_LAYOUT: SlideLayoutConfig = {
	widthPct: 80,
	topPct: 12,
	align: 'center',
	lineHeight: 1.2,
	fontSize: 1.8,
	fontWeight: 700
};

const DEFAULT_BODY_LAYOUT: SlideLayoutConfig = {
	widthPct: 90,
	topPct: 38,
	align: 'left',
	lineHeight: 1.5,
	fontSize: 1,
	fontWeight: 400
};

export function getDefaultTitleLayout(): SlideLayoutConfig {
	return { ...DEFAULT_TITLE_LAYOUT };
}

export function getDefaultBodyLayout(): SlideLayoutConfig {
	return { ...DEFAULT_BODY_LAYOUT };
}

const normalizeLayout = (value: unknown, defaults: SlideLayoutConfig): SlideLayoutConfig => {
	if (!value || typeof value !== 'object') {
		return { ...defaults };
	}
	const raw = value as Record<string, unknown>;
	const align = raw.align === 'left' || raw.align === 'right' || raw.align === 'center' ? raw.align : defaults.align;
	const widthPct = clampPct(normalizeNumber(raw.widthPct, defaults.widthPct));
	const topPct = clampPct(normalizeNumber(raw.topPct, defaults.topPct));
	const lineHeight = normalizeNumber(raw.lineHeight, defaults.lineHeight);
	const fontSize = normalizeNumber(raw.fontSize, defaults.fontSize);
	const fontWeight = normalizeNumber(raw.fontWeight, defaults.fontWeight);
	return {
		widthPct,
		topPct,
		align,
		lineHeight,
		fontSize,
		fontWeight
	};
};

export function sanitizeSlideTemplateConfig(config: unknown): SlideTemplateConfig {
	if (!config || typeof config !== 'object') {
		return { ...DEFAULT_SLIDE_TEMPLATE };
	}
	return {
		titleTemplate: normalizeTemplateString((config as Record<string, unknown>).titleTemplate),
		bodyTemplate: normalizeTemplateString((config as Record<string, unknown>).bodyTemplate),
		textColor: normalizeColorString((config as Record<string, unknown>).textColor),
		backgroundColor: normalizeColorString((config as Record<string, unknown>).backgroundColor),
		titleLayout: normalizeLayout((config as Record<string, unknown>).titleLayout, DEFAULT_TITLE_LAYOUT),
		bodyLayout: normalizeLayout((config as Record<string, unknown>).bodyLayout, DEFAULT_BODY_LAYOUT)
	};
}

export function normalizeSlideViewConfig(config: unknown): SlideViewConfig {
	if (!config || typeof config !== 'object') {
		return {
			...DEFAULT_SLIDE_VIEW_CONFIG,
			template: {
				...DEFAULT_SLIDE_TEMPLATE,
				titleLayout: getDefaultTitleLayout(),
				bodyLayout: getDefaultBodyLayout()
			}
		};
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
		(template.bodyTemplate ?? '') === DEFAULT_SLIDE_TEMPLATE.bodyTemplate &&
		(template.textColor ?? '') === DEFAULT_SLIDE_TEMPLATE.textColor &&
		(template.backgroundColor ?? '') === DEFAULT_SLIDE_TEMPLATE.backgroundColor &&
		JSON.stringify(template.titleLayout ?? {}) === JSON.stringify(getDefaultTitleLayout()) &&
		JSON.stringify(template.bodyLayout ?? {}) === JSON.stringify(getDefaultBodyLayout())
	);
}
