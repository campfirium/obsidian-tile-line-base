import { App, Component, setIcon } from 'obsidian';
import { t } from '../../i18n';
import type { RowData } from '../../grid/GridAdapter';
import type { SlideViewConfig } from '../../types/slide';
import { SlideScaleManager } from './SlideScaleManager';
import { SlideThumbnailPanel, type SlideThumbnail } from './SlideThumbnailPanel';
import { buildSlidePages, type SlidePage } from './SlidePageBuilder';
import { applyLayoutStyles, type ComputedLayout } from './slideLayout';
import { COVER_HIDDEN_CLASS, COVER_LAYOUT, resolveSourceTitle } from './slideCover';
import { renderSlideEditForm, serializeTemplateSegments, type EditState } from './slideTemplateEditing';
import { applyLayoutWithWatcher, buildSlideMarkdown, renderMarkdownBlock, resetRenderArtifacts } from './SlideRenderUtils';
interface SlideControllerOptions {
	app: App;
	sourcePath: string;
	container: HTMLElement;
	rows: RowData[];
	fields: string[];
	config: SlideViewConfig;
	onSaveRow: (row: RowData, values: Record<string, string>) => Promise<RowData[] | void>;
	onEditTemplate: () => void;
}
const RESERVED_FIELDS = new Set(['#', '__tlb_row_id', '__tlb_status', '__tlb_index', 'status', 'statusChanged']);
export class SlideViewController {
	private readonly app: App;
	private readonly sourcePath: string;
	private readonly root: HTMLElement;
	private readonly stage: HTMLElement;
	private readonly controls: HTMLElement;
	private readonly scaleManager: SlideScaleManager;
	private rows: RowData[] = [];
	private fields: string[] = [];
	private config: SlideViewConfig;
	private activeIndex = 0;
	private readonly cleanup: Array<() => void> = [];
	private renderCleanup: Array<() => void> = [];
	private markdownComponents: Component[] = [];
	private readonly onSaveRow: (row: RowData, values: Record<string, string>) => Promise<RowData[] | void>;
	private readonly onEditTemplate: () => void;
	private fullscreenTarget: HTMLElement | null = null;
	private isFullscreen = false;
	private fullscreenBtn: HTMLElement | null = null;
	private fullscreenCleanup: (() => void) | null = null;
	private readonly coverTitle: string | null;
	private activeCoverEl: HTMLElement | null = null;
	private lastCoverState = false;
	private pages: SlidePage[] = [];
	private editingPageKey: { rowIndex: number; templateRef: SlidePage['templateRef'] } | null = null;
	private saving = false;
	private readonly editState: EditState = { template: null, values: {}, fieldInputs: {} };
	private readonly thumbnailPanel: SlideThumbnailPanel;
	constructor(options: SlideControllerOptions) {
		this.app = options.app;
		this.sourcePath = options.sourcePath;
		this.rows = options.rows;
		this.fields = options.fields;
		this.config = options.config;
		this.onSaveRow = options.onSaveRow;
		this.onEditTemplate = options.onEditTemplate;
		this.root = options.container;
		this.root.empty();
		this.root.addClass('tlb-slide-full');
		this.controls = this.root.createDiv({ cls: 'tlb-slide-full__controls' });
		this.stage = this.root.createDiv({ cls: 'tlb-slide-full__stage' });
		this.fullscreenTarget = this.root;
		this.scaleManager = new SlideScaleManager(this.stage, () => this.isFullscreen);
		this.cleanup.push(() => this.scaleManager.dispose());
		this.thumbnailPanel = new SlideThumbnailPanel({
			host: this.root,
			emptyText: t('slideView.emptyState'),
			app: this.app,
			sourcePath: this.sourcePath,
			onSelect: (index) => {
				this.jumpTo(index);
				this.closeThumbnails();
			},
			onVisibilityChange: (open) => {
				this.root.toggleClass('tlb-slide-full--thumbs-open', open);
				if (open) {
					this.refreshThumbnails();
				}
			}
		});
		this.cleanup.push(() => this.thumbnailPanel.destroy());
		this.coverTitle = resolveSourceTitle(this.sourcePath);
		this.renderControls();
		this.attachFullscreenWatcher();
		this.attachKeyboard();
		this.renderActive();
	}
	updateRows(rows: RowData[]): void {
		this.rows = rows;
		this.clearEditingState();
		if (rows.length === 0) {
			this.closeThumbnails();
		}
		this.renderActive();
	}
	updateConfig(config: SlideViewConfig): void {
		this.config = config;
		this.clearEditingState();
		this.renderActive();
	}
	destroy(): void {
		resetRenderArtifacts(this.renderCleanup, this.markdownComponents);
		for (const dispose of this.cleanup) {
			try {
				dispose();
			} catch {
				// ignore
			}
		}
		this.exitFullscreen();
		this.root.empty();
	}
	private renderControls(): void {
		const templateBtn = this.controls.createEl('button', {
			cls: 'tlb-slide-full__btn',
			attr: { 'aria-label': t('slideView.actions.openTemplate') }
		});
		setIcon(templateBtn, 'settings');
		templateBtn.addEventListener('click', (evt) => {
			evt.preventDefault();
			this.onEditTemplate();
		});
		const fullscreenBtn = this.controls.createEl('button', {
			cls: 'tlb-slide-full__btn',
			attr: { 'aria-label': t('slideView.actions.enterFullscreen') }
		});
		this.fullscreenBtn = fullscreenBtn;
		setIcon(fullscreenBtn, 'maximize-2');
		fullscreenBtn.addEventListener('click', (evt) => {
			evt.preventDefault();
			if (this.isFullscreen) {
				this.exitFullscreen();
			} else {
				void this.enterFullscreen();
			}
			this.updateFullscreenButton();
		});
	}
	private attachKeyboard(): void {
		const handler = (evt: KeyboardEvent) => {
			const target = evt.target as HTMLElement | null;
			const tag = target?.tagName?.toLowerCase();
			if (
				tag === 'input' ||
				tag === 'textarea' ||
				tag === 'select' ||
				tag === 'button' ||
				target?.isContentEditable
			) {
				return;
			}
			if (evt.key === 'Tab') {
				if (this.isFullscreen && !this.editingPageKey && !this.thumbnailPanel.isOpen()) {
					evt.preventDefault();
					this.openThumbnails();
				}
				return;
			}
			if (evt.key === 'ArrowRight' || evt.key === ' ') {
				this.next();
				evt.preventDefault();
			} else if (evt.key === 'ArrowLeft') {
				this.prev();
				evt.preventDefault();
			} else if (evt.key === 'Enter') {
				if (!this.isFullscreen) {
					void this.enterFullscreen();
					this.updateFullscreenButton();
					evt.preventDefault();
				}
			} else if (evt.key === 'Escape') {
				if (this.thumbnailPanel.isOpen()) {
					this.closeThumbnails();
					evt.preventDefault();
					return;
				}
				if (this.isFullscreen) {
					this.exitFullscreen();
					this.updateFullscreenButton();
					evt.preventDefault();
				}
			}
		};
		const owner = this.root.ownerDocument ?? document;
		owner.addEventListener('keydown', handler);
		this.cleanup.push(() => owner.removeEventListener('keydown', handler));
	}
	private attachFullscreenWatcher(): void {
		const doc = this.root.ownerDocument ?? document;
		const listener = () => {
			if (!doc.fullscreenElement && this.isFullscreen) {
				this.isFullscreen = false;
				this.root.removeClass('tlb-slide-full--fullscreen');
				this.closeThumbnails();
				this.updateFullscreenButton();
				this.renderActive();
				this.scaleManager.requestScale();
			} else if (doc.fullscreenElement && this.isFullscreen) {
				this.renderActive();
				this.updateCoverVisibility();
				this.scaleManager.requestScale();
			}
		};
		doc.addEventListener('fullscreenchange', listener);
		this.fullscreenCleanup = () => doc.removeEventListener('fullscreenchange', listener);
		this.cleanup.push(() => this.fullscreenCleanup?.());
	}
	private next(): void {
		const maxIndex = this.getTotalPageCount() - 1;
		if (maxIndex < 0) return;
		this.clearEditingState();
		const nextIndex = Math.min(maxIndex, this.activeIndex + 1);
		if (nextIndex !== this.activeIndex) {
			this.activeIndex = nextIndex;
			this.renderActive();
		}
	}
	private prev(): void {
		const maxIndex = this.getTotalPageCount() - 1;
		if (maxIndex < 0) return;
		this.clearEditingState();
		const nextIndex = Math.max(0, this.activeIndex - 1);
		if (nextIndex !== this.activeIndex) {
			this.activeIndex = nextIndex;
			this.renderActive();
		}
	}
	private jumpTo(index: number): void {
		const maxIndex = this.getTotalPageCount() - 1;
		if (index < 0 || index > maxIndex || index === this.activeIndex) {
			return;
		}
		this.clearEditingState();
		this.activeIndex = index;
		this.renderActive();
	}
	private renderActive(): void {
		resetRenderArtifacts(this.renderCleanup, this.markdownComponents);
		this.stage.empty();
		this.activeCoverEl = null;
		this.pages = this.buildPages();
		if (this.editingPageKey && !this.pages.some((page) => this.isEditingPage(page))) {
			this.clearEditingState();
		}
		const hasCover = this.showCover;
		if (hasCover !== this.lastCoverState) {
			if (hasCover) {
				this.activeIndex = 0;
			} else {
				this.activeIndex = Math.max(0, this.activeIndex - 1);
			}
			this.lastCoverState = hasCover;
		}
		const totalCount = this.pages.length + (hasCover ? 1 : 0);
		if (totalCount === 0) {
			this.clearEditingState();
			this.stage.createDiv({
				cls: 'tlb-slide-full__empty',
				text: t('slideView.emptyState')
			});
			this.scaleManager.setSlide(null);
			this.closeThumbnails();
			return;
		}
		if (this.activeIndex >= totalCount) {
			this.activeIndex = Math.max(0, totalCount - 1);
		}
		this.refreshThumbnails();
		const isCover = hasCover && this.activeIndex === 0;
		const slideIndex = hasCover ? this.activeIndex - 1 : this.activeIndex;
		if (isCover) {
			this.renderCoverSlide();
			return;
		}
		const page = this.pages[slideIndex];
		const row = this.rows[page.rowIndex];
		const slide = this.stage.createDiv({
			cls: 'tlb-slide-full__slide',
			attr: { 'data-tlb-slide-index': String(slideIndex) }
		});
		if (page.editable) {
			slide.addEventListener('click', () => {
				if (!this.isEditingPage(page)) {
					this.beginEdit(page, row);
				}
			});
		}
		this.applySlideColors(slide, page.textColor, page.backgroundColor);
		const applyLayout = (el: HTMLElement, layout: ComputedLayout, slideEl: HTMLElement) =>
			applyLayoutWithWatcher(this.renderCleanup, el, layout, slideEl, (target, layoutSpec, container) =>
				applyLayoutStyles(target, layoutSpec, container));
		const titleEl = slide.createDiv({ cls: 'tlb-slide-full__title', text: page.title });
		titleEl.style.lineHeight = `${page.titleLayout.lineHeight}`;
		titleEl.style.fontSize = `${page.titleLayout.fontSize}rem`;
		titleEl.style.fontWeight = String(page.titleLayout.fontWeight);
		applyLayout(titleEl, page.titleLayout, slide);
		if (this.isEditingPage(page) && page.editable) {
			renderSlideEditForm({
				container: slide,
				row,
				page,
				fields: this.fields,
				reservedFields: RESERVED_FIELDS,
				state: this.editState,
				position: applyLayout,
				onCancel: () => {
					this.clearEditingState();
					this.renderActive();
				},
				onSave: () => {
					void this.persistEdit(page);
				}
			});
		} else {
			if (page.textBlocks.length === 0 && page.imageBlocks.length === 0) {
				const content = slide.createDiv({ cls: 'tlb-slide-full__content' });
				content.createDiv({ cls: 'tlb-slide-full__block tlb-slide-full__block--empty', text: t('slideView.emptyValue') });
				applyLayout(content, page.textLayout, slide);
			} else {
				if (page.textBlocks.length > 0) {
					const content = slide.createDiv({ cls: 'tlb-slide-full__content tlb-slide-full__layer--text' });
					const bodyBlock = content.createDiv({ cls: 'tlb-slide-full__block tlb-slide-full__block--text' });
					renderMarkdownBlock(
						this.app,
						buildSlideMarkdown(page.textBlocks),
						bodyBlock,
						this.sourcePath,
						this.markdownComponents
					);
					bodyBlock.style.lineHeight = `${page.textLayout.lineHeight}`;
					bodyBlock.style.fontSize = `${page.textLayout.fontSize}rem`;
					bodyBlock.style.fontWeight = String(page.textLayout.fontWeight);
					bodyBlock.style.textAlign = page.textLayout.align;
					applyLayout(content, page.textLayout, slide);
				}
				if (page.imageBlocks.length > 0) {
					const imageWrapper = slide.createDiv({ cls: 'tlb-slide-full__content tlb-slide-full__layer--image' });
					for (const img of page.imageBlocks) {
						const imageBlock = imageWrapper.createDiv({ cls: 'tlb-slide-full__block tlb-slide-full__block--image' });
						imageBlock.style.textAlign = page.imageLayout.align;
						renderMarkdownBlock(this.app, img, imageBlock, this.sourcePath, this.markdownComponents);
					}
					applyLayout(imageWrapper, page.imageLayout, slide);
				}
			}
		}
		this.scaleManager.setSlide(slide);
		this.thumbnailPanel.setActive(this.getThumbnailActiveIndex());
	}
	private buildPages(): SlidePage[] {
		return buildSlidePages({
			rows: this.rows,
			fields: this.fields,
			config: this.config,
			reservedFields: RESERVED_FIELDS
		});
	}
	private async enterFullscreen(): Promise<void> {
		if (!this.fullscreenTarget || this.isFullscreen) return;
		try {
			if (this.fullscreenTarget.requestFullscreen) {
				await this.fullscreenTarget.requestFullscreen();
				this.isFullscreen = true;
				this.activeIndex = 0;
				this.root.addClass('tlb-slide-full--fullscreen');
				this.updateFullscreenButton();
				this.renderActive();
				this.scaleManager.requestScale();
			}
		} catch {
			// ignore fullscreen errors
		}
	}
	private exitFullscreen(): void {
		if (!this.isFullscreen) return;
		if (document.fullscreenElement) {
			void document.exitFullscreen();
		}
		this.isFullscreen = false;
		this.root.removeClass('tlb-slide-full--fullscreen');
		this.closeThumbnails();
		this.updateFullscreenButton();
		this.renderActive();
		this.scaleManager.requestScale();
	}
	private updateFullscreenButton(): void {
		if (!this.fullscreenBtn) return;
		if (this.isFullscreen) {
			setIcon(this.fullscreenBtn, 'minimize-2');
			this.fullscreenBtn.setAttr('aria-label', t('slideView.actions.exitFullscreen'));
		} else {
			setIcon(this.fullscreenBtn, 'maximize-2');
			this.fullscreenBtn.setAttr('aria-label', t('slideView.actions.enterFullscreen'));
		}
	}
	private beginEdit(page: SlidePage, row: RowData): void {
		this.editingPageKey = { rowIndex: page.rowIndex, templateRef: page.templateRef };
		this.closeThumbnails();
		const editableFields = this.fields.filter((field) => field && !RESERVED_FIELDS.has(field));
		const values: Record<string, string> = {};
		for (const field of editableFields) {
			const raw = row[field];
			values[field] = typeof raw === 'string' ? raw : String(raw ?? '');
		}
		this.editState.values = values;
		this.editState.fieldInputs = {};
		this.editState.template = null;
		this.renderActive();
	}
	private async persistEdit(page: SlidePage): Promise<void> {
		if (this.saving || !this.editState.template) return;
		this.saving = true;
		try {
			const { titleTemplate, bodyTemplate } = serializeTemplateSegments(this.editState.template);
			page.updateTemplate({
				...page.templateRef,
				titleTemplate,
				bodyTemplate
			});
			const row = this.rows[page.rowIndex];
			const nextRows = await this.onSaveRow(row, this.editState.values);
			if (nextRows) {
				this.updateRows(nextRows);
			}
			this.clearEditingState();
			this.renderActive();
		} finally {
			this.saving = false;
		}
	}
	private refreshThumbnails(): void {
		const slides: SlideThumbnail[] = this.pages.map((page, index) => ({
			index,
			title: page.title,
			textBlocks: page.textBlocks,
			imageBlocks: page.imageBlocks,
			titleLayout: page.titleLayout,
			textLayout: page.textLayout,
			imageLayout: page.imageLayout,
			backgroundColor: page.backgroundColor,
			textColor: page.textColor
		}));
		this.thumbnailPanel.setSlides(slides, this.getThumbnailActiveIndex());
	}
	private openThumbnails(): void {
		this.refreshThumbnails();
		const activeThumbIndex = this.getThumbnailActiveIndex();
		this.thumbnailPanel.setActive(activeThumbIndex);
		this.thumbnailPanel.open(activeThumbIndex);
	}
	private closeThumbnails(): void {
		this.thumbnailPanel.close();
	}
	private renderCoverSlide(): void {
		const title = this.coverTitle;
		if (!title) {
			return;
		}
		const slide = this.stage.createDiv({
			cls: 'tlb-slide-full__slide',
			attr: { 'data-tlb-slide-index': 'cover' }
		});
		const textColor = (this.config.template.textColor ?? '').trim();
		const backgroundColor = (this.config.template.backgroundColor ?? '').trim();
		this.applySlideColors(slide, textColor, backgroundColor);
		const cover = slide.createDiv({ cls: 'tlb-slide-full__cover', text: title });
		cover.style.lineHeight = `${COVER_LAYOUT.lineHeight}`;
		cover.style.fontSize = `${COVER_LAYOUT.fontSize}rem`;
		cover.style.fontWeight = String(COVER_LAYOUT.fontWeight);
		applyLayoutWithWatcher(
			this.renderCleanup,
			cover,
			COVER_LAYOUT,
			slide,
			(target, layoutSpec, container) => applyLayoutStyles(target, layoutSpec, container)
		);
		this.activeCoverEl = cover;
		this.updateCoverVisibility();
		this.scaleManager.setSlide(slide);
		this.thumbnailPanel.setActive(this.getThumbnailActiveIndex());
	}
	private updateCoverVisibility(): void {
		if (!this.activeCoverEl) return;
		const visible = this.showCover && this.activeIndex === 0 && Boolean(this.coverTitle);
		this.activeCoverEl.toggleClass(COVER_HIDDEN_CLASS, !visible);
		this.activeCoverEl.setAttr('aria-hidden', visible ? 'false' : 'true');
	}
	private applySlideColors(slide: HTMLElement, textColor: string, backgroundColor: string): void {
		if (backgroundColor) {
			slide.style.setProperty('--tlb-slide-card-bg', backgroundColor);
			this.root.style.setProperty('--tlb-slide-full-bg', backgroundColor);
		} else {
			slide.style.removeProperty('--tlb-slide-card-bg');
			this.root.style.removeProperty('--tlb-slide-full-bg');
		}
		if (textColor) {
			slide.style.setProperty('--tlb-slide-text-color', textColor);
		} else {
			slide.style.removeProperty('--tlb-slide-text-color');
		}
	}
	private getThumbnailActiveIndex(): number {
		const index = this.showCover ? this.activeIndex - 1 : this.activeIndex;
		return Math.max(0, index);
	}
	private getTotalPageCount(): number {
		return this.pages.length + (this.showCover ? 1 : 0);
	}
	private get showCover(): boolean {
		return Boolean(this.coverTitle) && this.isFullscreen;
	}
	private clearEditingState(): void { this.editState.template = null; this.editingPageKey = null; }
	private isEditingPage(page: SlidePage): boolean {
		return Boolean(this.editingPageKey && this.editingPageKey.rowIndex === page.rowIndex && this.editingPageKey.templateRef === page.templateRef);
	}
}
