import type { TableView } from '../../TableView';
import { t } from '../../i18n';
import { KanbanViewController } from './KanbanViewController';

interface RenderKanbanViewOptions {
	primaryField: string | null;
	laneField: string;
	sortField: string | null;
	laneWidth: number;
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

	const hasLaneField = columnNames.includes(laneField);

	if (!hasLaneField) {
		container.createDiv({
			cls: 'tlb-kanban-warning',
			text: t('kanbanView.missingLaneField', { field: laneField })
		});
		return;
	}
	if (sortField && !columnNames.includes(sortField)) {
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
		sortField,
		fallbackLaneName: t('kanbanView.unassignedLaneLabel'),
		primaryField: options.primaryField,
		displayFields: columnNames,
		enableDrag: true,
		laneWidth: options.laneWidth
	});
}
