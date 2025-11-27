import { App, Component, setIcon } from 'obsidian';
import { t } from '../../i18n';
import type { RowData } from '../../grid/GridAdapter';
import type { SlideViewConfig } from '../../types/slide';
import { SlideScaleManager } from './SlideScaleManager';
import { SlideThumbnailPanel, type SlideThumbnail } from './SlideThumbnailPanel';
import { buildSlidePages, type SlidePage } from './SlidePageBuilder';
import { applyLayoutStyles, type ComputedLayout } from './slideLayout';
import {
	renderSlideEditForm,
	serializeTemplateSegments,
	type EditState
} from './slideTemplateEditing';
import {
	applyLayoutWithWatcher,
	renderMarkdownBlock,
	resetRenderArtifacts
} from './SlideRenderUtils';

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
	private pages: SlidePage[] = [];
	private editingPage: SlidePage | null = null;
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
		this.renderControls();
		this.attachFullscreenWatcher();
		this.attachKeyboard();
		this.renderActive();
	}

	updateRows(rows: RowData[]): void {
		this.rows = rows;
		this.editState.template = null;
		this.editingPage = null;
		if (rows.length === 0) {
			this.closeThumbnails();
		}
		this.renderActive();
	}

	updateConfig(config: SlideViewConfig): void {
		this.config = config;
		this.editState.template = null;
		this.editingPage = null;
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
				if (this.isFullscreen && !this.editingPage && !this.thumbnailPanel.isOpen()) {
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
				this.scaleManager.requestScale();
			} else if (doc.fullscreenElement && this.isFullscreen) {
				this.scaleManager.requestScale();
			}
		};
		doc.addEventListener('fullscreenchange', listener);
		this.fullscreenCleanup = () => doc.removeEventListener('fullscreenchange', listener);
		this.cleanup.push(() => this.fullscreenCleanup?.());
	}

	private next(): void {
		if (this.pages.length === 0) return;
		this.editState.template = null;
		this.editingPage = null;
		const nextIndex = Math.min(this.pages.length - 1, this.activeIndex + 1);
		if (nextIndex !== this.activeIndex) {
			this.activeIndex = nextIndex;
			this.renderActive();
		}
	}

	private prev(): void {
		if (this.pages.length === 0) return;
		this.editState.template = null;
		this.editingPage = null;
		const nextIndex = Math.max(0, this.activeIndex - 1);
		if (nextIndex !== this.activeIndex) {
			this.activeIndex = nextIndex;
			this.renderActive();
		}
	}

	private jumpTo(index: number): void {
		if (index < 0 || index >= this.pages.length || index === this.activeIndex) {
			return;
		}
		this.editState.template = null;
		this.editingPage = null;
		this.activeIndex = index;
		this.renderActive();
	}

	private renderActive(): void {
		resetRenderArtifacts(this.renderCleanup, this.markdownComponents);
		this.stage.empty();
		this.pages = this.buildPages();
		if (this.activeIndex >= this.pages.length) {
			this.activeIndex = Math.max(0, this.pages.length - 1);
		}
		this.refreshThumbnails();
		if (this.pages.length === 0) {
			this.stage.createDiv({
				cls: 'tlb-slide-full__empty',
				text: t('slideView.emptyState')
			});
			this.scaleManager.setSlide(null);
			this.closeThumbnails();
			return;
		}
		const page = this.pages[this.activeIndex];
		const row = this.rows[page.rowIndex];
		const slide = this.stage.createDiv({
			cls: 'tlb-slide-full__slide',
			attr: { 'data-tlb-slide-index': String(this.activeIndex) }
		});
		if (page.editable) {
			slide.addEventListener('click', () => {
				if (this.editingPage !== page) {
					this.beginEdit(page, row);
				}
			});
		}
		if (page.backgroundColor) {
			slide.style.setProperty('--tlb-slide-card-bg', page.backgroundColor);
			this.root.style.setProperty('--tlb-slide-full-bg', page.backgroundColor);
		} else {
			slide.style.removeProperty('--tlb-slide-card-bg');
			this.root.style.removeProperty('--tlb-slide-full-bg');
		}
		if (page.textColor) {
			slide.style.setProperty('--tlb-slide-text-color', page.textColor);
		} else {
			slide.style.removeProperty('--tlb-slide-text-color');
		}
		const applyLayout = (el: HTMLElement, layout: ComputedLayout, slideEl: HTMLElement) =>
			applyLayoutWithWatcher(this.renderCleanup, el, layout, slideEl, (target, layoutSpec, container) =>
				applyLayoutStyles(target, layoutSpec, container));
		const titleEl = slide.createDiv({ cls: 'tlb-slide-full__title', text: page.title });
		titleEl.style.lineHeight = `${page.titleLayout.lineHeight}`;
		titleEl.style.fontSize = `${page.titleLayout.fontSize}rem`;
		titleEl.style.fontWeight = String(page.titleLayout.fontWeight);
		applyLayout(titleEl, page.titleLayout, slide);

		if (this.editingPage === page && page.editable && this.editState.template) {
			renderSlideEditForm({
				container: slide,
				row,
				page,
				fields: this.fields,
				reservedFields: RESERVED_FIELDS,
				state: this.editState,
				position: applyLayout,
				onCancel: () => {
					this.editState.template = null;
					this.editingPage = null;
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
					renderMarkdownBlock(this.app, page.textBlocks.join('\n'), bodyBlock, this.sourcePath, this.markdownComponents);
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
		this.thumbnailPanel.setActive(this.activeIndex);
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
				this.root.addClass('tlb-slide-full--fullscreen');
				this.updateFullscreenButton();
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
		this.editingPage = page;
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
			this.editState.template = null;
			this.editingPage = null;
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
		this.thumbnailPanel.setSlides(slides, this.activeIndex);
	}

	private openThumbnails(): void {
		this.refreshThumbnails();
		this.thumbnailPanel.setActive(this.activeIndex);
		this.thumbnailPanel.open(this.activeIndex);
	}

	private closeThumbnails(): void {
		this.thumbnailPanel.close();
	}
}
