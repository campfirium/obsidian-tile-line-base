import { ICellEditorComp, ICellEditorParams } from 'ag-grid-community';
import { Notice } from 'obsidian';

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

export function createTimeCellEditor() {
	return class implements ICellEditorComp {
		private wrapper!: HTMLDivElement;
		private textInput!: HTMLInputElement;
		private params!: ICellEditorParams;
		private initialValue = '';
		private lastValidValue = '';
		private invalidNotice: Notice | null = null;
		private readonly isoPattern = /^\d{2}:\d{2}:\d{2}$/;
		private isInvalid = false;

		private blurHandler = () => {
			this.applyNormalizedInput();
		};

		private inputHandler = () => {
			if (this.isInvalid) {
				this.clearInvalidState();
				this.dismissNotice();
			}
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
			this.wrapper.appendChild(this.textInput);

			this.textInput.addEventListener('blur', this.blurHandler);
			this.textInput.addEventListener('input', this.inputHandler);
			this.textInput.addEventListener('keydown', this.keydownHandler);
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
			this.textInput.removeEventListener('input', this.inputHandler);
			this.textInput.removeEventListener('keydown', this.keydownHandler);
			this.clearInvalidState();
			this.dismissNotice();
		}

		isPopup(): boolean {
			return false;
		}

		private applyNormalizedInput(): string | null {
			const { normalized, valid } = this.prepareNormalizedValue(this.textInput.value ?? '');
			if (!valid) {
				this.markInvalid();
				this.showNotice();
				return null;
			}
			this.clearInvalidState();
			this.dismissNotice();
			if (normalized === null) {
				return '';
			}
			if (normalized !== this.textInput.value) {
				this.textInput.value = normalized;
			}
			this.lastValidValue = normalized;
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

		private markInvalid(): void {
			if (this.isInvalid) {
				return;
			}
			this.isInvalid = true;
			this.wrapper.classList.add('is-invalid');
			this.textInput.classList.add('tlb-time-editor-input--invalid');
			this.textInput.setAttribute('aria-invalid', 'true');
		}

		private clearInvalidState(): void {
			if (!this.isInvalid) {
				return;
			}
			this.isInvalid = false;
			this.wrapper.classList.remove('is-invalid');
			this.textInput.classList.remove('tlb-time-editor-input--invalid');
			this.textInput.removeAttribute('aria-invalid');
		}

		private showNotice(): void {
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
