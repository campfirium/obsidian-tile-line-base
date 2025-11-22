import type { Schema } from './SchemaBuilder';
import type { TableDataStore } from './TableDataStore';
import { getLogger } from '../utils/logger';
import { isReservedColumnId } from '../grid/systemColumnUtils';
import type { TableHistoryManager, BlockSnapshot } from './TableHistoryManager';
import { ROW_ID_FIELD, type RowDragEndPayload } from '../grid/GridAdapter';

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
		const uniqueRowIndexes: number[] = [];
		const seenRows = new Set<number>();
		for (const rowIndex of rowIndexes) {
			if (!Number.isInteger(rowIndex)) {
				continue;
			}
			if (rowIndex < 0 || rowIndex >= blocks.length) {
				continue;
			}
			if (seenRows.has(rowIndex)) {
				continue;
			}
			seenRows.add(rowIndex);
			uniqueRowIndexes.push(rowIndex);
		}

		if (uniqueRowIndexes.length === 0) {
			return;
		}

		const normalizedValue = typeof value === 'string' ? value : String(value ?? '');

		const changedRows: number[] = [];
		const resolvedFocusField = this.resolveFocusField(options) ?? field;

		const recorded = this.history.captureCellChanges(
			uniqueRowIndexes.map((rowIndex) => ({ index: rowIndex, fields: [field] })),
			() => {
				for (const rowIndex of uniqueRowIndexes) {
					const block = blocks[rowIndex];
					if (!block) {
						continue;
					}
					const currentValue = block.data?.[field] ?? '';
					if (currentValue === normalizedValue) {
						continue;
					}
					if (this.dataStore.updateCell(rowIndex, field, normalizedValue)) {
						changedRows.push(rowIndex);
					}
				}
			},
			(changes) => {
				const explicitFocus = options?.focusRowIndex;
				const fallbackRowIndex =
					typeof explicitFocus === 'number'
						? explicitFocus
						: changes[0]?.index ?? uniqueRowIndexes[0] ?? null;
				if (fallbackRowIndex == null && resolvedFocusField == null) {
					return undefined;
				}
				return {
					undo: { rowIndex: fallbackRowIndex, field: resolvedFocusField },
					redo: { rowIndex: fallbackRowIndex, field: resolvedFocusField }
				};
			}
		);

		if (!recorded) {
			return;
		}

		this.refreshGridData();

		const focusRowIndex =
			typeof options?.focusRowIndex === 'number'
				? options.focusRowIndex
				: changedRows[0] ?? uniqueRowIndexes[0];
		if (typeof focusRowIndex === 'number') {
			this.focusRow(focusRowIndex, resolvedFocusField);
		}

		this.scheduleSave();
	}

	reorderRowsByDrag(event: RowDragEndPayload): void {
		if (!this.ensureSchema()) {
			return;
		}

		const blocks = this.dataStore.getBlocks();
		const sourceIndex = this.dataStore.getBlockIndexFromRow(event.draggedRow ?? undefined);
		let targetIndex = this.dataStore.getBlockIndexFromRow(event.targetRow ?? undefined);

		const displayedOrder = Array.isArray(event.displayedRowOrder) ? event.displayedRowOrder : null;
		if (displayedOrder && displayedOrder.length > 0 && sourceIndex !== null) {
			const sourceId =
				event.draggedRow && Object.prototype.hasOwnProperty.call(event.draggedRow, ROW_ID_FIELD)
					? String((event.draggedRow as any)[ROW_ID_FIELD])
					: String(sourceIndex);
			const destination = displayedOrder
				.map((value) => parseInt(String(value), 10))
				.findIndex((value) => !Number.isNaN(value) && String(value) === sourceId);
			if (destination >= 0) {
				const clampedDestination = this.clampIndex(destination, 0, blocks.length - 1);
				if (clampedDestination !== sourceIndex) {
					const placeAfter = clampedDestination > sourceIndex;
					this.reorderRow(sourceIndex, clampedDestination, placeAfter ? 'after' : 'before');
					return;
				}
			}
		}

		if (targetIndex === null) {
			if (typeof event.overIndex === 'number' && event.overIndex >= 0) {
				targetIndex = this.clampIndex(event.overIndex, 0, blocks.length - 1);
			} else if (blocks.length > 0) {
				// 当拖拽到空白区域时，AG Grid 可能不给出 targetRow/overIndex，默认落到末尾
				targetIndex = blocks.length - 1;
			}
		}

		if (sourceIndex === null || targetIndex === null) {
			return;
		}

		if (sourceIndex === targetIndex) {
			return;
		}

		const placeAfter = this.shouldPlaceAfter(event.direction, sourceIndex, targetIndex);
		this.reorderRow(sourceIndex, targetIndex, placeAfter ? 'after' : 'before');
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

	private reorderRow(sourceIndex: number, targetIndex: number, position: 'before' | 'after'): number | null {
		const blocks = this.dataStore.getBlocks();
		if (sourceIndex === targetIndex) {
			return null;
		}
		if (sourceIndex < 0 || sourceIndex >= blocks.length || targetIndex < 0 || targetIndex >= blocks.length) {
			return null;
		}

		const focusField = this.resolveFocusField();
		const [extracted] = blocks.splice(sourceIndex, 1);
		if (!extracted) {
			return null;
		}

		const normalizedTarget = targetIndex > sourceIndex ? targetIndex - 1 : targetIndex;
		const insertionIndex = this.clampIndex(
			position === 'after' ? normalizedTarget + 1 : normalizedTarget,
			0,
			blocks.length
		);

		blocks.splice(insertionIndex, 0, extracted);

		this.refreshGridData();
		this.focusRow(insertionIndex, focusField);
		this.scheduleSave();

		this.history.recordRowMove(
			{
				ref: extracted,
				fromIndex: sourceIndex,
				toIndex: insertionIndex
			},
			{
				undo: { rowIndex: sourceIndex, field: focusField ?? null },
				redo: { rowIndex: insertionIndex, field: focusField ?? null }
			}
		);

		return insertionIndex;
	}

	private shouldPlaceAfter(direction: 'up' | 'down' | null, sourceIndex: number, targetIndex: number): boolean {
		if (direction === 'down') {
			return true;
		}
		if (direction === 'up') {
			return false;
		}
		return targetIndex > sourceIndex;
	}

	private clampIndex(value: number, min: number, max: number): number {
		if (Number.isNaN(value)) {
			return min;
		}
		return Math.max(min, Math.min(max, value));
	}

}
