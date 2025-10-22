import { App, Modal, Setting } from 'obsidian';
import type { FilterCondition, FilterOperator, FilterRule, SortRule } from '../../types/filterView';

export interface FilterViewEditorModalOptions {
	title: string;
	columns: string[];
	initialName?: string;
	initialRule?: FilterRule | null;
	initialSortRules?: SortRule[] | null;
	onSubmit: (name: string, rule: FilterRule, sortRules: SortRule[]) => void;
	onCancel: () => void;
}

export class FilterViewEditorModal extends Modal {
	private readonly options: FilterViewEditorModalOptions;
	private nameInputEl!: HTMLInputElement;
	private conditionsContainer!: HTMLElement;
	private combineModeSelect!: HTMLSelectElement;
	private conditions: FilterCondition[] = [];
	private combineMode: 'AND' | 'OR' = 'AND';
	private sortContainer!: HTMLElement;
	private sortRules: SortRule[] = [];
	private draggingSortIndex: number | null = null;

	constructor(app: App, options: FilterViewEditorModalOptions) {
		super(app);
		this.options = options;
		if (options.initialRule) {
			this.conditions = [...options.initialRule.conditions];
			this.combineMode = options.initialRule.combineMode;
		}
		if (options.initialSortRules && options.initialSortRules.length > 0) {
			this.sortRules = options.initialSortRules.map((rule) => ({
				column: rule.column,
				direction: rule.direction === 'desc' ? 'desc' : 'asc'
			}));
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tlb-filter-editor-modal');
		this.titleEl.setText(this.options.title);

		const nameSetting = new Setting(contentEl);
		nameSetting.setName('View name');
		nameSetting.addText((text) => {
			text.setPlaceholder('Enter view name');
			if (this.options.initialName) {
				text.setValue(this.options.initialName);
			}
			this.nameInputEl = text.inputEl;
		});

		const modeSetting = new Setting(contentEl);
		modeSetting.setName('Condition combine mode');
		modeSetting.addDropdown((dropdown) => {
			dropdown.addOption('AND', 'Match all conditions (AND)');
			dropdown.addOption('OR', 'Match any condition (OR)');
			dropdown.setValue(this.combineMode);
			dropdown.onChange((value) => {
				this.combineMode = value as 'AND' | 'OR';
			});
			this.combineModeSelect = dropdown.selectEl;
		});

		contentEl.createEl('h3', { text: 'Filter conditions' });
		this.conditionsContainer = contentEl.createDiv({ cls: 'tlb-filter-conditions' });
		this.renderConditions();

		const addConditionButton = contentEl.createEl('button', { text: '+ Add condition' });
		addConditionButton.addClass('mod-cta');
		addConditionButton.addEventListener('click', () => this.addCondition());

		contentEl.createEl('h3', { text: 'Sort rules' });
		this.sortContainer = contentEl.createDiv({ cls: 'tlb-filter-conditions tlb-filter-sort' });
		this.renderSortRules();

		const addSortButton = contentEl.createEl('button', { text: '+ Add sort' });
		addSortButton.addEventListener('click', () => this.addSortRule());

		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
		const saveButton = buttonContainer.createEl('button', { text: 'Save' });
		saveButton.addClass('mod-cta');
		saveButton.addEventListener('click', () => this.submit());

		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.addEventListener('click', () => this.close());
	}

	private renderConditions(): void {
		this.conditionsContainer.empty();

		if (this.conditions.length === 0) {
			this.conditionsContainer.createEl('p', {
				text: 'No filter conditions yet. Use "Add condition" to configure.',
				cls: 'tlb-filter-empty-hint'
			});
			return;
		}

		this.conditions.forEach((condition, index) => {
			const row = this.conditionsContainer.createDiv({ cls: 'tlb-filter-condition-row' });

			const columnSelect = row.createEl('select', { cls: 'tlb-filter-select' });
			this.options.columns.forEach((col) => {
				const option = columnSelect.createEl('option', { text: col, value: col });
				if (col === condition.column) {
					option.selected = true;
				}
			});
			columnSelect.addEventListener('change', () => {
				condition.column = columnSelect.value;
			});

			const operators: { value: FilterOperator; label: string }[] = [
				{ value: 'equals', label: 'Equals' },
				{ value: 'notEquals', label: 'Not equal' },
				{ value: 'contains', label: 'Contains' },
				{ value: 'notContains', label: 'Does not contain' },
				{ value: 'startsWith', label: 'Starts with' },
				{ value: 'endsWith', label: 'Ends with' },
				{ value: 'isEmpty', label: 'Is empty' },
				{ value: 'isNotEmpty', label: 'Is not empty' }
			];

			const operatorSelect = row.createEl('select', { cls: 'tlb-filter-select' });
			operators.forEach((op) => {
				const option = operatorSelect.createEl('option', { text: op.label, value: op.value });
				if (op.value === condition.operator) {
					option.selected = true;
				}
			});
			operatorSelect.addEventListener('change', () => {
				condition.operator = operatorSelect.value as FilterOperator;
				this.renderConditions();
			});

			const requiresValue = !['isEmpty', 'isNotEmpty'].includes(condition.operator);
			if (requiresValue) {
				const valueInput = row.createEl('input', {
					type: 'text',
					cls: 'tlb-filter-input',
					placeholder: 'Enter value'
				});
				valueInput.value = condition.value ?? '';
				valueInput.addEventListener('input', () => {
					condition.value = valueInput.value;
				});
			}

			const removeButton = row.createEl('button', { text: 'Remove', cls: 'mod-warning' });
			removeButton.addEventListener('click', () => {
				this.conditions.splice(index, 1);
				this.renderConditions();
			});
		});
	}

	private addCondition(): void {
		const firstColumn = this.options.columns[0] ?? 'status';
		this.conditions.push({ column: firstColumn, operator: 'equals', value: '' });
		this.renderConditions();
	}

	private renderSortRules(): void {
		this.sortContainer.empty();
		const availableColumns = this.options.columns;
		if (availableColumns.length === 0) {
			this.sortContainer.createEl('p', {
				text: 'No available columns. Sorting cannot be configured.',
				cls: 'tlb-filter-empty-hint'
			});
			return;
		}
		if (this.sortRules.length === 0) {
			this.sortContainer.createEl('p', {
				text: 'No sort rules yet. Use "Add sort" to configure.',
				cls: 'tlb-filter-empty-hint'
			});
			return;
		}

		this.sortRules.forEach((rule, index) => {
			const row = this.sortContainer.createDiv({ cls: 'tlb-filter-condition-row tlb-sort-rule-row' });
			row.draggable = true;
			row.setAttribute('data-index', String(index));
			row.addEventListener('dragstart', (event) => this.onSortDragStart(event, index));
			row.addEventListener('dragover', (event) => this.onSortDragOver(event, index));
			row.addEventListener('drop', (event) => this.onSortDrop(event, index));
			row.addEventListener('dragleave', () => row.classList.remove('is-drag-over'));
			row.addEventListener('dragend', () => this.onSortDragEnd());

			row.createSpan({ cls: 'tlb-sort-rule-handle', text: '::' }).setAttribute('aria-hidden', 'true');

			const columnSelect = row.createEl('select', { cls: 'tlb-filter-select' });
			availableColumns.forEach((col) => {
				const option = columnSelect.createEl('option', { text: col, value: col });
				if (col === rule.column) {
					option.selected = true;
				}
			});
			if (!availableColumns.includes(rule.column) && availableColumns.length > 0) {
				columnSelect.value = availableColumns[0];
				rule.column = availableColumns[0];
			}
			columnSelect.addEventListener('change', () => {
				rule.column = columnSelect.value;
			});

			const directionSelect = row.createEl('select', { cls: 'tlb-filter-select' });
			directionSelect.createEl('option', { text: 'Ascending (A → Z)', value: 'asc' });
			directionSelect.createEl('option', { text: 'Descending (Z → A)', value: 'desc' });
			directionSelect.value = rule.direction === 'desc' ? 'desc' : 'asc';
			directionSelect.addEventListener('change', () => {
				rule.direction = directionSelect.value === 'desc' ? 'desc' : 'asc';
			});

			const removeButton = row.createEl('button', { text: 'Remove', cls: 'mod-warning' });
			removeButton.style.marginLeft = 'auto';
			removeButton.addEventListener('click', () => {
				this.sortRules.splice(index, 1);
				this.renderSortRules();
			});
		});
	}

	private addSortRule(): void {
		const firstColumn = this.options.columns[0];
		if (!firstColumn) {
			return;
		}
		this.sortRules.push({ column: firstColumn, direction: 'asc' });
		this.renderSortRules();
	}

	private onSortDragStart(event: DragEvent, index: number): void {
		this.draggingSortIndex = index;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', String(index));
		}
		(event.currentTarget as HTMLElement | null)?.classList.add('is-dragging');
	}

	private onSortDragOver(event: DragEvent, index: number): void {
		event.preventDefault();
		if (this.draggingSortIndex === null || this.draggingSortIndex === index) {
			return;
		}
		(event.currentTarget as HTMLElement | null)?.classList.add('is-drag-over');
	}

	private onSortDrop(event: DragEvent, index: number): void {
		event.preventDefault();
		const fromIndex = this.draggingSortIndex;
		this.clearSortDragState();
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

	private onSortDragEnd(): void {
		this.clearSortDragState();
	}

	private clearSortDragState(): void {
		if (!this.sortContainer) {
			return;
		}
		this.draggingSortIndex = null;
		this.sortContainer.querySelectorAll('.tlb-sort-rule-row').forEach((row) => {
			row.classList.remove('is-drag-over', 'is-dragging');
		});
	}

	private submit(): void {
		const name = this.nameInputEl?.value?.trim();
		if (!name) {
			return;
		}
		if (this.conditions.length === 0) {
			return;
		}

		const rule: FilterRule = {
			conditions: this.conditions,
			combineMode: this.combineMode
		};

		const sortRules = this.sortRules.map((rule) => ({ ...rule }));
		this.options.onSubmit(name, rule, sortRules);
		this.options.onCancel = () => {};
		this.close();
	}

	onClose(): void {
		this.options.onCancel();
	}
}

export interface FilterViewNameModalOptions {
	title: string;
	placeholder: string;
	defaultValue: string;
	onSubmit: (value: string) => void;
	onCancel: () => void;
}

export class FilterViewNameModal extends Modal {
	private readonly options: FilterViewNameModalOptions;
	private inputEl!: HTMLInputElement;

	constructor(app: App, options: FilterViewNameModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(this.options.title);

		const setting = new Setting(contentEl);
		setting.setClass('tlb-filter-view-modal');
		setting.addText((text) => {
			text.setPlaceholder(this.options.placeholder);
			text.setValue(this.options.defaultValue);
			text.inputEl.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					event.stopPropagation();
					this.submit();
				}
			});
			this.inputEl = text.inputEl;
		});

		setting.addButton((button) => {
			button.setButtonText('Save');
			button.setCta();
			button.onClick(() => this.submit());
		});

		const cancelBtn = contentEl.createEl('button', { text: 'Cancel' });
		cancelBtn.addClass('mod-cta-secondary');
		cancelBtn.addEventListener('click', () => this.close());
	}

	onClose(): void {
		if (this.inputEl) {
			this.inputEl.blur();
		}
		this.options.onCancel();
	}

	private submit(): void {
		const value = this.inputEl?.value ?? '';
		this.options.onSubmit(value);
		this.options.onCancel = () => {};
		this.close();
	}
}

export function openFilterViewNameModal(app: App, options: { title: string; placeholder: string; defaultValue?: string }): Promise<string | null> {
	return new Promise((resolve) => {
		const modal = new FilterViewNameModal(app, {
			title: options.title,
			placeholder: options.placeholder,
			defaultValue: options.defaultValue ?? '',
			onSubmit: (value) => {
				const trimmed = value.trim();
				resolve(trimmed.length > 0 ? trimmed : null);
			},
			onCancel: () => resolve(null)
		});
		modal.open();
	});
}
