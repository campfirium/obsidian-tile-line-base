import { App } from 'obsidian';
import { t } from '../../i18n';
import type { RowData } from '../../grid/GridAdapter';
import type { SlideViewConfig } from '../../types/slide';
import type { GlobalQuickFilterManager } from '../filter/GlobalQuickFilterManager';
import { buildSlidePages, type SlidePage } from '../slide/SlidePageBuilder';
import { RESERVED_SLIDE_FIELDS } from '../slide/slideDefaults';
import { applyLayoutWithWatcher } from '../slide/SlideRenderUtils';
import { applyLayoutStyles } from '../slide/slideLayout';
import { renderSlideEditForm, serializeTemplateSegments, type EditState } from '../slide/slideTemplateEditing';
import { optimizeGalleryMediaElements } from './galleryMediaOptimizer';
import { GalleryVirtualizer } from './GalleryVirtualizer';
import { openGalleryCardFieldMenu, type GalleryCardFieldContext } from './galleryCardFieldMenu';
import { GalleryCardDeck } from './GalleryCardDeck';
import {
	applyGallerySlideColors,
	ensureGalleryGrid,
	renderGalleryDisplayCard,
	renderGalleryEmptyState,
	type GalleryDomState
} from './galleryDomUtils';
import { getLogger } from '../../utils/logger';
import { findRenderedLinkElement, tryOpenRenderedInternalLink } from '../RenderedLinkNavigation';

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
	private readonly rootContainer: HTMLElement;
	private readonly container: HTMLElement;
	private rows: RowData[] = [];
	private visibleRows: RowData[] = [];
	private fields: string[] = [];
	private config: SlideViewConfig;
	private cardWidth = DEFAULT_CARD_WIDTH;
	private cardHeight = DEFAULT_CARD_HEIGHT;
	private pages: SlidePage[] = [];
	private editingKey: EditingKey = null;
	private readonly editState: EditState = { template: null, values: {}, fieldInputs: {} };
	private readonly onSaveRow: (row: RowData, values: Record<string, string>) => Promise<RowData[] | void>;
	private readonly sourcePath: string;
	private readonly onTemplateChange: (() => void) | null;
	private readonly quickFilterManager: GlobalQuickFilterManager | null;
	private quickFilterValue = '';
	private unsubscribeRows: (() => void) | null = null;
	private unsubscribeQuickFilter: (() => void) | null = null;
	private readonly domState: GalleryDomState = { gridEl: null, cardEls: [] };
	private renderRaf: number | null = null;
	private renderScheduled = false;
	private destroyed = false;
	private renderCount = 0;
	private pagesDirty = true;
	private lastCardSize = { width: DEFAULT_CARD_WIDTH, height: DEFAULT_CARD_HEIGHT };
	private readonly virtualizer: GalleryVirtualizer;
	private readonly cardDeck = new GalleryCardDeck();
	private readonly cardFieldMenuProvider: (() => GalleryCardFieldContext | null) | null;
	private readonly processingIndicator: HTMLElement;
	private processingVisible = false;

	constructor(options: GalleryViewControllerOptions) {
		this.app = options.app;
		this.rootContainer = options.container;
		this.rootContainer.empty();
		this.container = this.rootContainer.createDiv({ cls: 'tlb-gallery-surface' });
		this.processingIndicator = this.createProcessingIndicator(this.rootContainer);
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
		this.lastCardSize = { width: this.cardWidth, height: this.cardHeight };
		this.virtualizer = new GalleryVirtualizer({
			container: this.container,
			overscan: 2,
			onViewportChange: () => this.requestRender(false, false)
		});
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
		this.virtualizer.detach();
		this.unsubscribeRows?.();
		this.unsubscribeRows = null;
		this.unsubscribeQuickFilter?.();
		this.unsubscribeQuickFilter = null;
		this.cardDeck.clear();
		this.domState.cardEls = [];
		this.domState.gridEl = null;
		this.toggleProcessingHint(false);
		this.rootContainer.empty();
	}

	private requestRender(immediate = false, rebuildPages = true): void {
		if (this.destroyed) {
			return;
		}
		if (rebuildPages) {
			this.pagesDirty = true;
			this.toggleProcessingHint(true);
		}
		if (immediate) {
			this.cancelScheduledRender();
		} else if (this.renderScheduled) {
			return;
		}
		this.renderScheduled = true;
		const raf = typeof requestAnimationFrame === 'function'
			? requestAnimationFrame
			: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0);
		const runRender = () => {
			this.renderScheduled = false;
			this.renderRaf = null;
			if (this.destroyed) {
				this.toggleProcessingHint(false);
				return;
			}
			try {
				this.renderInternal();
			} finally {
				if (!this.pagesDirty) {
					this.toggleProcessingHint(false);
				}
			}
		};
		this.renderRaf = raf(() => {
			if (this.destroyed) {
				this.renderScheduled = false;
				this.toggleProcessingHint(false);
				this.renderRaf = null;
				return;
			}
			if (rebuildPages) {
				this.renderRaf = raf(runRender);
				return;
			}
			runRender();
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

	private createProcessingIndicator(container: HTMLElement): HTMLElement {
		const indicator = container.createDiv({
			cls: 'tlb-gallery-processing',
			attr: { role: 'status', 'aria-live': 'polite' }
		});
		const bubble = indicator.createDiv({ cls: 'tlb-gallery-processing__bubble' });
		bubble.createDiv({ cls: 'tlb-gallery-processing__spinner', attr: { 'aria-hidden': 'true' } });
		bubble.createDiv({ cls: 'tlb-gallery-processing__label', text: t('galleryView.processingHint') });
		return indicator;
	}

	private toggleProcessingHint(isActive: boolean): void {
		if (this.processingVisible === isActive) {
			return;
		}
		this.processingVisible = isActive;
		this.processingIndicator.toggleClass('is-active', isActive);
	}

	private renderInternal(): void {
		const shouldRebuildPages = this.pagesDirty;
		if (!shouldRebuildPages && this.pages.length === 0) {
			return;
		}
		if (shouldRebuildPages) {
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
		}
		const hasPages = this.pages.length > 0;
		const isFirstBatch = this.renderCount === 0 && hasPages;
		if (!hasPages) {
			this.cardDeck.clear();
			renderGalleryEmptyState({
				state: this.domState,
				container: this.container,
				cardWidth: this.cardWidth,
				cardHeight: this.cardHeight,
				baseFont: TEMPLATE_FONT_BASE_PX,
				emptyLabel: t('galleryView.emptyState')
			});
			this.pagesDirty = false;
			this.virtualizer.resetWindow();
			this.lastCardSize = { width: this.cardWidth, height: this.cardHeight };
			return;
		}

		const grid = ensureGalleryGrid(this.domState, this.container);
		if (this.domState.cardEls.length > 0) {
			for (const card of this.domState.cardEls) {
				card.remove();
			}
			this.domState.cardEls.length = 0;
		}
		grid.style.setProperty('--tlb-gallery-card-width', `${this.cardWidth}px`);
		grid.style.setProperty('--tlb-gallery-card-height', `${this.cardHeight}px`);

		const virtualWindow = this.virtualizer.computeWindow({
			cardWidth: this.cardWidth,
			cardHeight: this.cardHeight,
			totalItems: this.pages.length,
			grid
		});
		const windowChanged = this.virtualizer.hasWindowChanged(virtualWindow);
		const cardSizeChanged = this.lastCardSize.width !== this.cardWidth || this.lastCardSize.height !== this.cardHeight;

		if (!shouldRebuildPages && !windowChanged && !cardSizeChanged) {
			return;
		}

		this.virtualizer.commitWindow(virtualWindow);
		this.lastCardSize = { width: this.cardWidth, height: this.cardHeight };
		this.pagesDirty = false;
		if (shouldRebuildPages && hasPages) {
			this.renderCount += 1;
		}

		grid.style.paddingTop = `${virtualWindow.paddingTop}px`;
		grid.style.paddingBottom = `${virtualWindow.paddingBottom}px`;

		const cardEntries = this.cardDeck.reconcileRange({
			grid,
			start: virtualWindow.start,
			end: virtualWindow.end,
			invalidate: shouldRebuildPages || cardSizeChanged
		});
		let renderedCards = 0;
		for (const entry of cardEntries) {
			if (!entry.shouldRender) {
				continue;
			}
			const page = this.pages[entry.pageIndex];
			if (!page) {
				continue;
			}
			renderedCards += 1;
			const card = entry.slot.cardEl;
			card.removeClass('tlb-gallery-card--empty');
			card.removeAttribute('aria-label');
			card.setAttr('data-tlb-gallery-index', String(entry.pageIndex));
			card.style.setProperty('--tlb-gallery-card-width', `${this.cardWidth}px`);
			card.style.setProperty('--tlb-gallery-card-height', `${this.cardHeight}px`);
			const slideEl = entry.slot.slideEl;
			slideEl.removeClass('tlb-gallery-card__slide--empty');
			slideEl.removeAttribute('aria-label');
			slideEl.style.setProperty('--tlb-gallery-card-width', `${this.cardWidth}px`);
			slideEl.style.setProperty('--tlb-gallery-card-height', `${this.cardHeight}px`);
			slideEl.style.setProperty('--tlb-gallery-base-font', `${TEMPLATE_FONT_BASE_PX}px`);
			const titleFontSize = toFontPx(page.titleLayout.fontSize);
			const bodyFontSize = toFontPx(page.textLayout.fontSize);
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
			applyGallerySlideColors(slideEl, page.textColor, page.backgroundColor);
			const row = this.visibleRows[page.rowIndex];
			const applyLayout = (el: HTMLElement, layout: SlidePage['titleLayout']) =>
				applyLayoutWithWatcher(entry.slot.renderCleanup, el, layout, slideEl, (target, layoutSpec, container) =>
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
				renderGalleryDisplayCard({
					app: this.app,
					sourcePath: this.sourcePath,
					slideEl,
					page,
					applyLayout,
					titleFontSize,
					titleLineHeight: page.titleLayout.lineHeight,
					titleFontWeight: page.titleLayout.fontWeight,
					bodyFontSize,
					bodyLineHeight: page.textLayout.lineHeight,
					bodyFontWeight: page.textLayout.fontWeight,
					textAlign: page.textLayout.align,
					cardWidth: this.cardWidth,
					markdownComponents: entry.slot.markdownComponents
				});
				card.onclick = (evt) => {
					if (evt.defaultPrevented) return;
					if (tryOpenRenderedInternalLink(this.app, this.sourcePath, evt)) {
						return;
					}
					if (findRenderedLinkElement(evt.target)) {
						return;
					}
					this.beginEdit(page, row);
				};
			}
			if (!isEditing && this.cardFieldMenuProvider && row) {
				card.oncontextmenu = (evt) => {
					if (evt.defaultPrevented) return;
					const context = this.cardFieldMenuProvider?.();
					if (!context) {
						return;
					}
					openGalleryCardFieldMenu({
						row,
						context,
						event: evt,
						onApply: (value) => {
							void this.applyFieldValueChange(row, context.field, value);
						}
					});
				};
			} else {
				card.oncontextmenu = null;
			}
		}
		if (hasPages && this.domState.gridEl && renderedCards > 0) {
			void optimizeGalleryMediaElements(
				this.domState.gridEl,
				{ width: this.cardWidth, height: this.cardHeight },
				{ isFirstBatch }
			).catch(() => undefined);
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

}
