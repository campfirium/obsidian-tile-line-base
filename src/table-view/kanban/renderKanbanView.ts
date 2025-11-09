import type { TableView } from '../../TableView';
import type { KanbanCardContentConfig, KanbanHeightMode } from '../../types/kanban';
import { t } from '../../i18n';
import { KanbanViewController } from './KanbanViewController';

interface RenderKanbanViewOptions {
	primaryField: string | null;
	laneField: string;
	laneWidth: number;
	fontScale: number;
	sortField: string | null;
	heightMode: KanbanHeightMode;
	initialVisibleCount: number;
	content: KanbanCardContentConfig | null;
	lanePresets: string[];
}

export function renderKanbanView(
	view: TableView,
	container: HTMLElement,
	options: RenderKanbanViewOptions
): void {
	const schema = view.schema;
	if (!schema) {
		container.createDiv({
			cls: 'tlb-kanban-warning',
			text: t('kanbanView.schemaUnavailable')
		});
		return;
	}

	const columnNames = schema.columnNames ?? [];
	const laneField = options.laneField;
	const sortField = options.sortField;
	const hiddenFields = view.hiddenSortableFields ?? new Set<string>();

	const hasLaneField = columnNames.includes(laneField);

	if (!hasLaneField) {
		container.createDiv({
			cls: 'tlb-kanban-warning',
			text: t('kanbanView.missingLaneField', { field: laneField })
		});
		return;
	}
	if (sortField && !columnNames.includes(sortField) && !hiddenFields.has(sortField)) {
		container.createDiv({
			cls: 'tlb-kanban-warning',
			text: t('kanbanView.missingSortField', { field: sortField })
		});
		return;
	}

	const wrapper = container.createDiv({ cls: 'tlb-kanban-wrapper' });
	view.kanbanController = new KanbanViewController({
		view,
		container: wrapper,
		laneField,
		laneWidth: options.laneWidth,
		fontScale: options.fontScale,
		sortField,
		fallbackLaneName: t('kanbanView.unassignedLaneLabel'),
		primaryField: options.primaryField,
		displayFields: columnNames,
		lanePresets: options.lanePresets ?? [],
		enableDrag: true,
		heightMode: options.heightMode,
		initialVisibleCount: options.initialVisibleCount,
		contentConfig: options.content
	});
}
