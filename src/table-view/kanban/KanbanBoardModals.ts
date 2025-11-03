import { App, Modal, Notice, Setting } from 'obsidian';
import type { FilterRule } from '../../types/filterView';
import type { FilterColumnOption } from '../TableViewFilterPresenter';
import { FilterViewEditorModal } from '../filter/FilterViewModals';
import { t } from '../../i18n';
import {
	DEFAULT_KANBAN_LANE_WIDTH,
	MAX_KANBAN_LANE_WIDTH,
	MIN_KANBAN_LANE_WIDTH,
	parseKanbanLaneWidth,
	sanitizeKanbanLaneWidth
} from './kanbanWidth';
import {
	DEFAULT_KANBAN_SORT_DIRECTION,
	DEFAULT_KANBAN_SORT_FIELD,
	type KanbanSortDirection
} from '../../types/kanban';

export interface KanbanBoardEditorOptions {
	app: App;
	title: string;
	defaultName: string;
	defaultIcon: string | null;
	initialFilter: FilterRule | null;
	initialLaneField: string | null;
	initialLaneWidth: number | null;
	initialSortField: string | null;
	initialSortDirection: KanbanSortDirection | null;
	columns: FilterColumnOption[];
	laneOptions: string[];
	sortFieldOptions: string[];
}

export interface KanbanBoardEditorResult {
	name: string;
	icon: string | null;
	laneField: string;
	filterRule: FilterRule | null;
	laneWidth: number;
	sortField: string;
	sortDirection: KanbanSortDirection;
}

export async function openKanbanBoardEditor(
	options: KanbanBoardEditorOptions
): Promise<KanbanBoardEditorResult | null> {
	const { app, columns, laneOptions } = options;
	if (!columns.length) {
		new Notice(t('filterViewController.noColumns'));
		return null;
	}
	if (!laneOptions.length) {
		new Notice(t('kanbanView.fieldModal.noColumns'));
		return null;
	}

	let selectedLane =
		options.initialLaneField && laneOptions.includes(options.initialLaneField)
			? options.initialLaneField
			: laneOptions[0];
	let selectedLaneWidth = sanitizeKanbanLaneWidth(options.initialLaneWidth, DEFAULT_KANBAN_LANE_WIDTH);
	const sortOptions = options.sortFieldOptions.length > 0 ? options.sortFieldOptions : [DEFAULT_KANBAN_SORT_FIELD];
	let selectedSortField =
		options.initialSortField && sortOptions.includes(options.initialSortField)
			? options.initialSortField
			: sortOptions.includes(DEFAULT_KANBAN_SORT_FIELD)
			? DEFAULT_KANBAN_SORT_FIELD
			: sortOptions[0];
	let selectedSortDirection =
		options.initialSortDirection === 'asc' || options.initialSortDirection === 'desc'
			? options.initialSortDirection
			: DEFAULT_KANBAN_SORT_DIRECTION;

	return new Promise((resolve) => {
		const modal = new FilterViewEditorModal(app, {
			title: options.title,
			columns,
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
					});
				});

				const widthSetting = new Setting(container);
				widthSetting.setName(t('kanbanView.toolbar.laneWidthLabel'));
				widthSetting.setDesc(
					t('kanbanView.toolbar.laneWidthDescription', {
						min: String(MIN_KANBAN_LANE_WIDTH),
						max: String(MAX_KANBAN_LANE_WIDTH)
					})
				);
				let suppressWidthChange = false;
				widthSetting.addText((text) => {
					const syncDisplayValue = (componentValue: string) => {
						suppressWidthChange = true;
						text.setValue(componentValue);
						suppressWidthChange = false;
					};
					text.inputEl.type = 'number';
					text.inputEl.step = '0.5';
					text.inputEl.min = String(MIN_KANBAN_LANE_WIDTH);
					text.inputEl.max = String(MAX_KANBAN_LANE_WIDTH);
					syncDisplayValue(String(selectedLaneWidth));
					text.onChange((value) => {
						if (suppressWidthChange) {
							return;
						}
						const trimmed = value.trim();
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
						const parsedOnBlur = parseKanbanLaneWidth(text.inputEl.value);
						const normalized =
							parsedOnBlur === null
								? sanitizeKanbanLaneWidth(selectedLaneWidth, DEFAULT_KANBAN_LANE_WIDTH)
								: sanitizeKanbanLaneWidth(parsedOnBlur, DEFAULT_KANBAN_LANE_WIDTH);
						selectedLaneWidth = normalized;
						text.inputEl.removeAttribute('aria-invalid');
						syncDisplayValue(String(normalized));
					});
				});

				const sortSetting = new Setting(container);
				sortSetting.setName(t('kanbanView.toolbar.sortSettingLabel'));
				sortSetting.setDesc(t('kanbanView.toolbar.sortSettingDescription'));
				sortSetting.addDropdown((dropdown) => {
					for (const option of sortOptions) {
						dropdown.addOption(option, option);
					}
					dropdown.setValue(selectedSortField);
					dropdown.onChange((value) => {
						selectedSortField = value;
					});
					dropdown.selectEl.setAttribute('aria-label', t('kanbanView.toolbar.sortFieldLabel'));
				});
				sortSetting.addDropdown((dropdown) => {
					dropdown.addOption('desc', t('kanbanView.toolbar.sortDirectionDesc'));
					dropdown.addOption('asc', t('kanbanView.toolbar.sortDirectionAsc'));
					dropdown.setValue(selectedSortDirection);
					dropdown.onChange((value) => {
						selectedSortDirection = value === 'asc' ? 'asc' : 'desc';
					});
					dropdown.selectEl.setAttribute('aria-label', t('kanbanView.toolbar.sortDirectionLabel'));
				});
			},
			onSubmit: (result) => {
				const trimmed = result.name?.trim();
				if (!trimmed) {
					resolve(null);
					return;
				}
				const laneField = typeof selectedLane === 'string' ? selectedLane.trim() : '';
				resolve({
					name: trimmed,
					icon: result.icon ?? null,
					laneField: laneField.length > 0 ? laneField : laneOptions[0],
					filterRule: result.filterRule ?? null,
					laneWidth: sanitizeKanbanLaneWidth(selectedLaneWidth, DEFAULT_KANBAN_LANE_WIDTH),
					sortField: selectedSortField,
					sortDirection: selectedSortDirection
				});
			},
			onCancel: () => resolve(null)
		});
		modal.open();
	});
}

export async function confirmKanbanBoardDeletion(app: App, boardName: string): Promise<boolean> {
	return new Promise((resolve) => {
		const modal = new KanbanBoardConfirmModal(app, {
			message: t('kanbanView.toolbar.deleteBoardConfirm', { name: boardName }),
			onConfirm: () => resolve(true),
			onCancel: () => resolve(false)
		});
		modal.open();
	});
}

class KanbanBoardConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly options: { message: string; onConfirm: () => void; onCancel: () => void }
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tlb-kanban-confirm-modal');
		contentEl.createEl('p', { text: this.options.message });

		const controls = new Setting(contentEl);
		controls.addButton((button) => {
			button.setButtonText(t('kanbanView.toolbar.deleteBoardConfirmAction'));
			button.setCta();
			button.onClick(() => {
				this.close();
				this.options.onConfirm();
			});
		});
		controls.addButton((button) => {
			button.setButtonText(t('filterViewModals.cancelButton'));
			button.onClick(() => {
				this.close();
				this.options.onCancel();
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
