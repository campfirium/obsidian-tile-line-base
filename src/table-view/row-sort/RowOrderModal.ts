import { App, Modal, setIcon } from 'obsidian';
import type { SortRule } from '../../types/filterView';
import { t } from '../../i18n';

interface RowOrderModalOptions {
	columns: string[];
	initialSortRules?: SortRule[];
	onSubmit: (sortRules: SortRule[]) => void;
}

export class RowOrderModal extends Modal {
	private readonly options: RowOrderModalOptions;
	private sortContainer: HTMLElement | null = null;
	private sortRules: SortRule[] = [];
	private draggingIndex: number | null = null;

	constructor(app: App, options: RowOrderModalOptions) {
		super(app);
		this.options = options;
		this.modalEl.addClass('tlb-row-order-modal');
		this.sortRules = Array.isArray(options.initialSortRules)
			? options.initialSortRules.map((rule) => ({
					column: rule.column,
					direction: rule.direction === 'desc' ? 'desc' : 'asc'
				}))
			: [];
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		this.titleEl.setText(t('rowOrder.modalTitle'));

		const warning = contentEl.createDiv({ cls: 'tlb-filter-empty-hint tlb-row-order-warning' });
		warning.setText(t('rowOrder.modalWarning'));

		this.sortContainer = contentEl.createDiv({ cls: 'tlb-filter-conditions tlb-filter-sort' });
		this.renderSortRules();

		const addButton = contentEl.createEl('button', { text: t('filterViewModals.addSortButton') });
		addButton.addEventListener('click', () => this.addSortRule());

		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
		const applyButton = buttonContainer.createEl('button', { text: t('filterViewModals.saveButton') });
		applyButton.addClass('mod-cta');
		applyButton.addEventListener('click', () => {
			if (this.sortRules.length === 0) {
				return;
			}
			this.options.onSubmit(this.sortRules.map((rule) => ({ ...rule })));
			this.close();
		});

		const cancelButton = buttonContainer.createEl('button', { text: t('filterViewModals.cancelButton') });
		cancelButton.addEventListener('click', () => this.close());
	}

	private renderSortRules(): void {
		const container = this.sortContainer;
		if (!container) {
			return;
		}
		container.empty();
		const columns = this.options.columns;
		if (columns.length === 0) {
			container.createEl('p', { cls: 'tlb-filter-empty-hint', text: t('filterViewModals.sortsNoColumnsHint') });
			return;
		}
		if (this.sortRules.length === 0) {
			container.createEl('p', { cls: 'tlb-filter-empty-hint', text: t('filterViewModals.sortsEmptyHint') });
			return;
		}

		this.sortRules.forEach((rule, index) => {
			const row = container.createDiv({ cls: 'tlb-filter-condition-row tlb-sort-rule-row' });
			row.draggable = true;
			row.setAttribute('data-index', String(index));
			row.addEventListener('dragstart', (event) => this.onDragStart(event, index));
			row.addEventListener('dragover', (event) => this.onDragOver(event, index));
			row.addEventListener('drop', (event) => this.onDrop(event, index));
			row.addEventListener('dragleave', () => row.classList.remove('is-drag-over'));
			row.addEventListener('dragend', () => this.onDragEnd());

			row.createSpan({ cls: 'tlb-sort-rule-handle', text: '::' }).setAttribute('aria-hidden', 'true');

			const columnSelect = row.createEl('select', { cls: 'tlb-filter-select' });
			columns.forEach((name) => {
				const option = columnSelect.createEl('option', { text: name, value: name });
				if (name === rule.column) {
					option.selected = true;
				}
			});
			if (!columns.includes(rule.column) && columns.length > 0) {
				columnSelect.value = columns[0];
				rule.column = columns[0];
			}
			columnSelect.addEventListener('change', () => {
				rule.column = columnSelect.value;
			});

			const directionSelect = row.createEl('select', { cls: 'tlb-filter-select' });
			directionSelect.createEl('option', {
				text: t('filterViewModals.sortDirectionAsc'),
				value: 'asc'
			});
			directionSelect.createEl('option', {
				text: t('filterViewModals.sortDirectionDesc'),
				value: 'desc'
			});
			directionSelect.value = rule.direction === 'desc' ? 'desc' : 'asc';
			directionSelect.addEventListener('change', () => {
				rule.direction = directionSelect.value === 'desc' ? 'desc' : 'asc';
			});

			const removeButton = row.createEl('button', {
				type: 'button',
				cls: 'clickable-icon tlb-filter-view-modal__remove-button',
				attr: { 'aria-label': t('filterViewModals.removeButton') }
			});
			setIcon(removeButton, 'trash-2');
			removeButton.addEventListener('click', () => {
				this.sortRules.splice(index, 1);
				this.renderSortRules();
			});
		});
	}

	private addSortRule(): void {
		const first = this.options.columns[0];
		if (!first) {
			return;
		}
		this.sortRules.push({ column: first, direction: 'asc' });
		this.renderSortRules();
	}

	private onDragStart(event: DragEvent, index: number): void {
		this.draggingIndex = index;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', String(index));
		}
		(event.currentTarget as HTMLElement | null)?.classList.add('is-dragging');
	}

	private onDragOver(event: DragEvent, index: number): void {
		event.preventDefault();
		if (this.draggingIndex === null || this.draggingIndex === index) {
			return;
		}
		(event.currentTarget as HTMLElement | null)?.classList.add('is-drag-over');
	}

	private onDrop(event: DragEvent, index: number): void {
		event.preventDefault();
		const fromIndex = this.draggingIndex;
		this.clearDragState();
		if (fromIndex === null || fromIndex === index) {
			return;
		}
		if (fromIndex < 0 || fromIndex >= this.sortRules.length || index < 0 || index >= this.sortRules.length) {
			return;
		}
		const [moved] = this.sortRules.splice(fromIndex, 1);
		this.sortRules.splice(index, 0, moved);
		this.renderSortRules();
	}

	private onDragEnd(): void {
		this.clearDragState();
	}

	private clearDragState(): void {
		if (!this.sortContainer) {
			return;
		}
		this.draggingIndex = null;
		this.sortContainer.querySelectorAll('.tlb-sort-rule-row').forEach((row) => {
			row.classList.remove('is-drag-over', 'is-dragging');
		});
	}
}
