import { App, Modal, Setting, Notice } from 'obsidian';
import { t } from '../../../i18n';

export type TagGroupCreateMode = 'manual' | 'field';

export interface TagGroupCreateResult {
	mode: TagGroupCreateMode;
	field?: string;
}

interface TagGroupCreateModalOptions {
	app: App;
	columns: string[];
	maxAutoGroups: number;
	onSubmit: (result: TagGroupCreateResult) => void;
	onCancel: () => void;
}

export class TagGroupCreateModal extends Modal {
	private readonly options: TagGroupCreateModalOptions;
	private mode: TagGroupCreateMode = 'manual';
	private fieldSelect: HTMLSelectElement | null = null;

	constructor(options: TagGroupCreateModalOptions) {
		super(options.app);
		this.options = options;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tlb-tag-group-create-modal');
		this.titleEl.setText(t('tagGroups.createModalTitle'));

		const modeSetting = new Setting(contentEl);
		modeSetting.setName(t('tagGroups.createModeLabel'));
		modeSetting.addDropdown((dropdown) => {
			dropdown.addOption('manual', t('tagGroups.createModeManual'));
			dropdown.addOption('field', t('tagGroups.createModeField'));
			dropdown.setValue(this.mode);
			dropdown.onChange((value) => {
				this.mode = (value as TagGroupCreateMode) ?? 'manual';
				this.renderFieldSelection(contentEl);
			});
		});

		this.renderFieldSelection(contentEl);

		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
		const confirmButton = buttonContainer.createEl('button', { text: t('tagGroups.confirmButton') });
		confirmButton.addClass('mod-cta');
		confirmButton.addEventListener('click', () => this.submit());

		const cancelButton = buttonContainer.createEl('button', { text: t('tagGroups.cancelButton') });
		cancelButton.addEventListener('click', () => this.close());
	}

	private renderFieldSelection(container: HTMLElement): void {
		container.querySelectorAll('.tlb-tag-group-create-field').forEach((el) => el.remove());

		if (this.mode !== 'field') {
			this.fieldSelect = null;
			return;
		}

		const wrapper = container.createDiv({ cls: 'tlb-tag-group-create-field' });
		const fieldSetting = new Setting(wrapper);
		fieldSetting.setName(t('tagGroups.createFieldLabel'));
		fieldSetting.addDropdown((dropdown) => {
			for (const column of this.options.columns) {
				dropdown.addOption(column, column);
			}
			dropdown.onChange((_value) => {
				this.fieldSelect = dropdown.selectEl;
			});
			this.fieldSelect = dropdown.selectEl;
			const defaultField = this.options.columns[0] ?? '';
			if (defaultField) {
				dropdown.setValue(defaultField);
			}
		});

		const hintEl = wrapper.createDiv({ cls: 'setting-item-description' });
		hintEl.setText(t('tagGroups.createFieldLimitNotice', { limit: String(this.options.maxAutoGroups) }));
	}

	private submit(): void {
		if (this.mode === 'field') {
			const field = this.fieldSelect?.value?.trim() ?? '';
			if (!field) {
				new Notice(t('tagGroups.createFieldValidation'));
				return;
			}
			this.options.onSubmit({ mode: 'field', field });
		} else {
			this.options.onSubmit({ mode: 'manual' });
		}
		this.close();
	}

	onClose(): void {
		this.options.onCancel();
		this.contentEl.empty();
	}
}

export function openTagGroupCreateModal(app: App, options: { columns: string[]; maxAutoGroups: number }): Promise<TagGroupCreateResult | null> {
	return new Promise((resolve) => {
		const modal = new TagGroupCreateModal({
			app,
			columns: options.columns,
			maxAutoGroups: options.maxAutoGroups,
			onSubmit: (result) => resolve(result),
			onCancel: () => resolve(null)
		});
		modal.open();
	});
}
