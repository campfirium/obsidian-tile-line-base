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
		this.titleEl.setText(t('slideView.templateModal.title'));
		this.resolveThemeDefaults();
		const grid = this.contentEl.createDiv({ cls: 'tlb-slide-template__grid' });
		const leftCol = grid.createDiv({ cls: 'tlb-slide-template__col tlb-slide-template__col--content' });
		const rightCol = grid.createDiv({ cls: 'tlb-slide-template__col tlb-slide-template__col--layout' });

		this.renderInsertRow(leftCol);
		this.renderTitleInput(leftCol);
		this.renderBodyInput(leftCol);
		this.ensureBodyInputExists();

		this.renderLayoutInputs(rightCol);
		this.renderColorInputs(rightCol);
		this.renderActions();
	}

	onClose(): void {
		this.contentEl.empty();
		this.titleInputEl = null;
		this.bodyInputEl = null;
		this.insertButtonEl = null;
		this.lastFocusedInput = null;
	}

	private renderInsertRow(parent?: HTMLElement): void {
		const container = parent ?? this.contentEl;
		const header = container.createDiv({ cls: 'tlb-slide-template__header' });
		const insertButton = header.createEl('button', {
			cls: 'tlb-slide-template__insert',
			text: t('slideView.templateModal.insertField'),
			attr: { type: 'button' }
		});
		this.insertButtonEl = insertButton;
		insertButton.disabled = false;
		insertButton.addEventListener('mousedown', (event) => {
			// Preserve textarea focus so insertion target stays accurate.
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
						if (!target) {
							return;
						}
						this.insertPlaceholder(target, `{${field}}`);
					});
				});
			}
			menu.showAtMouseEvent(event);
		});
		this.refreshInsertButton();
	}

	private renderTitleInput(parent?: HTMLElement): void {
		const block = (parent ?? this.contentEl).createDiv({ cls: 'tlb-slide-template__block' });
		block.createEl('div', { cls: 'tlb-slide-template__label', text: t('slideView.templateModal.titleFieldLabel') });
		block.createEl('div', { cls: 'tlb-slide-template__hint', text: t('slideView.templateModal.titleFieldDesc') });
		const input = block.createEl('textarea', {
			cls: 'tlb-slide-template__textarea tlb-slide-template__textarea--title',
			attr: {
				rows: '2',
				placeholder: t('slideView.templateModal.titleFieldDesc')
			}
		}) as HTMLTextAreaElement;
		input.value = this.titleTemplate;
		this.registerFocusTracking(input);
		input.addEventListener('input', () => {
			this.titleTemplate = input.value;
		});
		this.titleInputEl = input;
		this.lastFocusedInput = this.titleInputEl;
		this.refreshInsertButton();
	}

	private renderBodyInput(parent?: HTMLElement): void {
		const block = (parent ?? this.contentEl).createDiv({ cls: 'tlb-slide-template__block' });
		block.createEl('div', { cls: 'tlb-slide-template__label', text: t('slideView.templateModal.bodyFieldsLabel') });
		block.createEl('div', { cls: 'tlb-slide-template__hint', text: t('slideView.templateModal.bodyFieldsDesc') });
		const textarea = block.createEl('textarea', {
			cls: 'tlb-slide-template__textarea tlb-slide-template__textarea--body',
			attr: {
				rows: '4',
				placeholder: t('slideView.templateModal.bodyFieldsDesc')
			}
		}) as HTMLTextAreaElement;
		textarea.value = this.bodyTemplate;
		this.registerFocusTracking(textarea);
		textarea.addEventListener('input', () => {
			this.bodyTemplate = textarea.value;
		});
		this.bodyInputEl = textarea;
		this.refreshInsertButton();
	}

	private ensureBodyInputExists(parent?: HTMLElement): void {
		if (this.bodyInputEl && this.contentEl.contains(this.bodyInputEl)) {
			return;
		}
		const block = (parent ?? this.contentEl).createDiv({ cls: 'tlb-slide-template__block' });
		block.createEl('div', { cls: 'tlb-slide-template__label', text: t('slideView.templateModal.bodyFieldsLabel') });
		block.createEl('div', { cls: 'tlb-slide-template__hint', text: t('slideView.templateModal.bodyFieldsDesc') });
		const textarea = block.createEl('textarea', {
			cls: 'tlb-slide-template__textarea tlb-slide-template__textarea--body',
			attr: {
				rows: '4',
				placeholder: t('slideView.templateModal.bodyFieldsDesc')
			}
		}) as HTMLTextAreaElement;
		textarea.value = this.bodyTemplate;
		this.registerFocusTracking(textarea);
		textarea.addEventListener('input', () => {
			this.bodyTemplate = textarea.value;
		});
		this.bodyInputEl = textarea;
		this.refreshInsertButton();
	}

	private renderColorInputs(parent?: HTMLElement): void {
		const group = (parent ?? this.contentEl).createDiv({ cls: 'tlb-slide-template__color-group' });
		this.renderColorInput(group, {
			label: t('slideView.templateModal.textColorLabel'),
			value: this.textColor,
			defaultColor: this.defaultTextColor,
			onChange: (value) => {
				this.textColor = value;
			}
		});
		this.renderColorInput(group, {
			label: t('slideView.templateModal.backgroundColorLabel'),
			value: this.backgroundColor,
			defaultColor: this.defaultBackgroundColor,
			onChange: (value) => {
				this.backgroundColor = value;
			}
		});
	}

	private renderLayoutInputs(parent?: HTMLElement): void {
		const layoutGroup = (parent ?? this.contentEl).createDiv({ cls: 'tlb-slide-template__layout-group' });
		layoutGroup.createEl('h4', { cls: 'tlb-slide-template__layout-title', text: t('slideView.templateModal.layoutTitle') });
		this.renderLayoutRow(layoutGroup, t('slideView.templateModal.titleLayoutLabel'), this.titleLayout, (next) => {
			this.titleLayout = next;
		});
		this.renderLayoutRow(layoutGroup, t('slideView.templateModal.bodyLayoutLabel'), this.bodyLayout, (next) => {
			this.bodyLayout = next;
		});
	}

	private renderLayoutRow(
		container: HTMLElement,
		label: string,
		value: SlideLayoutConfig,
		onChange: (next: SlideLayoutConfig) => void
	): void {
		const row = container.createDiv({ cls: 'tlb-slide-template__layout-row' });
		row.createDiv({ cls: 'tlb-slide-template__layout-label', text: label });
		const inputs = row.createDiv({ cls: 'tlb-slide-template__layout-fields' });

		const numberInput = (labelText: string, current: number, min: number, max: number, assign: (val: number) => void) => {
			const field = inputs.createDiv({ cls: 'tlb-slide-template__layout-field' });
			field.createDiv({ cls: 'tlb-slide-template__layout-sublabel', text: labelText });
			const input = field.createEl('input', {
				type: 'number',
				value: String(current),
				attr: { min: String(min), max: String(max), step: '1' },
				cls: 'tlb-slide-template__layout-number'
			});
			input.addEventListener('input', () => {
				const next = Number(input.value);
				if (Number.isFinite(next)) {
					assign(next);
					onChange({ ...value });
				}
			});
		};

		numberInput(t('slideView.templateModal.widthPctLabel'), value.widthPct, 0, 100, (v) => (value.widthPct = clampPct(v)));
		numberInput(t('slideView.templateModal.topPctLabel'), value.topPct, 0, 100, (v) => (value.topPct = clampPct(v)));

		const alignField = inputs.createDiv({ cls: 'tlb-slide-template__layout-field' });
		alignField.createDiv({ cls: 'tlb-slide-template__layout-sublabel', text: t('slideView.templateModal.alignLabel') });
		const align = alignField.createEl('select', { cls: 'tlb-slide-template__layout-select' });
		[
			['left', t('slideView.templateModal.alignLeft')],
			['center', t('slideView.templateModal.alignCenter')],
			['right', t('slideView.templateModal.alignRight')]
		].forEach(([key, text]) => {
			const opt = align.createEl('option', { value: key, text });
			if (value.align === key) {
				opt.selected = true;
			}
		});
		align.addEventListener('change', () => {
			const next = align.value as SlideLayoutConfig['align'];
			value.align = next;
			onChange({ ...value });
		});

		numberInput(t('slideView.templateModal.lineHeightLabel'), value.lineHeight, 0.5, 3, (v) => (value.lineHeight = v));
		numberInput(t('slideView.templateModal.fontSizeLabel'), value.fontSize, 0.5, 5, (v) => (value.fontSize = v));
		numberInput(t('slideView.templateModal.fontWeightLabel'), value.fontWeight, 100, 900, (v) => (value.fontWeight = v));
	}

	private renderColorInput(
		container: HTMLElement,
		config: { label: string; value: string; defaultColor: string; onChange: (value: string) => void }
	): void {
		const row = container.createDiv({ cls: 'tlb-slide-template__color-row' });
		row.createEl('div', { cls: 'tlb-slide-template__color-label', text: config.label });
		const defaultColor = config.defaultColor && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(config.defaultColor)
			? config.defaultColor
			: '#000000';
		const fallbackColor =
			config.value && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(config.value) ? config.value : defaultColor;
		const picker = row.createEl('input', {
			attr: {
				type: 'color',
				value: fallbackColor
			}
		}) as HTMLInputElement;
		const textInput = row.createEl('input', {
			attr: {
				type: 'text',
				value: config.value ?? '',
				placeholder: '#RRGGBB'
			},
			cls: 'tlb-slide-template__color-text'
		}) as HTMLInputElement;
		const resetBtn = row.createEl('button', {
			text: t('slideView.templateModal.resetColorLabel'),
			cls: 'tlb-slide-template__color-reset',
			attr: { type: 'button' }
		});
		const resetDot = resetBtn.createSpan({ cls: 'tlb-slide-template__color-reset-dot' });
		resetDot.style.backgroundColor = defaultColor;
		resetDot.style.borderColor = defaultColor;

		const applyValue = (value: string) => {
			const normalized = value.trim();
			if (normalized) {
				config.onChange(normalized);
				if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(normalized)) {
					picker.value = normalized;
				}
				textInput.value = normalized;
			} else {
				config.onChange('');
				textInput.value = '';
			}
		};

		picker.addEventListener('input', () => {
			applyValue(picker.value);
		});
		textInput.addEventListener('input', () => {
			applyValue(textInput.value);
		});
		resetBtn.addEventListener('click', () => {
			config.onChange('');
			textInput.value = '';
			picker.value = defaultColor;
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
