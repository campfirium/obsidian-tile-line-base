import { App, Modal, Setting } from 'obsidian';
import { compileFormula } from '../formula/FormulaEngine';
import { t } from '../i18n';

export type ColumnFieldType = 'text' | 'formula';

export interface ColumnEditorResult {
	name: string;
	type: ColumnFieldType;
	formula: string;
}

export interface ColumnEditorModalOptions {
	columnName: string;
	initialType: ColumnFieldType;
	initialFormula: string;
	validateName?: (name: string) => string | null;
	triggerElement?: HTMLElement | null;
	onSubmit: (result: ColumnEditorResult) => void;
	onCancel: () => void;
}

export class ColumnEditorModal extends Modal {
	private readonly options: ColumnEditorModalOptions;
	private type: ColumnFieldType;
	private nameValue: string;
	private formulaSetting!: Setting;
	private formulaInput!: HTMLTextAreaElement;
	private nameInput!: HTMLInputElement;
	private errorEl!: HTMLElement;
	private submitted = false;
	private returnFocusTarget: HTMLElement | null = null;
	private keydownHandler?: (event: KeyboardEvent) => void;

	constructor(app: App, options: ColumnEditorModalOptions) {
		super(app);
		this.options = options;
		this.type = options.initialType;
		this.nameValue = options.columnName;
	}

	onOpen(): void {
		const { contentEl } = this;
		const ownerDoc = contentEl.ownerDocument;

		const providedTrigger = this.options.triggerElement;
		if (providedTrigger && providedTrigger instanceof HTMLElement) {
			this.returnFocusTarget = providedTrigger;
		} else if (ownerDoc?.activeElement instanceof HTMLElement) {
			this.returnFocusTarget = ownerDoc.activeElement;
		} else {
			this.returnFocusTarget = null;
		}

		contentEl.empty();
		contentEl.addClass('tlb-column-editor-modal');
		this.titleEl.setText(t('columnEditorModal.title', { columnName: this.options.columnName }));

		const nameSetting = new Setting(contentEl);
		nameSetting.setName(t('columnEditorModal.nameLabel'));
		nameSetting.addText((text) => {
			text.setPlaceholder(t('columnEditorModal.namePlaceholder'));
			text.setValue(this.nameValue);
			this.nameInput = text.inputEl;
			text.onChange((value) => {
				this.nameValue = value;
			});
		});

		const typeSetting = new Setting(contentEl);
		typeSetting.setName(t('columnEditorModal.typeLabel'));
		typeSetting.addDropdown((dropdown) => {
			dropdown.addOption('text', t('columnEditorModal.typeTextOption'));
			dropdown.addOption('formula', t('columnEditorModal.typeFormulaOption'));
			dropdown.setValue(this.type);
			dropdown.onChange((value) => {
				this.type = value === 'formula' ? 'formula' : 'text';
				this.updateFormulaVisibility();
			});
		});

		this.formulaSetting = new Setting(contentEl);
		this.formulaSetting.setName(t('columnEditorModal.formulaLabel'));
		this.formulaSetting.setDesc(t('columnEditorModal.formulaDescription'));
		this.formulaSetting.controlEl.empty();

		const textarea = document.createElement('textarea');
		textarea.className = 'tlb-column-formula-input';
		textarea.rows = 4;
		textarea.placeholder = t('columnEditorModal.formulaPlaceholder');
		textarea.value = this.options.initialFormula;
		this.formulaSetting.controlEl.appendChild(textarea);
		this.formulaInput = textarea;

		this.errorEl = contentEl.createDiv({ cls: 'tlb-column-editor-error' });
		this.errorEl.style.display = 'none';
		this.errorEl.style.color = 'var(--text-error, #ff4d4f)';

		const modalEl = this.modalEl;
		if (modalEl) {
			if (this.keydownHandler) {
				modalEl.removeEventListener('keydown', this.keydownHandler, true);
			}
			this.keydownHandler = (event: KeyboardEvent) => {
				if (event.key === 'Escape' || event.key === 'Esc') {
					event.preventDefault();
					event.stopPropagation();
					this.close();
				}
			};
			modalEl.addEventListener('keydown', this.keydownHandler, true);
		}

		const actionSetting = new Setting(contentEl);
		actionSetting.addButton((button) => {
			button.setButtonText(t('columnEditorModal.saveButton'))
				.setCta()
				.onClick(() => {
					this.submit();
				});
		});
		actionSetting.addButton((button) => {
			button.setButtonText(t('columnEditorModal.cancelButton')).onClick(() => {
				this.close();
			});
		});

		this.updateFormulaVisibility();

		const focusNameInput = () => {
			this.nameInput?.focus({ preventScroll: true });
		};
		const requestFrame = ownerDoc?.defaultView?.requestAnimationFrame ?? window.requestAnimationFrame;
		if (typeof requestFrame === 'function') {
			requestFrame(() => focusNameInput());
		} else {
			window.setTimeout(focusNameInput, 0);
		}
	}

	onClose(): void {
		if (this.modalEl && this.keydownHandler) {
			this.modalEl.removeEventListener('keydown', this.keydownHandler, true);
			this.keydownHandler = undefined;
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
	}

	private updateFormulaVisibility(): void {
		const hidden = this.type !== 'formula';
		if (this.formulaSetting) {
			const el = this.formulaSetting.settingEl as HTMLElement;
			el.style.display = hidden ? 'none' : '';
		}
		if (this.formulaInput) {
			this.formulaInput.disabled = hidden;
		}
	}

	private setError(message: string | null): void {
		if (!this.errorEl) {
			return;
		}
		if (message && message.trim().length > 0) {
			this.errorEl.style.display = '';
			this.errorEl.setText(message);
		} else {
			this.errorEl.style.display = 'none';
			this.errorEl.empty();
		}
	}

	private submit(): void {
		this.setError(null);
		const trimmedName = this.nameValue.trim();
		if (trimmedName.length === 0) {
			this.setError(t('columnEditorModal.nameEmptyError'));
			this.nameInput?.focus();
			return;
		}
		if (this.options.validateName) {
			const validationMessage = this.options.validateName(trimmedName);
			if (validationMessage) {
				this.setError(validationMessage);
				this.nameInput?.focus();
				return;
			}
		}
		if (this.type === 'formula') {
			const formula = this.formulaInput.value.trim();
			if (formula.length === 0) {
				this.setError(t('columnEditorModal.formulaEmptyError'));
				this.formulaInput.focus();
				return;
			}
			try {
				compileFormula(formula);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.setError(t('columnEditorModal.formulaValidationFailed', { message }));
				this.formulaInput.focus();
				return;
			}
			this.options.onSubmit({ name: trimmedName, type: 'formula', formula });
			this.submitted = true;
			this.close();
			return;
		}

		this.options.onSubmit({ name: trimmedName, type: 'text', formula: '' });
		this.submitted = true;
		this.close();
	}
}
