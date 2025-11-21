import { App, Modal, Setting, setIcon } from 'obsidian';
import type { FilterCondition, FilterOperator, FilterRule, SortRule } from '../../types/filterView';
import { t } from '../../i18n';
import type { FilterColumnOption } from '../TableViewFilterPresenter';
import { getStatusDisplayLabel } from './statusDefaults';
import { getOperatorLabelKey, getOperatorsForOption, VALUELESS_OPERATORS } from './FilterOperatorUtils';
import { createIconPicker, type IconPickerHandle } from '../icon/IconPicker';
import { sanitizeIconId } from '../icon/IconUtils';

export interface FilterViewEditorResult {
	name: string;
	icon: string | null;
	filterRule: FilterRule | null;
	sortRules: SortRule[];
}

export interface FilterViewAdditionalControlsContext {
	leftColumn: HTMLElement;
	rightColumn: HTMLElement;
	layout: 'single' | 'dual';
}

export interface FilterViewEditorModalOptions {
	title: string;
	columns: FilterColumnOption[];
	initialName?: string;
	initialIcon?: string | null;
	initialRule?: FilterRule | null;
	initialSortRules?: SortRule[] | null;
	allowFilterEditing?: boolean;
	allowSortEditing?: boolean;
	minConditionCount?: number;
	layout?: 'single' | 'dual';
	renderAdditionalControls?: (container: HTMLElement, context: FilterViewAdditionalControlsContext) => void;
	onSubmit: (result: FilterViewEditorResult) => void;
	onCancel: () => void;
}

export class FilterViewEditorModal extends Modal {
	private readonly options: FilterViewEditorModalOptions;
	private readonly layout: 'single' | 'dual';
	private nameInputEl!: HTMLInputElement;
	private iconPicker: IconPickerHandle | null = null;
	private iconValue: string | null = null;
	private readonly allowFilterEditing: boolean;
	private readonly allowSortEditing: boolean;
	private readonly minimumConditionCount: number;
	private readonly additionalControlsRenderer:
		| ((container: HTMLElement, context: FilterViewAdditionalControlsContext) => void)
		| null;
	private conditionsContainer: HTMLElement | null = null;
	private conditions: FilterCondition[] = [];
	private combineMode: 'AND' | 'OR' = 'AND';
	private sortContainer: HTMLElement | null = null;
	private sortRules: SortRule[] = [];
	private draggingSortIndex: number | null = null;

	constructor(app: App, options: FilterViewEditorModalOptions) {
		super(app);
		this.modalEl.addClass('tlb-filter-editor-modal-container');
		this.options = options;
		this.allowFilterEditing = options.allowFilterEditing !== false;
		this.allowSortEditing = options.allowSortEditing !== false;
		const minConditionsOption =
			typeof options.minConditionCount === 'number' ? Math.floor(options.minConditionCount) : null;
		this.minimumConditionCount = Math.max(
			0,
			minConditionsOption !== null ? minConditionsOption : this.allowFilterEditing ? 1 : 0
		);
		this.additionalControlsRenderer =
			typeof options.renderAdditionalControls === 'function' ? options.renderAdditionalControls : null;
		this.layout = options.layout === 'dual' ? 'dual' : 'single';
		this.iconValue = sanitizeIconId(options.initialIcon);
		if (options.initialRule && this.allowFilterEditing) {
			this.conditions = [...options.initialRule.conditions];
			this.combineMode = options.initialRule.combineMode;
		}
		if (this.allowSortEditing && options.initialSortRules && options.initialSortRules.length > 0) {
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
		contentEl.removeClass('tlb-filter-editor-modal--dual');
		const isDualLayout = this.layout === 'dual';
		if (isDualLayout) {
			this.modalEl.addClass('tlb-filter-editor-modal-container--dual');
			this.modalEl.removeClass('tlb-filter-editor-modal-container--single');
		} else {
			this.modalEl.addClass('tlb-filter-editor-modal-container--single');
			this.modalEl.removeClass('tlb-filter-editor-modal-container--dual');
		}
		let leftColumn = contentEl;
		let rightColumn = contentEl;
		if (isDualLayout) {
			contentEl.addClass('tlb-filter-editor-modal--dual');
			const columnsWrapper = contentEl.createDiv({ cls: 'tlb-filter-editor-modal__columns' });
			leftColumn = columnsWrapper.createDiv({
				cls: 'tlb-filter-editor-modal__column tlb-filter-editor-modal__column--left'
			});
			rightColumn = columnsWrapper.createDiv({
				cls: 'tlb-filter-editor-modal__column tlb-filter-editor-modal__column--right'
			});
		}
		this.titleEl.setText(this.options.title);

		const inlineControls = (isDualLayout ? leftColumn : contentEl).createDiv({
			cls: 'tlb-filter-inline-controls'
		});

		// Left column: Icon selector
		const iconColumn = inlineControls.createDiv({ cls: 'tlb-inline-icon-col' });
		iconColumn.createSpan({ cls: 'tlb-inline-field-label', text: t('filterViewModals.iconLabel') });
		const iconPickerHost = iconColumn.createDiv({ cls: 'tlb-icon-picker-host' });
		const pickerSlot = iconPickerHost.createDiv({ cls: 'tlb-icon-picker-slot' });
		const iconHint = iconPickerHost.createSpan({ cls: 'tlb-icon-picker-hint', text: '' });
		const updateIconHint = (value: string | null) => {
			iconHint.setText(value ? t('filterViewModals.iconPickerTooltip') : t('filterViewModals.iconPickerAdd'));
		};
		this.iconPicker = createIconPicker({
			app: this.app,
			container: pickerSlot,
			initialIcon: this.iconValue,
			onChange: (value) => {
				this.iconValue = value;
				updateIconHint(value);
			}
		});
		this.iconValue = this.iconPicker.getValue();
		updateIconHint(this.iconValue);

		// Right column: View name
		const nameColumn = inlineControls.createDiv({ cls: 'tlb-inline-name-col' });
		nameColumn.createSpan({ cls: 'tlb-inline-field-label', text: t('filterViewModals.viewNameLabel') });
		const nameInputWrapper = nameColumn.createDiv({ cls: 'tlb-inline-name-input' });
		this.nameInputEl = nameInputWrapper.createEl('input', {
			type: 'text',
			cls: 'tlb-inline-input',
			placeholder: t('filterViewModals.viewNamePlaceholder')
		});
		if (this.options.initialName) {
			this.nameInputEl.value = this.options.initialName;
		}

		if (this.additionalControlsRenderer) {
			const extraContainer = (isDualLayout ? leftColumn : contentEl).createDiv({
				cls: 'tlb-filter-editor-extra'
			});
			this.additionalControlsRenderer(extraContainer, {
				leftColumn,
				rightColumn,
				layout: this.layout
			});
			if (!extraContainer.hasChildNodes()) {
				extraContainer.remove();
			}
		}

		let filterPanel: HTMLElement | null = null;
		let filterBody: HTMLElement = isDualLayout ? rightColumn : contentEl;
		let filterFooter: HTMLElement | null = null;
		if (isDualLayout) {
			filterPanel = rightColumn.createDiv({ cls: 'tlb-filter-editor-panel' });
			const filterHeader = filterPanel.createDiv({ cls: 'tlb-filter-editor-panel__header' });
			filterHeader.createSpan({
				cls: 'tlb-filter-editor-panel__title',
				text: t('filterViewModals.conditionsHeading')
			});
			filterBody = filterPanel.createDiv({ cls: 'tlb-filter-editor-panel__body' });
			filterFooter = filterPanel.createDiv({ cls: 'tlb-filter-editor-panel__footer' });
		}

		if (this.allowFilterEditing) {
			if (!isDualLayout) {
				contentEl.createEl('h3', { text: t('filterViewModals.conditionsHeading') });
			}
			const modeSetting = new Setting(filterBody);
			modeSetting.setName(t('filterViewModals.combineModeLabel'));
			modeSetting.addDropdown((dropdown) => {
				dropdown.addOption('AND', t('filterViewModals.combineModeOptionAll'));
				dropdown.addOption('OR', t('filterViewModals.combineModeOptionAny'));
				dropdown.setValue(this.combineMode);
				dropdown.onChange((value) => {
					this.combineMode = value as 'AND' | 'OR';
				});
			});

			this.conditionsContainer = filterBody.createDiv({ cls: 'tlb-filter-conditions' });
			this.renderConditions();

			const addConditionHost = filterFooter ?? filterBody;
			const addConditionButton = addConditionHost.createEl('button', {
				text: t('filterViewModals.addConditionButton')
			});
			addConditionButton.addClass('tlb-filter-editor-add-condition');
			addConditionButton.addEventListener('click', () => this.addCondition());
		}

		if (this.allowSortEditing) {
			const sortHeadingParent = filterPanel ?? contentEl;
			sortHeadingParent.createEl('h3', { text: t('filterViewModals.sortHeading') });
			this.sortContainer = sortHeadingParent.createDiv({ cls: 'tlb-filter-conditions tlb-filter-sort' });
			this.renderSortRules();

			const addSortButton = sortHeadingParent.createEl('button', { text: t('filterViewModals.addSortButton') });
			addSortButton.addEventListener('click', () => this.addSortRule());
		}

		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
		const saveButton = buttonContainer.createEl('button', { text: t('filterViewModals.saveButton') });
		saveButton.addClass('mod-cta');
		saveButton.addEventListener('click', () => this.submit());

		const cancelButton = buttonContainer.createEl('button', { text: t('filterViewModals.cancelButton') });
		cancelButton.addEventListener('click', () => this.close());
	}

	private renderConditions(): void {
		const container = this.conditionsContainer;
		if (!container) {
			return;
		}
		container.empty();

		if (this.conditions.length === 0) {
			container.createEl('p', {
				text: t('filterViewModals.conditionsEmptyHint'),
				cls: 'tlb-filter-empty-hint'
			});
			return;
		}

		this.conditions.forEach((condition, index) => {
			const row = container.createDiv({ cls: 'tlb-filter-condition-row' });

			const columnSelect = row.createEl('select', { cls: 'tlb-filter-select' });
			const availableColumns = this.options.columns;
			availableColumns.forEach((option) => {
				const element = columnSelect.createEl('option', { text: option.name, value: option.name });
				if (option.name === condition.column) {
					element.selected = true;
				}
			});
			if (availableColumns.length > 0 && !availableColumns.some((option) => option.name === condition.column)) {
				const fallback = availableColumns[0].name;
				columnSelect.value = fallback;
				condition.column = fallback;
			}
			columnSelect.addEventListener('change', () => {
				condition.column = columnSelect.value;
				const nextOption = this.getColumnOption(condition.column);
				const operators = getOperatorsForOption(nextOption);
				if (!operators.includes(condition.operator)) {
					condition.operator = operators[0] ?? 'equals';
				}
				if (!this.operatorRequiresValue(condition.operator)) {
					delete condition.value;
				} else {
					const defaultValue = this.getDefaultValueForColumn(condition.column, condition.operator);
					if (defaultValue !== undefined) {
						condition.value = defaultValue;
					}
				}
				this.renderConditions();
			});

			const operatorSelect = row.createEl('select', { cls: 'tlb-filter-select' });
			const columnOption = this.getColumnOption(condition.column);
			const operators = getOperatorsForOption(columnOption);
			const effectiveOperators = operators.length > 0 ? operators : (['equals'] as FilterOperator[]);
			if (!effectiveOperators.includes(condition.operator)) {
				condition.operator = effectiveOperators[0] ?? 'equals';
			}
			effectiveOperators.forEach((operator) => {
				const labelKey = getOperatorLabelKey(columnOption, operator);
				const label = labelKey ? t(labelKey) : operator;
				const option = operatorSelect.createEl('option', { text: label, value: operator });
				if (operator === condition.operator) {
					option.selected = true;
				}
			});
			operatorSelect.addEventListener('change', () => {
				const nextOperator = operatorSelect.value as FilterOperator;
				condition.operator = nextOperator;
				if (!this.operatorRequiresValue(nextOperator)) {
					delete condition.value;
				} else if (condition.value == null) {
					const defaultValue = this.getDefaultValueForColumn(condition.column, nextOperator);
					if (defaultValue !== undefined) {
						condition.value = defaultValue;
					}
				}
				this.renderConditions();
			});

			if (this.operatorRequiresValue(condition.operator)) {
				if (columnOption.kind === 'status') {
					this.renderStatusValueInput(row, condition, columnOption);
				} else {
					this.renderValueInput(row, condition, columnOption);
				}
			}

			const removeButton = row.createEl('button', {
				type: 'button',
				cls: 'clickable-icon tlb-filter-view-modal__remove-button',
				attr: { 'aria-label': t('filterViewModals.removeButton') }
			});
			setIcon(removeButton, 'trash-2');
			removeButton.addEventListener('click', () => {
				this.conditions.splice(index, 1);
				this.renderConditions();
			});
		});
	}

	private getColumnOption(column: string): FilterColumnOption {
		const match = this.options.columns.find((option) => option.name === column);
		if (match) {
			return match;
		}
		return { name: column, kind: 'text', allowNumericOperators: true };
	}

	private operatorRequiresValue(operator: FilterOperator): boolean {
		return !VALUELESS_OPERATORS.has(operator);
	}

	private getDefaultValueForColumn(column: string, operator: FilterOperator): string | undefined {
		if (!this.operatorRequiresValue(operator)) {
			return undefined;
		}
		const option = this.getColumnOption(column);
		if (option.kind === 'status') {
			const statuses = this.getStatusOptions(option);
			return statuses.length > 0 ? statuses[0] : '';
		}
		return '';
	}

	private getStatusOptions(option: FilterColumnOption): string[] {
		if (Array.isArray(option.statusValues) && option.statusValues.length > 0) {
			return [...option.statusValues];
		}
		return [];
	}

	private renderStatusValueInput(row: HTMLElement, condition: FilterCondition, option: FilterColumnOption): void {
		const select = row.createEl('select', { cls: 'tlb-filter-select' });
		const values = this.getStatusOptions(option);
		const seen = new Set<string>();
		const currentValue = typeof condition.value === 'string' ? condition.value.trim() : '';

		values.forEach((value) => {
			const trimmed = value.trim();
			if (!trimmed) {
				return;
			}
			const key = trimmed.toLowerCase();
			if (seen.has(key)) {
				return;
			}
			seen.add(key);
			const label = getStatusDisplayLabel(trimmed);
			const opt = select.createEl('option', { text: label, value: trimmed });
			if (currentValue && key === currentValue.toLowerCase()) {
				opt.selected = true;
			}
		});

		if (currentValue && !seen.has(currentValue.toLowerCase())) {
			const opt = select.createEl('option', {
				text: getStatusDisplayLabel(currentValue),
				value: currentValue
			});
			opt.selected = true;
		}

		if (!currentValue) {
			if (values.length > 0) {
				select.value = values[0];
				condition.value = values[0];
			} else {
				condition.value = '';
			}
		}

		select.addEventListener('change', () => {
			condition.value = select.value;
		});
	}

	private renderValueInput(row: HTMLElement, condition: FilterCondition, option: FilterColumnOption): void {
		const inputType = option.kind === 'date' ? 'date' : option.kind === 'time' ? 'time' : 'text';
		const input = row.createEl('input', {
			type: inputType,
			cls: 'tlb-filter-input',
			placeholder: t('filterViewModals.valuePlaceholder')
		});
		const currentValue = typeof condition.value === 'string' ? condition.value : '';
		input.value = currentValue;
		condition.value = currentValue;
		if (option.allowNumericOperators && option.kind === 'text') {
			input.setAttribute('inputmode', 'decimal');
		}
		input.addEventListener('input', () => {
			condition.value = input.value;
		});
	}

	private addCondition(): void {
		if (!this.allowFilterEditing) {
			return;
		}
		const firstOption = this.options.columns[0];
		if (!firstOption) {
			return;
		}
		const operators = getOperatorsForOption(firstOption);
		const operator = operators[0] ?? 'equals';
		const condition: FilterCondition = {
			column: firstOption.name,
			operator
		};
		const defaultValue = this.getDefaultValueForColumn(firstOption.name, operator);
		if (defaultValue !== undefined) {
			condition.value = defaultValue;
		}
		this.conditions.push(condition);
		this.renderConditions();
	}

	private renderSortRules(): void {
		const container = this.sortContainer;
		if (!container) {
			return;
		}
		container.empty();
		const availableColumns = this.options.columns.map((option) => option.name);
		if (availableColumns.length === 0) {
			container.createEl('p', {
				text: t('filterViewModals.sortsNoColumnsHint'),
				cls: 'tlb-filter-empty-hint'
			});
			return;
		}
		if (this.sortRules.length === 0) {
			container.createEl('p', {
				text: t('filterViewModals.sortsEmptyHint'),
				cls: 'tlb-filter-empty-hint'
			});
			return;
		}

		this.sortRules.forEach((rule, index) => {
			const row = container.createDiv({ cls: 'tlb-filter-condition-row tlb-sort-rule-row' });
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
			directionSelect.createEl('option', { text: t('filterViewModals.sortDirectionAsc'), value: 'asc' });
			directionSelect.createEl('option', { text: t('filterViewModals.sortDirectionDesc'), value: 'desc' });
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
		if (!this.allowSortEditing) {
			return;
		}
		const firstColumn = this.options.columns[0]?.name;
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
		let filterRule: FilterRule | null = null;
		if (this.allowFilterEditing) {
			if (this.conditions.length < this.minimumConditionCount) {
				return;
			}
			if (this.conditions.length > 0) {
				filterRule = {
					conditions: this.conditions.map((condition) => ({ ...condition })),
					combineMode: this.combineMode
				};
			}
		}

		const sortRules = this.allowSortEditing ? this.sortRules.map((rule) => ({ ...rule })) : [];
		this.options.onSubmit({
			name,
			icon: this.iconValue ?? null,
			filterRule,
			sortRules
		});
		this.options.onCancel = () => undefined;
		this.close();
	}

	onClose(): void {
		this.iconPicker?.destroy();
		this.iconPicker = null;
		this.options.onCancel();
	}
}
