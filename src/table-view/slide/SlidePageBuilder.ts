import type { RowData } from '../../grid/GridAdapter';
import { getDefaultBodyLayout, getDefaultTitleLayout, type SlideTextTemplate, type SlideViewConfig } from '../../types/slide';
import { computeLayout, type ComputedLayout } from './slideLayout';
import { renderSlideTemplate, resolveDirectImage, resolveSlideContent, type SlideBodyBlock } from './SlideContentResolver';

export interface SlidePage {
	rowIndex: number;
	title: string;
	textBlocks: string[];
	imageBlocks: string[];
	titleLayout: ComputedLayout;
	textLayout: ComputedLayout;
	imageLayout: ComputedLayout;
	textColor: string;
	backgroundColor: string;
	editable: boolean;
	templateRef: SlideTextTemplate;
	updateTemplate: (next: SlideTextTemplate) => void;
}

interface BuildPagesOptions {
	rows: RowData[];
	fields: string[];
	config: SlideViewConfig;
	reservedFields: Set<string>;
}

export function buildSlidePages(options: BuildPagesOptions): SlidePage[] {
	const { rows, fields, config, reservedFields } = options;
	const template = config.template;
	const textColor = (template.textColor ?? '').trim();
	const backgroundColor = (template.backgroundColor ?? '').trim();
	const mode = template.mode === 'split' ? 'split' : 'single';
	const pages: SlidePage[] = [];
	for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
		const row = rows[rowIndex];
		if (mode === 'single') {
			const imageInfo = resolveImageTemplate(row, fields, reservedFields, template.single.withImage.imageTemplate);
			const withImageContent = resolveSlideContent({
				row,
				fields,
				template: template.single.withImage,
				activeIndex: rowIndex,
				reservedFields,
				imageValue: imageInfo.raw,
				includeBodyImages: true
			});
			const withImageBlocks = withImageContent.blocks;
			const hasImage = Boolean(imageInfo.markdown) || withImageBlocks.some((block) => block.type === 'image');
			const branch = hasImage ? template.single.withImage : template.single.withoutImage;
			const content =
				hasImage && withImageContent
					? withImageContent
					: resolveSlideContent({
							row,
							fields,
							template: branch,
							activeIndex: rowIndex,
							reservedFields,
							includeBodyImages: true
						});
			pages.push(
				buildPageFromBlocks(
					rowIndex,
					content.title,
					content.blocks,
					branch,
					textColor,
					backgroundColor,
					(next) => {
						if (hasImage) {
							template.single.withImage = { ...template.single.withImage, ...next };
						} else {
							template.single.withoutImage = { ...template.single.withoutImage, ...next };
						}
					},
					computeLayout(hasImage ? template.single.withImage.imageLayout : branch.bodyLayout, 'body')
				)
			);
		} else {
			const imageInfo = resolveImageTemplate(row, fields, reservedFields, template.split.withImage.imageTemplate);
			const hasImage = Boolean(imageInfo.markdown);
			const textBranch = template.split.withoutImage;
			const { title, blocks } = resolveSlideContent({
				row,
				fields,
				template: textBranch,
				activeIndex: rowIndex,
				reservedFields,
				includeBodyImages: true
			});
			pages.push(
				buildPageFromBlocks(
					rowIndex,
					title,
					blocks,
					textBranch,
					textColor,
					backgroundColor,
					(next) => {
						template.split.withoutImage = { ...template.split.withoutImage, ...next };
					},
					computeLayout(textBranch.bodyLayout, 'body')
				)
			);

			if (hasImage && imageInfo.markdown) {
				const imageTemplateText = template.split.withImage.imageTemplate ?? '';
				const imageTemplate: SlideTextTemplate = {
					titleTemplate: '',
					bodyTemplate: imageTemplateText,
					titleLayout: getDefaultTitleLayout(),
					bodyLayout: template.split.withImage.imageLayout ?? getDefaultBodyLayout()
				};
				const imageContent = resolveSlideContent({
					row,
					fields,
					template: imageTemplate,
					activeIndex: rowIndex,
					reservedFields,
					imageValue: imageInfo.raw,
					includeBodyImages: true
				});
				pages.push(
					buildPageFromBlocks(
						rowIndex,
						imageContent.title,
						imageContent.blocks,
						imageTemplate,
						textColor,
						backgroundColor,
						() => {},
						computeLayout(template.split.withImage.imageLayout, 'body')
					)
				);
			}
		}
	}
	return pages;
}

function buildPageFromBlocks(
	rowIndex: number,
	title: string,
	blocks: SlideBodyBlock[],
	templateRef: SlideTextTemplate,
	textColor: string,
	backgroundColor: string,
	updateTemplate: (next: SlideTextTemplate) => void,
	imageLayout: ComputedLayout
): SlidePage {
	const textBlocks = blocks.filter((block) => block.type === 'text').map((block) => block.text);
	const imageBlocks = blocks.filter((block) => block.type === 'image').map((block) => block.markdown);
	return {
		rowIndex,
		title,
		textBlocks,
		imageBlocks,
		titleLayout: computeLayout(templateRef.titleLayout, 'title'),
		textLayout: computeLayout(templateRef.bodyLayout, 'body'),
		imageLayout,
		textColor,
		backgroundColor,
		editable: true,
		templateRef,
		updateTemplate
	};
}

function resolveImageTemplate(
	row: RowData,
	fields: string[],
	reservedFields: Set<string>,
	template: string | null | undefined
): { raw: string | null; markdown: string | null } {
	const rendered = renderTemplateValue(template, row, fields, reservedFields);
	const direct = resolveDirectImage(rendered);
	if (direct) {
		return { raw: rendered, markdown: direct };
	}
	const templateFields =
		typeof template === 'string'
			? Array.from(template.matchAll(/\{([^{}]+)\}/g)).map((match) => match[1]?.trim()).filter(Boolean)
			: [];
	for (const field of templateFields) {
		if (!field || reservedFields.has(field)) {
			continue;
		}
		const candidateValue = row[field];
		if (candidateValue == null) {
			continue;
		}
		const text = typeof candidateValue === 'string' ? candidateValue.trim() : String(candidateValue).trim();
		if (!text) {
			continue;
		}
		const fallback = resolveDirectImage(text);
		if (fallback) {
			return { raw: text, markdown: fallback };
		}
	}
	return { raw: rendered, markdown: null };
}

function renderTemplateValue(
	template: string | null | undefined,
	row: RowData,
	fields: string[],
	reservedFields: Set<string>
): string | null {
	if (!template || !template.trim()) {
		return null;
	}
	const values: Record<string, string> = {};
	const orderedFields = fields.filter((field) => field && !reservedFields.has(field));
	for (const field of orderedFields) {
		if (field === 'status') continue;
		const raw = row[field];
		const text = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
		if (text) {
			values[field] = text;
		}
	}
	const rendered = renderSlideTemplate(template, values, reservedFields).trim();
	return rendered.length > 0 ? rendered : null;
}
