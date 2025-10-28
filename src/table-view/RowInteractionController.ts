import type { Schema } from './SchemaBuilder';
import type { TableDataStore } from './TableDataStore';
import { getLogger } from '../utils/logger';
import { isReservedColumnId } from '../grid/systemColumnUtils';
import type { TableHistoryManager, BlockSnapshot } from './TableHistoryManager';

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
	history: TableHistoryManager;
}

export class RowInteractionController {
	private readonly dataStore: TableDataStore;
	private readonly getSchema: () => Schema | null;
	private readonly getFocusedField: () => string | null;
	private readonly refreshGridData: () => void;
	private readonly focusRow: (rowIndex: number, field?: string | null) => void;
	private readonly scheduleSave: () => void;
	private readonly getActiveFilterPrefills: () => Record<string, string>;
	private readonly history: TableHistoryManager;

	constructor(deps: RowInteractionDeps) {
		this.dataStore = deps.dataStore;
		this.getSchema = deps.getSchema;
		this.getFocusedField = deps.getFocusedField;
		this.refreshGridData = deps.refreshGridData;
		this.focusRow = deps.focusRow;
		this.scheduleSave = deps.scheduleSave;
		this.getActiveFilterPrefills = deps.getActiveFilterPrefills;
		this.history = deps.history;
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

		const blocks = this.dataStore.getBlocks();
		const newBlock = blocks[insertIndex];
		if (!newBlock) {
			return;
		}
		const undoRowIndex = insertIndex > 0 ? insertIndex - 1 : null;
		this.history.recordRowInsertions(
			[{ index: insertIndex, ref: newBlock }],
			{
				undo: undoRowIndex !== null ? { rowIndex: undoRowIndex, field: focusField ?? null } : undefined,
				redo: { rowIndex: insertIndex, field: focusField ?? null }
			}
		);
	}

	deleteRow(rowIndex: number, options?: RowActionOptions): void {
		if (!this.ensureSchema()) {
			return;
		}

		const blocks = this.dataStore.getBlocks();
		if (rowIndex < 0 || rowIndex >= blocks.length) {
			logger.error('Invalid row index:', rowIndex);
			return;
		}

		const snapshot = this.history.snapshotBlock(blocks[rowIndex]);
		const focusField = this.resolveFocusField(options);
		const nextIndex = this.dataStore.deleteRow(rowIndex);
		this.refreshGridData();

		if (nextIndex !== null && nextIndex >= 0) {
			this.focusRow(nextIndex, focusField);
		}

		this.scheduleSave();

		this.history.recordRowDeletions(
			[{ index: rowIndex, snapshot }],
			{
				undo: { rowIndex, field: focusField ?? null },
				redo:
					nextIndex !== null && nextIndex >= 0
						? { rowIndex: nextIndex, field: focusField ?? null }
						: { rowIndex: null, field: null }
			}
		);
	}

	deleteRows(rowIndexes: number[]): void {
		if (!this.ensureSchema()) {
			return;
		}
		if (rowIndexes.length === 0) {
			return;
		}

		const blocks = this.dataStore.getBlocks();
		const normalized = Array.from(
			new Set(
				rowIndexes
					.filter((index) => index >= 0 && index < blocks.length)
					.map((index) => index)
			)
		).sort((a, b) => a - b);
		if (normalized.length === 0) {
			return;
		}

		const snapshots: Array<{ index: number; snapshot: BlockSnapshot }> = normalized.map((index) => ({
			index,
			snapshot: this.history.snapshotBlock(blocks[index])
		}));

		const nextIndex = this.dataStore.deleteRows(normalized);
		this.refreshGridData();

		if (nextIndex !== null && nextIndex >= 0) {
			this.focusRow(nextIndex);
		}

		this.scheduleSave();

		this.history.recordRowDeletions(snapshots, {
			undo: { rowIndex: normalized[0], field: null },
			redo:
				nextIndex !== null && nextIndex >= 0
					? { rowIndex: nextIndex, field: null }
					: { rowIndex: null, field: null }
		});
	}

	duplicateRows(rowIndexes: number[], options?: RowActionOptions): void {
		if (!this.ensureSchema()) {
			return;
		}
		if (rowIndexes.length === 0) {
			return;
		}

		const focusField = this.resolveFocusField(options);
		const blocksBefore = this.dataStore.getBlocks();
		const normalized = Array.from(
			new Set(
				rowIndexes
					.filter((index) => index >= 0 && index < blocksBefore.length)
					.map((index) => index)
			)
		).sort((a, b) => a - b);
		if (normalized.length === 0) {
			return;
		}

		const newIndex = this.dataStore.duplicateRows(normalized);
		this.refreshGridData();

		if (newIndex !== null && newIndex >= 0) {
			this.focusRow(newIndex, focusField);
		}

		this.scheduleSave();

		const blocksAfter = this.dataStore.getBlocks();
		const inserted = normalized
			.map((index) => {
				const targetIndex = index + 1;
				const ref = blocksAfter[targetIndex];
				if (!ref) {
					return null;
				}
				return { index: targetIndex, ref };
			})
			.filter((entry): entry is { index: number; ref: typeof blocksAfter[number] } => entry !== null);

		if (inserted.length > 0) {
			const redoFocusIndex = newIndex ?? inserted[0].index;
			this.history.recordRowInsertions(inserted, {
				undo: { rowIndex: normalized[0], field: focusField ?? null },
				redo: { rowIndex: redoFocusIndex, field: focusField ?? null }
			});
		}
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

		if (newIndex !== null && newIndex >= 0) {
			const blocksAfter = this.dataStore.getBlocks();
			const newBlock = blocksAfter[newIndex];
			if (newBlock) {
				this.history.recordRowInsertions(
					[{ index: newIndex, ref: newBlock }],
					{
						undo: { rowIndex, field: focusField ?? null },
						redo: { rowIndex: newIndex, field: focusField ?? null }
					}
				);
			}
		}
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
		const changes: Array<{
			ref: typeof blocks[number];
			index: number;
			field: string;
			oldValue: string;
			newValue: string;
		}> = [];

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
				const blockRef = blocks[rowIndex];
				if (blockRef) {
					changes.push({
						ref: blockRef,
						index: rowIndex,
						field,
						oldValue: currentValue,
						newValue: normalizedValue
					});
				}
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

		if (changes.length > 0) {
			const firstChangeIndex = changes[0]?.index ?? null;
			const targetRowIndex =
				typeof focusRowIndex === 'number'
					? focusRowIndex
					: firstChangeIndex ?? rowIndexes[0];
			this.history.recordCellChanges(
				changes.map((change) => ({
					ref: change.ref,
					index: change.index,
					field: change.field,
					oldValue: change.oldValue,
					newValue: change.newValue
				})),
				{
					undo: { rowIndex: targetRowIndex, field: focusField },
					redo: { rowIndex: targetRowIndex, field: focusField }
				}
			);
		}
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
