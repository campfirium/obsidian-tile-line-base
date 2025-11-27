/* eslint-disable max-lines */
import type { App } from 'obsidian';
import { Menu, Modal, Notice, parseYaml, setIcon } from 'obsidian';
import { t } from '../../i18n';
import {
	getDefaultBodyLayout,
	getDefaultTitleLayout,
	sanitizeSlideTemplateConfig,
	type SlideLayoutConfig,
	type SlideTemplateConfig
} from '../../types/slide';
import { getPluginContext } from '../../pluginContext';
import { buildBuiltInSlideTemplate, RESERVED_SLIDE_FIELDS } from './slideDefaults';

interface SlideTemplateModalOptions {
	app: App;
	fields: string[];
	initial: SlideTemplateConfig;
	onSave: (next: SlideTemplateConfig) => void;
	onSaveDefault?: (next: SlideTemplateConfig) => Promise<void> | void;
}

const clampPct = (value: number): number => Math.min(100, Math.max(0, value));

export class SlideTemplateModal extends Modal {
	private static lastSelectedSingleBranch: 'withoutImage' | 'withImage' = 'withoutImage';
	private static lastSelectedSplitBranch: 'withoutImage' | 'withImage' = 'withoutImage';
	private readonly fields: string[];
	private readonly onSave: (next: SlideTemplateConfig) => void;
	private readonly onSaveDefault?: (next: SlideTemplateConfig) => Promise<void> | void;
	private template: SlideTemplateConfig;
	private defaultTextColor = '';
	private defaultBackgroundColor = '';
	private titleInputEl: HTMLTextAreaElement | null = null;
	private bodyInputEl: HTMLTextAreaElement | null = null;
	private insertButtonEl: HTMLButtonElement | null = null;
	private lastFocusedInput: HTMLTextAreaElement | null = null;
	private singleBranch: 'withoutImage' | 'withImage';
	private splitBranch: 'withoutImage' | 'withImage';
	private containerNode: HTMLElement | null = null;

	constructor(opts: SlideTemplateModalOptions) {
		super(opts.app);
		this.modalEl.addClass('tlb-slide-template-modal');
		this.fields = opts.fields.filter((field) => field && !RESERVED_SLIDE_FIELDS.has(field));
		this.onSave = opts.onSave;
		this.onSaveDefault = opts.onSaveDefault;
		this.template = JSON.parse(JSON.stringify(opts.initial)) as SlideTemplateConfig;
		this.singleBranch = this.resolveInitialBranch('single');
		this.splitBranch = this.resolveInitialBranch('split');
	}

	onOpen(): void {
		const container = this.modalEl?.parentElement;
		if (container) {
			container.classList.add('tlb-slide-template-container');
			this.containerNode = container;
		}
		this.renderModalContent();
	}

	onClose(): void {
		this.contentEl.empty();
		this.titleInputEl = null;
		this.bodyInputEl = null;
		this.insertButtonEl = null;
		this.lastFocusedInput = null;
		if (this.containerNode) {
			this.containerNode.classList.remove('tlb-slide-template-container');
			this.containerNode = null;
		}
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
		this.contentEl.addClass('tlb-slide-template');
		this.modalEl.addClass('tlb-slide-template-modal');
		this.titleEl.setText(t('slideView.templateModal.title'));

		const toolbar = this.contentEl.createDiv({ cls: 'tlb-slide-template__header' });
		const toolbarLeft = toolbar.createDiv({ cls: 'tlb-slide-template__toolbar-left' });
		this.renderSlideModeSwitch(toolbarLeft);
		const toolbarRight = toolbar.createDiv({ cls: 'tlb-slide-template__toolbar-right' });
		this.renderPresetsMenu(toolbarRight);

		this.resolveThemeDefaults();
		this.renderSingleSection(this.template.mode === 'single');
		this.renderSplitSection(this.template.mode === 'split');
		this.renderColorSection(this.contentEl);
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
			this.getText('slideView.templateModal.modeSingleLabel', 'Combined Slide')
		);
		this.renderModeButton(
			switchRow,
			'split',
			this.getText('slideView.templateModal.modeSplitLabel', 'Split Slides')
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
				this.setBranchSelection(mode, this.resolveInitialBranch(mode));
				this.renderModalContent();
			}
		});
	}

	private renderPresetsMenu(container: HTMLElement): void {
		if (!this.onSaveDefault) {
			return;
		}
		const presetsButton = container.createEl('button', {
			cls: 'tlb-slide-template__mode-toggle',
			attr: { type: 'button' }
		});
		presetsButton.createSpan({ text: t('slideView.templateModal.presetsLabel') });
		const iconWrap = presetsButton.createSpan({ cls: 'tlb-slide-template__chevron' });
		setIcon(iconWrap, 'chevron-down');
		presetsButton.addEventListener('click', (event) => {
			event.preventDefault();
			const menu = new Menu();
			menu.addItem((item) => {
				item.setTitle(t('slideView.templateModal.setDefaultLabel')).onClick(() => {
					this.saveAsGlobalDefault();
				});
			});
			menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle(t('slideView.templateModal.resetToGlobalDefaultLabel')).onClick(() => {
					this.applyGlobalDefault();
				});
			});
			menu.addItem((item) => {
				item.setTitle(t('slideView.templateModal.resetToBuiltInDefaultLabel')).onClick(() => {
					this.applyBuiltInDefault();
				});
			});
			menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle(t('slideView.templateModal.copyPresetLabel')).onClick(() => {
					void this.copyPresetToClipboard();
				});
			});
			menu.addItem((item) => {
				item.setTitle(t('slideView.templateModal.pastePresetLabel')).onClick(() => {
					void this.pastePresetFromClipboard();
				});
			});
			menu.showAtMouseEvent(event);
		});
	}

	private getClipboard(): Clipboard | null {
		const ownerDoc = this.contentEl.ownerDocument ?? document;
		const navigatorLike =
			ownerDoc.defaultView?.navigator ?? (typeof navigator === 'undefined' ? null : navigator);
		return navigatorLike?.clipboard ?? null;
	}

	private isTemplatePayload(payload: unknown): boolean {
		if (!payload || typeof payload !== 'object') {
			return false;
		}
		const raw = payload as Record<string, unknown>;
		return Boolean(
			raw.single ||
				raw.split ||
				typeof raw.mode === 'string' ||
				typeof raw.titleTemplate === 'string' ||
				typeof raw.bodyTemplate === 'string' ||
				raw.textColor !== undefined ||
				raw.backgroundColor !== undefined
		);
	}

	private async copyPresetToClipboard(): Promise<void> {
		const clipboard = this.getClipboard();
		if (!clipboard?.writeText) {
			new Notice(t('slideView.templateModal.clipboardUnavailable'));
			return;
		}
		try {
			const payload = JSON.stringify(sanitizeSlideTemplateConfig(this.template), null, 2);
			await clipboard.writeText(payload);
			new Notice(t('slideView.templateModal.copyPresetSuccess'));
		} catch (error) {
			console.error('[SlideTemplateModal] Failed to copy preset', error);
			new Notice(t('slideView.templateModal.copyPresetFailed'));
		}
	}

	private async pastePresetFromClipboard(): Promise<void> {
		const clipboard = this.getClipboard();
		if (!clipboard?.readText) {
			new Notice(t('slideView.templateModal.clipboardUnavailable'));
			return;
		}
		let rawText = '';
		try {
			rawText = await clipboard.readText();
		} catch (error) {
			console.error('[SlideTemplateModal] Failed to read preset from clipboard', error);
			new Notice(t('slideView.templateModal.pastePresetFailed'));
			return;
		}
		if (!rawText || rawText.trim().length === 0) {
			new Notice(t('slideView.templateModal.pastePresetInvalid'));
			return;
		}
		let parsed: unknown;
		try {
			parsed = parseYaml(rawText);
		} catch (error) {
			console.error('[SlideTemplateModal] Failed to parse preset from clipboard', error);
			new Notice(t('slideView.templateModal.pastePresetInvalid'));
			return;
		}
		if (!this.isTemplatePayload(parsed)) {
			new Notice(t('slideView.templateModal.pastePresetInvalid'));
			return;
		}
		try {
			this.template = sanitizeSlideTemplateConfig(parsed);
			this.setBranchSelection('single', this.resolveInitialBranch('single'));
			this.setBranchSelection('split', this.resolveInitialBranch('split'));
			this.renderModalContent();
			new Notice(t('slideView.templateModal.pastePresetSuccess'));
		} catch (error) {
			console.error('[SlideTemplateModal] Failed to apply preset from clipboard', error);
			new Notice(t('slideView.templateModal.pastePresetFailed'));
		}
	}

	private saveAsGlobalDefault(): void {
		if (!this.onSaveDefault) {
			return;
		}
		try {
			const nextTemplate = sanitizeSlideTemplateConfig(this.template);
			const maybePromise = this.onSaveDefault(nextTemplate);
			if (maybePromise && typeof (maybePromise as Promise<void>).catch === 'function') {
				void maybePromise.catch((error: unknown) => {
					console.error('[SlideTemplateModal] Failed to save global default', error);
					new Notice(t('slideView.templateModal.setDefaultError'));
				});
			}
		} catch (error) {
			console.error('[SlideTemplateModal] Failed to save global default', error);
			new Notice(t('slideView.templateModal.setDefaultError'));
		}
	}

	private applyPresetStyles(preset: SlideTemplateConfig): void {
		const sanitizedPreset = sanitizeSlideTemplateConfig(preset);
		this.template = sanitizedPreset;
		this.setBranchSelection('single', this.resolveInitialBranch('single'));
		this.setBranchSelection('split', this.resolveInitialBranch('split'));
		this.renderModalContent();
	}

	private applyGlobalDefault(): void {
		const plugin = getPluginContext();
		const globalConfig = plugin?.getDefaultSlideConfig();
		if (!globalConfig || !globalConfig.template) {
			new Notice(t('slideView.templateModal.noGlobalDefault'));
			return;
		}
		this.applyPresetStyles(globalConfig.template);
	}

	private applyBuiltInDefault(): void {
		const preset = buildBuiltInSlideTemplate(this.fields);
		this.applyPresetStyles(preset);
	}

	private setBranchSelection(mode: 'single' | 'split', branch: 'withoutImage' | 'withImage'): void {
		if (mode === 'single') {
			this.singleBranch = branch;
			SlideTemplateModal.lastSelectedSingleBranch = branch;
			return;
		}
		this.splitBranch = branch;
		SlideTemplateModal.lastSelectedSplitBranch = branch;
	}

	private resolveInitialBranch(mode: 'single' | 'split'): 'withoutImage' | 'withImage' {
		const hasImageTemplate =
			mode === 'single'
				? Boolean(this.template.single.withImage.imageTemplate?.trim())
				: Boolean(this.template.split.withImage.imageTemplate?.trim());
		if (hasImageTemplate) {
			return 'withImage';
		}
		return mode === 'single' ? SlideTemplateModal.lastSelectedSingleBranch : SlideTemplateModal.lastSelectedSplitBranch;
	}

	private renderInsertButton(container: HTMLElement, getPreferredTarget?: () => HTMLTextAreaElement | null): void {
		const insertButton = container.createEl('button', {
			cls: 'tlb-slide-template__insert',
			attr: { type: 'button', 'aria-label': t('slideView.templateModal.insertField') }
		});
		const icon = insertButton.createSpan({ cls: 'tlb-slide-template__insert-icon' });
		setIcon(icon, 'plus');
		insertButton.createSpan({ text: t('slideView.templateModal.insertField') });
		this.insertButtonEl = insertButton;
		insertButton.disabled = false;
		insertButton.addEventListener('mousedown', (event) => {
			event.preventDefault();
		});
		insertButton.addEventListener('click', (event) => {
			event.preventDefault();
			const preferred = getPreferredTarget?.();
			if (preferred) {
				this.lastFocusedInput = preferred;
				preferred.focus();
			}
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
						const target = getPreferredTarget?.() ?? this.resolveInsertionTarget();
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
		this.renderInsertButton(head, () => this.titleInputEl);
		const input = container.createEl('textarea', {
			cls: 'tlb-slide-template__textarea tlb-slide-template__textarea--title',
			attr: { rows: '3' }
		}) as HTMLTextAreaElement;
		input.value = titleValue;
		this.registerFocusTracking(input);
		input.addEventListener('input', () => onChange({ title: input.value, body: bodyValue }));
		this.titleInputEl = input;
		this.lastFocusedInput = this.titleInputEl;

		const bodyHead = container.createDiv({ cls: 'tlb-slide-template__cell-head-row' });
		bodyHead.createDiv({ cls: 'tlb-slide-template__cell-head', text: t('slideView.templateModal.bodyContentLabel') });
		this.renderInsertButton(bodyHead, () => this.bodyInputEl);
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

	private renderImageContent(
		grid: HTMLElement,
		label: string,
		value: string,
		onChange: (next: string) => void
	): void {
		const cell = grid.createDiv({ cls: 'tlb-slide-template__cell' });
		const head = cell.createDiv({ cls: 'tlb-slide-template__cell-head-row' });
		head.createDiv({ cls: 'tlb-slide-template__cell-head', text: label });
		const textarea = cell.createEl('textarea', {
			cls: 'tlb-slide-template__textarea tlb-slide-template__textarea--body',
			attr: { rows: '3' }
		}) as HTMLTextAreaElement;
		textarea.value = value;
		this.registerFocusTracking(textarea);
		textarea.addEventListener('input', () => onChange(textarea.value));
		this.renderInsertButton(head, () => textarea);
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
		const insetLabel = () => (value.align === 'right' ? 'Right Offset (%)' : 'Left Offset (%)');

		const alignRow = addSelectRow(row1, this.getText('slideView.templateModal.alignLabel', 'Horizontal align'), (next) => {
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
		numberRow(
			row2,
			'Top Offset (%)',
			value.topPct,
			0,
			100,
			1,
			(v) => (value.topPct = clampPct(v))
		);
		numberRow(row2, t('slideView.templateModal.widthPctLabel'), value.widthPct, 0, 100, 1, (v) => (value.widthPct = clampPct(v)));

		const row3 = layoutRow('three');
		numberRow(row3, t('slideView.templateModal.fontSizeLabel'), value.fontSize, 0.1, 10, 0.1, (v) => (value.fontSize = v));
		numberRow(
			row3,
			this.getText('slideView.templateModal.fontWeightLabel', 'Font weight (400=Normal, 700=Bold)'),
			value.fontWeight,
			100,
			900,
			50,
			(v) => (value.fontWeight = v)
		);
		numberRow(row3, t('slideView.templateModal.lineHeightLabel'), value.lineHeight, 0.5, 3, 0.1, (v) => (value.lineHeight = v));
	}

	private renderColorSection(container: HTMLElement): void {
		const section = container.createDiv({ cls: 'tlb-slide-template__section' });
		const headRow = section.createDiv({ cls: 'tlb-slide-template__cell-head-row' });
		headRow.createDiv({
			cls: 'tlb-slide-template__cell-head',
			text: this.getText('slideView.templateModal.globalSettingsLabel', 'Global settings')
		});
		const grid = section.createDiv({ cls: 'tlb-slide-template__grid tlb-slide-template__grid--colors' });
		const colorsRow = this.createRow(grid);
		this.renderColorControls(colorsRow.left, 'text');
		this.renderColorControls(colorsRow.right, 'background');
	}

	private renderColorControls(container: HTMLElement, kind: 'text' | 'background'): void {
		const colorGroup = container.createDiv({ cls: 'tlb-slide-template__color-group' });
		const colorRow = colorGroup.createDiv({ cls: 'tlb-slide-template__color-row' });
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
		const resetDot = resetBtn.createSpan({ cls: 'tlb-slide-template__color-reset-dot' });
		resetDot.style.backgroundColor = defaultColor;
		resetDot.style.borderColor = defaultColor;

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
		if (!active) {
			return;
		}
		const wrapper = this.contentEl.createDiv({ cls: 'tlb-slide-template__section' });
		wrapper.createDiv({
			cls: 'tlb-slide-template__hint',
			text: this.getText(
				'slideView.templateModal.modeSingleDesc',
				'Generates a single slide per row. Displays text and image side-by-side if an image exists.'
			)
		});
			this.renderBranchTabs(
				wrapper,
				this.singleBranch,
				{
					without: this.getText('slideView.templateModal.noImageTabLabel', 'Layout: No Image'),
					with: this.getText('slideView.templateModal.withImageTabLabel', 'Layout: With Image')
				},
				(next) => {
					this.setBranchSelection('single', next);
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
			this.renderImageContent(
				imageLayoutRow.left,
				this.getText('slideView.templateModal.imageLayoutLabel', 'Image content'),
				this.template.single.withImage.imageTemplate,
				(next) => (this.template.single.withImage.imageTemplate = next)
			);
			this.renderLayoutTwoColumn(
				imageLayoutRow.right,
				this.getText('slideView.templateModal.imageLayoutLabel', 'Image layout'),
				this.template.single.withImage.imageLayout ?? getDefaultBodyLayout(),
				(next) => (this.template.single.withImage.imageLayout = next)
			);
		}
	}

	private renderSplitSection(active: boolean): void {
		if (!active) {
			return;
		}
		const wrapper = this.contentEl.createDiv({ cls: 'tlb-slide-template__section' });
		wrapper.createDiv({
			cls: 'tlb-slide-template__hint',
			text: this.getText(
				'slideView.templateModal.modeSplitDesc',
				'Generates two sequential slides per row: 1. Text Slide → 2. Image Slide (if image exists).'
			)
		});
			this.renderBranchTabs(
				wrapper,
				this.splitBranch,
				{
					without: this.getText('slideView.templateModal.noImageTabLabel', 'Slide 1: Text'),
					with: this.getText('slideView.templateModal.withImageTabLabel', 'Slide 2: Image')
				},
				(next) => {
					this.setBranchSelection('split', next);
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
			const imageLayoutRow = this.createRow(grid);
			this.renderImageContent(
				imageLayoutRow.left,
				this.getText('slideView.templateModal.imageLayoutLabel', 'Image content'),
				this.template.split.withImage.imageTemplate,
				(next) => (this.template.split.withImage.imageTemplate = next)
			);
			this.renderLayoutTwoColumn(
				imageLayoutRow.right,
				this.getText('slideView.templateModal.imageLayoutLabel', 'Image layout'),
				this.template.split.withImage.imageLayout ?? getDefaultBodyLayout(),
				(next) => (this.template.split.withImage.imageLayout = next)
			);
		}
	}
}
