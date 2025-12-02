import { App, Component, type EventRef } from 'obsidian';
import { buildSlideMarkdown, renderMarkdownBlock } from './SlideRenderUtils';
import { t } from '../../i18n';
import { applyLayoutStyles, type ComputedLayout } from './slideLayout';
import { computeOverlayBackground } from './SlideColorUtils';
import { THUMBNAIL_STYLES } from './thumbnailStyles';


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
	private overlayBaseColor: string | null = null;
	private cssChangeRef: EventRef | null = null;

	private readonly thumbSurfaces: ThumbSurface[] = [];

	private scaleRaf: number | null = null;
	private scrollRaf: number | null = null;
	private rowHeight = 0;
	private isScrollable = false;
	private readonly wheelHandler: (evt: WheelEvent) => void;

	constructor(options: SlideThumbnailPanelOptions) {
		this.options = options;
		this.ownerDocument = options.host.ownerDocument ?? document;
		this.ownerWindow = this.ownerDocument.defaultView ?? null;
		this.app = options.app;
		this.sourcePath = options.sourcePath;
		this.overlay = options.host.createDiv({ cls: 'tlb-slide-thumb', attr: { tabindex: '-1' } });
		this.grid = this.overlay.createDiv({ cls: 'tlb-slide-thumb__grid' });
		this.injectStyles();
		this.cssChangeRef = this.app.workspace.on('css-change', () => this.applyOverlayBackground());
		this.wheelHandler = (evt) => this.onWheel(evt);
		this.grid.addEventListener('wheel', this.wheelHandler, { passive: false });

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
		this.applyOverlayBackground(baseColor);
        
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
			const slideNumber = slide.index + 1;
			const slideTitle = slide.title && slide.title.trim().length > 0
				? slide.title
				: t('slideView.untitledSlide', { index: String(slideNumber) });
			btn.setAttribute('aria-label', t('slideView.thumbnailAriaLabel', { index: String(slideNumber) }));
			// 序号标记
			btn.setAttribute(
				'title',
				t('slideView.thumbnailTitle', { index: String(slideNumber), title: slideTitle })
			);

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
			const markdown = buildSlideMarkdown(slide.textBlocks);
			renderMarkdownBlock(this.app, markdown, bodyBlock, this.sourcePath, this.markdownComponents);
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
		if (this.cssChangeRef) {
			this.app.workspace.offref(this.cssChangeRef);
			this.cssChangeRef = null;
		}
		this.grid.removeEventListener('wheel', this.wheelHandler);
		this.overlay.remove();
		this.items = [];
		this.cleanupSurfaces();
		this.cleanupMarkdown();
		if (this.scaleRaf != null && this.ownerWindow) {
			this.ownerWindow.cancelAnimationFrame(this.scaleRaf);
		}
		this.scaleRaf = null;
		if (this.scrollRaf != null && this.ownerWindow) {
			this.ownerWindow.cancelAnimationFrame(this.scrollRaf);
		}
		this.scrollRaf = null;
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

	private applyOverlayBackground(baseColor?: string | null): void {
		if (baseColor !== undefined) {
			this.overlayBaseColor = baseColor;
		}
		const background = computeOverlayBackground(this.overlayBaseColor, this.options.host, this.ownerWindow);
		this.overlay.style.background = background;
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
		const paddingX = 24 * 2;
		const paddingY = 28 * 2;
		const usableWidth = (this.overlay.clientWidth || this.ownerWindow.innerWidth || 0) - paddingX;
		const usableHeight = (this.overlay.clientHeight || this.ownerWindow.innerHeight || 0) - paddingY;
		if (usableWidth <= 0 || usableHeight <= 0) return;

		const cols = 5;
		const count = Math.max(1, this.slideCount || this.items.length || 1);
		const totalRows = Math.max(1, Math.ceil(count / cols));
		const maxRowsPerScreen = 4;
		const visibleRows = Math.min(totalRows, maxRowsPerScreen);
		const gapRatio = 0.05;

		let cardWidth = usableWidth / (cols + (cols - 1) * gapRatio);
		let gapX = cardWidth * gapRatio;
		let cardHeight = cardWidth * (9 / 16);
		let gapY = cardHeight * gapRatio;

		const getHeightForRows = (rows: number): number => rows * cardHeight + (rows - 1) * gapY;

		let visibleHeight = getHeightForRows(visibleRows);
		if (visibleHeight > usableHeight) {
			cardHeight = usableHeight / (visibleRows + (visibleRows - 1) * gapRatio);
			gapY = cardHeight * gapRatio;
			cardWidth = cardHeight * (16 / 9);
			gapX = cardWidth * gapRatio;
			visibleHeight = getHeightForRows(visibleRows);
		}

		this.currentCardHeight = cardHeight;
		this.grid.style.gridTemplateColumns = `repeat(${cols}, ${cardWidth}px)`;
		this.grid.style.columnGap = `${gapX}px`;
		this.grid.style.rowGap = `${gapY}px`;
		this.grid.style.setProperty('--tlb-thumb-gap-x', `${gapX}px`);
		this.grid.style.setProperty('--tlb-thumb-gap-y', `${gapY}px`);
		this.grid.style.setProperty('--tlb-thumb-card-height', `${cardHeight}px`);
		const gridWidth = Math.min(
			usableWidth,
			cols * cardWidth + (cols - 1) * gapX
		);
		this.grid.style.width = `${gridWidth}px`;
		this.grid.style.height = `${visibleHeight}px`;

		this.rowHeight = cardHeight + gapY;
		this.isScrollable = totalRows > maxRowsPerScreen;
		this.grid.classList.toggle('tlb-slide-thumb__grid--scrollable', this.isScrollable);
	}

	private onWheel(evt: WheelEvent): void {
		if (!this.isScrollable) return;
		if (!this.ownerWindow) return;
		const target = evt.currentTarget as HTMLElement | null;
		if (!target) return;

		const normalizedDelta = evt.deltaMode === WheelEvent.DOM_DELTA_LINE ? evt.deltaY * 16 : evt.deltaY;
		const direction = Math.sign(normalizedDelta);
		if (!direction) return;

		evt.preventDefault();

		const baseStep = Math.max(1, Math.round(Math.abs(normalizedDelta) / Math.max(1, this.rowHeight / 2)));
		const step = baseStep * direction;
		const nextTop = Math.max(0, Math.min(target.scrollHeight - target.clientHeight, target.scrollTop + step * this.rowHeight));

		if (this.scrollRaf != null) {
			this.ownerWindow.cancelAnimationFrame(this.scrollRaf);
		}
		this.scrollRaf = this.ownerWindow.requestAnimationFrame(() => {
			this.scrollRaf = null;
			target.scrollTo({ top: nextTop, behavior: 'smooth' });
		});
	}
}
