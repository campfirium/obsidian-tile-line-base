import type { RowData } from '../../grid/GridAdapter';
import type { SlideTextTemplate, SlideViewConfig } from '../../types/slide';
import { computeLayout, type ComputedLayout } from './slideLayout';
import { resolveDirectImage, resolveSlideContent, type SlideBodyBlock } from './SlideContentResolver';

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
			const imageInfo = resolveImageField(row, template.single.withImage.imageField);
			const hasImage = Boolean(imageInfo.markdown);
			const branch = hasImage ? template.single.withImage : template.single.withoutImage;
			const { title, blocks } = resolveSlideContent({
				row,
				fields,
				template: branch,
				activeIndex: rowIndex,
				reservedFields,
				imageValue: hasImage ? imageInfo.raw : undefined,
				includeBodyImages: true
			});
			pages.push(
				buildPageFromBlocks(
					rowIndex,
					title,
					blocks,
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
			const imageInfo = resolveImageField(row, template.split.withImage.imageField);
			if (!imageInfo.markdown) {
				const branch = template.split.withoutImage;
				const { title, blocks } = resolveSlideContent({
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
						title,
						blocks,
						branch,
						textColor,
						backgroundColor,
						(next) => {
							template.split.withoutImage = { ...template.split.withoutImage, ...next };
						},
						computeLayout(branch.bodyLayout, 'body')
					)
				);
			} else {
				const textBranch = template.split.withImage.textPage;
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
							template.split.withImage.textPage = { ...template.split.withImage.textPage, ...next };
						},
						computeLayout(textBranch.bodyLayout, 'body')
					)
				);

				const imageMarkdown = imageInfo.markdown;
				const imagePageTitle = template.split.withImage.imagePage.showTitle ? title : '';
				const imageTitleLayout = template.split.withImage.imagePage.titleLayout ?? textBranch.titleLayout;
				pages.push({
					rowIndex,
					title: imagePageTitle,
					textBlocks: [],
					imageBlocks: imageMarkdown ? [imageMarkdown] : [],
					titleLayout: computeLayout(imageTitleLayout, 'title'),
					textLayout: computeLayout(textBranch.bodyLayout, 'body'),
					imageLayout: computeLayout(template.split.withImage.imagePage.imageLayout, 'body'),
					textColor,
					backgroundColor,
					editable: false,
					templateRef: textBranch,
					updateTemplate: () => {}
				});
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

function getImageValue(row: RowData, field: string | null | undefined): string | null {
	if (!field) return null;
	const raw = row[field];
	if (typeof raw === 'string') {
		return raw;
	}
	if (raw != null) {
		return String(raw);
	}
	return null;
}

function resolveImageField(row: RowData, field: string | null | undefined): { raw: string | null; markdown: string | null } {
	const raw = getImageValue(row, field);
	const markdown = resolveDirectImage(raw);
	return { raw, markdown };
}
