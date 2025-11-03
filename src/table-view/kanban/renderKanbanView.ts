import type { TableView } from '../../TableView';
import { t } from '../../i18n';
import { KanbanViewController } from './KanbanViewController';
import { resolveKanbanLaneSources } from './KanbanLaneResolver';

interface RenderKanbanViewOptions {
	primaryField: string | null;
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

	const columnNames = Array.isArray(schema.columnNames) ? schema.columnNames : [];
	const wrapper = container.createDiv({ cls: 'tlb-kanban-wrapper' });

	const controls = wrapper.createDiv({ cls: 'tlb-kanban-controls' });
	view.globalQuickFilterController.render(controls);

	const boardHost = wrapper.createDiv({ cls: 'tlb-kanban-board-host' });
	const lanes = resolveKanbanLaneSources(view);

	view.kanbanController = new KanbanViewController({
		view,
		container: boardHost,
		lanes,
		primaryField: options.primaryField,
		displayFields: columnNames
	});
}
