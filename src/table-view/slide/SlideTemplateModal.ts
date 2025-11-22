import type { App } from 'obsidian';
import { DropdownComponent, Modal, TextAreaComponent } from 'obsidian';
import { t } from '../../i18n';
import type { SlideTemplateConfig } from '../../types/slide';

interface SlideTemplateModalOptions {
	app: App;
	fields: string[];
	initial: SlideTemplateConfig;
	onSave: (next: SlideTemplateConfig) => void;
}

const RESERVED_FIELDS = new Set(['#', '__tlb_row_id', '__tlb_status', '__tlb_index', 'status', 'statusChanged']);

export class SlideTemplateModal extends Modal {
	private readonly fields: string[];
	private readonly onSave: (next: SlideTemplateConfig) => void;
	private titleTemplate: string;
	private bodyTemplate: string;
	private activeTarget: 'title' | 'body' = 'title';
	private titleInputEl: HTMLTextAreaElement | null = null;
	private bodyInputEl: HTMLTextAreaElement | null = null;
	private rootEl: HTMLElement | null = null;

	constructor(opts: SlideTemplateModalOptions) {
		super(opts.app);
		this.fields = opts.fields.filter((field) => field && !RESERVED_FIELDS.has(field));
		this.onSave = opts.onSave;
		this.titleTemplate = opts.initial.titleTemplate ?? '';
		this.bodyTemplate = opts.initial.bodyTemplate ?? '';
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.addClass('tlb-slide-template');
		this.titleEl.setText(t('slideView.templateModal.title'));
		this.rootEl = this.contentEl.createDiv({ cls: 'tlb-slide-template__stack' });
		this.renderInsertRow();
		this.renderTitleInput();
		this.renderBodyInput();
		this.renderActions();
	}

	onClose(): void {
		this.contentEl.empty();
		this.titleInputEl = null;
		this.bodyInputEl = null;
		this.rootEl = null;
	}

	private renderInsertRow(): void {
		const host = this.rootEl ?? this.contentEl;
		const block = host.createDiv({ cls: 'tlb-slide-template__header' });
		const left = block.createDiv({ cls: 'tlb-slide-template__header-text' });
		left.createDiv({ cls: 'tlb-slide-template__label', text: t('slideView.templateModal.insertField') });
		left.createDiv({ cls: 'tlb-slide-template__hint', text: t('slideView.templateModal.insertFieldDesc') });

		const dropdown = new DropdownComponent(block);
		dropdown.selectEl.addClass('tlb-slide-template__dropdown');
		dropdown.addOption('', t('slideView.templateModal.addFieldPlaceholder'));
		for (const field of this.fields) {
			dropdown.addOption(field, `{${field}}`);
		}
		dropdown.onChange((value) => {
			const trimmed = value.trim();
			if (!trimmed) return;
			const placeholder = `{${trimmed}}`;
			this.insertPlaceholder(placeholder);
			dropdown.setValue('');
		});
	}

	private renderTitleInput(): void {
		const host = this.rootEl ?? this.contentEl;
		const block = host.createDiv({ cls: 'tlb-slide-template__block' });
		block.createEl('div', { cls: 'tlb-slide-template__label', text: t('slideView.templateModal.titleFieldLabel') });
		block.createEl('div', { cls: 'tlb-slide-template__hint', text: t('slideView.templateModal.titleFieldDesc') });
		const input = new TextAreaComponent(block);
		input.setValue(this.titleTemplate);
		input.inputEl.addClass('tlb-slide-template__textarea tlb-slide-template__textarea--title');
		input.inputEl.setAttr('rows', '2');
		input.inputEl.addEventListener('focus', () => {
			this.activeTarget = 'title';
		});
		input.onChange((value) => {
			this.titleTemplate = value;
		});
		this.titleInputEl = input.inputEl;
	}

	private renderBodyInput(): void {
		const host = this.rootEl ?? this.contentEl;
		const block = host.createDiv({ cls: 'tlb-slide-template__block' });
		block.createEl('div', { cls: 'tlb-slide-template__label', text: t('slideView.templateModal.bodyFieldsLabel') });
		block.createEl('div', { cls: 'tlb-slide-template__hint', text: t('slideView.templateModal.bodyFieldsDesc') });
		const textarea = new TextAreaComponent(block);
		textarea.setValue(this.bodyTemplate);
		textarea.inputEl.addClass('tlb-slide-template__textarea tlb-slide-template__textarea--body');
		textarea.inputEl.setAttr('rows', '4');
		textarea.inputEl.addEventListener('focus', () => {
			this.activeTarget = 'body';
		});
		textarea.onChange((value) => {
			this.bodyTemplate = value;
		});
		this.bodyInputEl = textarea.inputEl;
	}

	private renderActions(): void {
		const host = this.rootEl ?? this.contentEl;
		const footer = host.createDiv({ cls: 'tlb-slide-template__footer' });
		const saveButton = footer.createEl('button', {
			cls: 'mod-cta tlb-slide-template__primary',
			text: t('slideView.templateModal.saveLabel')
		});
		saveButton.addEventListener('click', () => {
			this.onSave({
				titleTemplate: this.titleTemplate,
				bodyTemplate: this.bodyTemplate
			});
			this.close();
		});

		const cancelButton = footer.createEl('button', {
			text: t('slideView.templateModal.cancelLabel')
		});
		cancelButton.addEventListener('click', () => this.close());
	}

	private insertPlaceholder(placeholder: string): void {
		const target =
			this.activeTarget === 'title'
				? this.titleInputEl
				: this.bodyInputEl ?? this.titleInputEl;
		if (!target) {
			return;
		}
		const currentValue = target.value;
		const selectionStart = target.selectionStart ?? currentValue.length;
		const selectionEnd = target.selectionEnd ?? currentValue.length;
		const next =
			currentValue.slice(0, selectionStart) +
			placeholder +
			currentValue.slice(selectionEnd);
		target.value = next;
		if (target === this.titleInputEl) {
			this.titleTemplate = next;
		} else {
			this.bodyTemplate = next;
		}
		target.focus();
		target.setSelectionRange(selectionStart + placeholder.length, selectionStart + placeholder.length);
	}
}
