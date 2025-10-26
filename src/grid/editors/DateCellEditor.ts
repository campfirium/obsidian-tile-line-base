import { ICellEditorComp, ICellEditorParams } from 'ag-grid-community';
import { Notice, setIcon } from 'obsidian';

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
		private readonly referenceDate = new Date();
		private initialValue = '';
		private readonly isoPattern = /^\d{4}-\d{2}-\d{2}$/;
		private invalidNotice: Notice | null = null;
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
				const normalized = this.applyNormalizedInput();
				if (normalized !== null || this.textInput.value.trim().length === 0) {
					this.params.stopEditing(false);
				}
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
			this.applyColorScheme();

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
			if (this.invalidNotice) {
				this.invalidNotice.hide();
				this.invalidNotice = null;
			}
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

			if (!valid && this.textInput.value.trim().length > 0) {
				this.handleInvalidInput();
			}

			return valid ? normalized : null;
		}

		private prepareNormalizedValue(value: string): { normalized: string; valid: boolean } {
			const trimmed = (value ?? '').trim();
			if (!trimmed) {
				return { normalized: '', valid: true };
			}

			const interpreted = this.interpretInput(trimmed);
			const valid = typeof interpreted === 'string' && interpreted.length > 0 && this.isoPattern.test(interpreted);

			return {
				normalized: valid ? (interpreted as string) : trimmed,
				valid
			};
		}

		private interpretInput(input: string): string | null {
			const normalized = normalizeDateInput(input);
			if (normalized && this.isoPattern.test(normalized)) {
				return normalized;
			}

			const digits = input.replace(/\D/g, '');
			if (!digits) {
				return null;
			}

			const reference = this.referenceDate;
			const currentYear = reference.getFullYear();
			const currentMonth = reference.getMonth() + 1;
			const currentDay = reference.getDate();

			let year = currentYear;
			let month = currentMonth;
			let day = currentDay;

			switch (digits.length) {
				case 1:
				case 2: {
					day = parseInt(digits, 10);
					break;
				}
				case 3: {
					month = parseInt(digits.substring(0, 1), 10);
					day = parseInt(digits.substring(1), 10);
					break;
				}
				case 4: {
					month = parseInt(digits.substring(0, 2), 10);
					day = parseInt(digits.substring(2), 10);
					break;
				}
				case 6: {
					const twoDigitYear = parseInt(digits.substring(0, 2), 10);
					year = this.expandTwoDigitYear(twoDigitYear, currentYear);
					month = parseInt(digits.substring(2, 4), 10);
					day = parseInt(digits.substring(4, 6), 10);
					break;
				}
				case 8: {
					year = parseInt(digits.substring(0, 4), 10);
					month = parseInt(digits.substring(4, 6), 10);
					day = parseInt(digits.substring(6, 8), 10);
					break;
				}
				default:
					return null;
			}

			if (!this.isValidDate(year, month, day)) {
				return null;
			}

			return this.composeIsoDate(year, month, day);
		}

		private composeIsoDate(year: number, month: number, day: number): string {
			return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
		}

		private expandTwoDigitYear(year: number, referenceYear: number): number {
			const referenceCentury = Math.floor(referenceYear / 100) * 100;
			let candidate = referenceCentury + year;

			if (candidate < referenceYear - 50) {
				candidate += 100;
			} else if (candidate > referenceYear + 50) {
				candidate -= 100;
			}

			return candidate;
		}

		private isValidDate(year: number, month: number, day: number): boolean {
			if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
				return false;
			}
			if (month < 1 || month > 12 || day < 1 || day > 31) {
				return false;
			}

			const date = new Date(year, month - 1, day);
			return (
				date.getFullYear() === year &&
				date.getMonth() === month - 1 &&
				date.getDate() === day
			);
		}

		private handleInvalidInput(): void {
			if (this.invalidNotice) {
				this.invalidNotice.hide();
			}
			this.invalidNotice = new Notice(t('dateCellEditor.invalidInput'), 2500);
			this.openPicker();
		}

		private applyColorScheme(): void {
			const ownerDoc = this.wrapper?.ownerDocument || document;
			const isDark = ownerDoc?.body?.classList.contains('theme-dark') ?? false;
			this.hiddenPicker.style.colorScheme = isDark ? 'dark' : 'light';
		}
	};
}
