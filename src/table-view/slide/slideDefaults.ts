import {
	sanitizeSlideTemplateConfig,
	type SlideTemplateConfig,
	type SlideTextTemplate
} from '../../types/slide';
import type { ColumnConfig } from '../MarkdownBlockParser';
import { resolveDirectImage } from './SlideContentResolver';

export const RESERVED_SLIDE_FIELDS = new Set(['#', '__tlb_row_id', '__tlb_status', '__tlb_index', 'status', 'statusChanged']);

const BUILT_IN_SLIDE_BASE: SlideTemplateConfig = sanitizeSlideTemplateConfig({
	mode: 'single',
	single: {
		withImage: {
			titleTemplate: '',
			bodyTemplate: '',
			titleLayout: {
				widthPct: 80,
				topPct: 20,
				insetPct: 11,
				align: 'left',
				lineHeight: 1.2,
				fontSize: 1.8,
				fontWeight: 700
			},
			bodyLayout: {
				widthPct: 50,
				topPct: 30,
				insetPct: 10,
				align: 'left',
				lineHeight: 1.5,
				fontSize: 1,
				fontWeight: 400
			},
			imageTemplate: '',
			imageLayout: {
				widthPct: 30,
				topPct: 32,
				insetPct: 60,
				align: 'left',
				lineHeight: 1.5,
				fontSize: 1,
				fontWeight: 400
			}
		},
		withoutImage: {
			titleTemplate: '',
			bodyTemplate: '',
			titleLayout: {
				widthPct: 62,
				topPct: 30,
				insetPct: 30,
				align: 'center',
				lineHeight: 1.2,
				fontSize: 1.8,
				fontWeight: 700
			},
			bodyLayout: {
				widthPct: 62,
				topPct: 40,
				insetPct: 20,
				align: 'center',
				lineHeight: 1.5,
				fontSize: 1,
				fontWeight: 400
			}
		}
	},
	split: {
		withImage: {
			imageTemplate: '',
			textPage: {
				titleTemplate: '',
				bodyTemplate: '',
				titleLayout: {
					widthPct: 62,
					topPct: 90,
					insetPct: 30,
					align: 'center',
					lineHeight: 1.2,
					fontSize: 0.8,
					fontWeight: 700
				},
				bodyLayout: {
					widthPct: 62,
					topPct: 50,
					insetPct: 20,
					align: 'center',
					lineHeight: 1.5,
					fontSize: 1,
					fontWeight: 400
				}
			},
			imageLayout: {
				widthPct: 80,
				topPct: 5,
				insetPct: 0,
				align: 'center',
				lineHeight: 1.5,
				fontSize: 1,
				fontWeight: 400
			}
		},
		withoutImage: {
			titleTemplate: '',
			bodyTemplate: '',
			titleLayout: {
				widthPct: 62,
				topPct: 30,
				insetPct: 30,
				align: 'center',
				lineHeight: 1.2,
				fontSize: 1.8,
				fontWeight: 700
			},
			bodyLayout: {
				widthPct: 62,
				topPct: 40,
				insetPct: 20,
				align: 'center',
				lineHeight: 1.5,
				fontSize: 1,
				fontWeight: 400
			}
		}
	},
	textColor: '',
	backgroundColor: ''
});

const isEmptyTextTemplate = (template: SlideTextTemplate): boolean =>
	!template.titleTemplate?.trim() && !template.bodyTemplate?.trim();

export function isSlideTemplateEmpty(template: SlideTemplateConfig): boolean {
	const singleWithImageEmpty =
		isEmptyTextTemplate(template.single.withImage) && !template.single.withImage.imageTemplate?.trim();
	const singleWithoutEmpty = isEmptyTextTemplate(template.single.withoutImage);
	const splitWithImageEmpty =
		!template.split.withImage.imageTemplate?.trim() && isEmptyTextTemplate(template.split.withImage.textPage);
	const splitWithoutEmpty = isEmptyTextTemplate(template.split.withoutImage);
	return singleWithImageEmpty && singleWithoutEmpty && splitWithImageEmpty && splitWithoutEmpty;
}

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

const resolveImageFieldFromConfigs = (fields: string[], columnConfigs?: ColumnConfig[] | null): string | null => {
	if (!columnConfigs || columnConfigs.length === 0) {
		return null;
	}
	const configMap = new Map<string, ColumnConfig>();
	for (const config of columnConfigs) {
		const name = (config?.name ?? '').trim();
		if (!name) continue;
		configMap.set(name, config);
		configMap.set(name.toLowerCase(), config);
	}
	for (const field of fields) {
		const normalized = (field ?? '').trim();
		if (!normalized) continue;
		const config = configMap.get(normalized) ?? configMap.get(normalized.toLowerCase());
		if (config?.type === 'image') {
			return normalized;
		}
	}
	return null;
};

const resolveImageFieldFromRows = (
	fields: string[],
	sampleRows?: Array<Record<string, unknown>> | null
): string | null => {
	if (!sampleRows || sampleRows.length === 0) {
		return null;
	}
	for (const row of sampleRows) {
		for (const field of fields) {
			const raw = (row as Record<string, unknown>)[field];
			const text = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
			if (!text) continue;
			if (resolveDirectImage(text)) {
				return field;
			}
		}
	}
	return null;
};

const applyTemplates = (template: SlideTextTemplate, title: string, body: string): SlideTextTemplate => ({
	...template,
	titleTemplate: title || template.titleTemplate || '',
	bodyTemplate: body || template.bodyTemplate || ''
});

export function buildBuiltInSlideTemplate(
	fields: string[],
	columnConfigs?: ColumnConfig[] | null,
	sampleRows?: Array<Record<string, unknown>> | null
): SlideTemplateConfig {
	const normalizedFields = normalizeFieldList(fields);
	const primaryField = pickPrimaryField(normalizedFields);
	const titleTemplate = primaryField ? `{${primaryField}}` : '';
	const imageField =
		resolveImageFieldFromConfigs(normalizedFields, columnConfigs) ??
		resolveImageFieldFromRows(normalizedFields, sampleRows);
	const bodyFields = normalizedFields.filter((field) => field !== primaryField && field !== imageField);
	const bodyTemplate = bodyFields.length > 0 ? bodyFields.map((field) => `{${field}}`).join('\n') : '';
	const imageTemplate = imageField ? `{${imageField}}` : '';
	const base = BUILT_IN_SLIDE_BASE;

	const merged: SlideTemplateConfig = {
		...base,
		single: {
			withImage: {
				...base.single.withImage,
				...applyTemplates(base.single.withImage, titleTemplate, bodyTemplate),
				imageTemplate
			},
			withoutImage: applyTemplates(base.single.withoutImage, titleTemplate, bodyTemplate)
		},
		split: {
			withImage: {
				...base.split.withImage,
				imageTemplate,
				textPage: applyTemplates(base.split.withImage.textPage, titleTemplate, bodyTemplate)
			},
			withoutImage: applyTemplates(base.split.withoutImage, titleTemplate, bodyTemplate)
		}
	};

	return sanitizeSlideTemplateConfig(merged);
}

export function mergeSlideTemplateFields(
	template: SlideTemplateConfig,
	fieldTemplate: SlideTemplateConfig
): SlideTemplateConfig {
	const base = sanitizeSlideTemplateConfig(template);
	const fields = sanitizeSlideTemplateConfig(fieldTemplate);

	return {
		...base,
		single: {
			withImage: {
				...base.single.withImage,
				titleTemplate: fields.single.withImage.titleTemplate,
				bodyTemplate: fields.single.withImage.bodyTemplate,
				imageTemplate: fields.single.withImage.imageTemplate
			},
			withoutImage: {
				...base.single.withoutImage,
				titleTemplate: fields.single.withoutImage.titleTemplate,
				bodyTemplate: fields.single.withoutImage.bodyTemplate
			}
		},
		split: {
			withImage: {
				...base.split.withImage,
				imageTemplate: fields.split.withImage.imageTemplate,
				textPage: {
					...base.split.withImage.textPage,
					titleTemplate: fields.split.withImage.textPage.titleTemplate,
					bodyTemplate: fields.split.withImage.textPage.bodyTemplate
				}
			},
			withoutImage: {
				...base.split.withoutImage,
				titleTemplate: fields.split.withoutImage.titleTemplate,
				bodyTemplate: fields.split.withoutImage.bodyTemplate
			}
		}
	};
}
