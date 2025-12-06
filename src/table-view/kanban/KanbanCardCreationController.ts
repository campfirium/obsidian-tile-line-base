import type { TableView } from '../../TableView';
import { KanbanCardCreateModal } from './KanbanCardCreateModal';

export class KanbanCardCreationController {
	constructor(private readonly view: TableView, private readonly laneField: string) {}

	open(laneName: string): void {
		const schema = this.view.schema;
		if (!schema) {
			return;
		}
		const initialValues = this.buildInitialValues(laneName);
		const modal = new KanbanCardCreateModal({
			app: this.view.app,
			laneName,
			laneField: this.laneField,
			fields: schema.columnNames,
			initialValues,
			onSubmit: (values) => {
				this.handleSubmit(values);
			}
		});
		modal.open();
	}

	private buildInitialValues(laneName: string): Record<string, string> {
		const schema = this.view.schema;
		if (!schema) {
			return {};
		}
		const values: Record<string, string> = {};

		for (let i = 0; i < schema.columnNames.length; i++) {
			const field = schema.columnNames[i];
			if (typeof field !== 'string' || field.trim().length === 0) {
				continue;
			}
			if (field === this.laneField) {
				values[field] = laneName;
				continue;
			}
			values[field] = '';
		}
		return values;
	}

	private handleSubmit(values: Record<string, string>): void {
		const rowInteraction = this.view.rowInteractionController;
		if (!rowInteraction) {
			return;
		}
		const prefills: Record<string, string> = {};
		for (const [field, value] of Object.entries(values)) {
			prefills[field] = typeof value === 'string' ? value.trim() : '';
		}
		rowInteraction.addRow(undefined, { prefills, skipFocus: true });
	}
}
