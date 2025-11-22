import type { App } from 'obsidian';
import { DropdownComponent, Modal, Setting, TextAreaComponent } from 'obsidian';
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

	constructor(opts: SlideTemplateModalOptions) {
		super(opts.app);
		this.fields = opts.fields.filter((field) => field && !RESERVED_FIELDS.has(field));
		this.onSave = opts.onSave;
		this.titleTemplate = opts.initial.titleTemplate ?? '';
		this.bodyTemplate = opts.initial.bodyTemplate ?? '';
	}

	onOpen(): void {
		this.titleEl.setText(t('slideView.templateModal.title'));
		this.renderInsertRow();
		this.renderTitleInput();
		this.renderBodyInput();
		this.renderActions();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderInsertRow(): void {
		const setting = new Setting(this.contentEl)
			.setName(t('slideView.templateModal.insertField'))
			.setDesc(t('slideView.templateModal.insertFieldDesc'));

		const dropdown = new DropdownComponent(setting.controlEl);
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
		const setting = new Setting(this.contentEl)
			.setName(t('slideView.templateModal.titleFieldLabel'))
			.setDesc(t('slideView.templateModal.titleFieldDesc'));
		const input = new TextAreaComponent(setting.controlEl);
		input.setValue(this.titleTemplate);
		input.inputEl.addClass('tlb-slide-template__textarea tlb-slide-template__textarea--title');
		input.onChange((value) => {
			this.titleTemplate = value;
		});
	}

	private renderBodyInput(): void {
		const setting = new Setting(this.contentEl)
			.setName(t('slideView.templateModal.bodyFieldsLabel'))
			.setDesc(t('slideView.templateModal.bodyFieldsDesc'));
		const textarea = new TextAreaComponent(setting.controlEl);
		textarea.setValue(this.bodyTemplate);
		textarea.inputEl.addClass('tlb-slide-template__textarea tlb-slide-template__textarea--body');
		textarea.onChange((value) => {
			this.bodyTemplate = value;
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
		// Insert into body by default; user can copy to title manually
		this.bodyTemplate = (this.bodyTemplate + (this.bodyTemplate ? ' ' : '') + placeholder).trim();
		this.contentEl.querySelectorAll('.tlb-slide-template__textarea').forEach((el) => {
			(el as HTMLTextAreaElement).value = this.bodyTemplate;
		});
	}
}
