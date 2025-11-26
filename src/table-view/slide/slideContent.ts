import { t } from '../../i18n';
import type { RowData } from '../../grid/GridAdapter';
import type { SlideViewConfig } from '../../types/slide';
import type { SlideThumbnail } from './SlideThumbnailPanel';
import { computeLayout } from './slideLayout';

export const RESERVED_FIELDS = new Set(['#', '__tlb_row_id', '__tlb_status', '__tlb_index', 'status', 'statusChanged']);

export function resolveSlideContent(params: {
	row: RowData;
	fields: string[];
	config: SlideViewConfig;
	index: number;
}): { title: string; contents: string[] } {
	const orderedFields = params.fields.filter((field) => field && !RESERVED_FIELDS.has(field));
	const template = params.config.template;
	const values: Record<string, string> = {};
	for (const field of orderedFields) {
		if (field === 'status') continue;
		const raw = params.row[field];
		const text = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
		if (!text) continue;
		values[field] = text;
	}

	const renderTemplate = (templateText: string, trimResult = true): string => {
		const input = templateText.replace(/\r\n/g, '\n');
		const replaced = input.replace(/\{([^{}]+)\}/g, (_, key: string) => {
			const field = key.trim();
			if (!field || RESERVED_FIELDS.has(field)) {
				return '';
			}
			return values[field] ?? '';
		});
		return trimResult ? replaced.trim() : replaced;
	};

	const titleTemplate = template.titleTemplate || `{${orderedFields[0] ?? ''}}`;
	const title = renderTemplate(titleTemplate) || t('slideView.untitledSlide', { index: String(params.index + 1) });

	const body = renderTemplate(template.bodyTemplate, false);
	const lines = body.split('\n');
	const hasContent = lines.some((line) => line.trim().length > 0);
	return { title, contents: hasContent ? lines : [] };
}

export function buildSlidePreviews(rows: RowData[], fields: string[], config: SlideViewConfig): SlideThumbnail[] {
	return rows.map((row, index) => {
		const { title, contents } = resolveSlideContent({ row, fields, config, index });
		return {
			index,
			title,
			contents,
			titleLayout: computeLayout(config.template.titleLayout, 'title'),
			bodyLayout: computeLayout(config.template.bodyLayout, 'body'),
			backgroundColor: (config.template.backgroundColor ?? '').trim(),
			textColor: (config.template.textColor ?? '').trim()
		};
	});
}
