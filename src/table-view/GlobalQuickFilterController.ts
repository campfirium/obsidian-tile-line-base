import { setIcon } from 'obsidian';
import type { GridAdapter } from '../grid/GridAdapter';
import { globalQuickFilterManager } from './filter/GlobalQuickFilterManager';

interface GlobalQuickFilterDeps {
        getGridAdapter: () => GridAdapter | null;
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

                const clearButton = container.createSpan({ cls: 'clickable-icon' });
                clearButton.setAttribute('role', 'button');
                clearButton.setAttribute('tabindex', '0');
                clearButton.setAttribute('aria-label', '清除过滤');
                setIcon(clearButton, 'x');

                const input = container.createEl('input', {
                        type: 'search',
                        placeholder: '全局过滤'
                });
                input.setAttribute('aria-label', '全局过滤关键字');
                input.setAttribute('size', '16');

                const iconEl = container.createSpan({ cls: 'clickable-icon' });
                iconEl.setAttribute('aria-label', '聚焦过滤输入');
                iconEl.setAttribute('tabindex', '0');
                setIcon(iconEl, 'search');

                const currentValue = globalQuickFilterManager.getValue();
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

                this.unsubscribe = globalQuickFilterManager.subscribe((value, source) => {
                        if (source === this) {
                                return;
                        }
                        this.updateInput(value);
                        this.applyToGrid(value);
                });

                if (!this.registered) {
                        this.registered = true;
                        globalQuickFilterManager.incrementHost();
                }

                this.applyToGrid(currentValue);
                this.updateInput(currentValue);
        }

        reapply(): void {
                const value = globalQuickFilterManager.getValue();
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
                        globalQuickFilterManager.decrementHost();
                }
        }

        private handleInput(value: string): void {
                const normalized = value ?? '';
                this.applyToGrid(normalized);
                if (normalized === globalQuickFilterManager.getValue()) {
                        return;
                }
                globalQuickFilterManager.emit(normalized, this);
        }

        private handleClear(): void {
                this.updateInput('');
                this.applyToGrid('');
                if (globalQuickFilterManager.getValue() !== '') {
                        globalQuickFilterManager.emit('', this);
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
                        (this.clearEl as HTMLElement).style.display = '';
                } else {
                        this.clearEl.setAttribute('hidden', 'true');
                        (this.clearEl as HTMLElement).style.display = 'none';
                }
        }
}
