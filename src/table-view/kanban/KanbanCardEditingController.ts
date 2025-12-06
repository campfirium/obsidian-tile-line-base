import type { RowData } from '../../grid/GridAdapter';
import { ROW_ID_FIELD } from '../../grid/GridAdapter';
import type { TableView } from '../../TableView';
import { t } from '../../i18n';
import { getCurrentLocalDateTime } from '../../utils/datetime';
import { KanbanCardCreateModal } from './KanbanCardCreateModal';

interface KanbanCardDescriptor {
	rowIndex: number;
	row: RowData;
}

export class KanbanCardEditingController {
	constructor(private readonly view: TableView, private readonly laneField: string) {}

	open(card: KanbanCardDescriptor): void {
		const schema = this.view.schema;
		if (!schema) {
			return;
		}
		const rowIndex = card.rowIndex;
		if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= this.view.blocks.length) {
			return;
		}
		const fields = Array.isArray(schema.columnNames) ? schema.columnNames : [];
		if (fields.length === 0) {
			return;
		}

		const initialValues = this.buildInitialValues(rowIndex, card.row, fields);
		const laneValue = initialValues[this.laneField] ?? '';

		const modal = new KanbanCardCreateModal({
			app: this.view.app,
			laneName: laneValue,
			laneField: this.laneField,
			fields,
			initialValues,
			title: t('kanbanView.cardEditModal.title'),
			submitLabel: t('kanbanView.cardEditModal.submitLabel'),
			onSubmit: (values) => {
				this.applyEdits(rowIndex, values);
			}
		});
		modal.open();
	}

	private buildInitialValues(rowIndex: number, row: RowData, fields: string[]): Record<string, string> {
		const values: Record<string, string> = {};
		const block = this.view.blocks[rowIndex];
		for (const field of fields) {
			const normalizedField = typeof field === 'string' ? field.trim() : '';
			if (!normalizedField) {
				continue;
			}
			values[normalizedField] = this.normalizeValue(
				(block?.data ?? {})[normalizedField] ?? row?.[normalizedField]
			);
		}
		if (!Object.prototype.hasOwnProperty.call(values, this.laneField)) {
			values[this.laneField] = this.normalizeValue(row?.[this.laneField]);
		}
		return values;
	}

	private applyEdits(rowIndex: number, payload: Record<string, string>): void {
		const schema = this.view.schema;
		if (!schema) {
			return;
		}
		if (rowIndex < 0 || rowIndex >= this.view.blocks.length) {
			return;
		}
		const block = this.view.blocks[rowIndex];
		if (!block) {
			return;
		}

		const allowedFields = new Set(
			(schema.columnNames ?? []).filter((field): field is string => typeof field === 'string')
		);
		const sanitizedUpdates = new Map<string, string>();
		for (const [field, value] of Object.entries(payload)) {
			const normalizedField = typeof field === 'string' ? field.trim() : '';
			if (!normalizedField || normalizedField === ROW_ID_FIELD || !allowedFields.has(normalizedField)) {
				continue;
			}
			const normalizedValue = this.normalizeValue(value);
			const currentValue = this.normalizeValue(block.data?.[normalizedField]);
			if (currentValue === normalizedValue) {
				continue;
			}
			sanitizedUpdates.set(normalizedField, normalizedValue);
		}

		if (sanitizedUpdates.size === 0) {
			return;
		}

		const targetFields = new Set<string>();
		for (const field of sanitizedUpdates.keys()) {
			targetFields.add(field);
			if (field === 'status') {
				targetFields.add('statusChanged');
			}
		}
		const focusField = sanitizedUpdates.keys().next().value ?? null;

		const recorded = this.view.historyManager.captureCellChanges(
			[{ index: rowIndex, fields: Array.from(targetFields) }],
			() => {
				const target = this.view.blocks[rowIndex];
				if (!target) {
					return;
				}
				for (const [field, value] of sanitizedUpdates.entries()) {
					target.data[field] = value;
					if (field === 'status') {
						target.data['statusChanged'] = getCurrentLocalDateTime();
					}
				}
			},
			{
				undo: { rowIndex, field: focusField },
				redo: { rowIndex, field: focusField }
			}
		);

		if (!recorded) {
			return;
		}

		this.view.filterOrchestrator?.refresh();
		this.view.markUserMutation('kanban-card-edit');
		this.view.persistenceService?.scheduleSave();
	}

	private normalizeValue(value: unknown): string {
		if (typeof value === 'string') {
			return value;
		}
		if (value === null || value === undefined) {
			return '';
		}
		return String(value);
	}
}
