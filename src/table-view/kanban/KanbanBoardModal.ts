import { App, DropdownComponent, Setting } from 'obsidian';
import type { FilterRule } from '../../types/filterView';
import type { KanbanCardContentConfig, KanbanSortDirection } from '../../types/kanban';
import {
	DEFAULT_KANBAN_FONT_SCALE,
	DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT,
	MAX_KANBAN_INITIAL_VISIBLE_COUNT,
	MIN_KANBAN_INITIAL_VISIBLE_COUNT,
	DEFAULT_KANBAN_SORT_DIRECTION,
	MAX_KANBAN_FONT_SCALE,
	MIN_KANBAN_FONT_SCALE,
	parseKanbanFontScale,
	sanitizeKanbanFontScale,
	sanitizeKanbanInitialVisibleCount
} from '../../types/kanban';
import type { FilterColumnOption } from '../TableViewFilterPresenter';
import { FilterViewEditorModal } from '../filter/FilterViewModals';
import { renderContentSettingsEditor, type ContentEditorHandle } from './KanbanContentEditor';
import {
	cloneKanbanContentConfig,
	isKanbanContentConfigEffectivelyEmpty,
	resolveInitialKanbanContentConfig
} from './KanbanContentConfig';
import { t } from '../../i18n';
import {
	DEFAULT_KANBAN_LANE_WIDTH,
	MAX_KANBAN_LANE_WIDTH,
	MIN_KANBAN_LANE_WIDTH,
	parseKanbanLaneWidth,
	sanitizeKanbanLaneWidth
} from './kanbanWidth';

export interface KanbanBoardModalRequest {
	app: App;
	title: string;
	defaultName: string;
	defaultIcon: string | null;
	initialFilter: FilterRule | null;
	initialLaneField: string | null;
	initialLaneWidth: number | null;
	initialFontScale: number | null;
	initialVisibleCount: number | null;
	initialContent: KanbanCardContentConfig | null;
	columns: FilterColumnOption[];
	laneOptions: string[];
	sortFieldOptions: string[];
	initialSortField: string | null;
	initialSortDirection: KanbanSortDirection | null;
	getContentFields: () => string[];
}

export interface KanbanBoardModalResult {
	name: string;
	icon: string | null;
	laneField: string;
	laneWidth: number;
	fontScale: number;
	filterRule: FilterRule | null;
	initialVisibleCount: number;
	content: KanbanCardContentConfig | null;
	sortField: string | null;
	sortDirection: KanbanSortDirection;
}

export function openKanbanBoardModal(options: KanbanBoardModalRequest): Promise<KanbanBoardModalResult | null> {
	const laneOptions = options.laneOptions.length > 0 ? options.laneOptions : [''];
	let selectedLane =
		options.initialLaneField && laneOptions.includes(options.initialLaneField)
			? options.initialLaneField
			: laneOptions[0];
	let selectedLaneWidth = sanitizeKanbanLaneWidth(options.initialLaneWidth ?? null, DEFAULT_KANBAN_LANE_WIDTH);
	let selectedFontScale = sanitizeKanbanFontScale(
		options.initialFontScale ?? DEFAULT_KANBAN_FONT_SCALE,
		DEFAULT_KANBAN_FONT_SCALE
	);
	let initialVisibleCount = sanitizeKanbanInitialVisibleCount(
		options.initialVisibleCount ?? DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT,
		DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT
	);
	const sortOptions = Array.from(
		new Set(
			['', ...options.sortFieldOptions.filter((field) => typeof field === 'string' && field.trim().length > 0)]
		)
	);
	let selectedSortField =
		typeof options.initialSortField === 'string' && options.initialSortField.trim().length > 0
			? options.initialSortField.trim()
			: '';
	let selectedSortDirection: KanbanSortDirection =
		options.initialSortDirection === 'desc' ? 'desc' : DEFAULT_KANBAN_SORT_DIRECTION;
	const hasExplicitInitialContent =
		options.initialContent != null && !isKanbanContentConfigEffectivelyEmpty(options.initialContent);

	const getContentFields = () => options.getContentFields();

	let contentHandle: ContentEditorHandle | null = null;
	let contentDirty = false;
	let contentConfig = cloneKanbanContentConfig(
		resolveInitialKanbanContentConfig(options.initialContent, getContentFields(), selectedLane)
	);

	return new Promise((resolve) => {
		const modal = new FilterViewEditorModal(options.app, {
			title: options.title,
			columns: options.columns,
			initialName: options.defaultName,
			initialIcon: options.defaultIcon,
			initialRule: options.initialFilter,
			allowFilterEditing: true,
			allowSortEditing: false,
			minConditionCount: 0,
			layout: 'dual',
			renderAdditionalControls: (_container, context) => {
				const stylesCard = context.leftColumn.createDiv({
					cls: 'tlb-kanban-board-modal__card tlb-kanban-board-modal__card--styles'
				});
				const settingsGrid = stylesCard.createDiv({ cls: 'tlb-kanban-board-modal__grid' });

				const laneSetting = new Setting(settingsGrid);
				laneSetting.setName(t('kanbanView.toolbar.laneFieldLabel'));
				laneSetting.addDropdown((dropdown) => {
					for (const option of laneOptions) {
						dropdown.addOption(option, option);
					}
					dropdown.setValue(selectedLane);
					dropdown.onChange((value) => {
						selectedLane = value;
						if (!contentDirty && !hasExplicitInitialContent) {
							const defaults = resolveInitialKanbanContentConfig(
								null,
								getContentFields(),
								selectedLane
							);
							contentDirty = false;
							contentHandle?.update(defaults);
						} else {
							contentHandle?.refresh();
						}
					});
				});

				const widthSetting = new Setting(settingsGrid);
				widthSetting.setName(t('kanbanView.toolbar.laneWidthLabel'));
				widthSetting.setDesc(
					t('kanbanView.toolbar.laneWidthDescription', {
						min: String(MIN_KANBAN_LANE_WIDTH),
						max: String(MAX_KANBAN_LANE_WIDTH)
					})
				);
				let suppressWidthChange = false;
				widthSetting.addText((text) => {
					const syncDisplayValue = (value: number) => {
						suppressWidthChange = true;
						text.setValue(String(value));
						suppressWidthChange = false;
					};
					text.inputEl.type = 'number';
					text.inputEl.step = '0.5';
					text.inputEl.min = String(MIN_KANBAN_LANE_WIDTH);
					text.inputEl.max = String(MAX_KANBAN_LANE_WIDTH);
					syncDisplayValue(selectedLaneWidth);
					text.onChange((raw) => {
						if (suppressWidthChange) {
							return;
						}
						const trimmed = raw.trim();
						if (!trimmed) {
							text.inputEl.setAttribute('aria-invalid', 'true');
							return;
						}
						const parsed = parseKanbanLaneWidth(trimmed);
						if (parsed === null) {
							text.inputEl.setAttribute('aria-invalid', 'true');
							return;
						}
						text.inputEl.removeAttribute('aria-invalid');
						selectedLaneWidth = parsed;
					});
					text.inputEl.addEventListener('blur', () => {
						const parsed = parseKanbanLaneWidth(text.inputEl.value);
						const normalized =
							parsed === null
								? sanitizeKanbanLaneWidth(selectedLaneWidth, DEFAULT_KANBAN_LANE_WIDTH)
								: parsed;
						selectedLaneWidth = normalized;
						text.inputEl.removeAttribute('aria-invalid');
						syncDisplayValue(normalized);
					});
				});

				const fontScaleSetting = new Setting(settingsGrid);
				fontScaleSetting.setName(t('kanbanView.toolbar.fontScaleLabel'));
				fontScaleSetting.setDesc(
					t('kanbanView.toolbar.fontScaleDescription', {
						min: `${Math.round(MIN_KANBAN_FONT_SCALE * 100)}%`,
						max: `${Math.round(MAX_KANBAN_FONT_SCALE * 100)}%`
					})
				);
				let suppressFontScaleChange = false;
				fontScaleSetting.addText((text) => {
					const syncFontScaleValue = (value: number) => {
						suppressFontScaleChange = true;
						text.setValue(String(value));
						suppressFontScaleChange = false;
					};
					text.inputEl.type = 'number';
					text.inputEl.step = '0.05';
					text.inputEl.min = String(MIN_KANBAN_FONT_SCALE);
					text.inputEl.max = String(MAX_KANBAN_FONT_SCALE);
					syncFontScaleValue(selectedFontScale);
					text.onChange((raw) => {
						if (suppressFontScaleChange) {
							return;
						}
						const parsed = parseKanbanFontScale(raw);
						if (parsed === null) {
							text.inputEl.setAttribute('aria-invalid', 'true');
							return;
						}
						text.inputEl.removeAttribute('aria-invalid');
						selectedFontScale = parsed;
					});
					text.inputEl.addEventListener('blur', () => {
						selectedFontScale = sanitizeKanbanFontScale(selectedFontScale, DEFAULT_KANBAN_FONT_SCALE);
						text.inputEl.removeAttribute('aria-invalid');
						syncFontScaleValue(selectedFontScale);
					});
				});

				const countSetting = new Setting(settingsGrid);
				countSetting.setName(t('kanbanView.toolbar.initialVisibleCountLabel'));
				countSetting.setDesc(t('kanbanView.toolbar.initialVisibleCountDesc'));
				countSetting.addText((text) => {
					text.inputEl.type = 'number';
					text.inputEl.min = String(MIN_KANBAN_INITIAL_VISIBLE_COUNT);
					text.inputEl.max = String(MAX_KANBAN_INITIAL_VISIBLE_COUNT);
					text.setValue(String(initialVisibleCount));
					text.onChange((raw) => {
						const trimmed = raw.trim();
						if (!trimmed) {
							return;
						}
						initialVisibleCount = sanitizeKanbanInitialVisibleCount(trimmed, initialVisibleCount);
					});
					text.inputEl.addEventListener('blur', () => {
						initialVisibleCount = sanitizeKanbanInitialVisibleCount(initialVisibleCount);
						text.setValue(String(initialVisibleCount));
					});
				});

				const laneOrderCard = context.leftColumn.createDiv({
					cls: 'tlb-kanban-board-modal__card tlb-kanban-board-modal__lane-order'
				});
				const laneOrderHeader = laneOrderCard.createDiv({ cls: 'tlb-kanban-board-modal__lane-order-header' });
				laneOrderHeader.createSpan({
					cls: 'tlb-kanban-board-modal__card-title',
					text: t('kanbanView.toolbar.sortSettingLabel')
				});
				laneOrderHeader.createSpan({
					cls: 'tlb-kanban-board-modal__lane-order-desc',
					text: t('kanbanView.toolbar.sortSettingDesc')
				});
				const laneOrderControls = laneOrderCard.createDiv({ cls: 'tlb-kanban-board-modal__lane-order-controls' });
				const sortFieldDropdown = new DropdownComponent(laneOrderControls);
				sortFieldDropdown.selectEl.addClass('tlb-kanban-board-modal__select');
				sortFieldDropdown.selectEl.setAttr('aria-label', t('kanbanView.toolbar.sortFieldLabel'));
				for (const option of sortOptions) {
					const label = option.length > 0 ? option : t('kanbanView.toolbar.sortFieldNone');
					sortFieldDropdown.addOption(option, label);
				}
				if (!sortOptions.includes(selectedSortField)) {
					selectedSortField = '';
				}
				sortFieldDropdown.setValue(selectedSortField);
				sortFieldDropdown.onChange((value) => {
					selectedSortField = value;
				});

				const directionDropdown = new DropdownComponent(laneOrderControls);
				directionDropdown.selectEl.addClass('tlb-kanban-board-modal__select');
				directionDropdown.selectEl.setAttr('aria-label', t('kanbanView.toolbar.sortDirectionLabel'));
				directionDropdown.addOption('asc', t('kanbanView.toolbar.sortDirectionAsc'));
				directionDropdown.addOption('desc', t('kanbanView.toolbar.sortDirectionDesc'));
				directionDropdown.setValue(selectedSortDirection);
				directionDropdown.onChange((value) => {
					selectedSortDirection = value === 'desc' ? 'desc' : 'asc';
				});

				const contentColumn = context.rightColumn.createDiv({
					cls: 'tlb-kanban-board-modal__column tlb-kanban-board-modal__column--content'
				});
				const contentPanel = contentColumn.createDiv({ cls: 'tlb-kanban-board-modal__content-panel' });
				const contentContainer = contentPanel.createDiv({ cls: 'tlb-kanban-board-modal__content' });
				contentHandle = renderContentSettingsEditor({
					container: contentContainer,
					getFields: getContentFields,
					initialContent: cloneKanbanContentConfig(contentConfig),
					onChange: (next) => {
						contentConfig = cloneKanbanContentConfig(next);
					},
					onDirty: () => {
						contentDirty = true;
					}
				});
			},
			onSubmit: (result) => {
				const trimmed = result.name?.trim();
				if (!trimmed) {
					resolve(null);
					return;
				}
				const laneField = typeof selectedLane === 'string' ? selectedLane.trim() : '';
				const normalizedContent = cloneKanbanContentConfig(contentConfig);
				const persistedContent = isKanbanContentConfigEffectivelyEmpty(normalizedContent)
					? null
					: normalizedContent;
				const normalizedSortField = selectedSortField.trim();
				resolve({
					name: trimmed,
					icon: result.icon ?? null,
					laneField: laneField.length > 0 ? laneField : laneOptions[0],
					laneWidth: sanitizeKanbanLaneWidth(selectedLaneWidth, DEFAULT_KANBAN_LANE_WIDTH),
					fontScale: sanitizeKanbanFontScale(selectedFontScale, DEFAULT_KANBAN_FONT_SCALE),
					filterRule: result.filterRule ?? null,
					initialVisibleCount: sanitizeKanbanInitialVisibleCount(initialVisibleCount),
					content: persistedContent,
					sortField: normalizedSortField.length > 0 ? normalizedSortField : null,
					sortDirection: selectedSortDirection
				});
			},
			onCancel: () => resolve(null)
		});
		modal.open();
	});
}
