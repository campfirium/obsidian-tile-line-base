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
		this.modalEl.addClass('tlb-slide-template-modal');
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
		this.modalEl.addClass('tlb-slide-template-modal');
		this.titleEl.setText(t('slideView.templateModal.title'));
		this.resolveThemeDefaults();
		const grid = this.contentEl.createDiv({ cls: 'tlb-slide-template__grid' });

		const titleRow = this.createRow(grid);
		this.renderTitleContent(titleRow.left);
		this.renderLayoutTwoColumn(titleRow.right, t('slideView.templateModal.titleLayoutLabel'), this.titleLayout, (next) => {
			this.titleLayout = next;
		});

		const bodyRow = this.createRow(grid);
		this.renderBodyContent(bodyRow.left);
		this.renderLayoutTwoColumn(bodyRow.right, t('slideView.templateModal.bodyLayoutLabel'), this.bodyLayout, (next) => {
			this.bodyLayout = next;
		});

		this.renderColorRow(grid, 'text');
		this.renderColorRow(grid, 'background');

		this.renderActions();
	}

	onClose(): void {
		this.contentEl.empty();
		this.titleInputEl = null;
		this.bodyInputEl = null;
		this.insertButtonEl = null;
		this.lastFocusedInput = null;
	}

	private createRow(parent: HTMLElement): { row: HTMLElement; left: HTMLElement; right: HTMLElement } {
		const row = parent.createDiv({ cls: 'tlb-slide-template__row' });
		const left = row.createDiv({ cls: 'tlb-slide-template__cell' });
		const right = row.createDiv({ cls: 'tlb-slide-template__cell' });
		return { row, left, right };
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

	private renderTitleContent(container: HTMLElement): void {
		const head = container.createDiv({ cls: 'tlb-slide-template__cell-head-row' });
		head.createDiv({ cls: 'tlb-slide-template__cell-head', text: t('slideView.templateModal.titleContentLabel') });
		this.renderInsertButton(head);
		const input = container.createEl('textarea', {
			cls: 'tlb-slide-template__textarea tlb-slide-template__textarea--title',
			attr: { rows: '3' }
		}) as HTMLTextAreaElement;
		input.value = this.titleTemplate;
		this.registerFocusTracking(input);
		input.addEventListener('input', () => (this.titleTemplate = input.value));
		this.titleInputEl = input;
		this.lastFocusedInput = this.titleInputEl;
	}

	private renderBodyContent(container: HTMLElement): void {
		container.createDiv({ cls: 'tlb-slide-template__cell-head', text: t('slideView.templateModal.bodyContentLabel') });
		const textarea = container.createEl('textarea', {
			cls: 'tlb-slide-template__textarea tlb-slide-template__textarea--body',
			attr: { rows: '4' }
		}) as HTMLTextAreaElement;
		textarea.value = this.bodyTemplate;
		this.registerFocusTracking(textarea);
		textarea.addEventListener('input', () => (this.bodyTemplate = textarea.value));
		this.bodyInputEl = textarea;
		this.refreshInsertButton();
	}

	private renderLayoutTwoColumn(container: HTMLElement, heading: string, value: SlideLayoutConfig, onChange: (next: SlideLayoutConfig) => void): void {
		if (heading) container.createDiv({ cls: 'tlb-slide-template__cell-head', text: heading });
		const layout = container.createDiv({ cls: 'tlb-slide-template__layout-lines' });

		const addSelectRow = (parent: HTMLElement, label: string, update: (val: string) => void) => {
			const field = parent.createDiv({ cls: 'tlb-slide-template__layout-field' });
			field.createDiv({ cls: 'tlb-slide-template__mini-label', text: label });
			const select = field.createEl('select', { cls: 'tlb-slide-template__layout-select' });
			return { select, field, update };
		};

		const numberRow = (
			parent: HTMLElement,
			labelText: string,
			current: number,
			min: number,
			max: number,
			step: number,
			assign: (val: number) => void,
			disabled = false
		) => {
			const field = parent.createDiv({ cls: 'tlb-slide-template__layout-field' });
			const labelEl = field.createDiv({ cls: 'tlb-slide-template__mini-label', text: labelText });
			const input = field.createEl('input', {
				type: 'number',
				value: String(current),
				attr: { min: String(min), max: String(max), step: String(step) },
				cls: 'tlb-slide-template__layout-number'
			});
			input.disabled = disabled;
			input.addEventListener('input', () => {
				const next = Number(input.value);
				if (Number.isFinite(next)) {
					assign(next);
					onChange({ ...value });
				}
			});
			return { input, labelEl, field };
		};

		const layoutRow = (kind: 'two' | 'three') =>
			layout.createDiv({ cls: `tlb-slide-template__layout-line tlb-slide-template__layout-line--${kind}` });

		const row1 = layoutRow('two');
		const insetLabel = () =>
			value.align === 'right'
				? `${t('slideView.templateModal.alignRight')} inset (%)`
				: `${t('slideView.templateModal.alignLeft')} inset (%)`;

		const alignRow = addSelectRow(row1, t('slideView.templateModal.alignLabel'), (next) => {
			value.align = next as SlideLayoutConfig['align'];
			onChange({ ...value });
			insetInput.disabled = value.align === 'center';
			insetInput.dataset.label = insetLabel();
			insetInput.previousElementSibling?.setText?.(insetLabel());
		});
		const align = alignRow.select;
		[
			['left', t('slideView.templateModal.alignLeft')],
			['center', t('slideView.templateModal.alignCenter')],
			['right', t('slideView.templateModal.alignRight')]
		].forEach(([key, text]) => {
			const opt = align.createEl('option', { value: key, text });
			if (value.align === key) opt.selected = true;
		});
		const insetField = numberRow(
			row1,
			insetLabel(),
			value.insetPct,
			0,
			100,
			1,
			(v) => (value.insetPct = clampPct(v)),
			value.align === 'center'
		);
		const insetInput = insetField.input;
		const insetLabelEl = insetField.labelEl;
		const insetFieldEl = insetField.field;
		const syncInsetVisibility = () => {
			const shouldHide = value.align === 'center';
			insetInput.disabled = shouldHide;
			insetFieldEl.classList.toggle('is-hidden', shouldHide);
			insetLabelEl.textContent = insetLabel();
		};
		syncInsetVisibility();
		align.addEventListener('change', () => {
			value.align = align.value as SlideLayoutConfig['align'];
			syncInsetVisibility();
			onChange({ ...value });
		});

		const row2 = layoutRow('two');
		numberRow(row2, t('slideView.templateModal.topPctLabel'), value.topPct, 0, 100, 1, (v) => (value.topPct = clampPct(v)));
		numberRow(row2, t('slideView.templateModal.widthPctLabel'), value.widthPct, 0, 100, 1, (v) => (value.widthPct = clampPct(v)));

		const row3 = layoutRow('three');
		numberRow(row3, t('slideView.templateModal.fontSizeLabel'), value.fontSize, 0.1, 10, 0.1, (v) => (value.fontSize = v));
		numberRow(row3, t('slideView.templateModal.fontWeightLabel'), value.fontWeight, 100, 900, 50, (v) => (value.fontWeight = v));
		numberRow(row3, t('slideView.templateModal.lineHeightLabel'), value.lineHeight, 0.5, 3, 0.1, (v) => (value.lineHeight = v));
	}

	private renderColorRow(container: HTMLElement, kind: 'text' | 'background'): void {
		const row = container.createDiv({ cls: 'tlb-slide-template__row tlb-slide-template__row--full' });
		const colorCell = row.createDiv({ cls: 'tlb-slide-template__cell tlb-slide-template__cell--full' });
		const colorRow = colorCell.createDiv({ cls: 'tlb-slide-template__color-row' });
		const labelText =
			kind === 'text' ? t('slideView.templateModal.textColorLabel') : t('slideView.templateModal.backgroundColorLabel');
		colorRow.createDiv({ cls: 'tlb-slide-template__color-label', text: labelText });
		const defaultColor = kind === 'text' ? this.defaultTextColor || '#000000' : this.defaultBackgroundColor || '#000000';
		const current = kind === 'text' ? this.textColor : this.backgroundColor;
		const fallback = current && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(current) ? current : defaultColor;
		const picker = colorRow.createEl('input', {
			attr: { type: 'color', value: fallback },
			cls: 'tlb-slide-template__color-picker'
		}) as HTMLInputElement;
		const textInput = colorRow.createEl('input', {
			attr: { type: 'text', value: current ?? '', placeholder: '#RRGGBB' },
			cls: 'tlb-slide-template__color-text'
		}) as HTMLInputElement;
		const resetBtn = colorRow.createEl('button', {
			cls: 'tlb-slide-template__color-reset',
			text: t('slideView.templateModal.resetColorLabel'),
			attr: { type: 'button' }
		});
		resetBtn.createSpan({ cls: 'tlb-slide-template__color-reset-dot' });

		const apply = (value: string) => {
			const normalized = value.trim();
			if (kind === 'text') {
				this.textColor = normalized;
			} else {
				this.backgroundColor = normalized;
			}
			if (normalized) {
				if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(normalized)) {
					picker.value = normalized;
				}
				textInput.value = normalized;
			} else {
				picker.value = defaultColor;
				textInput.value = '';
			}
		};

		picker.addEventListener('input', () => apply(picker.value));
		textInput.addEventListener('input', () => apply(textInput.value));
		resetBtn.addEventListener('click', (evt) => {
			evt.preventDefault();
			apply('');
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
