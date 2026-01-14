import type { App, Component } from 'obsidian';
import type { SlidePage } from '../slide/SlidePageBuilder';
import { buildSlideMarkdown, renderMarkdownBlock } from '../slide/SlideRenderUtils';

export interface GalleryDomState {
	gridEl: HTMLElement | null;
	cardEls: HTMLElement[];
}

export function ensureGalleryGrid(state: GalleryDomState, container: HTMLElement): HTMLElement {
	if (!state.gridEl || !state.gridEl.isConnected) {
		container.empty();
		state.gridEl = container.createDiv({ cls: 'tlb-gallery-grid' });
		state.cardEls = [];
	}
	return state.gridEl;
}

export function ensureGalleryCard(state: GalleryDomState, grid: HTMLElement, index: number): HTMLElement {
	if (!state.cardEls[index]) {
		const card = grid.createDiv({ cls: 'tlb-gallery-card' });
		state.cardEls[index] = card;
	}
	const card = state.cardEls[index];
	if (!card.isConnected) {
		grid.appendChild(card);
	}
	return card;
}

export function ensureGallerySlide(card: HTMLElement): HTMLElement {
	const target = card.querySelector('.tlb-gallery-card__slide');
	let slide = target instanceof HTMLElement ? target : null;
	if (!slide) {
		slide = card.createDiv({ cls: 'tlb-slide-full__slide tlb-gallery-card__slide tlb-gallery-edit' });
	}
	return slide;
}

export function applyGallerySlideColors(slide: HTMLElement, textColor: string, backgroundColor: string): void {
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

export function renderGalleryEmptyState(options: {
	state: GalleryDomState;
	container: HTMLElement;
	cardWidth: number;
	cardHeight: number;
	baseFont: number;
	emptyLabel: string;
}): void {
	const { state, container, cardWidth, cardHeight, baseFont, emptyLabel } = options;
	state.cardEls = [];
	if (state.gridEl) {
		state.gridEl.remove();
	}
	state.gridEl = null;
	container.empty();

	const grid = ensureGalleryGrid(state, container);
	grid.style.setProperty('--tlb-gallery-card-width', `${cardWidth}px`);
	grid.style.setProperty('--tlb-gallery-card-height', `${cardHeight}px`);

	const card = ensureGalleryCard(state, grid, 0);
	card.addClass('tlb-gallery-card--empty');
	card.removeAttribute('data-tlb-gallery-index');
	card.onclick = null;
	card.oncontextmenu = null;

	const slideEl = ensureGallerySlide(card);
	slideEl.empty();
	slideEl.addClass('tlb-gallery-card__slide--empty');
	slideEl.style.setProperty('--tlb-gallery-card-width', `${cardWidth}px`);
	slideEl.style.setProperty('--tlb-gallery-card-height', `${cardHeight}px`);
	slideEl.style.setProperty('--tlb-gallery-base-font', `${baseFont}px`);
	slideEl.setAttr('aria-label', emptyLabel);
}

export function renderGalleryDisplayCard(options: {
	app: App;
	sourcePath: string;
	slideEl: HTMLElement;
	page: SlidePage;
	applyLayout: (el: HTMLElement, layout: SlidePage['titleLayout']) => void;
	titleFontSize: string;
	titleLineHeight: number;
	titleFontWeight: number;
	bodyFontSize: string;
	bodyLineHeight: number;
	bodyFontWeight: number;
	textAlign: string;
	cardWidth: number;
	markdownComponents: Component[];
}): void {
	const {
		app,
		sourcePath,
		slideEl,
		page,
		applyLayout,
		titleFontSize,
		titleLineHeight,
		titleFontWeight,
		bodyFontSize,
		bodyLineHeight,
		bodyFontWeight,
		textAlign,
		cardWidth,
		markdownComponents
	} = options;
	const titleEl = slideEl.createDiv({ cls: 'tlb-slide-full__title', text: page.title });
	titleEl.style.lineHeight = `${titleLineHeight}`;
	titleEl.style.fontSize = titleFontSize;
	titleEl.style.fontWeight = String(titleFontWeight);
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
		bodyBlock.style.lineHeight = `${bodyLineHeight}`;
		bodyBlock.style.fontSize = bodyFontSize;
		bodyBlock.style.fontWeight = String(bodyFontWeight);
		bodyBlock.style.textAlign = textAlign;
		void renderMarkdownBlock(app, buildSlideMarkdown(page.textBlocks), bodyBlock, sourcePath, markdownComponents);
		applyLayout(content, page.textLayout);
	}

	if (page.imageBlocks.length > 0) {
		const imageWrapper = slideEl.createDiv({ cls: 'tlb-slide-full__content tlb-slide-full__layer--image' });
		for (const img of page.imageBlocks) {
			const imageBlock = imageWrapper.createDiv({ cls: 'tlb-slide-full__block tlb-slide-full__block--image tlb-gallery-media-container' });
			imageBlock.style.textAlign = page.imageLayout.align;
			const targetHeight = Math.max(40, Math.round(cardWidth / (16 / 9)));
			imageBlock.style.height = `${targetHeight}px`;
			imageBlock.style.minHeight = `${targetHeight}px`;
			void renderMarkdownBlock(app, img, imageBlock, sourcePath, markdownComponents).catch(() => undefined);
		}
		applyLayout(imageWrapper, page.imageLayout);
	}
}
