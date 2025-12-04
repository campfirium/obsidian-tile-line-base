interface FormulaFieldSuggesterOptions {
	input: HTMLTextAreaElement;
	fields: string[];
	ownerDocument: Document;
	maxResults?: number;
}

interface ActiveFieldState {
	start: number;
	end: number;
	partial: string;
}

function clamp(value: number, min: number, max: number): number {
	if (value < min) {
		return min;
	}
	if (value > max) {
		return max;
	}
	return value;
}

export class FormulaFieldSuggester {
	private readonly input: HTMLTextAreaElement;
	private fields: string[];
	private readonly maxResults: number;
	private readonly dropdownEl: HTMLDivElement;
	private readonly listEl: HTMLUListElement;
	private enabled = true;
	private isOpen = false;
	private matches: string[] = [];
	private activeIndex = 0;

	private readonly handleInput = () => this.updateSuggestions();
	private readonly handleKeyDown = (event: KeyboardEvent) => this.onKeyDown(event);
	private readonly handleBlur = () => this.hide();
	private readonly handleMouseDown = (event: MouseEvent) => {
		event.preventDefault();
	};
	private readonly handleReposition = () => {
		if (this.isOpen) {
			this.positionDropdown();
		}
	};
	private readonly ownerDocument: Document;
	private readonly ownerWindow: Window;

	constructor(options: FormulaFieldSuggesterOptions) {
		this.input = options.input;
		this.fields = this.prepareFields(options.fields);
		this.maxResults = options.maxResults ?? 20;
		this.ownerDocument = options.ownerDocument;
		this.ownerWindow = this.ownerDocument.defaultView ?? window;

		this.dropdownEl = this.ownerDocument.createElement('div');
		this.dropdownEl.className = 'tlb-formula-field-suggest';
		
		this.dropdownEl.setAttribute('role', 'listbox');
		this.dropdownEl.addEventListener('mousedown', this.handleMouseDown);

		this.listEl = this.ownerDocument.createElement('ul');
		this.listEl.className = 'tlb-formula-field-suggest-list';
		this.dropdownEl.appendChild(this.listEl);

		this.ownerDocument.body.appendChild(this.dropdownEl);

		this.input.addEventListener('input', this.handleInput);
		this.input.addEventListener('keydown', this.handleKeyDown, true);
		this.input.addEventListener('blur', this.handleBlur);
		this.ownerDocument.addEventListener('scroll', this.handleReposition, true);
		this.ownerWindow.addEventListener('resize', this.handleReposition);
	}

	destroy(): void {
		this.hide();
		this.dropdownEl.removeEventListener('mousedown', this.handleMouseDown);
		this.input.removeEventListener('input', this.handleInput);
		this.input.removeEventListener('keydown', this.handleKeyDown, true);
		this.input.removeEventListener('blur', this.handleBlur);
		this.ownerDocument.removeEventListener('scroll', this.handleReposition, true);
		this.ownerWindow.removeEventListener('resize', this.handleReposition);
		if (this.dropdownEl.parentElement) {
			this.dropdownEl.parentElement.removeChild(this.dropdownEl);
		}
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		if (!enabled) {
			this.hide();
		}
	}

	setFields(fields: string[]): void {
		this.fields = this.prepareFields(fields);
		this.updateSuggestions();
	}

	private prepareFields(fields: string[]): string[] {
		const seen = new Set<string>();
		const result: string[] = [];
		for (const field of fields) {
			const trimmed = field.trim();
			if (!trimmed) {
				continue;
			}
			const lower = trimmed.toLowerCase();
			if (seen.has(lower)) {
				continue;
			}
			seen.add(lower);
			result.push(trimmed);
		}
		return result;
	}

	private onKeyDown(event: KeyboardEvent): void {
		if (!this.isOpen || !this.enabled) {
			return;
		}
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				this.moveSelection(1);
				break;
			case 'ArrowUp':
				event.preventDefault();
				this.moveSelection(-1);
				break;
			case 'Tab':
			case 'Enter':
				if (this.matches.length > 0) {
					event.preventDefault();
					event.stopPropagation();
					this.applySelection();
				}
				break;
			case 'Escape':
				event.preventDefault();
				event.stopPropagation();
				this.hide();
				break;
			default:
				break;
		}
	}

	private updateSuggestions(): void {
		if (!this.enabled) {
			return;
		}
		const state = this.getActiveFieldState();
		if (!state) {
			this.hide();
			return;
		}

		const partialLower = state.partial.toLowerCase();
		const matches = this.fields
			.filter((field) => field.toLowerCase().includes(partialLower))
			.sort((a, b) => this.compareMatch(a, b, partialLower))
			.slice(0, this.maxResults);

		if (matches.length === 0) {
			this.hide();
			return;
		}

		this.matches = matches;
		this.activeIndex = 0;
		this.renderList();
		this.show();
	}

	private getActiveFieldState(): ActiveFieldState | null {
		const value = this.input.value;
		const selectionStart = this.input.selectionStart ?? 0;
		const selectionEnd = this.input.selectionEnd ?? 0;
		if (selectionStart !== selectionEnd) {
			return null;
		}

		const prefix = value.slice(0, selectionStart);
		const braceIndex = prefix.lastIndexOf('{');
		if (braceIndex === -1) {
			return null;
		}
		if (prefix.lastIndexOf('}') > braceIndex) {
			return null;
		}

		const partial = prefix.slice(braceIndex + 1);
		if (partial.includes('{') || partial.includes('}') || partial.includes('\n') || partial.includes('\r')) {
			return null;
		}

		return {
			start: braceIndex + 1,
			end: selectionStart,
			partial
		};
	}

	private renderList(): void {
		this.listEl.textContent = '';
		this.matches.forEach((match, index) => {
			const item = document.createElement('li');
			item.className = 'tlb-formula-field-suggest-item';
			if (index === this.activeIndex) {
				item.classList.add('is-active');
			}
			item.textContent = match;
			item.setAttribute('role', 'option');
			item.addEventListener('mouseover', () => this.setActiveIndex(index));
			item.addEventListener('mousedown', (event) => {
				event.preventDefault();
				this.setActiveIndex(index);
				this.applySelection();
			});
			this.listEl.appendChild(item);
		});
	}

	private moveSelection(delta: number): void {
		if (this.matches.length === 0) {
			return;
		}
		const next = clamp(this.activeIndex + delta, 0, this.matches.length - 1);
		if (next === this.activeIndex) {
			return;
		}
		this.setActiveIndex(next);
	}

	private setActiveIndex(index: number): void {
		this.activeIndex = clamp(index, 0, Math.max(0, this.matches.length - 1));
		this.updateActiveStyles();
	}

	private updateActiveStyles(): void {
		const children = Array.from(this.listEl.children) as HTMLElement[];
		children.forEach((child, index) => {
			if (index === this.activeIndex) {
				child.classList.add('is-active');
			} else {
				child.classList.remove('is-active');
			}
		});
	}

	private applySelection(): void {
		if (this.matches.length === 0) {
			return;
		}
		const match = this.matches[this.activeIndex] ?? this.matches[0];
		const state = this.getActiveFieldState();
		if (!match || !state) {
			return;
		}

		const value = this.input.value;
		const before = value.slice(0, state.start);
		const after = value.slice(state.end);
		const hasClosingBrace = after.startsWith('}');
		const closing = hasClosingBrace ? '' : '}';
		const nextValue = `${before}${match}${closing}${hasClosingBrace ? after.slice(1) : after}`;
		const caretPosition = before.length + match.length + closing.length;

		this.input.value = nextValue;
		this.input.selectionStart = caretPosition;
		this.input.selectionEnd = caretPosition;
		this.input.dispatchEvent(new Event('input', { bubbles: true }));
		this.hide();
	}

	private show(): void {
		if (this.isOpen) {
			this.positionDropdown();
			return;
		}
		this.isOpen = true;
		this.dropdownEl.classList.add('is-visible');
		this.dropdownEl.style.removeProperty('--tlb-suggest-max-height');
		this.positionDropdown();
	}

	private hide(): void {
		if (!this.isOpen) {
			return;
		}
		this.isOpen = false;
		this.dropdownEl.classList.remove('is-visible');
		this.dropdownEl.style.removeProperty('--tlb-suggest-max-height');
		this.dropdownEl.style.removeProperty('--tlb-suggest-top');
		this.dropdownEl.style.removeProperty('--tlb-suggest-left');
		this.dropdownEl.style.removeProperty('--tlb-suggest-min-width');
		this.matches = [];
	}

	private positionDropdown(): void {
		const inputRect = this.input.getBoundingClientRect();
		const margin = 4;
		const viewportHeight = this.ownerWindow.innerHeight || this.ownerDocument.documentElement.clientHeight || 0;

		const dropdownHeight = this.dropdownEl.offsetHeight || 0;
		const viewportWidth = this.ownerWindow.innerWidth || this.ownerDocument.documentElement.clientWidth || 0;
		const availableBelow = Math.max(viewportHeight - inputRect.bottom - margin, 0);
		const availableAbove = Math.max(inputRect.top - margin, 0);

		let placement: 'below' | 'above' = 'below';
		if (availableBelow < dropdownHeight && availableAbove > availableBelow) {
			placement = 'above';
		}

		let maxHeightPx: number;
		if (placement === 'below') {
			maxHeightPx = availableBelow > 0 ? availableBelow : Math.min(dropdownHeight || 220, 220);
		} else {
			maxHeightPx = availableAbove > 0 ? availableAbove : Math.min(dropdownHeight || 220, 220);
		}
		let clampedHeight: number;
		if (maxHeightPx > 0) {
			clampedHeight = Math.min(Math.max(maxHeightPx, 120), 320);
		} else {
			clampedHeight = Math.min(dropdownHeight || 220, 220);
		}
		this.dropdownEl.style.setProperty('--tlb-suggest-max-height', `${clampedHeight}px`);

		const adjustedHeight = this.dropdownEl.offsetHeight || clampedHeight;
		let left = inputRect.left;
		let top: number;
		if (placement === 'below') {
			top = inputRect.bottom + margin;
		} else {
			top = inputRect.top - adjustedHeight - margin;
		}

		const maxLeft = viewportWidth - margin - inputRect.width;
		if (left > maxLeft) {
			left = Math.max(maxLeft, margin);
		} else {
			left = Math.max(left, margin);
		}

		this.dropdownEl.style.setProperty('--tlb-suggest-top', `${Math.max(top, margin)}px`);
		this.dropdownEl.style.setProperty('--tlb-suggest-left', `${left}px`);
		this.dropdownEl.style.setProperty('--tlb-suggest-min-width', `${inputRect.width}px`);
	}

	private compareMatch(a: string, b: string, partialLower: string): number {
		const aLower = a.toLowerCase();
		const bLower = b.toLowerCase();
		const aStarts = aLower.startsWith(partialLower) ? 0 : 1;
		const bStarts = bLower.startsWith(partialLower) ? 0 : 1;
		if (aStarts !== bStarts) {
			return aStarts - bStarts;
		}
		return aLower.localeCompare(bLower);
	}
}




