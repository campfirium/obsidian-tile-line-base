import { ICellEditorComp, ICellEditorParams } from 'ag-grid-community';
import { Notice, setIcon } from 'obsidian';

import { normalizeTimeInput } from '../../utils/datetime';
import { t } from '../../i18n';

function createWrapper(doc: Document): HTMLDivElement {
	const wrapper = doc.createElement('div');
	wrapper.classList.add('tlb-time-editor');
	return wrapper;
}

function createTextInput(doc: Document, value: string): HTMLInputElement {
	const input = doc.createElement('input');
	input.type = 'text';
	input.classList.add('tlb-time-editor-input');
	input.value = value;
	return input;
}

function injectClockGlyph(button: HTMLButtonElement): void {
	button.innerHTML =
		'<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
}

function createTriggerButton(doc: Document): HTMLButtonElement {
	const button = doc.createElement('button');
	button.type = 'button';
	button.classList.add('tlb-time-editor-button');
	button.setAttribute('aria-label', t('timeCellEditor.openPickerLabel'));
	setIcon(button, 'clock');
	queueMicrotask(() => {
		if (!button.firstElementChild) {
			injectClockGlyph(button);
		}
	});
	return button;
}

function createHiddenPicker(doc: Document): HTMLInputElement {
	const picker = doc.createElement('input');
	picker.type = 'time';
	picker.tabIndex = -1;
	picker.classList.add('tlb-time-editor-hidden-picker');
	picker.step = '1';
	return picker;
}

export function createTimeCellEditor() {
	return class implements ICellEditorComp {
		private wrapper!: HTMLDivElement;
		private textInput!: HTMLInputElement;
		private triggerButton!: HTMLButtonElement;
		private hiddenPicker!: HTMLInputElement;
		private params!: ICellEditorParams;
		private initialValue = '';
		private lastValidValue = '';
		private invalidNotice: Notice | null = null;
		private readonly isoPattern = /^\d{2}:\d{2}:\d{2}$/;

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
				if (normalized !== null) {
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
			this.lastValidValue = this.determineInitialValidValue(this.initialValue);

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
			if (normalized === null) {
				return this.lastValidValue;
			}
			this.lastValidValue = normalized;
			return normalized;
		}

		destroy(): void {
			this.textInput.removeEventListener('blur', this.blurHandler);
			this.textInput.removeEventListener('keydown', this.keydownHandler);
			this.triggerButton.removeEventListener('click', this.triggerClickHandler);
			this.hiddenPicker.removeEventListener('change', this.pickerChangeHandler);
			this.dismissNotice();
		}

		isPopup(): boolean {
			return false;
		}

		private openPicker(): void {
			const { normalized, valid } = this.prepareNormalizedValue(this.textInput.value ?? '');
			this.hiddenPicker.value = valid && normalized !== null ? normalized : '';
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
			if (valid && normalized !== null) {
				this.textInput.value = normalized;
				this.lastValidValue = normalized;
				this.dismissNotice();
				this.params.stopEditing(false);
			} else {
				this.textInput.focus({ preventScroll: true });
				this.handleInvalidInput();
			}
		}

		private applyNormalizedInput(): string | null {
			const { normalized, valid } = this.prepareNormalizedValue(this.textInput.value ?? '');
			if (!valid) {
				this.handleInvalidInput();
				return null;
			}
			if (normalized === null) {
				return '';
			}
			if (normalized !== this.textInput.value) {
				this.textInput.value = normalized;
			}
			this.lastValidValue = normalized;
			this.dismissNotice();
			return normalized;
		}

		private prepareNormalizedValue(value: string): { normalized: string | null; valid: boolean } {
			const trimmed = (value ?? '').trim();
			if (!trimmed) {
				return { normalized: '', valid: true };
			}
			const normalized = normalizeTimeInput(trimmed);
			const valid = this.isoPattern.test(normalized);
			return {
				normalized: valid ? normalized : null,
				valid
			};
		}

		private determineInitialValidValue(rawValue: string): string {
			if (!rawValue) {
				return '';
			}
			const normalized = normalizeTimeInput(rawValue);
			return this.isoPattern.test(normalized) ? normalized : '';
		}

		private handleInvalidInput(): void {
			if (!this.invalidNotice) {
				this.invalidNotice = new Notice(t('timeCellEditor.invalidInput'), 2000);
			}
		}

		private dismissNotice(): void {
			if (this.invalidNotice) {
				this.invalidNotice.hide();
				this.invalidNotice = null;
			}
		}
	};
}
