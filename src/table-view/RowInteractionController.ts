import type { Schema } from './SchemaBuilder';
import type { TableDataStore } from './TableDataStore';
import { getLogger } from '../utils/logger';
import { isReservedColumnId } from '../grid/systemColumnUtils';

const logger = getLogger('table-view:row-interaction');

interface RowActionOptions {
	focusField?: string | null;
}

interface FillColumnOptions extends RowActionOptions {
	focusRowIndex?: number;
}

interface RowInteractionDeps {
	dataStore: TableDataStore;
	getSchema: () => Schema | null;
	getFocusedField: () => string | null;
	refreshGridData: () => void;
	focusRow: (rowIndex: number, field?: string | null) => void;
	scheduleSave: () => void;
	getActiveFilterPrefills: () => Record<string, string>;
}

export class RowInteractionController {
	private readonly dataStore: TableDataStore;
	private readonly getSchema: () => Schema | null;
	private readonly getFocusedField: () => string | null;
	private readonly refreshGridData: () => void;
	private readonly focusRow: (rowIndex: number, field?: string | null) => void;
	private readonly scheduleSave: () => void;
	private readonly getActiveFilterPrefills: () => Record<string, string>;

	constructor(deps: RowInteractionDeps) {
		this.dataStore = deps.dataStore;
		this.getSchema = deps.getSchema;
		this.getFocusedField = deps.getFocusedField;
		this.refreshGridData = deps.refreshGridData;
		this.focusRow = deps.focusRow;
		this.scheduleSave = deps.scheduleSave;
		this.getActiveFilterPrefills = deps.getActiveFilterPrefills;
	}

	addRow(beforeRowIndex?: number, options?: RowActionOptions): void {
		if (!this.ensureSchema()) {
			return;
		}

		const focusField = this.resolveFocusField(options);
		const filterPrefills = this.getActiveFilterPrefills();
		const insertIndex = this.dataStore.addRow(beforeRowIndex, filterPrefills);
		if (insertIndex < 0) {
			logger.error('Failed to add new row');
			return;
		}

		this.refreshGridData();
		this.focusRow(insertIndex, focusField);
		this.scheduleSave();
	}

	deleteRow(rowIndex: number, options?: RowActionOptions): void {
		if (!this.ensureSchema()) {
			return;
		}

		const focusField = this.resolveFocusField(options);
		const nextIndex = this.dataStore.deleteRow(rowIndex);
		this.refreshGridData();

		if (nextIndex !== null && nextIndex >= 0) {
			this.focusRow(nextIndex, focusField);
		}

		this.scheduleSave();
	}

	deleteRows(rowIndexes: number[]): void {
		if (!this.ensureSchema()) {
			return;
		}
		if (rowIndexes.length === 0) {
			return;
		}

		const nextIndex = this.dataStore.deleteRows(rowIndexes);
		this.refreshGridData();

		if (nextIndex !== null && nextIndex >= 0) {
			this.focusRow(nextIndex);
		}

		this.scheduleSave();
	}

	duplicateRows(rowIndexes: number[], options?: RowActionOptions): void {
		if (!this.ensureSchema()) {
			return;
		}
		if (rowIndexes.length === 0) {
			return;
		}

		const focusField = this.resolveFocusField(options);
		const newIndex = this.dataStore.duplicateRows(rowIndexes);
		this.refreshGridData();

		if (newIndex !== null && newIndex >= 0) {
			this.focusRow(newIndex, focusField);
		}

		this.scheduleSave();
	}

	duplicateRow(rowIndex: number, options?: RowActionOptions): void {
		if (!this.ensureSchema()) {
			return;
		}

		const blocks = this.dataStore.getBlocks();
		if (rowIndex < 0 || rowIndex >= blocks.length) {
			logger.error('Invalid row index:', rowIndex);
			return;
		}

		const focusField = this.resolveFocusField(options);
		const newIndex = this.dataStore.duplicateRow(rowIndex);
		this.refreshGridData();

		if (newIndex !== null && newIndex >= 0) {
			this.focusRow(newIndex, focusField);
		}

		this.scheduleSave();
	}

	fillColumnWithValue(rowIndexes: number[], field: string, value: string, options?: FillColumnOptions): void {
		if (!this.ensureSchema()) {
			return;
		}
		if (!field || isReservedColumnId(field)) {
			return;
		}
		if (rowIndexes.length === 0) {
			return;
		}
		if (this.dataStore.isFormulaColumn(field)) {
			logger.warn('fillColumnWithValue ignored for formula column', field);
			return;
		}

		const blocks = this.dataStore.getBlocks();
		const normalizedValue = typeof value === 'string' ? value : String(value ?? '');

		let updated = false;
		for (const rowIndex of rowIndexes) {
			if (rowIndex < 0 || rowIndex >= blocks.length) {
				continue;
			}
			const currentValue = blocks[rowIndex]?.data?.[field] ?? '';
			if (currentValue === normalizedValue) {
				continue;
			}
			if (this.dataStore.updateCell(rowIndex, field, normalizedValue)) {
				updated = true;
			}
		}

		if (!updated) {
			return;
		}

		this.refreshGridData();

		const focusField = this.resolveFocusField(options) ?? field;
		const focusRowIndex = options?.focusRowIndex ?? rowIndexes[0];
		if (focusRowIndex !== null && focusRowIndex !== undefined) {
			this.focusRow(focusRowIndex, focusField);
		}

		this.scheduleSave();
	}

	private ensureSchema(): Schema | null {
		const schema = this.getSchema();
		if (!schema) {
			logger.error('Schema not initialized');
			return null;
		}
		return schema;
	}

	private resolveFocusField(options?: RowActionOptions): string | null {
		if (options && Object.prototype.hasOwnProperty.call(options, 'focusField')) {
			return options.focusField ?? null;
		}
		return this.getFocusedField();
	}
}
