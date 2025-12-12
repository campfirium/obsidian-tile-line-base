import { App, Component, Menu } from 'obsidian';
import { t } from '../../i18n';
import type { RowData } from '../../grid/GridAdapter';
import type { SlideViewConfig } from '../../types/slide';
import type { GlobalQuickFilterManager } from '../filter/GlobalQuickFilterManager';
import { buildSlidePages, type SlidePage } from '../slide/SlidePageBuilder';
import { RESERVED_SLIDE_FIELDS } from '../slide/slideDefaults';
import {
	applyLayoutWithWatcher,
	buildSlideMarkdown,
	renderMarkdownBlock,
	resetRenderArtifacts
} from '../slide/SlideRenderUtils';
import { applyLayoutStyles } from '../slide/slideLayout';
import { renderSlideEditForm, serializeTemplateSegments, type EditState } from '../slide/slideTemplateEditing';
import { optimizeGalleryMediaElements } from './galleryMediaOptimizer';
import type { GalleryCardFieldContext } from './galleryCardFieldMenu';
import { getLogger } from '../../utils/logger';

interface GalleryViewControllerOptions {
	app: App;
	container: HTMLElement;
	rows: RowData[];
	fields: string[];
	config: SlideViewConfig;
	cardWidth?: number;
	cardHeight?: number;
	sourcePath: string;
	onSaveRow: (row: RowData, values: Record<string, string>) => Promise<RowData[] | void>;
	onTemplateChange?: () => void;
	quickFilterManager?: GlobalQuickFilterManager | null;
	subscribeToRows?: (listener: (rows: RowData[]) => void) => () => void;
	getCardFieldMenu?: () => GalleryCardFieldContext | null;
}

type EditingKey = { rowIndex: number; templateRef: SlidePage['templateRef'] } | null;

const DEFAULT_CARD_WIDTH = 320;
const DEFAULT_CARD_HEIGHT = 240;
const TEMPLATE_FONT_BASE_PX = 10;

const toFontPx = (value: number): string => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) {
		return `${TEMPLATE_FONT_BASE_PX}px`;
	}
	return `${numeric * TEMPLATE_FONT_BASE_PX}px`;
};

export class GalleryViewController {
	private static readonly logger = getLogger('gallery:controller');
	private readonly app: App;
	private readonly container: HTMLElement;
	private rows: RowData[] = [];
	private visibleRows: RowData[] = [];
	private fields: string[] = [];
	private config: SlideViewConfig;
	private cardWidth = DEFAULT_CARD_WIDTH;
	private cardHeight = DEFAULT_CARD_HEIGHT;
	private pages: SlidePage[] = [];
	private readonly renderCleanup: Array<() => void> = [];
	private readonly markdownComponents: Component[] = [];
	private editingKey: EditingKey = null;
	private readonly editState: EditState = { template: null, values: {}, fieldInputs: {} };
	private readonly onSaveRow: (row: RowData, values: Record<string, string>) => Promise<RowData[] | void>;
	private readonly sourcePath: string;
	private readonly onTemplateChange: (() => void) | null;
	private readonly quickFilterManager: GlobalQuickFilterManager | null;
	private quickFilterValue = '';
	private unsubscribeRows: (() => void) | null = null;
	private unsubscribeQuickFilter: (() => void) | null = null;
	private gridEl: HTMLElement | null = null;
	private cardEls: HTMLElement[] = [];
	private renderRaf: number | null = null;
	private renderScheduled = false;
	private destroyed = false;
	private renderCount = 0;
	private readonly cardFieldMenuProvider: (() => GalleryCardFieldContext | null) | null;

	constructor(options: GalleryViewControllerOptions) {
		this.app = options.app;
		this.container = options.container;
		this.rows = options.rows;
		this.fields = options.fields;
		this.config = options.config;
		this.cardWidth = typeof options.cardWidth === 'number' ? options.cardWidth : DEFAULT_CARD_WIDTH;
		this.cardHeight = typeof options.cardHeight === 'number' ? options.cardHeight : DEFAULT_CARD_HEIGHT;
		this.sourcePath = options.sourcePath;
		this.onSaveRow = options.onSaveRow;
		this.onTemplateChange = options.onTemplateChange ?? null;
		this.quickFilterManager = options.quickFilterManager ?? null;
		this.quickFilterValue = this.quickFilterManager?.getValue() ?? '';
		this.cardFieldMenuProvider = options.getCardFieldMenu ?? null;
		if (options.subscribeToRows) {
			this.unsubscribeRows = options.subscribeToRows((rows) => {
				this.rows = rows;
				this.requestRender();
			});
		}
		if (this.quickFilterManager) {
			this.unsubscribeQuickFilter = this.quickFilterManager.subscribe((value) => {
				const nextValue = value ?? '';
				if (this.quickFilterValue === nextValue) {
					return;
				}
				this.quickFilterValue = nextValue;
				this.requestRender();
			});
		}
		this.requestRender(true);
	}

	setCardSize(size: { width: number; height: number }): void {
		const width = Number(size.width);
		const height = Number(size.height);
		const nextWidth = Number.isFinite(width) && width > 40 ? width : DEFAULT_CARD_WIDTH;
		const nextHeight = Number.isFinite(height) && height > 40 ? height : DEFAULT_CARD_HEIGHT;
		if (nextWidth === this.cardWidth && nextHeight === this.cardHeight) {
			return;
		}
		this.cardWidth = nextWidth;
		this.cardHeight = nextHeight;
		this.requestRender();
	}

	private getTitleFontSize(value: number): string {
		return toFontPx(value);
	}

	private getBodyFontSize(value: number): string {
		return toFontPx(value);
	}

	updateRows(rows: RowData[]): void {
		this.rows = rows;
		this.requestRender();
	}

	updateConfig(config: SlideViewConfig): void {
		this.config = config;
		this.requestRender();
	}

	destroy(): void {
		this.destroyed = true;
		this.cancelScheduledRender();
		this.unsubscribeRows?.();
		this.unsubscribeRows = null;
		this.unsubscribeQuickFilter?.();
		this.unsubscribeQuickFilter = null;
		resetRenderArtifacts(this.renderCleanup, this.markdownComponents);
		this.cardEls = [];
		this.gridEl = null;
		this.container.empty();
	}

	// Coalesce heavy gallery renders to avoid blocking rapid UI updates.
	private requestRender(immediate = false): void {
		if (this.destroyed) {
			return;
		}
		if (immediate) {
			this.cancelScheduledRender();
			this.renderInternal();
			return;
		}
		if (this.renderScheduled) {
			return;
		}
		this.renderScheduled = true;
		const raf = typeof requestAnimationFrame === 'function'
			? requestAnimationFrame
			: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0);
		this.renderRaf = raf(() => {
			this.renderScheduled = false;
			this.renderRaf = null;
			if (this.destroyed) {
				return;
			}
			this.renderInternal();
		});
	}

	private cancelScheduledRender(): void {
		if (this.renderRaf != null) {
			if (typeof cancelAnimationFrame === 'function') {
				cancelAnimationFrame(this.renderRaf);
			} else {
				window.clearTimeout(this.renderRaf);
			}
		}
		this.renderRaf = null;
		this.renderScheduled = false;
	}

	private renderInternal(): void {
		resetRenderArtifacts(this.renderCleanup, this.markdownComponents);
		this.container.querySelector('.tlb-gallery-empty')?.remove();
		this.visibleRows = this.filterRows(this.rows);
		this.pages = buildSlidePages({
			rows: this.visibleRows,
			fields: this.fields,
			config: this.config,
			reservedFields: RESERVED_SLIDE_FIELDS
		});
		if (this.editingKey && !this.pages.some((page) => this.isEditingPage(page))) {
			this.clearEditingState();
		}
		const hasPages = this.pages.length > 0;
		const isFirstBatch = this.renderCount === 0 && hasPages;
		if (!hasPages) {
			this.cardEls = [];
			if (this.gridEl) {
				this.gridEl.remove();
			}
			this.gridEl = null;
			this.container.empty();
			this.container.createDiv({ cls: 'tlb-gallery-empty', text: t('galleryView.emptyState') });
			return;
		}
		this.renderCount += 1;

		const grid = this.ensureGrid();
		grid.style.setProperty('--tlb-gallery-card-width', `${this.cardWidth}px`);
		grid.style.setProperty('--tlb-gallery-card-height', `${this.cardHeight}px`);
		this.pages.forEach((page, index) => {
			const card = this.ensureCard(grid, index);
			card.setAttr('data-tlb-gallery-index', String(index));
			card.style.setProperty('--tlb-gallery-card-width', `${this.cardWidth}px`);
			card.style.setProperty('--tlb-gallery-card-height', `${this.cardHeight}px`);
			const slideEl = this.ensureSlide(card);
			slideEl.empty();
			slideEl.style.setProperty('--tlb-gallery-card-width', `${this.cardWidth}px`);
			slideEl.style.setProperty('--tlb-gallery-card-height', `${this.cardHeight}px`);
			slideEl.style.setProperty('--tlb-gallery-base-font', `${TEMPLATE_FONT_BASE_PX}px`);
			const titleFontSize = this.getTitleFontSize(page.titleLayout.fontSize);
			const bodyFontSize = this.getBodyFontSize(page.textLayout.fontSize);
			slideEl.style.setProperty('--tlb-gallery-title-font-size', titleFontSize);
			slideEl.style.setProperty('--tlb-gallery-title-line-height', `${page.titleLayout.lineHeight}`);
			slideEl.style.setProperty('--tlb-gallery-title-font-weight', String(page.titleLayout.fontWeight));
			slideEl.style.setProperty('--tlb-gallery-body-font-size', bodyFontSize);
			slideEl.style.setProperty('--tlb-gallery-body-line-height', `${page.textLayout.lineHeight}`);
			slideEl.style.setProperty('--tlb-gallery-body-font-weight', String(page.textLayout.fontWeight));
			const bodyGapPx = Math.max(4, Math.round(TEMPLATE_FONT_BASE_PX * 1.2));
			slideEl.style.setProperty('--tlb-gallery-body-gap', `${bodyGapPx}px`);
			const imageMaxHeight = Math.max(40, this.cardHeight - 24);
			slideEl.toggleClass('tlb-gallery-square-image', true);
			slideEl.style.setProperty('--tlb-gallery-image-max-height', `${imageMaxHeight}px`);
			this.applySlideColors(slideEl, page.textColor, page.backgroundColor);
			const row = this.visibleRows[page.rowIndex];
			const applyLayout = (el: HTMLElement, layout: SlidePage['titleLayout']) =>
				applyLayoutWithWatcher(this.renderCleanup, el, layout, slideEl, (target, layoutSpec, container) =>
					applyLayoutStyles(target, layoutSpec, container));
			const isEditing = this.isEditingPage(page);

			if (isEditing) {
				renderSlideEditForm({
					container: slideEl,
					row,
					page,
					fields: this.fields,
					reservedFields: RESERVED_SLIDE_FIELDS,
					state: this.editState,
					position: applyLayout,
					onCancel: () => {
						this.clearEditingState();
						this.requestRender();
					},
					onSave: () => {
						void this.persistEdit(page);
					}
				});
			} else {
				this.renderDisplayCard({
					slideEl,
					page,
					applyLayout
				});
				card.onclick = (evt) => {
					if (evt.defaultPrevented) return;
					this.beginEdit(page, row);
				};
			}
			if (!isEditing && this.cardFieldMenuProvider && row) {
				card.oncontextmenu = (evt) => {
					if (evt.defaultPrevented) return;
					this.showCardFieldMenu(row, evt);
				};
			} else {
				card.oncontextmenu = null;
			}
		});
		if (this.cardEls.length > this.pages.length) {
			for (let i = this.pages.length; i < this.cardEls.length; i += 1) {
				this.cardEls[i].remove();
			}
			this.cardEls.length = this.pages.length;
		}
		if (hasPages && this.gridEl) {
			void optimizeGalleryMediaElements(
				this.gridEl,
				{ width: this.cardWidth, height: this.cardHeight },
				{ isFirstBatch }
			).catch(() => undefined);
		}
	}

	private renderDisplayCard(options: {
		slideEl: HTMLElement;
		page: SlidePage;
		applyLayout: (el: HTMLElement, layout: SlidePage['titleLayout']) => void;
	}): void {
		const { slideEl, page, applyLayout } = options;
		const titleEl = slideEl.createDiv({ cls: 'tlb-slide-full__title', text: page.title });
		const titleFontSize = this.getTitleFontSize(page.titleLayout.fontSize);
		titleEl.style.lineHeight = `${page.titleLayout.lineHeight}`;
		titleEl.style.fontSize = titleFontSize;
		titleEl.style.fontWeight = String(page.titleLayout.fontWeight);
		applyLayout(titleEl, page.titleLayout);

		if (page.textBlocks.length === 0 && page.imageBlocks.length === 0) {
			const content = slideEl.createDiv({ cls: 'tlb-slide-full__content' });
			content.createDiv({ cls: 'tlb-slide-full__block tlb-slide-full__block--empty', text: '' });
			applyLayout(content, page.textLayout);
			return;
		}

		if (page.textBlocks.length > 0) {
			const content = slideEl.createDiv({ cls: 'tlb-slide-full__content tlb-slide-full__layer--text' });
			const bodyBlock = content.createDiv({ cls: 'tlb-slide-full__block tlb-slide-full__block--text' });
			bodyBlock.style.lineHeight = `${page.textLayout.lineHeight}`;
			bodyBlock.style.fontSize = this.getBodyFontSize(page.textLayout.fontSize);
			bodyBlock.style.fontWeight = String(page.textLayout.fontWeight);
			bodyBlock.style.textAlign = page.textLayout.align;
			void renderMarkdownBlock(
				this.app,
				buildSlideMarkdown(page.textBlocks),
				bodyBlock,
				this.sourcePath,
				this.markdownComponents
			);
			applyLayout(content, page.textLayout);
		}

		if (page.imageBlocks.length > 0) {
			const imageWrapper = slideEl.createDiv({ cls: 'tlb-slide-full__content tlb-slide-full__layer--image' });
			for (const img of page.imageBlocks) {
				const imageBlock = imageWrapper.createDiv({ cls: 'tlb-slide-full__block tlb-slide-full__block--image tlb-gallery-media-container' });
				imageBlock.style.textAlign = page.imageLayout.align;
				const targetHeight = Math.max(40, Math.round(this.cardWidth / (16 / 9)));
				imageBlock.style.height = `${targetHeight}px`;
				imageBlock.style.minHeight = `${targetHeight}px`;
				void renderMarkdownBlock(this.app, img, imageBlock, this.sourcePath, this.markdownComponents).catch(() => undefined);
			}
			applyLayout(imageWrapper, page.imageLayout);
		}
	}

	private beginEdit(page: SlidePage, row: RowData): void {
		this.editingKey = { rowIndex: page.rowIndex, templateRef: page.templateRef };
		const editableFields = this.fields.filter((field) => field && !RESERVED_SLIDE_FIELDS.has(field));
		const values: Record<string, string> = {};
		for (const field of editableFields) {
			const raw = row[field];
			values[field] = typeof raw === 'string' ? raw : String(raw ?? '');
		}
		this.editState.values = values;
		this.editState.fieldInputs = {};
		this.editState.template = null;
		this.requestRender();
	}

	private showCardFieldMenu(row: RowData, event: MouseEvent): void {
		const context = this.cardFieldMenuProvider?.();
		if (!context || !context.field || !Array.isArray(context.options) || context.options.length === 0) {
			return;
		}

		const menu = new Menu();
		const rawCurrent = row[context.field];
		const currentValue = typeof rawCurrent === 'string' ? rawCurrent.trim() : String(rawCurrent ?? '').trim();
		const currentKey = currentValue.toLowerCase();
		let added = false;

		for (const option of context.options) {
			const value = typeof option.value === 'string' ? option.value.trim() : String(option.value ?? '').trim();
			if (!value) {
				continue;
			}
			const label =
				typeof option.label === 'string' && option.label.trim().length > 0
					? option.label.trim()
					: value;
			const normalizedValue = value.toLowerCase();
			const isActive = normalizedValue === currentKey;

			menu.addItem((item) => {
				item.setTitle(label);
				if (isActive) {
					item.setChecked(true);
					item.setDisabled(true);
				}
				item.onClick(() => {
					if (isActive) {
						return;
					}
					void this.applyFieldValueChange(row, context.field, value);
				});
			});
			added = true;
		}

		if (!added) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		menu.showAtMouseEvent(event);
	}

	private async applyFieldValueChange(row: RowData, field: string, value: string): Promise<void> {
		const payload: Record<string, string> = { [field]: value };
		try {
			const nextRows = await this.onSaveRow(row, payload);
			if (nextRows) {
				this.updateRows(nextRows);
			} else {
				this.requestRender();
			}
		} catch (error) {
			GalleryViewController.logger.error('Failed to apply gallery card field change', error);
		}
	}

	private async persistEdit(page: SlidePage): Promise<void> {
		if (!this.editState.template) return;
		const { titleTemplate, bodyTemplate } = serializeTemplateSegments(this.editState.template);
		page.updateTemplate({
			...page.templateRef,
			titleTemplate,
			bodyTemplate
		});
		this.onTemplateChange?.();
		const row = this.visibleRows[page.rowIndex];
		if (!row) {
			this.clearEditingState();
			this.requestRender();
			return;
		}
		const nextRows = await this.onSaveRow(row, this.editState.values);
		if (nextRows) {
			this.updateRows(nextRows);
		} else {
			this.requestRender();
		}
		this.clearEditingState();
		this.requestRender();
	}

	private applySlideColors(slide: HTMLElement, textColor: string, backgroundColor: string): void {
		if (backgroundColor) {
			slide.style.setProperty('--tlb-slide-card-bg', backgroundColor);
		} else {
			slide.style.removeProperty('--tlb-slide-card-bg');
		}
		if (textColor) {
			slide.style.setProperty('--tlb-slide-text-color', textColor);
		} else {
			slide.style.removeProperty('--tlb-slide-text-color');
		}
	}

	private clearEditingState(): void {
		this.editState.template = null;
		this.editingKey = null;
	}

	private filterRows(rows: RowData[]): RowData[] {
		if (!this.quickFilterManager) {
			return rows;
		}
		const value = this.quickFilterValue?.toLowerCase() ?? '';
		if (!value) {
			return rows;
		}
		return rows.filter((row) =>
			Object.values(row).some((entry) => {
				if (typeof entry !== 'string') return false;
				return entry.toLowerCase().includes(value);
			})
		);
	}

	private isEditingPage(page: SlidePage): boolean {
		return Boolean(this.editingKey && this.editingKey.rowIndex === page.rowIndex && this.editingKey.templateRef === page.templateRef);
	}

	private ensureGrid(): HTMLElement {
		if (!this.gridEl || !this.gridEl.isConnected) {
			this.container.empty();
			this.gridEl = this.container.createDiv({ cls: 'tlb-gallery-grid' });
			this.cardEls = [];
		}
		return this.gridEl;
	}

	private ensureCard(grid: HTMLElement, index: number): HTMLElement {
		if (!this.cardEls[index]) {
			const card = grid.createDiv({ cls: 'tlb-gallery-card' });
			this.cardEls[index] = card;
		}
		const card = this.cardEls[index];
		if (!card.isConnected) {
			grid.appendChild(card);
		}
		return card;
	}

	private ensureSlide(card: HTMLElement): HTMLElement {
		let slide = card.querySelector('.tlb-gallery-card__slide') as HTMLElement | null;
		if (!slide) {
			slide = card.createDiv({ cls: 'tlb-slide-full__slide tlb-gallery-card__slide tlb-gallery-edit' });
		}
		return slide;
	}


}
