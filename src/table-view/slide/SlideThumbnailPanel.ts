import { App, Component } from 'obsidian';
import { renderMarkdownBlock } from './SlideRenderUtils';
import { t } from '../../i18n';
import { applyLayoutStyles, type ComputedLayout } from './slideLayout';
import { computeOverlayBackground } from './SlideColorUtils';

// --- CSS 样式重构 ---
const THUMBNAIL_STYLES = `
.tlb-slide-thumb {
	position: absolute;
	inset: 0;
	display: none;
	padding: 18px 20px;
	background: var(--background-primary);
	overflow: auto;
	z-index: 8;
	opacity: 0;
	transition: opacity 0.2s ease;
	align-items: center;
	justify-content: flex-start;
	flex-direction: column;
}

.tlb-slide-thumb--visible {
	display: flex;
	opacity: 1;
}

.tlb-slide-thumb--centered {
	justify-content: center;
}

.tlb-slide-thumb__grid {
	display: grid;
	/* 初始占位，实际列宽/间距由 JS layoutGrid 写入 */
	grid-template-columns: repeat(5, minmax(0, 1fr));
	column-gap: var(--tlb-thumb-gap-x, 12px);
	row-gap: var(--tlb-thumb-gap-y, 12px);
	grid-auto-rows: var(--tlb-thumb-card-height, auto);
	width: auto;
	margin: 0 auto;
	justify-items: stretch;
	align-items: start;
}

.tlb-slide-thumb__item {
	position: relative;
	display: flex;
	flex-direction: column;
	width: 100%;
	height: 100%;
	box-sizing: border-box;
	appearance: none;
	border: none;
	background: transparent;
	padding: 0;
	cursor: pointer;
	transition: transform 0.1s ease;
}

.tlb-slide-thumb__item:hover {
	transform: translateY(-4px);
}

.tlb-slide-thumb__item:focus-visible {
	outline: 2px solid var(--interactive-accent);
	outline-offset: 4px;
	border-radius: 8px;
}
.tlb-slide-thumb__item:focus { outline: none; }

/* 缩略图画布：强制 16:9 */
.tlb-slide-thumb__canvas {
	position: relative;
	width: 100%;
	height: 100%;
	aspect-ratio: 16 / 9;
	background: color-mix(in srgb, var(--background-secondary) 88%, transparent 12%);
	border-radius: 10px;
	overflow: hidden;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
	border: 1px solid var(--background-modifier-border);
}

.tlb-slide-thumb__item--active .tlb-slide-thumb__canvas {
	border-color: var(--interactive-accent);
	box-shadow: 0 0 0 2px var(--interactive-accent);
}

/* 缩略图内容容器：绝对定位，通过 scale 适应画布 */
.tlb-slide-thumb__root {
	position: absolute;
	top: 0;
	left: 0;
	/* 这里的宽高必须与 JS 中的 baseWidth/baseHeight 一致 */
	width: 1200px;
	height: 675px;
	transform-origin: top left;
	transform: scale(var(--tlb-thumb-scale, 1));
	pointer-events: none; /* 禁止缩略图内部交互 */
}

.tlb-slide-thumb__slide {
	width: 100%;
	height: 100%;
	max-width: none;
	max-height: none;
	aspect-ratio: 16 / 9;
	padding: 36px 48px;
	box-sizing: border-box;
	transform: none;
	display: flex;
	flex-direction: column;
	justify-content: flex-start;
}

.tlb-slide-thumb__slide .tlb-slide-full__content {
	gap: 14px;
}

.tlb-slide-thumb__block--text {
	white-space: normal;
}

.tlb-slide-thumb__block--text p:last-child {
	margin-bottom: 0;
}

.tlb-slide-thumb__block--image {
	align-items: center;
}
`;

export interface SlideThumbnail {
	index: number;
	title: string;
	textBlocks: string[];
	imageBlocks: string[];
	titleLayout: ComputedLayout;
	textLayout: ComputedLayout;
	imageLayout: ComputedLayout;
	backgroundColor: string;
	textColor: string;
}

interface SlideThumbnailPanelOptions {
	host: HTMLElement;
	emptyText: string;
	app: App;
	sourcePath: string;
	onSelect: (index: number) => void;
	onVisibilityChange?: (open: boolean) => void;
}

type ThumbSurface = {
	canvas: HTMLElement;
	root: HTMLElement;
	slide: HTMLElement;
	titleEl: HTMLElement;
	textEl: HTMLElement | null;
	imageEl: HTMLElement | null;
	titleLayout: ComputedLayout;
	textLayout: ComputedLayout;
	imageLayout: ComputedLayout;
	observer: ResizeObserver | null;
};

export class SlideThumbnailPanel {
	private readonly overlay: HTMLElement;
	private readonly grid: HTMLElement;
	private readonly ownerDocument: Document;
	private readonly options: SlideThumbnailPanelOptions;
	private readonly ownerWindow: Window | null;
	private readonly app: App;
	private readonly sourcePath: string;
	private items: HTMLElement[] = [];
	private visible = false;
	private slideCount = 0;
	private readonly baseWidth = 1200;
	private readonly baseHeight = 1200 * (9 / 16); // 675px
	private currentCardHeight = 0;
	private readonly markdownComponents: Component[] = [];

	private readonly thumbSurfaces: ThumbSurface[] = [];

	private scaleRaf: number | null = null;

	constructor(options: SlideThumbnailPanelOptions) {
		this.options = options;
		this.ownerDocument = options.host.ownerDocument ?? document;
		this.ownerWindow = this.ownerDocument.defaultView ?? null;
		this.app = options.app;
		this.sourcePath = options.sourcePath;
		this.overlay = options.host.createDiv({ cls: 'tlb-slide-thumb', attr: { tabindex: '-1' } });
		this.grid = this.overlay.createDiv({ cls: 'tlb-slide-thumb__grid' });
		this.injectStyles();

        // 点击遮罩层关闭
		this.overlay.addEventListener('click', (evt) => {
			if (evt.target === this.overlay || evt.target === this.grid) {
				this.close();
			}
		});
        
        // ESC 关闭支持 (可选，通常在上层处理)
        this.overlay.addEventListener('keydown', (evt) => {
            if (evt.key === 'Escape') this.close();
        });
	}

	private injectStyles(): void {
		const doc = this.ownerDocument;
		if (!doc.head) return;
		const id = 'tlb-slide-thumb-styles';
		const existing = doc.getElementById(id) as HTMLStyleElement | null;
		if (existing) {
			existing.textContent = THUMBNAIL_STYLES;
			return;
		}
		const style = doc.createElement('style');
		style.id = id;
		style.textContent = THUMBNAIL_STYLES;
		doc.head.appendChild(style);
	}

	setSlides(slides: SlideThumbnail[], activeIndex: number): void {
		this.grid.empty();
		this.items = [];
		this.cleanupSurfaces();
		this.cleanupMarkdown();
		this.slideCount = slides.length;
		const baseColor = slides.find((slide) => slide.backgroundColor)?.backgroundColor ?? null;
		this.overlay.style.background = computeOverlayBackground(baseColor, this.options.host, this.ownerWindow);
        
		if (slides.length === 0) {
			this.grid.createDiv({
				cls: 'tlb-slide-thumb__empty',
				text: this.options.emptyText
			});
			return;
		}

		const fragment = this.ownerDocument.createDocumentFragment();
		
		for (const slide of slides) {
			const btn = this.ownerDocument.createElement('button');
			btn.type = 'button';
			btn.className = 'tlb-slide-thumb__item';
			btn.dataset.index = String(slide.index);
			btn.setAttribute('aria-label', `Go to slide ${slide.index + 1}`);
            // 序号标记
            btn.setAttribute('title', `Slide ${slide.index + 1}: ${slide.title}`);

			const canvas = this.ownerDocument.createElement('div');
			canvas.className = 'tlb-slide-thumb__canvas';

            // 缩放容器
			const root = this.ownerDocument.createElement('div');
			root.className = 'tlb-slide-thumb__root'; // 这里的 CSS 负责 scale

			const slideEl = this.ownerDocument.createElement('div');
			slideEl.className = 'tlb-slide-full__slide tlb-slide-thumb__slide';
			if (slide.backgroundColor) {
				slideEl.style.setProperty('--tlb-slide-card-bg', slide.backgroundColor);
			}
			if (slide.textColor) {
				slideEl.style.setProperty('--tlb-slide-text-color', slide.textColor);
			}
			root.appendChild(slideEl);
			canvas.appendChild(root);
			btn.appendChild(canvas);

            // 标题
			const titleEl = this.ownerDocument.createElement('div');
			titleEl.className = 'tlb-slide-full__title';
			titleEl.textContent = slide.title ?? '';
			titleEl.style.lineHeight = `${slide.titleLayout.lineHeight}`;
			titleEl.style.fontSize = `${slide.titleLayout.fontSize}rem`;
			titleEl.style.fontWeight = String(slide.titleLayout.fontWeight);
			slideEl.appendChild(titleEl);
			const { textEl, imageEl } = this.renderSlideBodies(slide, slideEl);

            // 应用布局样式
			applyLayoutStyles(titleEl, slide.titleLayout, slideEl);
			if (textEl) {
				applyLayoutStyles(textEl, slide.textLayout, slideEl);
			}
			if (imageEl) {
				applyLayoutStyles(imageEl, slide.imageLayout, slideEl);
			}

			btn.addEventListener('click', (e) => {
                e.stopPropagation();
				this.options.onSelect(slide.index);
			});

			this.items.push(btn);
			fragment.appendChild(btn);
            
            // 注册 ResizeObserver
			this.registerSurface({
				canvas,
				root,
				slide: slideEl,
				titleEl,
				textEl,
				imageEl,
				titleLayout: slide.titleLayout,
				textLayout: slide.textLayout,
				imageLayout: slide.imageLayout
			});
		}

		this.grid.appendChild(fragment);
        
        // 立即计算一次，防止闪烁
        // requestAnimationFrame 放在 open 中处理
		this.setActive(activeIndex);
		if (this.visible) {
			this.requestLayoutAndScale();
		}
	}

	private renderSlideBodies(slide: SlideThumbnail, slideEl: HTMLElement): { textEl: HTMLElement | null; imageEl: HTMLElement | null } {
		let textEl: HTMLElement | null = null;
		let imageEl: HTMLElement | null = null;
		const hasText = slide.textBlocks.length > 0;
		const hasImages = slide.imageBlocks.length > 0;

		if (!hasText && !hasImages) {
			textEl = this.ownerDocument.createElement('div');
			textEl.className = 'tlb-slide-full__content';
			const emptyBlock = this.ownerDocument.createElement('div');
			emptyBlock.className = 'tlb-slide-full__block tlb-slide-full__block--empty';
			emptyBlock.textContent = t('slideView.emptyValue');
			textEl.appendChild(emptyBlock);
			slideEl.appendChild(textEl);
			return { textEl, imageEl };
		}

		if (hasText) {
			textEl = this.ownerDocument.createElement('div');
			textEl.className = 'tlb-slide-full__content tlb-slide-full__layer--text';
			const bodyBlock = this.ownerDocument.createElement('div');
			bodyBlock.className = 'tlb-slide-full__block tlb-slide-full__block--text tlb-slide-thumb__block--text';
			bodyBlock.style.lineHeight = `${slide.textLayout.lineHeight}`;
			bodyBlock.style.fontSize = `${slide.textLayout.fontSize}rem`;
			bodyBlock.style.fontWeight = String(slide.textLayout.fontWeight);
			bodyBlock.style.textAlign = slide.textLayout.align;
			const markdown = slide.textBlocks.join('\n');
			if (markdown.trim().length > 0) {
				renderMarkdownBlock(this.app, markdown, bodyBlock, this.sourcePath, this.markdownComponents);
			} else {
				bodyBlock.textContent = '';
			}
			textEl.appendChild(bodyBlock);
			slideEl.appendChild(textEl);
		}

		if (hasImages) {
			imageEl = this.ownerDocument.createElement('div');
			imageEl.className = 'tlb-slide-full__content tlb-slide-full__layer--image';
			for (const img of slide.imageBlocks) {
				const imageBlock = this.ownerDocument.createElement('div');
				imageBlock.className = 'tlb-slide-full__block tlb-slide-full__block--image tlb-slide-thumb__block--image';
				imageBlock.style.textAlign = slide.imageLayout.align;
				renderMarkdownBlock(this.app, img, imageBlock, this.sourcePath, this.markdownComponents);
				imageEl.appendChild(imageBlock);
			}
			slideEl.appendChild(imageEl);
		}

		return { textEl, imageEl };
	}

	setActive(index: number): void {
		for (const item of this.items) {
			const match = Number(item.dataset.index) === index;
			item.classList.toggle('tlb-slide-thumb__item--active', match);
            if (match) {
                // 滚动到可见区域
                item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
		}
	}

	open(activeIndex?: number): void {
		if (this.visible) return;
		this.visible = true;
        
		this.overlay.classList.add('tlb-slide-thumb--visible');
		this.options.onVisibilityChange?.(true);
        
        // ✅ 关键：等待 CSS display:block 生效且布局完成后再计算缩放
        // 使用双重 rAF 确保布局已回流
		this.ownerWindow?.requestAnimationFrame(() => {
            this.ownerWindow?.requestAnimationFrame(() => {
                this.requestLayoutAndScale();
                if (activeIndex != null) {
                    this.setActive(activeIndex);
                    this.focusActive();
                }
            });
		});
	}

	close(): void {
		if (!this.visible) return;
		this.visible = false;
		this.overlay.classList.remove('tlb-slide-thumb--visible');
		this.options.onVisibilityChange?.(false);
	}

	isOpen(): boolean {
		return this.visible;
	}

	private focusActive(): void {
		const active = this.items.find((item) => item.classList.contains('tlb-slide-thumb__item--active'));
		if (active) {
			active.focus({ preventScroll: true });
		}
	}

	destroy(): void {
		this.overlay.remove();
		this.items = [];
		this.cleanupSurfaces();
		this.cleanupMarkdown();
		if (this.scaleRaf != null && this.ownerWindow) {
			this.ownerWindow.cancelAnimationFrame(this.scaleRaf);
		}
		this.scaleRaf = null;
	}

	private registerSurface(surface: Omit<ThumbSurface, 'observer'>): void {
		let observer: ResizeObserver | null = null;
		if (typeof ResizeObserver !== 'undefined') {
			observer = new ResizeObserver((entries) => {
				for (const entry of entries) {
					if (entry.contentRect && entry.contentRect.width) {
						this.requestLayoutAndScale();
						return;
					}
				}
			});
			observer.observe(surface.canvas);
		}
		this.thumbSurfaces.push({ ...surface, observer });
	}

	private cleanupSurfaces(): void {
		for (const surface of this.thumbSurfaces) {
			surface.observer?.disconnect();
		}
		this.thumbSurfaces.length = 0;
	}

	private cleanupMarkdown(): void {
		for (const component of this.markdownComponents) {
			try {
				component.unload();
			} catch {
				// ignore
			}
		}
		this.markdownComponents.length = 0;
	}
    // ✅ 核心修复：根据 canvas 实际宽度计算缩放，移除最小限制
	private applyScale(canvas: HTMLElement, root: HTMLElement): void {
		const rect = canvas.getBoundingClientRect();
		if (!rect.width) return;
		const scale = Math.min(rect.width / this.baseWidth, rect.height / this.baseHeight, 1);
		root.style.setProperty('--tlb-thumb-scale', `${scale}`);
		if (this.currentCardHeight > 0) {
			canvas.style.height = `${this.currentCardHeight}px`;
		}
	}

	private requestLayoutAndScale(): void {
		if (!this.ownerWindow || this.scaleRaf != null || !this.visible) return;
		this.scaleRaf = this.ownerWindow.requestAnimationFrame(() => {
			this.scaleRaf = null;
			this.layoutGrid();
			for (const surface of this.thumbSurfaces) {
				applyLayoutStyles(surface.titleEl, surface.titleLayout, surface.slide);
				if (surface.textEl) {
					applyLayoutStyles(surface.textEl, surface.textLayout, surface.slide);
				}
				if (surface.imageEl) {
					applyLayoutStyles(surface.imageEl, surface.imageLayout, surface.slide);
				}
				this.applyScale(surface.canvas, surface.root);
			}
		});
	}

	private layoutGrid(): void {
		if (!this.ownerWindow) return;
		const paddingX = 20 * 2;
		const paddingY = 18 * 2;
		const usableWidth = (this.overlay.clientWidth || this.ownerWindow.innerWidth || 0) - paddingX;
		const usableHeight = (this.overlay.clientHeight || this.ownerWindow.innerHeight || 0) - paddingY;
		if (usableWidth <= 0 || usableHeight <= 0) return;

		const cols = 5;
		const count = Math.max(1, this.slideCount || this.items.length || 1);
		const rows = Math.max(1, Math.ceil(count / cols));
		const gapRatio = 0.05;

		let cardWidth = usableWidth / (cols + (cols - 1) * gapRatio);
		let gapX = cardWidth * gapRatio;
		let cardHeight = cardWidth * (9 / 16);
		let gapY = cardHeight * gapRatio;

		let totalHeight = rows * cardHeight + (rows - 1) * gapY;
		if (totalHeight > usableHeight) {
			cardHeight = usableHeight / (rows + (rows - 1) * gapRatio);
			gapY = cardHeight * gapRatio;
			cardWidth = cardHeight * (16 / 9);
			gapX = cardWidth * gapRatio;
			totalHeight = rows * cardHeight + (rows - 1) * gapY;
		}

		this.currentCardHeight = cardHeight;
		this.grid.style.gridTemplateColumns = `repeat(${cols}, ${cardWidth}px)`;
		this.grid.style.columnGap = `${gapX}px`;
		this.grid.style.rowGap = `${gapY}px`;
		this.grid.style.setProperty('--tlb-thumb-gap-x', `${gapX}px`);
		this.grid.style.setProperty('--tlb-thumb-gap-y', `${gapY}px`);
		this.grid.style.setProperty('--tlb-thumb-card-height', `${cardHeight}px`);
		this.grid.style.width = `${cols * cardWidth + (cols - 1) * gapX}px`;
		this.grid.style.height = `${rows * cardHeight + (rows - 1) * gapY}px`;

		const leftover = usableHeight - totalHeight;
		const shouldCenter = leftover > cardHeight * 0.2;
		this.overlay.classList.toggle('tlb-slide-thumb--centered', shouldCenter);
	}
}
