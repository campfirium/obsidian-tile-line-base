import { App, Modal, Setting } from 'obsidian';
import { normalizeDateInput, normalizeTimeInput } from '../utils/datetime';
import { t } from '../i18n';

export type BulkFillColumnType = 'text' | 'date' | 'time';

interface GridBulkFillModalOptions {
	columnName: string;
	columnType: BulkFillColumnType;
	dateFormat?: string | null;
	timeFormat?: string | null;
	initialValue: string;
	onSubmit: (value: string) => void;
}

export class GridBulkFillModal extends Modal {
	private readonly options: GridBulkFillModalOptions;
	private currentValue: string;
	private errorEl: HTMLElement | null = null;
	private inputEl: HTMLInputElement | null = null;

	constructor(app: App, options: GridBulkFillModalOptions) {
		super(app);
		this.options = options;
		this.currentValue = options.initialValue ?? '';
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tlb-bulk-fill-modal');

		contentEl.createEl('h2', { text: t('gridFillModal.title', { column: this.options.columnName }) });

		const valueSetting = new Setting(contentEl).setName(t('gridFillModal.valueLabel'));
		this.inputEl = valueSetting.controlEl.createEl('input', { type: 'text' });
		const placeholder = this.options.columnType === 'date'
			? t('gridFillModal.datePlaceholder')
			: this.options.columnType === 'time'
				? t('gridFillModal.timePlaceholder')
				: t('gridFillModal.textPlaceholder');
		this.inputEl.placeholder = placeholder;
		this.inputEl.value = this.currentValue;
		this.inputEl.addEventListener('input', () => {
			this.currentValue = this.inputEl?.value ?? '';
			this.clearError();
		});
		this.inputEl.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && !event.isComposing) {
				event.preventDefault();
				this.handleSubmit();
			}
		});

		if (this.options.columnType === 'date' && this.options.dateFormat) {
			valueSetting.descEl.setText(
				t('gridFillModal.dateHint', {
					format: this.options.dateFormat
				})
			);
		} else if (this.options.columnType === 'time' && this.options.timeFormat) {
			valueSetting.descEl.setText(
				t('gridFillModal.timeHint', {
					format: this.options.timeFormat
				})
			);
		}

		this.errorEl = contentEl.createEl('div', { cls: 'tlb-bulk-fill-modal-error' });

		const buttonSetting = new Setting(contentEl);
		buttonSetting.addButton((button) =>
			button
				.setButtonText(t('gridFillModal.confirmButton'))
				.setCta()
				.onClick(() => {
					this.handleSubmit();
				})
		);
		buttonSetting.addButton((button) =>
			button.setButtonText(t('gridFillModal.cancelButton')).onClick(() => {
				this.close();
			})
		);

		window.setTimeout(() => {
			this.inputEl?.focus();
			if (this.inputEl && this.inputEl.value.length > 0) {
				this.inputEl.select();
			}
		}, 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private handleSubmit(): void {
		const raw = this.currentValue ?? '';
		if (this.options.columnType === 'date') {
			const trimmed = raw.trim();
			if (trimmed.length === 0) {
				this.submitAndClose('');
				return;
			}
			const normalized = normalizeDateInput(trimmed);
			if (!this.isIsoDate(normalized)) {
				this.showError(t('gridFillModal.invalidDate'));
				return;
			}
			this.submitAndClose(normalized);
			return;
		}
		if (this.options.columnType === 'time') {
			const trimmed = raw.trim();
			if (trimmed.length === 0) {
				this.submitAndClose('');
				return;
			}
			const normalized = normalizeTimeInput(trimmed);
			if (!this.isIsoTime(normalized)) {
				this.showError(t('gridFillModal.invalidTime'));
				return;
			}
			this.submitAndClose(normalized);
			return;
		}
		this.submitAndClose(raw);
	}

	private submitAndClose(value: string): void {
		this.options.onSubmit(value);
		this.close();
	}

	private showError(message: string): void {
		if (this.errorEl) {
			this.errorEl.setText(message);
		}
		this.inputEl?.focus();
	}

	private clearError(): void {
		if (this.errorEl) {
			this.errorEl.setText('');
		}
	}

	private isIsoDate(value: string): boolean {
		return /^\d{4}-\d{2}-\d{2}$/.test(value);
	}

	private isIsoTime(value: string): boolean {
		return /^\d{2}:\d{2}:\d{2}$/.test(value);
	}
}
