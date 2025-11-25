/* eslint-disable max-lines */
import type { App } from 'obsidian';
import { Menu, Modal, parseYaml, stringifyYaml } from 'obsidian';
import { t } from '../../i18n';
import {
	getDefaultBodyLayout,
	getDefaultTitleLayout,
	sanitizeSlideTemplateConfig,
	type SlideLayoutConfig,
	type SlideTemplateConfig
} from '../../types/slide';

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
	private template: SlideTemplateConfig;
	private defaultTextColor = '';
	private defaultBackgroundColor = '';
	private titleInputEl: HTMLTextAreaElement | null = null;
	private bodyInputEl: HTMLTextAreaElement | null = null;
	private insertButtonEl: HTMLButtonElement | null = null;
	private lastFocusedInput: HTMLTextAreaElement | null = null;
	private isYamlMode = false;
	private yamlInputEl: HTMLTextAreaElement | null = null;
	private singleBranch: 'withoutImage' | 'withImage';
	private splitBranch: 'withoutImage' | 'withImage';

	constructor(opts: SlideTemplateModalOptions) {
		super(opts.app);
		this.modalEl.addClass('tlb-slide-template-modal');
		this.fields = opts.fields.filter((field) => field && !RESERVED_FIELDS.has(field));
		this.onSave = opts.onSave;
		this.template = JSON.parse(JSON.stringify(opts.initial)) as SlideTemplateConfig;
		this.singleBranch = this.template.single.withImage.imageField ? 'withImage' : 'withoutImage';
		this.splitBranch = this.template.split.withImage.imageField ? 'withImage' : 'withoutImage';
	}

	onOpen(): void {
		this.renderModalContent();
	}

	onClose(): void {
		this.contentEl.empty();
		this.titleInputEl = null;
		this.bodyInputEl = null;
		this.insertButtonEl = null;
		this.lastFocusedInput = null;
		this.isYamlMode = false;
		this.yamlInputEl = null;
	}

	private getText(key: string, fallback: string): string {
		const translated = t(key as any);
		return translated === key ? fallback : translated;
	}

	private renderModalContent(): void {
		this.contentEl.empty();
		this.titleInputEl = null;
		this.bodyInputEl = null;
		this.insertButtonEl = null;
		this.lastFocusedInput = null;
		this.yamlInputEl = null;
		this.contentEl.addClass('tlb-slide-template');
		this.modalEl.addClass('tlb-slide-template-modal');
		this.titleEl.setText(t('slideView.templateModal.title'));

		const toolbar = this.contentEl.createDiv({ cls: 'tlb-slide-template__header' });
		const toolbarLeft = toolbar.createDiv({ cls: 'tlb-slide-template__toolbar-left' });
		this.renderSlideModeSwitch(toolbarLeft);
		const toolbarRight = toolbar.createDiv({ cls: 'tlb-slide-template__toolbar-right' });
		this.renderModeToggle(toolbarRight);

		if (this.isYamlMode) {
			this.renderYamlView();
			return;
		}

		this.resolveThemeDefaults();
		this.renderSingleSection(this.template.mode === 'single');
		this.renderSplitSection(this.template.mode === 'split');
		this.renderColorRow(this.contentEl, 'text');
		this.renderColorRow(this.contentEl, 'background');
		this.renderActions();
	}

	private createRow(parent: HTMLElement): { row: HTMLElement; left: HTMLElement; right: HTMLElement } {
		const row = parent.createDiv({ cls: 'tlb-slide-template__row' });
		const left = row.createDiv({ cls: 'tlb-slide-template__cell' });
		const right = row.createDiv({ cls: 'tlb-slide-template__cell' });
		return { row, left, right };
	}

	private renderSlideModeSwitch(container: HTMLElement): void {
		const switchRow = container.createDiv({ cls: 'tlb-slide-template__mode-switch' });
		this.renderModeButton(
			switchRow,
			'single',
			this.getText('slideView.templateModal.modeSingleLabel', 'Single layout')
		);
		this.renderModeButton(
			switchRow,
			'split',
			this.getText('slideView.templateModal.modeSplitLabel', 'Split layout')
		);
	}

	private renderModeButton(container: HTMLElement, mode: 'single' | 'split', label: string): void {
		const btn = container.createEl('button', {
			text: label,
			cls: `tlb-slide-template__mode-btn${this.template.mode === mode ? ' is-active' : ''}`
		});
		btn.setAttr('aria-pressed', this.template.mode === mode ? 'true' : 'false');
		btn.addEventListener('click', (evt) => {
			evt.preventDefault();
			if (this.template.mode !== mode) {
				this.template.mode = mode;
				this.renderModalContent();
			}
		});
	}

	private renderModeToggle(container: HTMLElement): void {
		const label = this.isYamlMode
			? t('slideView.templateModal.backToFormLabel')
			: t('slideView.templateModal.showYamlLabel');
		const toggleButton = container.createEl('button', {
			cls: 'tlb-slide-template__mode-toggle',
			text: label,
			attr: { type: 'button' }
		});
		toggleButton.addEventListener('click', (event) => {
			event.preventDefault();
			if (this.isYamlMode) {
				this.applyYamlInput();
			}
			this.isYamlMode = !this.isYamlMode;
			this.renderModalContent();
		});
	}

	private renderYamlView(): void {
		const grid = this.contentEl.createDiv({ cls: 'tlb-slide-template__grid' });
		const row = this.createRow(grid);
		row.left.createDiv({ cls: 'tlb-slide-template__cell-head', text: t('slideView.templateModal.bodyFieldsDesc') });
		const textarea = row.left.createEl('textarea', {
			cls: 'tlb-slide-template__textarea tlb-slide-template__textarea--body',
			attr: { rows: '16' }
		}) as HTMLTextAreaElement;
		textarea.value = stringifyYaml(this.template);
		this.yamlInputEl = textarea;
	}

	private applyYamlInput(): void {
		if (!this.yamlInputEl) return;
		try {
			const parsed = parseYaml(this.yamlInputEl.value) as unknown;
			const sanitized = sanitizeSlideTemplateConfig(parsed);
			this.template = sanitized;
		} catch {
			// ignore malformed yaml; keep old template
		}
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

	private renderTextContent(
		container: HTMLElement,
		titleValue: string,
		bodyValue: string,
		onChange: (payload: { title: string; body: string }) => void
	): void {
		const head = container.createDiv({ cls: 'tlb-slide-template__cell-head-row' });
		head.createDiv({ cls: 'tlb-slide-template__cell-head', text: t('slideView.templateModal.titleContentLabel') });
		this.renderInsertButton(head);
		const input = container.createEl('textarea', {
			cls: 'tlb-slide-template__textarea tlb-slide-template__textarea--title',
			attr: { rows: '3' }
		}) as HTMLTextAreaElement;
		input.value = titleValue;
		this.registerFocusTracking(input);
		input.addEventListener('input', () => onChange({ title: input.value, body: bodyValue }));
		this.titleInputEl = input;
		this.lastFocusedInput = this.titleInputEl;

		container.createDiv({ cls: 'tlb-slide-template__cell-head', text: t('slideView.templateModal.bodyContentLabel') });
		const textarea = container.createEl('textarea', {
			cls: 'tlb-slide-template__textarea tlb-slide-template__textarea--body',
			attr: { rows: '4' }
		}) as HTMLTextAreaElement;
		textarea.value = bodyValue;
		this.registerFocusTracking(textarea);
		textarea.addEventListener('input', () => onChange({ title: input.value, body: textarea.value }));
		this.bodyInputEl = textarea;
		this.refreshInsertButton();
	}

	private renderBranchTabs(
		container: HTMLElement,
		current: 'withoutImage' | 'withImage',
		labels: { without: string; with: string },
		onSelect: (next: 'withoutImage' | 'withImage') => void
	): void {
		const row = container.createDiv({ cls: 'tlb-slide-template__mode-switch tlb-slide-template__branch-switch' });
		const buildBtn = (value: 'withoutImage' | 'withImage', text: string) => {
			const btn = row.createEl('button', {
				text,
				cls: `tlb-slide-template__mode-btn${current === value ? ' is-active' : ''}`
			});
			btn.setAttr('aria-pressed', current === value ? 'true' : 'false');
			btn.addEventListener('click', (evt) => {
				evt.preventDefault();
				if (current !== value) {
					onSelect(value);
				}
			});
		};
		buildBtn('withoutImage', labels.without);
		buildBtn('withImage', labels.with);
	}

	private renderImageFieldSelect(
		grid: HTMLElement,
		current: string | null | undefined,
		onChange: (next: string | null) => void
	): void {
		const cell = grid.createDiv({ cls: 'tlb-slide-template__cell tlb-slide-template__cell--full' });
		const block = cell.createDiv({ cls: 'tlb-slide-template__block' });
		block.createDiv({
			cls: 'tlb-slide-template__cell-head',
			text: this.getText('slideView.templateModal.imageFieldLabel', 'Image field')
		});
		block.createDiv({
			cls: 'tlb-slide-template__hint',
			text: this.getText(
				'slideView.templateModal.imageFieldHint',
				'Used to decide when to switch to the with-image layouts.'
			)
		});
		const fieldSelect = block.createEl('select', { cls: 'dropdown' });
		const placeholder = fieldSelect.createEl('option', { value: '', text: t('kanbanView.content.noFieldOption') || '' });
		placeholder.selected = !current;
		for (const field of this.fields) {
			const opt = fieldSelect.createEl('option', { value: field, text: field });
			if (field === current) {
				opt.selected = true;
			}
		}
		fieldSelect.addEventListener('change', () => {
			onChange(fieldSelect.value || null);
		});
	}

	private renderImagePageTitleToggle(container: HTMLElement, showTitle: boolean, onChange: (next: boolean) => void): void {
		const row = container.createDiv({ cls: 'tlb-slide-template__cell-head-row' });
		const checkbox = row.createEl('input', { type: 'checkbox' });
		checkbox.checked = showTitle;
		const label = row.createDiv({
			cls: 'tlb-slide-template__cell-head',
			text: this.getText('slideView.templateModal.imagePageTitleLabel', 'Show title on image page')
		});
		label.addClass('tlb-slide-template__cell-head');
		label.addEventListener('click', () => checkbox.click());
		checkbox.addEventListener('change', () => onChange(checkbox.checked));
		container.createDiv({
			cls: 'tlb-slide-template__hint',
			text: this.getText(
				'slideView.templateModal.imagePageTitleHint',
				'When disabled, the image-only page hides the text title.'
			)
		});
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
		const current = kind === 'text' ? this.template.textColor : this.template.backgroundColor;
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
				this.template.textColor = normalized;
			} else {
				this.template.backgroundColor = normalized;
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
			if (this.isYamlMode) {
				this.applyYamlInput();
			}
			this.onSave(this.template);
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

	private renderSingleSection(active: boolean): void {
		const wrapper = this.contentEl.createDiv({ cls: 'tlb-slide-template__section' });
		wrapper.toggleClass('is-inactive', !active);
		if (!active) {
			wrapper.setAttr('aria-disabled', 'true');
		}
		wrapper.createDiv({
			cls: 'tlb-slide-template__hint',
			text: this.getText(
				'slideView.templateModal.modeSingleDesc',
				'One row renders one slide; if an image is available it shows alongside the text.'
			)
		});
		this.renderBranchTabs(
			wrapper,
			this.singleBranch,
			{
				without: this.getText('slideView.templateModal.noImageTabLabel', 'Text slide'),
				with: this.getText('slideView.templateModal.withImageTabLabel', 'Text + image slide')
			},
			(next) => {
				this.singleBranch = next;
				this.renderModalContent();
			}
		);
		const grid = wrapper.createDiv({ cls: 'tlb-slide-template__grid' });

		if (this.singleBranch === 'withoutImage') {
			const withoutRow = this.createRow(grid);
			this.renderTextContent(
				withoutRow.left,
				this.template.single.withoutImage.titleTemplate,
				this.template.single.withoutImage.bodyTemplate,
				(next) => {
					this.template.single.withoutImage.titleTemplate = next.title;
					this.template.single.withoutImage.bodyTemplate = next.body;
				}
			);
			this.renderLayoutTwoColumn(
				withoutRow.right,
				t('slideView.templateModal.titleLayoutLabel'),
				this.template.single.withoutImage.titleLayout ?? getDefaultTitleLayout(),
				(next) => (this.template.single.withoutImage.titleLayout = next)
			);
			this.renderLayoutTwoColumn(
				withoutRow.right,
				t('slideView.templateModal.bodyLayoutLabel'),
				this.template.single.withoutImage.bodyLayout ?? getDefaultBodyLayout(),
				(next) => (this.template.single.withoutImage.bodyLayout = next)
			);
		} else {
			this.renderImageFieldSelect(grid, this.template.single.withImage.imageField, (next) => {
				this.template.single.withImage.imageField = next;
			});
			const withImageRow = this.createRow(grid);
			this.renderTextContent(
				withImageRow.left,
				this.template.single.withImage.titleTemplate,
				this.template.single.withImage.bodyTemplate,
				(next) => {
					this.template.single.withImage.titleTemplate = next.title;
					this.template.single.withImage.bodyTemplate = next.body;
				}
			);
			this.renderLayoutTwoColumn(
				withImageRow.right,
				t('slideView.templateModal.titleLayoutLabel'),
				this.template.single.withImage.titleLayout ?? getDefaultTitleLayout(),
				(next) => (this.template.single.withImage.titleLayout = next)
			);
			this.renderLayoutTwoColumn(
				withImageRow.right,
				t('slideView.templateModal.bodyLayoutLabel'),
				this.template.single.withImage.bodyLayout ?? getDefaultBodyLayout(),
				(next) => (this.template.single.withImage.bodyLayout = next)
			);
			const imageLayoutRow = this.createRow(grid);
			imageLayoutRow.left.createDiv({
				cls: 'tlb-slide-template__cell-head',
				text: this.getText('slideView.templateModal.imageLayoutLabel', 'Image layout')
			});
			this.renderLayoutTwoColumn(
				imageLayoutRow.right,
				this.getText('slideView.templateModal.imageLayoutLabel', 'Image layout'),
				this.template.single.withImage.imageLayout ?? getDefaultBodyLayout(),
				(next) => (this.template.single.withImage.imageLayout = next)
			);
		}
	}

	private renderSplitSection(active: boolean): void {
		const wrapper = this.contentEl.createDiv({ cls: 'tlb-slide-template__section' });
		wrapper.toggleClass('is-inactive', !active);
		if (!active) {
			wrapper.setAttr('aria-disabled', 'true');
		}
		wrapper.createDiv({
			cls: 'tlb-slide-template__hint',
			text: this.getText(
				'slideView.templateModal.modeSplitDesc',
				'One row renders two slides: a text slide and an image-focused slide when an image is available.'
			)
		});
		this.renderBranchTabs(
			wrapper,
			this.splitBranch,
			{
				without: this.getText('slideView.templateModal.noImageTabLabel', 'Text slide'),
				with: this.getText('slideView.templateModal.withImageTabLabel', 'Text + image slides')
			},
			(next) => {
				this.splitBranch = next;
				this.renderModalContent();
			}
		);
		const grid = wrapper.createDiv({ cls: 'tlb-slide-template__grid' });

		if (this.splitBranch === 'withoutImage') {
			const withoutRow = this.createRow(grid);
			this.renderTextContent(
				withoutRow.left,
				this.template.split.withoutImage.titleTemplate,
				this.template.split.withoutImage.bodyTemplate,
				(next) => {
					this.template.split.withoutImage.titleTemplate = next.title;
					this.template.split.withoutImage.bodyTemplate = next.body;
				}
			);
			this.renderLayoutTwoColumn(
				withoutRow.right,
				t('slideView.templateModal.titleLayoutLabel'),
				this.template.split.withoutImage.titleLayout ?? getDefaultTitleLayout(),
				(next) => (this.template.split.withoutImage.titleLayout = next)
			);
			this.renderLayoutTwoColumn(
				withoutRow.right,
				t('slideView.templateModal.bodyLayoutLabel'),
				this.template.split.withoutImage.bodyLayout ?? getDefaultBodyLayout(),
				(next) => (this.template.split.withoutImage.bodyLayout = next)
			);
		} else {
			this.renderImageFieldSelect(grid, this.template.split.withImage.imageField, (next) => {
				this.template.split.withImage.imageField = next;
			});
			const withImageRow = this.createRow(grid);
			this.renderTextContent(
				withImageRow.left,
				this.template.split.withImage.textPage.titleTemplate,
				this.template.split.withImage.textPage.bodyTemplate,
				(next) => {
					this.template.split.withImage.textPage.titleTemplate = next.title;
					this.template.split.withImage.textPage.bodyTemplate = next.body;
				}
			);
			this.renderLayoutTwoColumn(
				withImageRow.right,
				t('slideView.templateModal.titleLayoutLabel'),
				this.template.split.withImage.textPage.titleLayout ?? getDefaultTitleLayout(),
				(next) => (this.template.split.withImage.textPage.titleLayout = next)
			);
			this.renderLayoutTwoColumn(
				withImageRow.right,
				t('slideView.templateModal.bodyLayoutLabel'),
				this.template.split.withImage.textPage.bodyLayout ?? getDefaultBodyLayout(),
				(next) => (this.template.split.withImage.textPage.bodyLayout = next)
			);
			const imageTitleRow = this.createRow(grid);
			this.renderImagePageTitleToggle(
				imageTitleRow.left,
				this.template.split.withImage.imagePage.showTitle !== false,
				(next) => (this.template.split.withImage.imagePage.showTitle = next)
			);
			this.renderLayoutTwoColumn(
				imageTitleRow.right,
				this.getText('slideView.templateModal.imagePageTitleLayout', 'Image page title layout'),
				this.template.split.withImage.imagePage.titleLayout ?? getDefaultTitleLayout(),
				(next) => (this.template.split.withImage.imagePage.titleLayout = next)
			);
			const imageLayoutRow = this.createRow(grid);
			imageLayoutRow.left.createDiv({
				cls: 'tlb-slide-template__cell-head',
				text: this.getText('slideView.templateModal.imageLayoutLabel', 'Image layout')
			});
			this.renderLayoutTwoColumn(
				imageLayoutRow.right,
				this.getText('slideView.templateModal.imageLayoutLabel', 'Image layout'),
				this.template.split.withImage.imagePage.imageLayout ?? getDefaultBodyLayout(),
				(next) => (this.template.split.withImage.imagePage.imageLayout = next)
			);
		}
	}
}
