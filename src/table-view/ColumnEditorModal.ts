import { App, Modal, Setting } from 'obsidian';
import { compileFormula } from '../formula/FormulaEngine';
import { t } from '../i18n';
import { normalizeDateFormatPreset, type DateFormatPreset } from '../utils/datetime';
import { FormulaFieldSuggester } from './FormulaFieldSuggester';
import {
	getFormulaFormatPresetOptions,
	normalizeFormulaFormatPreset,
	type FormulaFormatPreset
} from './formulaFormatPresets';

export type ColumnFieldType = 'text' | 'date' | 'formula';

export interface ColumnEditorResult {
	name: string;
	type: ColumnFieldType;
	formula: string;
	dateFormat?: DateFormatPreset;
	formulaFormatPreset?: FormulaFormatPreset;
}

export interface ColumnEditorModalOptions {
	columnName: string;
	initialType: ColumnFieldType;
	initialFormula: string;
	initialDateFormat?: DateFormatPreset;
	initialFormulaFormat?: FormulaFormatPreset;
	validateName?: (name: string) => string | null;
	triggerElement?: HTMLElement | null;
	availableFields?: string[];
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
	private formulaSuggester?: FormulaFieldSuggester;
	private formulaFormatSetting!: Setting;
	private formulaFormatPreset: FormulaFormatPreset;
	private dateFormat: DateFormatPreset;
	private dateFormatSetting!: Setting;

	constructor(app: App, options: ColumnEditorModalOptions) {
		super(app);
		this.options = options;
		this.type = options.initialType;
		this.nameValue = options.columnName;
		this.dateFormat = normalizeDateFormatPreset(options.initialDateFormat ?? 'iso');
		this.formulaFormatPreset = normalizeFormulaFormatPreset(options.initialFormulaFormat) ?? 'auto';
	}

	onOpen(): void {
		const { contentEl } = this;
		const ownerDoc = contentEl.ownerDocument ?? document;

		const providedTrigger = this.options.triggerElement;
		if (providedTrigger && providedTrigger instanceof HTMLElement) {
			this.returnFocusTarget = providedTrigger;
		} else if (ownerDoc.activeElement instanceof HTMLElement) {
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
			dropdown.addOption('date', t('columnEditorModal.typeDateOption'));
			dropdown.addOption('formula', t('columnEditorModal.typeFormulaOption'));
			dropdown.setValue(this.type);
			dropdown.onChange((value) => {
				if (value === 'formula') {
					this.type = 'formula';
				} else if (value === 'date') {
					this.type = 'date';
				} else {
					this.type = 'text';
				}
				this.updateFieldVisibility();
			});
		});

		this.dateFormatSetting = new Setting(contentEl);
		this.dateFormatSetting.setName(t('columnEditorModal.dateFormatLabel'));
		this.dateFormatSetting.setDesc(t('columnEditorModal.dateFormatDescription'));
		this.dateFormatSetting.addDropdown((dropdown) => {
			dropdown.addOption('iso', t('columnEditorModal.dateFormatIsoOption'));
			dropdown.addOption('short', t('columnEditorModal.dateFormatShortOption'));
			dropdown.addOption('long', t('columnEditorModal.dateFormatLongOption'));
			dropdown.setValue(this.dateFormat);
			dropdown.onChange((value) => {
				this.dateFormat = normalizeDateFormatPreset(value);
			});
		});

		this.formulaSetting = new Setting(contentEl);
		this.formulaSetting.setName(t('columnEditorModal.formulaLabel'));
		this.formulaSetting.setDesc(t('columnEditorModal.formulaDescription'));
		this.formulaSetting.controlEl.empty();

		const textareaWrapper = document.createElement('div');
		textareaWrapper.className = 'tlb-column-formula-input-wrapper';

		const textarea = document.createElement('textarea');
		textarea.className = 'tlb-column-formula-input';
		textarea.rows = 4;
		textarea.placeholder = t('columnEditorModal.formulaPlaceholder');
		textarea.value = this.options.initialFormula;
		textareaWrapper.appendChild(textarea);
		this.formulaSetting.controlEl.appendChild(textareaWrapper);
		this.formulaInput = textarea;

		this.formulaFormatSetting = new Setting(contentEl);
		this.formulaFormatSetting.setName(t('columnEditorModal.formulaFormatLabel'));
		this.formulaFormatSetting.setDesc(t('columnEditorModal.formulaFormatDescription'));
		this.formulaFormatSetting.addDropdown((dropdown) => {
			for (const option of getFormulaFormatPresetOptions()) {
				dropdown.addOption(option.value, t(option.labelKey));
			}
			dropdown.setValue(this.formulaFormatPreset);
			dropdown.onChange((value) => {
				const preset = normalizeFormulaFormatPreset(value);
				this.formulaFormatPreset = preset ?? 'auto';
				if (!preset) {
					dropdown.setValue('auto');
				}
			});
		});

		const fields = this.options.availableFields ?? [];
		if (fields.length > 0) {
			this.formulaSuggester = new FormulaFieldSuggester({
				input: textarea,
				fields,
				ownerDocument: ownerDoc
			});
		}

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

		this.updateFieldVisibility();

		const focusNameInput = () => {
			this.nameInput?.focus({ preventScroll: true });
		};
		const requestFrame = ownerDoc.defaultView?.requestAnimationFrame ?? window.requestAnimationFrame;
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
		if (this.formulaSuggester) {
			this.formulaSuggester.destroy();
			this.formulaSuggester = undefined;
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

	private updateFieldVisibility(): void {
		const formulaHidden = this.type !== 'formula';
		if (this.formulaSetting) {
			const formulaEl = this.formulaSetting.settingEl as HTMLElement;
			formulaEl.style.display = formulaHidden ? 'none' : '';
		}
		if (this.formulaInput) {
			this.formulaInput.disabled = formulaHidden;
		}
		if (this.formulaSuggester) {
			this.formulaSuggester.setEnabled(!formulaHidden);
		}
		if (this.formulaFormatSetting) {
			const formatEl = this.formulaFormatSetting.settingEl as HTMLElement;
			formatEl.style.display = formulaHidden ? 'none' : '';
		}
		if (this.dateFormatSetting) {
			const dateEl = this.dateFormatSetting.settingEl as HTMLElement;
			dateEl.style.display = this.type === 'date' ? '' : 'none';
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
			this.options.onSubmit({
				name: trimmedName,
				type: 'formula',
				formula,
				formulaFormatPreset: this.formulaFormatPreset === 'auto' ? undefined : this.formulaFormatPreset
			});
			this.submitted = true;
			this.close();
			return;
		}

		if (this.type === 'date') {
			const preset = normalizeDateFormatPreset(this.dateFormat);
			this.options.onSubmit({ name: trimmedName, type: 'date', formula: '', dateFormat: preset });
			this.submitted = true;
			this.close();
			return;
		}

		this.options.onSubmit({ name: trimmedName, type: 'text', formula: '' });
		this.submitted = true;
		this.close();
	}
}
