import type { App } from 'obsidian';
import { ButtonComponent, DropdownComponent, Modal, Setting } from 'obsidian';
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
	private titleField: string | null;
	private bodyFields: string[];

	constructor(opts: SlideTemplateModalOptions) {
		super(opts.app);
		this.fields = opts.fields.filter((field) => field && !RESERVED_FIELDS.has(field));
		this.onSave = opts.onSave;
		this.titleField = opts.initial.titleField;
		this.bodyFields = opts.initial.bodyFields.slice();
	}

	onOpen(): void {
		this.titleEl.setText(t('slideView.templateModal.title'));
		this.renderTitleSelector();
		this.renderBodyEditor();
		this.renderActions();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderTitleSelector(): void {
		const setting = new Setting(this.contentEl)
			.setName(t('slideView.templateModal.titleFieldLabel'))
			.setDesc(t('slideView.templateModal.titleFieldDesc'));

		new DropdownComponent(setting.controlEl)
			.addOption('', t('slideView.templateModal.autoOption'))
			.onChange((value) => {
				const trimmed = value.trim();
				this.titleField = trimmed.length > 0 ? trimmed : null;
			})
			.selectEl.addClass('tlb-slide-template__dropdown');

		const dropdown = setting.controlEl.querySelector('select') as HTMLSelectElement | null;
		if (dropdown) {
			for (const field of this.fields) {
				const option = dropdown.createEl('option', { value: field, text: field });
				if (this.titleField === field) {
					option.selected = true;
				}
			}
			if (!this.titleField) {
				dropdown.value = '';
			}
		}
	}

	private renderBodyEditor(): void {
		const container = this.contentEl.createDiv({ cls: 'tlb-slide-template__list' });
		const header = container.createDiv({ cls: 'tlb-slide-template__list-header' });
		header.createEl('h4', { text: t('slideView.templateModal.bodyFieldsLabel') });
		header.createSpan({ cls: 'tlb-slide-template__hint', text: t('slideView.templateModal.bodyFieldsDesc') });

		const listEl = container.createDiv({ cls: 'tlb-slide-template__items' });
		const renderList = () => {
			listEl.empty();
			if (this.bodyFields.length === 0) {
				listEl.createDiv({
					cls: 'tlb-slide-template__empty',
					text: t('slideView.templateModal.emptyBodyFields')
				});
			}
			this.bodyFields.forEach((field, index) => {
				const row = listEl.createDiv({ cls: 'tlb-slide-template__item' });
				row.createSpan({ cls: 'tlb-slide-template__item-label', text: field });
				const controls = row.createDiv({ cls: 'tlb-slide-template__item-actions' });
				const up = new ButtonComponent(controls)
					.setIcon('chevron-up')
					.setTooltip(t('slideView.templateModal.moveUp'))
					.onClick(() => {
						if (index === 0) return;
						const [item] = this.bodyFields.splice(index, 1);
						this.bodyFields.splice(index - 1, 0, item);
						renderList();
					});
				up.buttonEl.toggleClass('tlb-slide-template__icon-button', true);
				up.setDisabled(index === 0);

				const down = new ButtonComponent(controls)
					.setIcon('chevron-down')
					.setTooltip(t('slideView.templateModal.moveDown'))
					.onClick(() => {
						if (index >= this.bodyFields.length - 1) return;
						const [item] = this.bodyFields.splice(index, 1);
						this.bodyFields.splice(index + 1, 0, item);
						renderList();
					});
				down.buttonEl.toggleClass('tlb-slide-template__icon-button', true);
				down.setDisabled(index >= this.bodyFields.length - 1);

				const remove = new ButtonComponent(controls)
					.setIcon('x')
					.setTooltip(t('slideView.templateModal.removeField'))
					.onClick(() => {
						this.bodyFields.splice(index, 1);
						renderList();
					});
				remove.buttonEl.toggleClass('tlb-slide-template__icon-button', true);
			});
		};

		const addRow = new Setting(container)
			.setName(t('slideView.templateModal.addFieldLabel'))
			.setDesc(t('slideView.templateModal.addFieldDesc'));

		const addDropdown = new DropdownComponent(addRow.controlEl);
		addDropdown.selectEl.addClass('tlb-slide-template__dropdown');
		addDropdown.addOption('', t('slideView.templateModal.addFieldPlaceholder'));
		for (const field of this.fields) {
			if (field === this.titleField) continue;
			if (this.bodyFields.includes(field)) continue;
			addDropdown.addOption(field, field);
		}
		addDropdown.onChange((value) => {
			const trimmed = value.trim();
			if (!trimmed) {
				return;
			}
			if (this.bodyFields.includes(trimmed)) {
				return;
			}
			this.bodyFields.push(trimmed);
			renderList();
			addDropdown.setValue('');
		});

		renderList();
	}

	private renderActions(): void {
		const footer = this.contentEl.createDiv({ cls: 'tlb-slide-template__footer' });
		const saveButton = footer.createEl('button', {
			cls: 'mod-cta tlb-slide-template__primary',
			text: t('slideView.templateModal.saveLabel')
		});
		saveButton.addEventListener('click', () => {
			this.onSave({
				titleField: this.titleField,
				bodyFields: [...this.bodyFields],
				tagFields: [],
				includeEmptyFields: false,
				showIndex: false,
				fieldClassNames: {}
			});
			this.close();
		});

		const cancelButton = footer.createEl('button', {
			text: t('slideView.templateModal.cancelLabel')
		});
		cancelButton.addEventListener('click', () => this.close());
	}
}
