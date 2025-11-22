import { setIcon } from 'obsidian';
import { t } from '../../i18n';
import type { RowData } from '../../grid/GridAdapter';
import type { SlideViewConfig } from '../../types/slide';

interface SlideControllerOptions {
	container: HTMLElement;
	rows: RowData[];
	fields: string[];
	config: SlideViewConfig;
	onSaveRow: (row: RowData, values: Record<string, string>) => Promise<RowData[] | void>;
	onEditTemplate: () => void;
}

const RESERVED_FIELDS = new Set(['#', '__tlb_row_id', '__tlb_status', '__tlb_index', 'status', 'statusChanged']);

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
		if (this.editingIndex === this.activeIndex) {
			this.renderEditForm(slide, row);
		} else {
			slide.createDiv({ cls: 'tlb-slide-full__title', text: title });
			const content = slide.createDiv({ cls: 'tlb-slide-full__content' });
			if (contents.length === 0) {
				content.createDiv({ cls: 'tlb-slide-full__block tlb-slide-full__block--empty', text: t('slideView.emptyValue') });
			} else {
				for (const value of contents) {
					content.createDiv({ cls: 'tlb-slide-full__block', text: value });
				}
			}
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

		const renderTemplate = (templateText: string): string => {
			const input = templateText.replace(/\r\n/g, '\n');
			return input.replace(/\{([^{}]+)\}/g, (_, key: string) => {
				const field = key.trim();
				if (!field || RESERVED_FIELDS.has(field)) {
					return '';
				}
				return values[field] ?? '';
			}).trim();
		};

		const titleTemplate = template.titleTemplate || `{${orderedFields[0] ?? ''}}`;
		const title = renderTemplate(titleTemplate) || t('slideView.untitledSlide', { index: String(this.activeIndex + 1) });

		const body = renderTemplate(template.bodyTemplate);
		const contents = body ? body.split('\n').filter((line) => line.trim().length > 0) : [];
		return { title, contents };
	}

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
		this.renderActive();
	}

	private renderEditForm(container: HTMLElement, row: RowData): void {
		container.createDiv({ cls: 'tlb-slide-full__title', text: t('slideView.edit.heading') });
		const form = container.createDiv({ cls: 'tlb-slide-full__editor' });
		const editableFields = this.fields.filter((field) => field && !RESERVED_FIELDS.has(field));
		for (const field of editableFields) {
			const fieldRow = form.createDiv({ cls: 'tlb-slide-full__field' });
			fieldRow.createDiv({ cls: 'tlb-slide-full__field-label', text: field });
			const input = fieldRow.createEl('textarea', {
				cls: 'tlb-slide-full__field-input',
				attr: { rows: '2' }
			});
			input.value = this.editingValues[field] ?? '';
			input.addEventListener('input', () => {
				this.editingValues[field] = input.value;
			});
		}
		const actions = form.createDiv({ cls: 'tlb-slide-full__actions' });
		const cancel = actions.createEl('button', { text: t('slideView.templateModal.cancelLabel') });
		cancel.addEventListener('click', (evt) => {
			evt.preventDefault();
			this.editingIndex = null;
			this.editingValues = {};
			this.renderActive();
		});
		const save = actions.createEl('button', { cls: 'mod-cta', text: t('slideView.templateModal.saveLabel') });
		save.addEventListener('click', (evt) => {
			evt.preventDefault();
			void this.persistEdit(row);
		});
	}

	private async persistEdit(row: RowData): Promise<void> {
		if (this.saving) return;
		this.saving = true;
		try {
			const nextRows = await this.onSaveRow(row, this.editingValues);
			if (nextRows) {
				this.updateRows(nextRows);
			}
			this.editingIndex = null;
			this.editingValues = {};
			this.renderActive();
		} finally {
			this.saving = false;
		}
	}
}
