import { App, Modal, Setting, setIcon } from 'obsidian';
import type { FilterCondition, FilterOperator, FilterRule, SortRule } from '../../types/filterView';
import { t } from '../../i18n';
import type { FilterColumnOption } from '../TableViewFilterPresenter';
import { getStatusDisplayLabel } from './statusDefaults';
import { getOperatorLabelKey, getOperatorsForOption, VALUELESS_OPERATORS } from './FilterOperatorUtils';
import { FALLBACK_LUCIDE_ICON_IDS } from './IconCatalog';

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
	private iconInputEl!: HTMLInputElement;
	private iconMatchesEl: HTMLElement | null = null;
	private iconPage = 0;
	private iconQueryNormalized = '';
	private iconValue: string | null = null;
	private iconSelectionId: string | null = null;
	private iconOptions: string[] = [];
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
		this.iconValue = this.sanitizeIconId(options.initialIcon);
		this.iconSelectionId = this.iconValue ? this.resolveCanonicalIconId(this.iconValue) : null;
		if (this.iconSelectionId) {
			this.iconValue = this.iconSelectionId;
		}
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
		const isDualLayout = this.layout === 'dual';
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

		const nameSetting = new Setting(isDualLayout ? leftColumn : contentEl);
		nameSetting.setName(t('filterViewModals.viewNameLabel'));
		nameSetting.addText((text) => {
			text.setPlaceholder(t('filterViewModals.viewNamePlaceholder'));
			if (this.options.initialName) {
				text.setValue(this.options.initialName);
			}
			this.nameInputEl = text.inputEl;
		});

		const iconSetting = new Setting(isDualLayout ? leftColumn : contentEl);
		iconSetting.setName('');
		iconSetting.setDesc('');
		if (iconSetting.descEl) {
			iconSetting.descEl.remove();
		}
		if (iconSetting.nameEl) {
			iconSetting.nameEl.remove();
		}
		iconSetting.settingEl.addClass('tlb-filter-view-icon-setting');
		iconSetting.controlEl.empty();
		iconSetting.controlEl.addClass('tlb-filter-view-icon-control');

		const searchRow = iconSetting.controlEl.createDiv({ cls: 'tlb-filter-view-icon-header-row' });
		searchRow.createSpan({
			cls: 'tlb-filter-view-icon-title',
			text: t('filterViewModals.iconLabel')
		});
		const searchField = searchRow.createDiv({ cls: 'tlb-filter-view-icon-search-field' });
		const searchIcon = searchField.createSpan({ cls: 'tlb-filter-view-icon-search-field__icon' });
		setIcon(searchIcon, 'search');
		searchIcon.setAttribute('aria-hidden', 'true');
		this.iconInputEl = searchField.createEl('input', {
			type: 'text',
			cls: 'tlb-filter-view-icon-search-field__input',
			placeholder: t('filterViewModals.iconPlaceholder')
		});
		this.iconInputEl.value = this.iconValue ?? '';
		this.iconInputEl.addEventListener('input', () => this.handleIconInput(this.iconInputEl!.value));

		this.iconMatchesEl = iconSetting.controlEl.createDiv({ cls: 'tlb-filter-view-icon-matches' });

		this.renderIconMatches(this.iconInputEl.value);

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
				cls: 'tlb-filter-view-modal__remove-button',
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
				cls: 'tlb-filter-view-modal__remove-button',
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

	private handleIconInput(value: string): void {
		const sanitized = this.sanitizeIconId(value);
		this.iconValue = sanitized;
		if (!sanitized) {
			this.iconSelectionId = null;
		} else {
			const canonical = this.resolveCanonicalIconId(sanitized);
			if (canonical) {
				this.iconSelectionId = canonical;
				this.iconValue = canonical;
				if (this.iconInputEl && this.iconInputEl.value !== canonical) {
					this.iconInputEl.value = canonical;
				}
			} else {
				this.iconSelectionId = null;
			}
		}
		this.renderIconMatches(value);
	}

	private setIconValue(value: string | null): void {
		const sanitized = this.sanitizeIconId(value);
		const canonical = sanitized ? this.resolveCanonicalIconId(sanitized) : null;
		this.iconSelectionId = canonical ?? null;
		this.iconValue = canonical ?? sanitized;
		if (this.iconInputEl) {
			this.iconInputEl.value = this.iconValue ?? '';
		}
		this.renderIconMatches(this.iconInputEl?.value ?? '');
	}

	private ensureIconOptions(): string[] {
		if (this.iconOptions.length === 0) {
			this.iconOptions = collectLucideIconIds(this.app);
		}
		return this.iconOptions;
	}

	private renderIconMatches(query: string): boolean {
		if (!this.iconMatchesEl) {
			return false;
		}
		const icons = this.ensureIconOptions();
		const normalizedQuery = normalizeIconQuery(query) ?? '';
		if (normalizedQuery !== this.iconQueryNormalized) {
			this.iconPage = 0;
			this.iconQueryNormalized = normalizedQuery;
		}

		type IconMatch = { iconId: string; score: number };
		const matches: IconMatch[] = [];
		if (!normalizedQuery) {
			icons.forEach((iconId, index) => {
				matches.push({ iconId, score: index });
			});
		} else {
			for (const iconId of icons) {
				const normalizedIcon = normalizeIconQuery(iconId);
				if (normalizedIcon === normalizedQuery) {
					matches.push({ iconId, score: -100 });
					continue;
				}
				const directIndex = normalizedIcon.indexOf(normalizedQuery);
				if (directIndex !== -1) {
					matches.push({ iconId, score: directIndex });
					continue;
				}
				const fuzzyScore = getFuzzyMatchScore(normalizedIcon, normalizedQuery);
				if (fuzzyScore !== null) {
					matches.push({ iconId, score: 1000 + fuzzyScore });
				}
			}
		}

		matches.sort((a, b) => a.score - b.score || a.iconId.localeCompare(b.iconId));
		const results = matches.map((match) => match.iconId);

		this.iconMatchesEl.empty();
		if (results.length === 0) {
			this.iconMatchesEl.createSpan({
				cls: 'tlb-filter-view-icon-matches__empty',
				text: t('filterViewModals.iconMatchesEmpty')
			});
			return false;
		}

		const pageCount = Math.max(1, Math.ceil(results.length / ICON_MATCHES_PER_PAGE));
		if (this.iconPage >= pageCount) {
			this.iconPage = pageCount - 1;
		}
		const row = this.iconMatchesEl.createDiv({ cls: 'tlb-filter-view-icon-matches-row' });
		const grid = row.createDiv({ cls: 'tlb-filter-view-icon-matches-grid' });
		const start = this.iconPage * ICON_MATCHES_PER_PAGE;
		const visible = results.slice(start, start + ICON_MATCHES_PER_PAGE);
		const selectedNormalized = this.iconSelectionId ? normalizeIconQuery(this.iconSelectionId) : null;

		visible.forEach((iconId) => {
			const button = grid.createEl('button', {
				type: 'button',
				cls: 'tlb-filter-view-icon-match'
			});
			button.setAttribute('aria-label', t('filterViewModals.iconMatchAriaLabel', { icon: iconId }));
			const iconSpan = button.createSpan({ cls: 'tlb-filter-view-icon-match__icon' });
			setIcon(iconSpan, iconId);
			if (selectedNormalized && normalizeIconQuery(iconId) === selectedNormalized) {
				button.classList.add('is-active');
			}
			button.addEventListener('click', () => {
				this.setIconValue(iconId);
				this.iconInputEl?.focus();
			});
		});

		const placeholdersNeeded = ICON_MATCHES_PER_PAGE - visible.length;
		for (let index = 0; index < placeholdersNeeded; index += 1) {
			grid.createSpan({ cls: 'tlb-filter-view-icon-placeholder' });
		}

		grid.createSpan({ cls: 'tlb-filter-view-icon-grid-spacer' });

		const prev = grid.createEl('button', {
			type: 'button',
			cls: 'tlb-filter-view-icon-match tlb-filter-view-icon-nav tlb-filter-view-icon-nav--prev'
		});
		prev.setAttribute('aria-label', t('filterViewModals.iconNavPrev'));
		setIcon(prev, 'chevron-left');
		prev.disabled = pageCount <= 1 || this.iconPage === 0;
		prev.addEventListener('click', () => {
			if (this.iconPage > 0) {
				this.iconPage -= 1;
				this.renderIconMatches(this.iconInputEl?.value ?? '');
			}
		});

		const next = grid.createEl('button', {
			type: 'button',
			cls: 'tlb-filter-view-icon-match tlb-filter-view-icon-nav tlb-filter-view-icon-nav--right'
		});
		next.setAttribute('aria-label', t('filterViewModals.iconNavNext'));
		setIcon(next, 'chevron-right');
		next.disabled = pageCount <= 1 || this.iconPage >= pageCount - 1;
		next.addEventListener('click', () => {
			if (this.iconPage < pageCount - 1) {
				this.iconPage += 1;
				this.renderIconMatches(this.iconInputEl?.value ?? '');
			}
		});

		return true;
	}

	private resolveCanonicalIconId(value: string | null): string | null {
		if (!value) {
			return null;
		}
		const normalized = normalizeIconQuery(value);
		if (!normalized) {
			return null;
		}
		const icons = this.ensureIconOptions();
		for (const iconId of icons) {
			if (normalizeIconQuery(iconId) === normalized) {
				return iconId;
			}
		}
		return null;
	}

	private sanitizeIconId(value: unknown): string | null {
		if (typeof value !== 'string') {
			return null;
		}
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : null;
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
			icon: this.iconSelectionId,
			filterRule,
			sortRules
		});
		this.options.onCancel = () => undefined;
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

function collectLucideIconIds(app: App): string[] {
	const iconIds = new Set<string>();
	try {
		const manager = (app as unknown as { dom?: { appIconManager?: unknown } })?.dom?.appIconManager as {
			getIconIds?: () => string[] | undefined;
			icons?: Record<string, unknown>;
		} | undefined;
		const pushIds = (ids: Iterable<string> | undefined) => {
			if (!ids) {
				return;
			}
			for (const id of ids) {
				if (typeof id === 'string') {
					const trimmed = id.trim();
					if (trimmed) {
						iconIds.add(trimmed);
					}
				}
			}
		};
		if (manager) {
			const managerIds = manager.getIconIds?.();
			pushIds(managerIds);
			if (!managerIds && manager.icons) {
				pushIds(Object.keys(manager.icons));
			}
		}
		const appWindow = window as unknown as {
			app?: { dom?: { appIconManager?: { getIconIds?: () => string[]; icons?: Record<string, unknown> } } };
			getIconIds?: () => string[];
		};
		const globalManager = appWindow?.app?.dom?.appIconManager;
		if (globalManager && globalManager !== manager) {
			pushIds(globalManager.getIconIds?.());
			if (globalManager.icons) {
				pushIds(Object.keys(globalManager.icons));
			}
		}
		if (typeof appWindow.getIconIds === 'function') {
			pushIds(appWindow.getIconIds());
		}
	} catch {
		// ignore
	}

	if (iconIds.size === 0) {
		FALLBACK_LUCIDE_ICON_IDS.forEach((id) => iconIds.add(id));
	}
	return Array.from(iconIds).sort();
}

function normalizeIconQuery(value: string): string {
	return value.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function getFuzzyMatchScore(value: string, query: string): number | null {
	if (!query) {
		return 0;
	}
	let score = 0;
	let searchIndex = 0;
	for (const char of query) {
		const foundIndex = value.indexOf(char, searchIndex);
		if (foundIndex === -1) {
			return null;
		}
		score += foundIndex - searchIndex;
		searchIndex = foundIndex + 1;
	}
	score += Math.max(0, value.length - searchIndex);
	return score;
}

const ICON_MATCHES_PER_PAGE = 27;

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
			button.setButtonText(t('filterViewModals.saveButton'));
			button.setCta();
			button.onClick(() => this.submit());
		});

		const cancelBtn = contentEl.createEl('button', { text: t('filterViewModals.cancelButton') });
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
		this.options.onCancel = () => undefined;
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

