import {
	DEFAULT_SLIDE_TEMPLATE,
	sanitizeSlideTemplateConfig,
	type SlideTemplateConfig,
	type SlideTextTemplate
} from '../../types/slide';

export const RESERVED_SLIDE_FIELDS = new Set(['#', '__tlb_row_id', '__tlb_status', '__tlb_index', 'status', 'statusChanged']);

let cachedBaseTemplate: SlideTemplateConfig | null = null;

const normalizeFieldList = (fields: string[]): string[] => {
	const seen = new Set<string>();
	const normalized: string[] = [];
	for (const field of fields) {
		const trimmed = (field ?? '').trim();
		const lower = trimmed.toLowerCase();
		if (!trimmed || RESERVED_SLIDE_FIELDS.has(trimmed) || seen.has(lower)) {
			continue;
		}
		seen.add(lower);
		normalized.push(trimmed);
	}
	return normalized;
};

const pickPrimaryField = (fields: string[]): string | null => {
	if (fields.length === 0) return null;
	return fields[0];
};

const applyTemplates = (template: SlideTextTemplate, title: string, body: string): SlideTextTemplate => ({
	...template,
	titleTemplate: title || template.titleTemplate || '',
	bodyTemplate: body || template.bodyTemplate || ''
});

const resolveBaseTemplate = (base: SlideTemplateConfig | undefined): SlideTemplateConfig => {
	if (!cachedBaseTemplate) {
		cachedBaseTemplate = sanitizeSlideTemplateConfig(base ?? DEFAULT_SLIDE_TEMPLATE);
	}
	return cachedBaseTemplate;
};

export function buildBuiltInSlideTemplate(fields: string[], base?: SlideTemplateConfig): SlideTemplateConfig {
	const normalizedFields = normalizeFieldList(fields);
	const normalizedBase = resolveBaseTemplate(base);
	const primaryField = pickPrimaryField(normalizedFields);
	const titleTemplate = primaryField ? `{${primaryField}}` : '';
	const bodyFields = normalizedFields.filter((field) => field !== primaryField);
	const bodyTemplate = bodyFields.length > 0 ? bodyFields.map((field) => `{${field}}`).join('\n') : '';

	const merged: SlideTemplateConfig = {
		...normalizedBase,
		single: {
			withImage: {
				...normalizedBase.single.withImage,
				...applyTemplates(normalizedBase.single.withImage, titleTemplate, bodyTemplate),
				imageTemplate: ''
			},
			withoutImage: applyTemplates(normalizedBase.single.withoutImage, titleTemplate, bodyTemplate)
		},
		split: {
			withImage: {
				...normalizedBase.split.withImage,
				imageTemplate: '',
				textPage: applyTemplates(normalizedBase.split.withImage.textPage, titleTemplate, bodyTemplate)
			},
			withoutImage: applyTemplates(normalizedBase.split.withoutImage, titleTemplate, bodyTemplate)
		}
	};

	return sanitizeSlideTemplateConfig(merged);
}
