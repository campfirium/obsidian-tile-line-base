import { App, Modal, Setting } from 'obsidian';
import { t } from '../../i18n';

export interface FilterViewNameModalOptions {
	title: string;
	placeholder: string;
	defaultValue: string;
	onSubmit: (value: string) => void;
	onCancel: () => void;
}

export class FilterViewNameModal extends Modal {
	private readonly options: FilterViewNameModalOptions;
	private inputEl!: HTMLInputElement;

	constructor(app: App, options: FilterViewNameModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(this.options.title);

		const setting = new Setting(contentEl);
		setting.setClass('tlb-filter-view-modal');
		setting.addText((text) => {
			text.setPlaceholder(this.options.placeholder);
			text.setValue(this.options.defaultValue);
			text.inputEl.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					event.stopPropagation();
					this.submit();
				}
			});
			this.inputEl = text.inputEl;
		});

		setting.addButton((button) => {
			button.setButtonText(t('filterViewModals.saveButton'));
			button.setCta();
			button.onClick(() => this.submit());
		});

		const cancelBtn = contentEl.createEl('button', { text: t('filterViewModals.cancelButton') });
		cancelBtn.addClass('mod-cta-secondary');
		cancelBtn.addEventListener('click', () => this.close());
	}

	onClose(): void {
		if (this.inputEl) {
			this.inputEl.blur();
		}
		this.options.onCancel();
	}

	private submit(): void {
		const value = this.inputEl?.value ?? '';
		this.options.onSubmit(value);
		this.options.onCancel = () => undefined;
		this.close();
	}
}

export function openFilterViewNameModal(app: App, options: { title: string; placeholder: string; defaultValue?: string }): Promise<string | null> {
	return new Promise((resolve) => {
		const modal = new FilterViewNameModal(app, {
			title: options.title,
			placeholder: options.placeholder,
			defaultValue: options.defaultValue ?? '',
			onSubmit: (value) => {
				const trimmed = value.trim();
				resolve(trimmed.length > 0 ? trimmed : null);
			},
			onCancel: () => resolve(null)
		});
		modal.open();
	});
}
