import { setIcon } from 'obsidian';
import { t } from '../../i18n';
import type { RowData } from '../../grid/GridAdapter';
import type { SlideViewConfig } from '../../types/slide';
import { getDefaultBodyLayout, getDefaultTitleLayout } from '../../types/slide';

interface SlideControllerOptions {
	container: HTMLElement;
	rows: RowData[];
	fields: string[];
	config: SlideViewConfig;
	onSaveRow: (row: RowData, values: Record<string, string>) => Promise<RowData[] | void>;
	onEditTemplate: () => void;
}

type TemplateSegment = { type: 'text'; value: string } | { type: 'field'; field: string; value: string };

const RESERVED_FIELDS = new Set(['#', '__tlb_row_id', '__tlb_status', '__tlb_index', 'status', 'statusChanged']);

interface ComputedLayout {
	widthPct: number;
	topPct: number;
	insetPct: number;
	align: 'left' | 'center' | 'right';
	lineHeight: number;
	fontSize: number;
	fontWeight: number;
}

export class SlideViewController {
	private readonly root: HTMLElement;
	private readonly stage: HTMLElement;
	private readonly controls: HTMLElement;
	private rows: RowData[] = [];
	private fields: string[] = [];
	private config: SlideViewConfig;
	private activeIndex = 0;
	private readonly cleanup: Array<() => void> = [];
	private readonly onSaveRow: (row: RowData, values: Record<string, string>) => Promise<RowData[] | void>;
	private readonly onEditTemplate: () => void;
	private fullscreenTarget: HTMLElement | null = null;
	private isFullscreen = false;
	private fullscreenBtn: HTMLElement | null = null;
	private fullscreenCleanup: (() => void) | null = null;
	private editingIndex: number | null = null;
	private editingValues: Record<string, string> = {};
	private saving = false;
	private fieldInputs: Record<string, HTMLElement[]> = {};
	private editingTemplate: { title: TemplateSegment[]; body: TemplateSegment[][] } | null = null;

	constructor(options: SlideControllerOptions) {
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
		this.renderControls();
		this.attachFullscreenWatcher();
		this.attachKeyboard();
		this.renderActive();
	}

	updateRows(rows: RowData[]): void {
		this.rows = rows;
		this.editingIndex = null;
		this.editingTemplate = null;
		if (this.activeIndex >= this.rows.length) {
			this.activeIndex = Math.max(0, this.rows.length - 1);
		}
		this.renderActive();
	}

	updateConfig(config: SlideViewConfig): void {
		this.config = config;
		this.renderActive();
	}

	destroy(): void {
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
			}
		};
		doc.addEventListener('fullscreenchange', listener);
		this.fullscreenCleanup = () => doc.removeEventListener('fullscreenchange', listener);
		this.cleanup.push(() => this.fullscreenCleanup?.());
	}

	private next(): void {
		if (this.rows.length === 0) return;
		this.editingIndex = null;
		const nextIndex = Math.min(this.rows.length - 1, this.activeIndex + 1);
		if (nextIndex !== this.activeIndex) {
			this.activeIndex = nextIndex;
			this.renderActive();
		}
	}

	private prev(): void {
		if (this.rows.length === 0) return;
		this.editingIndex = null;
		const nextIndex = Math.max(0, this.activeIndex - 1);
		if (nextIndex !== this.activeIndex) {
			this.activeIndex = nextIndex;
			this.renderActive();
		}
	}

	private renderActive(): void {
		this.stage.empty();
		if (this.rows.length === 0) {
			this.stage.createDiv({
				cls: 'tlb-slide-full__empty',
				text: t('slideView.emptyState')
			});
			return;
		}
		const row = this.rows[this.activeIndex];
		const { title, contents } = this.resolveContent(row);
		const slide = this.stage.createDiv({
			cls: 'tlb-slide-full__slide',
			attr: { 'data-tlb-slide-index': String(this.activeIndex) }
		});
		slide.addEventListener('click', () => {
			if (this.editingIndex !== this.activeIndex) {
				this.beginEdit(row);
			}
		});
		const bgColor = (this.config.template.backgroundColor ?? '').trim();
		const textColor = (this.config.template.textColor ?? '').trim();
		if (bgColor) {
			slide.style.setProperty('--tlb-slide-card-bg', bgColor);
			this.root.style.setProperty('--tlb-slide-full-bg', bgColor);
		} else {
			slide.style.removeProperty('--tlb-slide-card-bg');
			this.root.style.removeProperty('--tlb-slide-full-bg');
		}
		if (textColor) {
			slide.style.setProperty('--tlb-slide-text-color', textColor);
		} else {
			slide.style.removeProperty('--tlb-slide-text-color');
		}
		const titleLayout = this.getComputedLayout(this.config.template.titleLayout, 'title');
		const bodyLayout = this.getComputedLayout(this.config.template.bodyLayout, 'body');
		if (this.editingIndex === this.activeIndex) {
			this.renderEditForm(slide, row, titleLayout, bodyLayout);
		} else {
			const titleEl = slide.createDiv({ cls: 'tlb-slide-full__title', text: title });
			titleEl.style.lineHeight = `${titleLayout.lineHeight}`;
			titleEl.style.fontSize = `${titleLayout.fontSize}rem`;
			titleEl.style.fontWeight = String(titleLayout.fontWeight);
			this.applyLayoutStyles(titleEl, titleLayout, slide);
			const content = slide.createDiv({ cls: 'tlb-slide-full__content' });
			if (contents.length === 0) {
				content.createDiv({ cls: 'tlb-slide-full__block tlb-slide-full__block--empty', text: t('slideView.emptyValue') });
			} else {
				const bodyBlock = content.createDiv({ cls: 'tlb-slide-full__block tlb-slide-full__block--text' });
				bodyBlock.textContent = contents.join('\n');
				bodyBlock.style.lineHeight = `${bodyLayout.lineHeight}`;
				bodyBlock.style.fontSize = `${bodyLayout.fontSize}rem`;
				bodyBlock.style.fontWeight = String(bodyLayout.fontWeight);
				bodyBlock.style.textAlign = bodyLayout.align;
			}
			this.applyLayoutStyles(content, bodyLayout, slide);
		}
	}

	private resolveContent(row: RowData): { title: string; contents: string[] } {
		const orderedFields = this.fields.filter((field) => field && !RESERVED_FIELDS.has(field));
		const template = this.config.template;
		const values: Record<string, string> = {};
		for (const field of orderedFields) {
			if (field === 'status') continue;
			const raw = row[field];
			const text = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
			if (!text) continue;
			values[field] = text;
		}

		const renderTemplate = (templateText: string, trimResult = true): string => {
			const input = templateText.replace(/\r\n/g, '\n');
			const replaced = input.replace(/\{([^{}]+)\}/g, (_, key: string) => {
				const field = key.trim();
				if (!field || RESERVED_FIELDS.has(field)) {
					return '';
				}
				return values[field] ?? '';
			});
			return trimResult ? replaced.trim() : replaced;
		};

		const titleTemplate = template.titleTemplate || `{${orderedFields[0] ?? ''}}`;
		const title = renderTemplate(titleTemplate) || t('slideView.untitledSlide', { index: String(this.activeIndex + 1) });

		const body = renderTemplate(template.bodyTemplate, false);
		const lines = body.split('\n');
		const hasContent = lines.some((line) => line.trim().length > 0);
		return { title, contents: hasContent ? lines : [] };
	}

	private getComputedLayout(layout: unknown, kind: 'title' | 'body'): ComputedLayout {
		const defaults = kind === 'title' ? getDefaultTitleLayout() : getDefaultBodyLayout();
		const source = layout && typeof layout === 'object' ? (layout as any) : {};
		const widthPct = Math.min(100, Math.max(0, Number(source.widthPct ?? defaults.widthPct)));
		const topPct = Math.min(100, Math.max(0, Number(source.topPct ?? defaults.topPct)));
		const insetPct = Math.min(100, Math.max(0, Number(source.insetPct ?? defaults.insetPct)));
		const align: ComputedLayout['align'] =
			source.align === 'left' || source.align === 'right' || source.align === 'center'
				? source.align
				: defaults.align;
		const lineHeight = Number.isFinite(source.lineHeight) ? Number(source.lineHeight) : defaults.lineHeight;
		const fontSize = Number.isFinite(source.fontSize) ? Number(source.fontSize) : defaults.fontSize;
		const fontWeight = Number.isFinite(source.fontWeight) ? Number(source.fontWeight) : defaults.fontWeight;
		return { widthPct, topPct, insetPct, align, lineHeight, fontSize, fontWeight };
	}

	/* eslint-disable obsidianmd/no-static-styles-assignment */
	private applyLayoutStyles(el: HTMLElement, layout: ComputedLayout, slideEl: HTMLElement): void {
		el.classList.add('tlb-slide-layout');
		el.style.setProperty('--tlb-layout-width', `${layout.widthPct}%`);
		el.style.setProperty('--tlb-layout-text-align', layout.align);

		// Horizontal alignment with inset.
		if (layout.align === 'center') {
			el.style.setProperty('--tlb-layout-left', '50%');
			el.style.setProperty('--tlb-layout-right', 'auto');
			el.style.setProperty('--tlb-layout-transform', 'translateX(-50%)');
		} else if (layout.align === 'right') {
			el.style.setProperty('--tlb-layout-left', 'auto');
			el.style.setProperty('--tlb-layout-right', `${layout.insetPct}%`);
			el.style.setProperty('--tlb-layout-transform', 'translateX(0)');
		} else {
			el.style.setProperty('--tlb-layout-left', `${layout.insetPct}%`);
			el.style.setProperty('--tlb-layout-right', 'auto');
			el.style.setProperty('--tlb-layout-transform', 'translateX(0)');
		}

		// Vertical positioning: topPct is absolute from the top, clamped to keep block in view.
		const usableHeight = Math.max(0, slideEl.clientHeight);
		const blockHeight = el.offsetHeight;
		const topPx = (usableHeight * layout.topPct) / 100;
		const maxTop = Math.max(0, usableHeight - blockHeight);
		el.style.setProperty('--tlb-layout-top', `${Math.min(topPx, maxTop)}px`);
	}
	/* eslint-enable obsidianmd/no-static-styles-assignment */

	private async enterFullscreen(): Promise<void> {
		if (!this.fullscreenTarget || this.isFullscreen) return;
		try {
			if (this.fullscreenTarget.requestFullscreen) {
				await this.fullscreenTarget.requestFullscreen();
				this.isFullscreen = true;
				this.root.addClass('tlb-slide-full--fullscreen');
				this.updateFullscreenButton();
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

	private beginEdit(row: RowData): void {
		const editableFields = this.fields.filter((field) => field && !RESERVED_FIELDS.has(field));
		const values: Record<string, string> = {};
		for (const field of editableFields) {
			const raw = row[field];
			values[field] = typeof raw === 'string' ? raw : String(raw ?? '');
		}
		this.editingIndex = this.activeIndex;
		this.editingValues = values;
		this.fieldInputs = {};
		this.editingTemplate = null;
		this.renderActive();
	}

	private renderEditForm(container: HTMLElement, row: RowData, titleLayout: ComputedLayout, bodyLayout: ComputedLayout): void {
		this.editingTemplate = { title: [], body: [] };
		const titleLine = container.createDiv({
			cls: 'tlb-slide-full__title tlb-slide-full__editable-title'
		});
		titleLine.style.lineHeight = `${titleLayout.lineHeight}`;
		titleLine.style.fontSize = `${titleLayout.fontSize}rem`;
		titleLine.style.fontWeight = String(titleLayout.fontWeight);
		this.applyLayoutStyles(titleLine, titleLayout, container);
		this.renderTemplateSegments(titleLine, this.config.template.titleTemplate, row, this.editingTemplate.title);

		const bodyContainer = container.createDiv({ cls: 'tlb-slide-full__editable-body' });
		const bodyLines = this.config.template.bodyTemplate.split(/\r?\n/);
		if (bodyLines.length === 0) {
			bodyContainer.createDiv({ cls: 'tlb-slide-full__block tlb-slide-full__block--empty', text: t('slideView.emptyValue') });
		} else {
			for (const line of bodyLines) {
				const lineEl = bodyContainer.createDiv({ cls: 'tlb-slide-full__editable-line tlb-slide-full__block' });
				lineEl.style.lineHeight = `${bodyLayout.lineHeight}`;
				lineEl.style.fontSize = `${bodyLayout.fontSize}rem`;
				lineEl.style.fontWeight = String(bodyLayout.fontWeight);
				const segments: TemplateSegment[] = [];
				this.renderTemplateSegments(lineEl, line, row, segments);
				this.editingTemplate.body.push(segments);
			}
		}
		this.applyLayoutStyles(bodyContainer, bodyLayout, container);

		const actions = container.createDiv({ cls: 'tlb-slide-full__actions' });
		const cancel = actions.createEl('button', { attr: { type: 'button' }, text: t('slideView.templateModal.cancelLabel') });
		cancel.addEventListener('click', (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			this.editingIndex = null;
			this.editingValues = {};
			this.editingTemplate = null;
			this.renderActive();
		});
		const save = actions.createEl('button', { cls: 'mod-cta', attr: { type: 'button' }, text: t('slideView.templateModal.saveLabel') });
		save.addEventListener('click', (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			void this.persistEdit(row);
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

	private async persistEdit(row: RowData): Promise<void> {
		if (this.saving) return;
		this.saving = true;
		try {
			if (this.editingTemplate) {
				const renderSegments = (segments: TemplateSegment[]): string =>
					segments.map((seg) => (seg.type === 'text' ? seg.value : `{${seg.field}}`)).join('');
				const titleTemplate = renderSegments(this.editingTemplate.title);
				const bodyTemplate = this.editingTemplate.body.map(renderSegments).join('\n');
				this.config = {
					...this.config,
					template: {
						...this.config.template,
						titleTemplate,
						bodyTemplate
					}
				};
			}
			const nextRows = await this.onSaveRow(row, this.editingValues);
			if (nextRows) {
				this.updateRows(nextRows);
			}
			this.editingIndex = null;
			this.editingValues = {};
			this.editingTemplate = null;
			this.renderActive();
		} finally {
			this.saving = false;
		}
	}
}
