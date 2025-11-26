export type SlideThemeId = 'basic';
export type SlideMode = 'single' | 'split';

export interface SlideTextTemplate {
	titleTemplate: string;
	bodyTemplate: string;
	titleLayout?: SlideLayoutConfig;
	bodyLayout?: SlideLayoutConfig;
}

export interface SlideSingleTemplate {
	withImage: SlideTextTemplate & { imageTemplate: string; imageLayout?: SlideLayoutConfig };
	withoutImage: SlideTextTemplate;
}

export interface SlideSplitTemplate {
	withImage: {
		imageTemplate: string;
		textPage: SlideTextTemplate;
		imageLayout?: SlideLayoutConfig;
	};
	withoutImage: SlideTextTemplate;
}

export interface SlideTemplateConfig {
	mode: SlideMode;
	single: SlideSingleTemplate;
	split: SlideSplitTemplate;
	textColor?: string;
	backgroundColor?: string;
}

export interface SlideLayoutConfig {
	widthPct: number;
	topPct: number;
	insetPct: number;
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

const DEFAULT_TEXT_TEMPLATE: SlideTextTemplate = {
	titleTemplate: '',
	bodyTemplate: '',
	titleLayout: undefined,
	bodyLayout: undefined
};

export const DEFAULT_SLIDE_TEMPLATE: SlideTemplateConfig = {
	mode: 'single',
	single: {
		withImage: {
			...DEFAULT_TEXT_TEMPLATE,
			imageTemplate: '',
			imageLayout: undefined
		},
		withoutImage: { ...DEFAULT_TEXT_TEMPLATE }
	},
	split: {
		withImage: {
			imageTemplate: '',
			textPage: { ...DEFAULT_TEXT_TEMPLATE },
			imageLayout: undefined
		},
		withoutImage: { ...DEFAULT_TEXT_TEMPLATE }
	},
	textColor: '',
	backgroundColor: ''
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
	insetPct: 0,
	align: 'center',
	lineHeight: 1.2,
	fontSize: 1.8,
	fontWeight: 700
};

const DEFAULT_BODY_LAYOUT: SlideLayoutConfig = {
	widthPct: 90,
	topPct: 38,
	insetPct: 0,
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
	const insetPct = clampPct(normalizeNumber(raw.insetPct, defaults.insetPct));
	const lineHeight = normalizeNumber(raw.lineHeight, defaults.lineHeight);
	const fontSize = normalizeNumber(raw.fontSize, defaults.fontSize);
	const fontWeight = normalizeNumber(raw.fontWeight, defaults.fontWeight);
	return {
		widthPct,
		topPct,
		insetPct,
		align,
		lineHeight,
		fontSize,
		fontWeight
	};
};

const normalizeTextTemplate = (value: unknown): SlideTextTemplate => {
	const defaults = DEFAULT_TEXT_TEMPLATE;
	if (!value || typeof value !== 'object') {
		return {
			...defaults,
			titleLayout: getDefaultTitleLayout(),
			bodyLayout: getDefaultBodyLayout()
		};
	}
	const raw = value as Record<string, unknown>;
	return {
		titleTemplate: normalizeTemplateString(raw.titleTemplate),
		bodyTemplate: normalizeTemplateString(raw.bodyTemplate),
		titleLayout: normalizeLayout(raw.titleLayout, DEFAULT_TITLE_LAYOUT),
		bodyLayout: normalizeLayout(raw.bodyLayout, DEFAULT_BODY_LAYOUT)
	};
};

function migrateLegacyTemplate(legacy: Record<string, unknown>): SlideTemplateConfig {
	const baseText = normalizeTextTemplate(legacy);
	const textColor = normalizeColorString(legacy.textColor);
	const backgroundColor = normalizeColorString(legacy.backgroundColor);
	const legacyImageField =
		typeof legacy.imageField === 'string' && legacy.imageField.trim().length > 0
			? legacy.imageField.trim()
			: null;
	const legacyImageTemplate = legacyImageField ? `{${legacyImageField}}` : '';
	return {
		mode: 'single',
		single: {
			withImage: {
				...baseText,
				imageTemplate: legacyImageTemplate,
				imageLayout: getDefaultBodyLayout()
			},
			withoutImage: baseText
		},
		split: {
			withImage: {
				imageTemplate: legacyImageTemplate,
				textPage: baseText,
				imageLayout: getDefaultBodyLayout()
			},
			withoutImage: baseText
		},
		textColor,
		backgroundColor
	};
}

export function sanitizeSlideTemplateConfig(config: unknown): SlideTemplateConfig {
	if (!config || typeof config !== 'object') {
		return sanitizeSlideTemplateConfig(DEFAULT_SLIDE_TEMPLATE);
	}

	const raw = config as Record<string, unknown>;

	if (raw.titleTemplate !== undefined || raw.bodyTemplate !== undefined) {
		return migrateLegacyTemplate(raw);
	}

	const mode = raw.mode === 'split' ? 'split' : 'single';
	const textColor = normalizeColorString(raw.textColor);
	const backgroundColor = normalizeColorString(raw.backgroundColor);

	const singleRaw = raw.single as Record<string, unknown> | undefined;
	const splitRaw = raw.split as Record<string, unknown> | undefined;

	const singleWithImageRaw = (singleRaw?.withImage ?? null) as Record<string, unknown> | null;
	const singleWithoutRaw = (singleRaw?.withoutImage ?? null) as Record<string, unknown> | null;
	const splitWithImageRaw = (splitRaw?.withImage ?? null) as Record<string, unknown> | null;
	const splitWithoutRaw = (splitRaw?.withoutImage ?? null) as Record<string, unknown> | null;

	const resolveImageTemplate = (raw: Record<string, unknown> | null | undefined): string => {
		const templateText = normalizeTemplateString(raw?.imageTemplate);
		if (templateText) {
			return templateText;
		}
		const legacyField = typeof raw?.imageField === 'string' ? raw.imageField.trim() : '';
		return legacyField ? `{${legacyField}}` : '';
	};

	const single: SlideSingleTemplate = {
		withImage: {
			...normalizeTextTemplate(singleWithImageRaw),
			imageTemplate: resolveImageTemplate(singleWithImageRaw),
			imageLayout: normalizeLayout(singleWithImageRaw?.imageLayout, DEFAULT_BODY_LAYOUT)
		},
		withoutImage: normalizeTextTemplate(singleWithoutRaw)
	};

	const split: SlideSplitTemplate = {
		withImage: {
			imageTemplate: resolveImageTemplate(splitWithImageRaw),
			textPage: normalizeTextTemplate(splitWithImageRaw?.textPage),
			imageLayout: normalizeLayout(
				splitWithImageRaw?.imageLayout ??
					(splitWithImageRaw?.imagePage as Record<string, unknown> | null | undefined)?.imageLayout,
				DEFAULT_BODY_LAYOUT
			)
		},
		withoutImage: normalizeTextTemplate(splitWithoutRaw)
	};

	return {
		mode,
		single,
		split,
		textColor,
		backgroundColor
	};
}

export function normalizeSlideViewConfig(config: unknown): SlideViewConfig {
	if (!config || typeof config !== 'object') {
		return {
			...DEFAULT_SLIDE_VIEW_CONFIG,
			template: sanitizeSlideTemplateConfig(DEFAULT_SLIDE_TEMPLATE)
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
	const defaultTemplate = sanitizeSlideTemplateConfig(DEFAULT_SLIDE_TEMPLATE);
	return (
		(config.theme ?? DEFAULT_SLIDE_THEME) === DEFAULT_SLIDE_THEME &&
		JSON.stringify(template) === JSON.stringify(defaultTemplate)
	);
}
