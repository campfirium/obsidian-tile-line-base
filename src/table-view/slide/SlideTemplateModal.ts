import type { App } from 'obsidian';
import { Menu, Modal } from 'obsidian';
import { t } from '../../i18n';
import { getDefaultBodyLayout, getDefaultTitleLayout, type SlideLayoutConfig, type SlideTemplateConfig } from '../../types/slide';

interface SlideTemplateModalOptions {
	app: App;
	fields: string[];
	initial: SlideTemplateConfig;
	onSave: (next: SlideTemplateConfig) => void;
}

const RESERVED_FIELDS = new Set(['#', '__tlb_row_id', '__tlb_status', '__tlb_index', 'status', 'statusChanged']);
const clampPct = (value: number): number => Math.min(100, Math.max(0, value));

export class SlideTemplateModal extends Modal {
	private readonly fields: string[];
	private readonly onSave: (next: SlideTemplateConfig) => void;
	private titleTemplate: string;
	private bodyTemplate: string;
	private textColor: string;
	private backgroundColor: string;
	private titleLayout: SlideLayoutConfig;
	private bodyLayout: SlideLayoutConfig;
	private defaultTextColor = '';
	private defaultBackgroundColor = '';
	private titleInputEl: HTMLTextAreaElement | null = null;
	private bodyInputEl: HTMLTextAreaElement | null = null;
	private insertButtonEl: HTMLButtonElement | null = null;
	private lastFocusedInput: HTMLTextAreaElement | null = null;

	constructor(opts: SlideTemplateModalOptions) {
		super(opts.app);
		this.fields = opts.fields.filter((field) => field && !RESERVED_FIELDS.has(field));
		this.onSave = opts.onSave;
		this.titleTemplate = opts.initial.titleTemplate ?? '';
		this.bodyTemplate = opts.initial.bodyTemplate ?? '';
		this.textColor = opts.initial.textColor ?? '';
		this.backgroundColor = opts.initial.backgroundColor ?? '';
		this.titleLayout = opts.initial.titleLayout ? { ...opts.initial.titleLayout } : getDefaultTitleLayout();
		this.bodyLayout = opts.initial.bodyLayout ? { ...opts.initial.bodyLayout } : getDefaultBodyLayout();
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.addClass('tlb-slide-template');
		this.resolveThemeDefaults();
		this.renderTitleSection();
		this.renderTitleLayoutSection();
		this.renderBodySection();
		this.renderBodyLayoutSection();
		this.renderColorRow('text');
		this.renderColorRow('background');
		this.renderActions();
	}

	onClose(): void {
		this.contentEl.empty();
		this.titleInputEl = null;
		this.bodyInputEl = null;
		this.insertButtonEl = null;
		this.lastFocusedInput = null;
	}

	private renderInsertButton(container: HTMLElement): void {
		const insertButton = container.createEl('button', {
			cls: 'tlb-slide-template__insert',
			text: t('slideView.templateModal.insertField'),
			attr: { type: 'button' }
		});
		this.insertButtonEl = insertButton;
		insertButton.disabled = false;
		insertButton.addEventListener('mousedown', (event) => {
			event.preventDefault();
		});
		insertButton.addEventListener('click', (event) => {
			event.preventDefault();
			const menu = new Menu();
			if (this.fields.length === 0) {
				menu.addItem((item) => {
					item.setTitle(t('kanbanView.content.noFieldOption'));
					item.setDisabled(true);
				});
				menu.showAtMouseEvent(event);
				return;
			}
			for (const field of this.fields) {
				menu.addItem((item) => {
					item.setTitle(field);
					item.onClick(() => {
						const target = this.resolveInsertionTarget();
						if (!target) return;
						this.insertPlaceholder(target, `{${field}}`);
					});
				});
			}
			menu.showAtMouseEvent(event);
		});
		this.refreshInsertButton();
	}

	private renderTitleSection(): void {
		const section = this.contentEl.createDiv({ cls: 'tlb-slide-template__section' });
		const head = section.createDiv({ cls: 'tlb-slide-template__section-head' });
		head.createEl('div', { cls: 'tlb-slide-template__label', text: t('slideView.templateModal.titleFieldLabel') });
		head.createEl('div', { cls: 'tlb-slide-template__hint', text: t('slideView.templateModal.titleFieldDesc') });
		this.renderInsertButton(head);
		const input = section.createEl('textarea', {
			cls: 'tlb-slide-template__textarea tlb-slide-template__textarea--title',
			attr: { rows: '3' }
		}) as HTMLTextAreaElement;
		input.value = this.titleTemplate;
		this.registerFocusTracking(input);
		input.addEventListener('input', () => (this.titleTemplate = input.value));
		this.titleInputEl = input;
		this.lastFocusedInput = this.titleInputEl;
		section.createDiv({ cls: 'tlb-slide-template__sublabel', text: t('slideView.templateModal.titleContentLabel') });
	}

	private renderTitleLayoutSection(): void {
		const section = this.contentEl.createDiv({ cls: 'tlb-slide-template__section' });
		section.createDiv({ cls: 'tlb-slide-template__label', text: t('slideView.templateModal.titleLayoutLabel') });
		this.renderLayoutTwoColumn(section, this.titleLayout, (next) => {
			this.titleLayout = next;
		});
	}

	private renderBodySection(): void {
		const section = this.contentEl.createDiv({ cls: 'tlb-slide-template__section' });
		const head = section.createDiv({ cls: 'tlb-slide-template__section-head' });
		head.createEl('div', { cls: 'tlb-slide-template__label', text: t('slideView.templateModal.bodyFieldsLabel') });
		head.createEl('div', { cls: 'tlb-slide-template__hint', text: t('slideView.templateModal.bodyFieldsDesc') });
		const input = section.createEl('textarea', {
			cls: 'tlb-slide-template__textarea tlb-slide-template__textarea--body',
			attr: { rows: '4' }
		}) as HTMLTextAreaElement;
		input.value = this.bodyTemplate;
		this.registerFocusTracking(input);
		input.addEventListener('input', () => (this.bodyTemplate = input.value));
		this.bodyInputEl = input;
		this.refreshInsertButton();
		section.createDiv({ cls: 'tlb-slide-template__sublabel', text: t('slideView.templateModal.bodyContentLabel') });
	}

	private renderBodyLayoutSection(): void {
		const section = this.contentEl.createDiv({ cls: 'tlb-slide-template__section' });
		section.createDiv({ cls: 'tlb-slide-template__label', text: t('slideView.templateModal.bodyLayoutLabel') });
		this.renderLayoutTwoColumn(section, this.bodyLayout, (next) => {
			this.bodyLayout = next;
		});
	}

	private renderLayoutTwoColumn(container: HTMLElement, value: SlideLayoutConfig, onChange: (next: SlideLayoutConfig) => void): void {
		// Align row
		const alignRow = container.createDiv({ cls: 'tlb-slide-template__layout-row' });
		alignRow.createSpan({ cls: 'tlb-slide-template__layout-sublabel', text: t('slideView.templateModal.alignLabel') });
		const align = alignRow.createEl('select', { cls: 'tlb-slide-template__layout-select' });
		[
			['left', t('slideView.templateModal.alignLeft')],
			['center', t('slideView.templateModal.alignCenter')],
			['right', t('slideView.templateModal.alignRight')]
		].forEach(([key, text]) => {
			const opt = align.createEl('option', { value: key, text });
			if (value.align === key) opt.selected = true;
		});
		align.addEventListener('change', () => {
			value.align = align.value as SlideLayoutConfig['align'];
			onChange({ ...value });
		});

		// two-column grid
		const grid = container.createDiv({ cls: 'tlb-slide-template__layout-grid' });
		const numberInput = (
			labelText: string,
			current: number,
			min: number,
			max: number,
			step: number,
			assign: (val: number) => void,
			placement: 'left' | 'right'
		) => {
			const field = grid.createDiv({ cls: `tlb-slide-template__mini-field tlb-slide-template__mini-field--${placement}` });
			field.createDiv({ cls: 'tlb-slide-template__mini-label', text: labelText });
			const input = field.createEl('input', {
				type: 'number',
				value: String(current),
				attr: { min: String(min), max: String(max), step: String(step) }
			});
			input.addEventListener('input', () => {
				const next = Number(input.value);
				if (Number.isFinite(next)) {
					assign(next);
					onChange({ ...value });
				}
			});
		};

		numberInput(t('slideView.templateModal.widthPctLabel'), value.widthPct, 0, 100, 1, (v) => (value.widthPct = clampPct(v)), 'left');
		numberInput(t('slideView.templateModal.topPctLabel'), value.topPct, 0, 100, 1, (v) => (value.topPct = clampPct(v)), 'right');
		numberInput(t('slideView.templateModal.fontWeightLabel'), value.fontWeight, 100, 900, 50, (v) => (value.fontWeight = v), 'left');
		numberInput(t('slideView.templateModal.fontSizeLabel'), value.fontSize, 0.1, 10, 0.1, (v) => (value.fontSize = v), 'right');
		numberInput(t('slideView.templateModal.lineHeightLabel'), value.lineHeight, 0.5, 3, 0.1, (v) => (value.lineHeight = v), 'right');
	}

	private renderColorRow(kind: 'text' | 'background'): void {
		const row = this.contentEl.createDiv({ cls: 'tlb-slide-template__color-row' });
		const labelText =
			kind === 'text' ? t('slideView.templateModal.textColorLabel') : t('slideView.templateModal.backgroundColorLabel');
		row.createDiv({ cls: 'tlb-slide-template__color-label', text: labelText });
		const toggle = row.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
		const defaultColor = kind === 'text' ? this.defaultTextColor || '#000000' : this.defaultBackgroundColor || '#000000';
		const current = kind === 'text' ? this.textColor : this.backgroundColor;
		toggle.checked = current.trim().length > 0;
		const picker = row.createEl('input', {
			attr: { type: 'color', value: current || defaultColor },
			cls: 'tlb-slide-template__color-picker'
		}) as HTMLInputElement;
		const textInput = row.createEl('input', {
			attr: { type: 'text', value: current ?? '', placeholder: '#RRGGBB' },
			cls: 'tlb-slide-template__color-text'
		}) as HTMLInputElement;
		const resetBtn = row.createEl('button', { cls: 'tlb-slide-template__color-reset', text: t('slideView.templateModal.resetColorLabel') });

		const apply = (value: string, clear?: boolean) => {
			const normalized = clear ? '' : value.trim();
			if (kind === 'text') {
				this.textColor = normalized;
			} else {
				this.backgroundColor = normalized;
			}
			if (normalized) {
				picker.value = normalized;
				textInput.value = normalized;
				toggle.checked = true;
			} else {
				picker.value = defaultColor;
				textInput.value = '';
				toggle.checked = false;
			}
		};

		const syncEnabled = (enabled: boolean) => {
			picker.disabled = !enabled;
			textInput.disabled = !enabled;
			resetBtn.disabled = !enabled;
		};
		syncEnabled(toggle.checked);

		toggle.addEventListener('change', () => {
			if (!toggle.checked) {
				apply('', true);
			}
			syncEnabled(toggle.checked);
		});

		picker.addEventListener('input', () => apply(picker.value));
		textInput.addEventListener('input', () => apply(textInput.value));
		resetBtn.addEventListener('click', (evt) => {
			evt.preventDefault();
			apply('', true);
			syncEnabled(false);
		});
	}

	private renderActions(): void {
		const footer = this.contentEl.createDiv({ cls: 'tlb-slide-template__footer' });
		const saveButton = footer.createEl('button', {
			cls: 'mod-cta tlb-slide-template__primary',
			text: t('slideView.templateModal.saveLabel')
		});
		saveButton.addEventListener('click', () => {
			this.onSave({
				titleTemplate: this.titleTemplate,
				bodyTemplate: this.bodyTemplate,
				textColor: this.textColor,
				backgroundColor: this.backgroundColor,
				titleLayout: { ...this.titleLayout },
				bodyLayout: { ...this.bodyLayout }
			});
			this.close();
		});

		const cancelButton = footer.createEl('button', {
			text: t('slideView.templateModal.cancelLabel')
		});
		cancelButton.addEventListener('click', () => this.close());
	}

	private registerFocusTracking(input: HTMLTextAreaElement): void {
		input.addEventListener('focus', () => {
			this.lastFocusedInput = input;
			this.refreshInsertButton();
		});
		input.addEventListener('blur', () => {
			setTimeout(() => this.refreshInsertButton(), 0);
		});
	}

	private resolveActiveInput(): HTMLTextAreaElement | null {
		const active = document.activeElement;
		if (active instanceof HTMLTextAreaElement && this.contentEl.contains(active)) {
			return active;
		}
		if (this.lastFocusedInput && this.contentEl.contains(this.lastFocusedInput)) {
			return this.lastFocusedInput;
		}
		return null;
	}

	private refreshInsertButton(): void {
		if (!this.insertButtonEl) {
			return;
		}
		this.insertButtonEl.disabled = false;
      	}

	private resolveInsertionTarget(): HTMLTextAreaElement | null {
		const active = this.resolveActiveInput();
		if (active) {
			return active;
		}
		if (this.titleInputEl) {
			this.lastFocusedInput = this.titleInputEl;
			this.titleInputEl.focus();
			return this.titleInputEl;
		}
		if (this.bodyInputEl) {
			this.lastFocusedInput = this.bodyInputEl;
			this.bodyInputEl.focus();
			return this.bodyInputEl;
		}
		return null;
	}

	private insertPlaceholder(target: HTMLTextAreaElement, placeholder: string): void {
		const selectionStart = target.selectionStart ?? target.value.length;
		const selectionEnd = target.selectionEnd ?? target.value.length;
		const next =
			target.value.slice(0, selectionStart) +
			placeholder +
			target.value.slice(selectionEnd);
		target.value = next;
		const cursor = selectionStart + placeholder.length;
		target.selectionStart = cursor;
		target.selectionEnd = cursor;
		target.focus();
		target.dispatchEvent(new Event('input'));
	}

	private resolveThemeDefaults(): void {
		const owner = this.contentEl.ownerDocument ?? document;
		const root = owner.body ?? owner.documentElement;
		const styles = owner.defaultView?.getComputedStyle(root);
		const textDefault = styles?.getPropertyValue('--text-normal')?.trim();
		const bgDefault = styles?.getPropertyValue('--background-primary')?.trim();
		this.defaultTextColor = textDefault || '#dddddd';
		this.defaultBackgroundColor = bgDefault || '#000000';
	}
}
