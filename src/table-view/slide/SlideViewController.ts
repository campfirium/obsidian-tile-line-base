import { App, Component, setIcon } from 'obsidian';
import { t } from '../../i18n';
import type { RowData } from '../../grid/GridAdapter';
import type { SlideViewConfig } from '../../types/slide';
import { SlideScaleManager } from './SlideScaleManager';
import { buildSlidePages, type SlidePage } from './SlidePageBuilder';
import { applyLayoutStyles, type ComputedLayout } from './slideLayout';
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

type TemplateSegment = { type: 'text'; value: string } | { type: 'field'; field: string; value: string };

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
	private editingValues: Record<string, string> = {};
	private saving = false;
	private fieldInputs: Record<string, HTMLElement[]> = {};
	private editingTemplate: { title: TemplateSegment[]; body: TemplateSegment[][] } | null = null;

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
		this.renderControls();
		this.attachFullscreenWatcher();
		this.attachKeyboard();
		this.renderActive();
	}

	updateRows(rows: RowData[]): void {
		this.rows = rows;
		this.editingTemplate = null;
		this.editingPage = null;
		this.renderActive();
	}

	updateConfig(config: SlideViewConfig): void {
		this.config = config;
		this.editingTemplate = null;
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
			if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
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
		this.editingTemplate = null;
		this.editingPage = null;
		const nextIndex = Math.min(this.pages.length - 1, this.activeIndex + 1);
		if (nextIndex !== this.activeIndex) {
			this.activeIndex = nextIndex;
			this.renderActive();
		}
	}

	private prev(): void {
		if (this.pages.length === 0) return;
		this.editingTemplate = null;
		this.editingPage = null;
		const nextIndex = Math.max(0, this.activeIndex - 1);
		if (nextIndex !== this.activeIndex) {
			this.activeIndex = nextIndex;
			this.renderActive();
		}
	}

	private renderActive(): void {
		resetRenderArtifacts(this.renderCleanup, this.markdownComponents);
		this.stage.empty();
		this.pages = this.buildPages();
		if (this.activeIndex >= this.pages.length) {
			this.activeIndex = Math.max(0, this.pages.length - 1);
		}
		if (this.pages.length === 0) {
			this.stage.createDiv({
				cls: 'tlb-slide-full__empty',
				text: t('slideView.emptyState')
			});
			this.scaleManager.setSlide(null);
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

		if (this.editingPage === page && page.editable && this.editingTemplate) {
			this.renderEditForm(slide, row, page, applyLayout);
		} else {
			if (page.textBlocks.length === 0 && page.imageBlocks.length === 0) {
				const content = slide.createDiv({ cls: 'tlb-slide-full__content' });
				content.createDiv({ cls: 'tlb-slide-full__block tlb-slide-full__block--empty', text: t('slideView.emptyValue') });
				applyLayout(content, page.textLayout, slide);
			} else {
				if (page.textBlocks.length > 0) {
					const content = slide.createDiv({ cls: 'tlb-slide-full__content tlb-slide-full__layer--text' });
					const bodyBlock = content.createDiv({ cls: 'tlb-slide-full__block tlb-slide-full__block--text' });
					bodyBlock.textContent = page.textBlocks.join('\n');
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
		const editableFields = this.fields.filter((field) => field && !RESERVED_FIELDS.has(field));
		const values: Record<string, string> = {};
		for (const field of editableFields) {
			const raw = row[field];
			values[field] = typeof raw === 'string' ? raw : String(raw ?? '');
		}
		this.editingValues = values;
		this.fieldInputs = {};
		this.editingTemplate = null;
		this.renderActive();
	}

	private renderEditForm(
		container: HTMLElement,
		row: RowData,
		page: SlidePage,
		position: (el: HTMLElement, layout: ComputedLayout, slideEl: HTMLElement) => void
	): void {
		this.editingTemplate = { title: [], body: [] };
		const editingTemplate = this.editingTemplate;
		const titleLine = container.createDiv({
			cls: 'tlb-slide-full__title tlb-slide-full__editable-title'
		});
		titleLine.style.lineHeight = `${page.titleLayout.lineHeight}`;
		titleLine.style.fontSize = `${page.titleLayout.fontSize}rem`;
		titleLine.style.fontWeight = String(page.titleLayout.fontWeight);
		position(titleLine, page.titleLayout, container);
		this.renderTemplateSegments(titleLine, page.templateRef.titleTemplate, row, editingTemplate.title);

		const bodyContainer = container.createDiv({ cls: 'tlb-slide-full__content tlb-slide-full__editable-body' });
		const bodyBlock = bodyContainer.createDiv({ cls: 'tlb-slide-full__block tlb-slide-full__editable-block' });
		bodyBlock.style.lineHeight = `${page.textLayout.lineHeight}`;
		bodyBlock.style.fontSize = `${page.textLayout.fontSize}rem`;
		bodyBlock.style.fontWeight = String(page.textLayout.fontWeight);
		bodyBlock.style.textAlign = page.textLayout.align;
		const bodyLines = page.templateRef.bodyTemplate.split(/\r?\n/);
		if (bodyLines.length === 0) {
			bodyLines.push('');
		}
		bodyLines.forEach((line, index) => {
			const segments: TemplateSegment[] = [];
			this.renderTemplateSegments(bodyBlock, line, row, segments);
			editingTemplate.body.push(segments);
			if (index < bodyLines.length - 1) {
				bodyBlock.createEl('br');
			}
		});
		position(bodyContainer, page.textLayout, container);

		const actions = container.createDiv({ cls: 'tlb-slide-full__actions' });
		const cancel = actions.createEl('button', { attr: { type: 'button' }, text: t('slideView.templateModal.cancelLabel') });
		cancel.addEventListener('click', (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			this.editingTemplate = null;
			this.editingPage = null;
			this.renderActive();
		});
		const save = actions.createEl('button', { cls: 'mod-cta', attr: { type: 'button' }, text: t('slideView.templateModal.saveLabel') });
		save.addEventListener('click', (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			void this.persistEdit(page);
		});
	}

	private renderTemplateSegments(
		container: HTMLElement,
		template: string,
		row: RowData,
		collect: TemplateSegment[]
	): void {
		const orderedFields = this.fields.filter((field) => field && !RESERVED_FIELDS.has(field));
		const values: Record<string, string> = {};
		for (const field of orderedFields) {
			if (field === 'status') continue;
			const raw = row[field];
			values[field] = typeof raw === 'string' ? raw : String(raw ?? '');
		}

		const segments: TemplateSegment[] = [];
		const regex = /\{([^{}]+)\}/g;
		let lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = regex.exec(template)) !== null) {
			const before = template.slice(lastIndex, match.index);
			if (before) {
				segments.push({ type: 'text', value: before });
			}
			const fieldName = match[1].trim();
			if (fieldName && !RESERVED_FIELDS.has(fieldName)) {
				const value = this.editingValues[fieldName] ?? values[fieldName] ?? '';
				segments.push({ type: 'field', field: fieldName, value });
			} else {
				segments.push({ type: 'text', value: '' });
			}
			lastIndex = regex.lastIndex;
		}
		if (lastIndex < template.length) {
			segments.push({ type: 'text', value: template.slice(lastIndex) });
		}

		for (const segment of segments) {
			if (segment.type === 'text') {
				if (segment.value) {
					const input = container.createEl('span', {
						text: segment.value,
						cls: 'tlb-slide-full__editable-input tlb-slide-full__editable-text',
						attr: { contenteditable: 'true' }
					});
					input.addEventListener('input', () => {
						segment.value = input.textContent ?? '';
					});
					collect.push(segment);
				}
			} else {
				const input = container.createEl('span', {
					text: segment.value,
					cls: 'tlb-slide-full__editable-input tlb-slide-full__editable-input--field',
					attr: { contenteditable: 'true' }
				});
				const field = segment.field;
				if (!this.fieldInputs[field]) {
					this.fieldInputs[field] = [];
				}
				this.fieldInputs[field].push(input);
				input.addEventListener('input', () => {
					this.editingValues[field] = input.textContent ?? '';
					for (const peer of this.fieldInputs[field]) {
						if (peer !== input) {
							peer.textContent = input.textContent;
						}
					}
				});
				collect.push({ type: 'field', field, value: this.editingValues[field] ?? '' });
			}
		}
	}

	private async persistEdit(page: SlidePage): Promise<void> {
		if (this.saving || !this.editingTemplate) return;
		this.saving = true;
		try {
			const renderSegments = (segments: TemplateSegment[]): string =>
				segments.map((seg) => (seg.type === 'text' ? seg.value : `{${seg.field}}`)).join('');
			const titleTemplate = renderSegments(this.editingTemplate.title);
			const bodyTemplate = this.editingTemplate.body.map(renderSegments).join('\n');
			page.updateTemplate({
				...page.templateRef,
				titleTemplate,
				bodyTemplate
			});
			const row = this.rows[page.rowIndex];
			const nextRows = await this.onSaveRow(row, this.editingValues);
			if (nextRows) {
				this.updateRows(nextRows);
			}
			this.editingTemplate = null;
			this.editingPage = null;
			this.renderActive();
		} finally {
			this.saving = false;
		}
	}
}
