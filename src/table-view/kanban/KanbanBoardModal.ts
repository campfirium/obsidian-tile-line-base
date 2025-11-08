import { App, Setting } from 'obsidian';
import type { FilterRule } from '../../types/filterView';
import type { KanbanCardContentConfig, KanbanSortDirection } from '../../types/kanban';
import {
	DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT,
	MAX_KANBAN_INITIAL_VISIBLE_COUNT,
	MIN_KANBAN_INITIAL_VISIBLE_COUNT,
	DEFAULT_KANBAN_SORT_DIRECTION,
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

export interface KanbanBoardModalRequest {
	app: App;
	title: string;
	defaultName: string;
	defaultIcon: string | null;
	initialFilter: FilterRule | null;
	initialLaneField: string | null;
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
			renderAdditionalControls: (container) => {
				const laneSetting = new Setting(container);
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

				const countSetting = new Setting(container);
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

				const sortSetting = new Setting(container);
				sortSetting.setName(t('kanbanView.toolbar.sortSettingLabel'));
				sortSetting.setDesc(t('kanbanView.toolbar.sortSettingDesc'));
				sortSetting.addDropdown((dropdown) => {
					for (const option of sortOptions) {
						const label =
							option.length > 0 ? option : t('kanbanView.toolbar.sortFieldNone');
						dropdown.addOption(option, label);
					}
					dropdown.setValue(selectedSortField);
					dropdown.onChange((value) => {
						selectedSortField = value;
					});
					dropdown.selectEl.setAttribute('aria-label', t('kanbanView.toolbar.sortFieldLabel'));
				});
				sortSetting.addDropdown((dropdown) => {
					dropdown.addOption('asc', t('kanbanView.toolbar.sortDirectionAsc'));
					dropdown.addOption('desc', t('kanbanView.toolbar.sortDirectionDesc'));
					dropdown.setValue(selectedSortDirection);
					dropdown.onChange((value) => {
						selectedSortDirection = value === 'desc' ? 'desc' : 'asc';
					});
					dropdown.selectEl.setAttribute('aria-label', t('kanbanView.toolbar.sortDirectionLabel'));
				});

				const contentContainer = container.createDiv({ cls: 'tlb-kanban-board-modal__content' });
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
