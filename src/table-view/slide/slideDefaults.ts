import {
	DEFAULT_SLIDE_TEMPLATE,
	sanitizeSlideTemplateConfig,
	type SlideTemplateConfig,
	type SlideTextTemplate
} from '../../types/slide';

export const RESERVED_SLIDE_FIELDS = new Set(['#', '__tlb_row_id', '__tlb_status', '__tlb_index', 'status', 'statusChanged']);

const BUILT_IN_SLIDE_BASE: SlideTemplateConfig = sanitizeSlideTemplateConfig(DEFAULT_SLIDE_TEMPLATE);

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

export function buildBuiltInSlideTemplate(fields: string[]): SlideTemplateConfig {
	const normalizedFields = normalizeFieldList(fields);
	const primaryField = pickPrimaryField(normalizedFields);
	const titleTemplate = primaryField ? `{${primaryField}}` : '';
	const bodyFields = normalizedFields.filter((field) => field !== primaryField);
	const bodyTemplate = bodyFields.length > 0 ? bodyFields.map((field) => `{${field}}`).join('\n') : '';

	const merged: SlideTemplateConfig = {
		...BUILT_IN_SLIDE_BASE,
		single: {
			withImage: {
				...BUILT_IN_SLIDE_BASE.single.withImage,
				...applyTemplates(BUILT_IN_SLIDE_BASE.single.withImage, titleTemplate, bodyTemplate),
				imageTemplate: ''
			},
			withoutImage: applyTemplates(BUILT_IN_SLIDE_BASE.single.withoutImage, titleTemplate, bodyTemplate)
		},
		split: {
			withImage: {
				...BUILT_IN_SLIDE_BASE.split.withImage,
				imageTemplate: '',
				textPage: applyTemplates(BUILT_IN_SLIDE_BASE.split.withImage.textPage, titleTemplate, bodyTemplate)
			},
			withoutImage: applyTemplates(BUILT_IN_SLIDE_BASE.split.withoutImage, titleTemplate, bodyTemplate)
		}
	};

	return sanitizeSlideTemplateConfig(merged);
}
