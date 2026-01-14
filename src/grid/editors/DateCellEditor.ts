import { ICellEditorComp, ICellEditorParams } from 'ag-grid-community';
import { Notice, setIcon } from 'obsidian';

import { normalizeDateInput } from '../../utils/datetime';
import { t } from '../../i18n';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgElement(doc: Document, tag: string, attrs: Record<string, string>): SVGElement {
	const element = doc.createElementNS(SVG_NS, tag);
	for (const [key, value] of Object.entries(attrs)) {
		element.setAttribute(key, value);
	}
	return element;
}

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

function injectCalendarGlyph(button: HTMLButtonElement): void {
	const doc = button.ownerDocument || document;
	const svg = createSvgElement(doc, 'svg', {
		viewBox: '0 0 24 24',
		width: '16',
		height: '16',
		stroke: 'currentColor',
		'stroke-width': '1.5',
		fill: 'none',
		'stroke-linecap': 'round',
		'stroke-linejoin': 'round',
		'aria-hidden': 'true'
	});

	const outerRect = createSvgElement(doc, 'rect', {
		x: '3',
		y: '4',
		width: '18',
		height: '18',
		rx: '2',
		ry: '2'
	});
	const topRightLine = createSvgElement(doc, 'line', { x1: '16', y1: '2', x2: '16', y2: '6' });
	const topLeftLine = createSvgElement(doc, 'line', { x1: '8', y1: '2', x2: '8', y2: '6' });
	const headerLine = createSvgElement(doc, 'line', { x1: '3', y1: '10', x2: '21', y2: '10' });
	const dayRect = createSvgElement(doc, 'rect', { x: '8', y: '14', width: '4', height: '4', rx: '1' });

	svg.appendChild(outerRect);
	svg.appendChild(topRightLine);
	svg.appendChild(topLeftLine);
	svg.appendChild(headerLine);
	svg.appendChild(dayRect);

	while (button.firstChild) {
		button.removeChild(button.firstChild);
	}
	button.appendChild(svg);
}

function createTriggerButton(doc: Document): HTMLButtonElement {
	const button = doc.createElement('button');
	button.type = 'button';
	button.classList.add('tlb-date-editor-button');
	button.setAttribute('aria-label', t('dateCellEditor.openPickerLabel'));
	setIcon(button, 'calendar');
	queueMicrotask(() => {
		if (!button.firstElementChild) {
			injectCalendarGlyph(button);
		}
	});
	return button;
}

function createHiddenPicker(doc: Document): HTMLInputElement {
	const picker = doc.createElement('input');
	picker.type = 'date';
	picker.tabIndex = -1;
	picker.classList.add('tlb-date-editor-hidden-picker');
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
		private lastValidValue = '';
		private invalidNotice: Notice | null = null;
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
				const picker = this.hiddenPicker as HTMLInputElement & { showPicker?: () => void };
				if (typeof picker.showPicker === 'function') {
					picker.showPicker();
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
			const normalized = normalizeDateInput(trimmed);
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
			const normalized = normalizeDateInput(rawValue);
			return this.isoPattern.test(normalized) ? normalized : '';
		}

		private handleInvalidInput(): void {
			if (!this.invalidNotice) {
				this.invalidNotice = new Notice(t('dateCellEditor.invalidInput'), 2000);
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
