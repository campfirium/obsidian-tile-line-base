import { ICellEditorComp, ICellEditorParams } from 'ag-grid-community';
import { setIcon } from 'obsidian';

import { normalizeDateInput } from '../../utils/datetime';
import { t } from '../../i18n';

function createWrapper(doc: Document): HTMLDivElement {
	const wrapper = doc.createElement('div');
	wrapper.classList.add('tlb-date-editor');
	return wrapper;
}

function createTextInput(doc: Document, value: string): HTMLInputElement {
	const input = doc.createElement('input');
	input.type = 'text';
	input.classList.add('tlb-date-editor-input');
	input.value = value;
	return input;
}

function createTriggerButton(doc: Document): HTMLButtonElement {
	const button = doc.createElement('button');
	button.type = 'button';
	button.classList.add('tlb-date-editor-button');
	button.setAttribute('aria-label', t('dateCellEditor.openPickerLabel'));
	setIcon(button, 'calendar');
	return button;
}

function createHiddenPicker(doc: Document): HTMLInputElement {
	const picker = doc.createElement('input');
	picker.type = 'date';
	picker.tabIndex = -1;
	picker.classList.add('tlb-date-editor-hidden-picker');
	picker.style.position = 'absolute';
	picker.style.opacity = '0';
	picker.style.pointerEvents = 'none';
	return picker;
}

export function createDateCellEditor() {
	return class implements ICellEditorComp {
		private wrapper!: HTMLDivElement;
		private textInput!: HTMLInputElement;
		private triggerButton!: HTMLButtonElement;
		private hiddenPicker!: HTMLInputElement;
		private params!: ICellEditorParams;
		private initialValue = '';
		private readonly isoPattern = /^\d{4}-\d{2}-\d{2}$/;
		private blurHandler = () => {
			this.applyNormalizedInput();
		};
		private pickerChangeHandler = (event: Event) => {
			const target = event.target as HTMLInputElement | null;
			const value = target?.value ?? '';
			this.handlePickerSelection(value);
		};
		private triggerClickHandler = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			this.openPicker();
		};
		private keydownHandler = (event: KeyboardEvent) => {
			if (event.key === 'Enter' || event.key === 'Tab') {
				event.stopPropagation();
				this.applyNormalizedInput();
				this.params.stopEditing(false);
			} else if (event.key === 'Escape') {
				event.stopPropagation();
				this.params.stopEditing(true);
			}
		};

		init(params: ICellEditorParams): void {
			this.params = params;
			const doc = params.eGridCell?.ownerDocument || document;
			this.initialValue = String(params.value ?? '').trim();

			this.wrapper = createWrapper(doc);
			this.textInput = createTextInput(doc, this.initialValue);
			this.triggerButton = createTriggerButton(doc);
			this.hiddenPicker = createHiddenPicker(doc);

			this.wrapper.appendChild(this.textInput);
			this.wrapper.appendChild(this.triggerButton);
			this.wrapper.appendChild(this.hiddenPicker);

			this.textInput.addEventListener('blur', this.blurHandler);
			this.textInput.addEventListener('keydown', this.keydownHandler);
			this.triggerButton.addEventListener('click', this.triggerClickHandler);
			this.hiddenPicker.addEventListener('change', this.pickerChangeHandler);
		}

		getGui(): HTMLElement {
			return this.wrapper;
		}

		afterGuiAttached(): void {
			this.textInput.focus({ preventScroll: true });
			if (this.initialValue.length > 0) {
				this.textInput.select();
			}
		}

		getValue(): string {
			const normalized = this.applyNormalizedInput();
			return normalized ?? normalizeDateInput(this.textInput.value || '');
		}

		destroy(): void {
			this.textInput.removeEventListener('blur', this.blurHandler);
			this.textInput.removeEventListener('keydown', this.keydownHandler);
			this.triggerButton.removeEventListener('click', this.triggerClickHandler);
			this.hiddenPicker.removeEventListener('change', this.pickerChangeHandler);
		}

		isPopup(): boolean {
			return false;
		}

		private openPicker(): void {
			const { normalized, valid } = this.prepareNormalizedValue(this.textInput.value ?? '');
			this.hiddenPicker.value = valid ? normalized : '';
			try {
				if (typeof (this.hiddenPicker as any).showPicker === 'function') {
					(this.hiddenPicker as any).showPicker();
				} else {
					this.hiddenPicker.focus();
					this.hiddenPicker.click();
				}
			} catch {
				this.hiddenPicker.focus();
			}
		}

		private handlePickerSelection(rawValue: string): void {
			const { normalized, valid } = this.prepareNormalizedValue(rawValue);
			if (valid) {
				this.textInput.value = normalized;
				this.params.stopEditing(false);
			} else {
				this.textInput.focus({ preventScroll: true });
			}
		}

		private applyNormalizedInput(): string | null {
			const { normalized, valid } = this.prepareNormalizedValue(this.textInput.value ?? '');
			if (valid && normalized !== this.textInput.value) {
				this.textInput.value = normalized;
			}
			return valid ? normalized : null;
		}

		private prepareNormalizedValue(value: string): { normalized: string; valid: boolean } {
			const trimmed = (value ?? '').trim();
			if (!trimmed) {
				return { normalized: '', valid: false };
			}
			const normalized = normalizeDateInput(trimmed);
			const valid = this.isoPattern.test(normalized);
			return {
				normalized: valid ? normalized : trimmed,
				valid
			};
		}
	};
}
