import { setIcon } from 'obsidian';
import type { GridAdapter } from '../grid/GridAdapter';
import { GlobalQuickFilterManager } from './filter/GlobalQuickFilterManager';
import { t } from '../i18n';

interface GlobalQuickFilterDeps {
	getGridAdapter: () => GridAdapter | null;
	quickFilterManager: GlobalQuickFilterManager;
}

export class GlobalQuickFilterController {
        private inputEl: HTMLInputElement | null = null;
        private clearEl: HTMLElement | null = null;
        private unsubscribe: (() => void) | null = null;
        private registered = false;

	constructor(private readonly deps: GlobalQuickFilterDeps) {}

	render(container: HTMLElement): void {
		this.cleanup();

		container.addClass('tlb-filter-view-search');
		container.setAttribute('role', 'search');

		const field = container.createDiv({ cls: 'tlb-filter-view-search__field' });

		const searchIconSize = 16;
		const clearIconSize = 20;
		const searchHitArea = searchIconSize + 12;
		const clearHitArea = clearIconSize + 12;

		field.style.setProperty('--tlb-quick-filter-hit-area', `${searchHitArea}px`);
		field.style.setProperty('--tlb-quick-filter-search-hit', `${searchHitArea}px`);
		field.style.setProperty('--tlb-quick-filter-clear-hit', `${clearHitArea}px`);
		field.style.setProperty('--tlb-quick-filter-icon-size', `${searchIconSize}px`);
		field.style.setProperty('--tlb-quick-filter-clear-size', `${clearIconSize}px`);

		const iconEl = field.createSpan({ cls: 'tlb-filter-view-search__icon clickable-icon' });
		iconEl.setAttribute('aria-label', t('quickFilter.focusAriaLabel'));
		iconEl.setAttribute('tabindex', '0');
		setIcon(iconEl, 'search');

		const input = field.createEl('input', {
			type: 'search',
			placeholder: t('quickFilter.placeholder')
		});
		input.addClass('tlb-filter-view-search__input');
		input.setAttribute('aria-label', t('quickFilter.inputAriaLabel'));
		input.setAttribute('size', '16');
		input.style.paddingLeft = `${searchHitArea + 8}px`;
		input.style.paddingRight = `${clearHitArea + 8}px`;

		const clearButton = field.createSpan({ cls: 'tlb-filter-view-search__clear clickable-icon' });
		clearButton.setAttribute('role', 'button');
		clearButton.setAttribute('tabindex', '0');
		clearButton.setAttribute('aria-label', t('quickFilter.clearAriaLabel'));
		clearButton.setAttribute('hidden', 'true');
		setIcon(clearButton, 'x');

		const currentValue = this.deps.quickFilterManager.getValue();
                input.value = currentValue;

                this.inputEl = input;
                this.clearEl = clearButton;

                clearButton.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        this.handleClear();
                });
                clearButton.addEventListener('keydown', (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                event.stopPropagation();
                                this.handleClear();
                        }
                });

                iconEl.addEventListener('click', () => input.focus());
                iconEl.addEventListener('keydown', (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                event.stopPropagation();
                                input.focus();
                        }
                });

                input.addEventListener('input', () => this.handleInput(input.value));
                input.addEventListener('keydown', (event) => {
                        if (event.key === 'Escape') {
                                event.preventDefault();
                                event.stopPropagation();
                                if (input.value.length > 0) {
                                        this.handleClear();
                                } else {
                                        input.blur();
                                }
                        }
                });

		this.unsubscribe = this.deps.quickFilterManager.subscribe((value, source) => {
			if (source === this) {
				return;
			}
			this.updateInput(value);
			this.applyToGrid(value);
		});

                if (!this.registered) {
                        this.registered = true;
			this.deps.quickFilterManager.incrementHost();
                }

                this.applyToGrid(currentValue);
                this.updateInput(currentValue);
        }

        reapply(): void {
		const value = this.deps.quickFilterManager.getValue();
                this.applyToGrid(value);
                this.updateInput(value);
        }

        cleanup(): void {
                if (this.unsubscribe) {
                        this.unsubscribe();
                        this.unsubscribe = null;
                }
                this.inputEl = null;
                this.clearEl = null;

		if (this.registered) {
			this.registered = false;
			this.deps.quickFilterManager.decrementHost();
                }
        }

        private handleInput(value: string): void {
                const normalized = value ?? '';
                this.applyToGrid(normalized);
		if (normalized === this.deps.quickFilterManager.getValue()) {
			return;
		}
		this.deps.quickFilterManager.emit(normalized, this);
        }

        private handleClear(): void {
                this.updateInput('');
                this.applyToGrid('');
		if (this.deps.quickFilterManager.getValue() !== '') {
			this.deps.quickFilterManager.emit('', this);
                }
                this.inputEl?.focus();
        }

        private applyToGrid(value: string): void {
		const adapter = this.deps.getGridAdapter();
		if (adapter && typeof adapter.setQuickFilter === 'function') {
			adapter.setQuickFilter(value);
		}
		this.updateIndicators(value);
        }

        private updateInput(value: string): void {
                if (!this.inputEl || this.inputEl.value === value) {
                        this.updateIndicators(value);
                        return;
                }

                const input = this.inputEl;
                const isFocused = document.activeElement === input;
                input.value = value;
                if (isFocused) {
                        const caret = typeof input.selectionEnd === 'number' ? Math.min(value.length, input.selectionEnd) : value.length;
                        input.setSelectionRange(caret, caret);
                }
                this.updateIndicators(value);
        }

	private updateIndicators(value: string): void {
		if (!this.clearEl) {
			return;
		}
		if (value && value.length > 0) {
			this.clearEl.removeAttribute('hidden');
		} else {
			this.clearEl.setAttribute('hidden', 'true');
		}
	}

}
