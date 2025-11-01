import { App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';

interface TableCreationModalOptions {
	initialName: string;
	initialRows: number;
	initialColumns: number;
	minRows: number;
	maxRows: number;
	minColumns: number;
	maxColumns: number;
	triggerElement: HTMLElement | null;
	onSubmit: (payload: { name: string; rows: number; columns: number }) => void;
	onCancel: () => void;
}

export class TableCreationModal extends Modal {
	private readonly options: TableCreationModalOptions;
	private nameValue: string;
	private rowValue: number;
	private columnValue: number;
	private submitted = false;
	private returnFocusTarget: HTMLElement | null = null;
	private errorEl: HTMLElement | null = null;
	private keydownHandler: ((event: KeyboardEvent) => void) | null = null;

	constructor(app: App, options: TableCreationModalOptions) {
		super(app);
		this.options = options;
		this.nameValue = options.initialName;
		this.rowValue = options.initialRows;
		this.columnValue = options.initialColumns;
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		contentEl.addClass('tlb-table-creation-modal');
		this.titleEl.setText(t('tableCreation.modalTitle'));

		this.prepareReturnFocusTarget();

		const nameSetting = new Setting(contentEl);
		nameSetting.setName(t('tableCreation.nameLabel'));
		nameSetting.setDesc(t('tableCreation.nameDesc'));
		let nameInput: HTMLInputElement | null = null;
		nameSetting.addText((text) => {
			text.setPlaceholder(t('tableCreation.namePlaceholder'));
			text.setValue(this.nameValue);
			text.inputEl.setAttribute('aria-label', t('tableCreation.nameLabel'));
			nameInput = text.inputEl;
			text.onChange((value) => {
				this.nameValue = value;
			});
		});

		const rowsSetting = new Setting(contentEl);
		rowsSetting.setName(t('tableCreation.rowsLabel'));
		rowsSetting.setDesc(t('tableCreation.rowsDesc', {
			min: String(this.options.minRows),
			max: String(this.options.maxRows)
		}));
		let rowsInput: HTMLInputElement | null = null;
		rowsSetting.addText((text) => {
			text.setValue(String(this.rowValue));
			text.inputEl.type = 'number';
			text.inputEl.min = String(this.options.minRows);
			text.inputEl.max = String(this.options.maxRows);
			text.inputEl.setAttribute('aria-label', t('tableCreation.rowsLabel'));
			rowsInput = text.inputEl;
			text.onChange((value) => {
				this.rowValue = this.normalizeNumericInput(value, this.options.minRows, this.options.maxRows, this.rowValue);
			});
		});

		const columnsSetting = new Setting(contentEl);
		columnsSetting.setName(t('tableCreation.columnsLabel'));
		columnsSetting.setDesc(t('tableCreation.columnsDesc', {
			min: String(this.options.minColumns),
			max: String(this.options.maxColumns)
		}));
		let columnsInput: HTMLInputElement | null = null;
		columnsSetting.addText((text) => {
			text.setValue(String(this.columnValue));
			text.inputEl.type = 'number';
			text.inputEl.min = String(this.options.minColumns);
			text.inputEl.max = String(this.options.maxColumns);
			text.inputEl.setAttribute('aria-label', t('tableCreation.columnsLabel'));
			columnsInput = text.inputEl;
			text.onChange((value) => {
				this.columnValue = this.normalizeNumericInput(value, this.options.minColumns, this.options.maxColumns, this.columnValue);
			});
		});

		this.errorEl = contentEl.createDiv({ cls: 'tlb-table-creation-error' });

		const actionSetting = new Setting(contentEl);
		actionSetting.addButton((button) => {
			button
				.setButtonText(t('tableCreation.createButton'))
				.setCta()
				.onClick(() => {
					this.handleSubmit();
				});
			button.buttonEl.setAttribute('aria-label', t('tableCreation.createButton'));
		});
		actionSetting.addButton((button) => {
			button
				.setButtonText(t('tableCreation.cancelButton'))
				.onClick(() => {
					this.close();
				});
			button.buttonEl.setAttribute('aria-label', t('tableCreation.cancelButton'));
		});

		if (modalEl && !this.keydownHandler) {
			this.keydownHandler = this.handleKeydown;
			modalEl.addEventListener('keydown', this.keydownHandler, true);
		}

		const focusTarget = (nameInput ?? rowsInput ?? columnsInput) as HTMLInputElement | null;
		if (focusTarget) {
			const doc = contentEl.ownerDocument ?? document;
			const raf = doc.defaultView?.requestAnimationFrame ?? window.requestAnimationFrame;
			const applyFocus = () => focusTarget.focus({ preventScroll: true });
			if (typeof raf === 'function') {
				raf(() => applyFocus());
			} else {
				window.setTimeout(() => applyFocus(), 0);
			}
		}
	}

	onClose(): void {
		if (this.modalEl && this.keydownHandler) {
			this.modalEl.removeEventListener('keydown', this.keydownHandler, true);
			this.keydownHandler = null;
		}

		if (!this.submitted) {
			this.options.onCancel();
		}
		if (this.returnFocusTarget && this.returnFocusTarget.isConnected) {
			this.returnFocusTarget.focus({ preventScroll: true });
		} else if (this.options.triggerElement && this.options.triggerElement.isConnected) {
			this.options.triggerElement.focus({ preventScroll: true });
		}
		this.returnFocusTarget = null;
		this.errorEl = null;
	}

	private handleSubmit(): void {
		const validation = this.validate();
		if (!validation.valid) {
			this.showError(validation.message);
			return;
		}

		this.showError('');
		this.submitted = true;
		this.options.onSubmit({
			name: validation.name,
			rows: validation.rows,
			columns: validation.columns
		});
		this.close();
	}

	private validate(): { valid: true; name: string; rows: number; columns: number } | { valid: false; message: string } {
		const rawName = (this.nameValue ?? '').trim();
		const name = rawName.length > 0 ? rawName : this.options.initialName;
		if (!name || name.trim().length === 0) {
			return { valid: false, message: t('tableCreation.nameRequired') };
		}

		const rows = this.clampValue(this.rowValue, this.options.minRows, this.options.maxRows);
		if (!Number.isFinite(rows) || rows < this.options.minRows || rows > this.options.maxRows) {
			return {
				valid: false,
				message: t('tableCreation.rowsOutOfRange', {
					min: String(this.options.minRows),
					max: String(this.options.maxRows)
				})
			};
		}

		const columns = this.clampValue(this.columnValue, this.options.minColumns, this.options.maxColumns);
		if (!Number.isFinite(columns) || columns < this.options.minColumns || columns > this.options.maxColumns) {
			return {
				valid: false,
				message: t('tableCreation.columnsOutOfRange', {
					min: String(this.options.minColumns),
					max: String(this.options.maxColumns)
				})
			};
		}

		return {
			valid: true,
			name,
			rows,
			columns
		};
	}

	private showError(message: string): void {
		if (!this.errorEl) {
			return;
		}
		this.errorEl.textContent = message;
		this.errorEl.classList.toggle('tlb-table-creation-error--visible', message.trim().length > 0);
	}

	private normalizeNumericInput(raw: string, min: number, max: number, fallback: number): number {
		const trimmed = raw.trim();
		if (trimmed.length === 0) {
			return fallback;
		}
		const parsed = Number(trimmed);
		if (!Number.isFinite(parsed)) {
			return fallback;
		}
		return this.clampValue(Math.round(parsed), min, max);
	}

	private clampValue(value: number, min: number, max: number): number {
		if (!Number.isFinite(value)) {
			return min;
		}
		if (value < min) {
			return min;
		}
		if (value > max) {
			return max;
		}
		return value;
	}

	private prepareReturnFocusTarget(): void {
		const ownerDoc = this.contentEl.ownerDocument ?? document;
		const trigger = this.options.triggerElement;
		if (trigger && trigger instanceof HTMLElement) {
			this.returnFocusTarget = trigger;
		} else if (ownerDoc.activeElement instanceof HTMLElement) {
			this.returnFocusTarget = ownerDoc.activeElement;
		}
	}

	private handleKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			event.stopPropagation();
			this.handleSubmit();
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			this.close();
		}
	};
}




