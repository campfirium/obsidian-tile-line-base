import type { Schema } from './SchemaBuilder';
import type { TableDataStore } from './TableDataStore';
import type { H2Block } from './MarkdownBlockParser';
import { collectCascadeDeleteIndexes } from './DisplayListBuilder';
import { getLogger } from '../utils/logger';
import { isReservedColumnId } from '../grid/systemColumnUtils';
import type { TableHistoryManager, BlockSnapshot } from './TableHistoryManager';
import { ROW_ID_FIELD, type RowDragEndPayload } from '../grid/GridAdapter';
import { COLLAPSED_STATE_FIELD, ENTRY_ID_FIELD, PARENT_ENTRY_ID_FIELD } from './entryFields';
import { reorderBlocksPreservingHierarchy } from './HierarchySort';

const logger = getLogger('table-view:row-interaction');

interface RowActionOptions {
	focusField?: string | null;
	prefills?: Record<string, string>;
	skipFocus?: boolean;
}

interface FillColumnOptions extends RowActionOptions {
	focusRowIndex?: number;
}

type FallbackRowEntry = { index: number; ref: H2Block; snapshot: BlockSnapshot };

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
		const optionPrefills = options?.prefills ?? {};
		const mergedPrefills = { ...filterPrefills, ...optionPrefills };
		const insertIndex = this.dataStore.addRow(beforeRowIndex, mergedPrefills);
		if (insertIndex < 0) {
			logger.error('Failed to add new row');
			return;
		}

		this.refreshGridData();
		if (!options?.skipFocus) {
			this.focusRow(insertIndex, focusField);
		}
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

	addChildRow(parentRowIndex: number, options?: RowActionOptions): void {
		if (!this.ensureSchema()) {
			return;
		}

		const blocks = this.dataStore.getBlocks();
		if (parentRowIndex < 0 || parentRowIndex >= blocks.length) {
			logger.error('Invalid parent row index:', parentRowIndex);
			return;
		}

		const parentBlock = blocks[parentRowIndex];
		const parentEntryId = String(parentBlock?.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim();
		if (parentEntryId) {
			logger.warn('Ignored child entry creation for nested row', parentRowIndex);
			return;
		}

		const focusField = this.resolveFocusField(options);
		const filterPrefills = this.getActiveFilterPrefills();
		const optionPrefills = options?.prefills ?? {};
		const mergedPrefills = { ...filterPrefills, ...optionPrefills };
		const insertIndex = this.dataStore.addChildRow(parentRowIndex, mergedPrefills);
		if (insertIndex < 0) {
			logger.error('Failed to add child entry');
			return;
		}

		this.refreshGridData();
		if (!options?.skipFocus) {
			this.focusRow(insertIndex, focusField);
		}
		this.scheduleSave();

		const newBlock = this.dataStore.getBlocks()[insertIndex];
		if (!newBlock) {
			return;
		}

		this.history.recordRowInsertions(
			[{ index: insertIndex, ref: newBlock }],
			{
				undo: { rowIndex: parentRowIndex, field: focusField ?? null },
				redo: { rowIndex: insertIndex, field: focusField ?? null }
			}
		);
	}

	canIndentRow(rowIndex: number): boolean {
		const blocks = this.dataStore.getBlocks();
		const block = blocks[rowIndex];
		if (!block || rowIndex <= 0) {
			return false;
		}

		const parentEntryId = String(block.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim();
		if (parentEntryId) {
			return false;
		}

		const entryId = String(block.data?.[ENTRY_ID_FIELD] ?? '').trim();
		if (!entryId || this.hasDirectChildren(blocks, entryId)) {
			return false;
		}

		return this.findNearestPreviousTopLevelRowIndex(blocks, rowIndex) !== null;
	}

	canOutdentRow(rowIndex: number): boolean {
		const blocks = this.dataStore.getBlocks();
		const block = blocks[rowIndex];
		if (!block) {
			return false;
		}

		return String(block.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim().length > 0;
	}

	indentRow(rowIndex: number, options?: RowActionOptions): boolean {
		if (!this.ensureSchema() || !this.canIndentRow(rowIndex)) {
			return false;
		}

		const blocks = this.dataStore.getBlocks();
		const block = blocks[rowIndex];
		const parentRowIndex = this.findNearestPreviousTopLevelRowIndex(blocks, rowIndex);
		if (!block || parentRowIndex === null) {
			return false;
		}

		const parentBlock = blocks[parentRowIndex];
		const parentEntryId = String(parentBlock?.data?.[ENTRY_ID_FIELD] ?? '').trim();
		if (!parentBlock || !parentEntryId) {
			return false;
		}

		const focusField = this.resolveFocusField(options);
		const targets = [{ index: rowIndex, fields: [PARENT_ENTRY_ID_FIELD] }];
		const currentCollapsedState = String(parentBlock.data?.[COLLAPSED_STATE_FIELD] ?? 'false');
		if (currentCollapsedState !== 'false') {
			targets.push({ index: parentRowIndex, fields: [COLLAPSED_STATE_FIELD] });
		}

		const recorded = this.history.captureCellChanges(
			targets,
			() => {
				block.data[PARENT_ENTRY_ID_FIELD] = parentEntryId;
				parentBlock.data[COLLAPSED_STATE_FIELD] = 'false';
			},
			{
				undo: { rowIndex, field: focusField ?? null },
				redo: { rowIndex, field: focusField ?? null }
			}
		);

		if (!recorded) {
			return false;
		}

		this.refreshGridData();
		this.focusRow(rowIndex, focusField);
		this.scheduleSave();
		return true;
	}

	outdentRow(rowIndex: number, options?: RowActionOptions): boolean {
		if (!this.ensureSchema() || !this.canOutdentRow(rowIndex)) {
			return false;
		}

		const blocks = this.dataStore.getBlocks();
		const block = blocks[rowIndex];
		if (!block) {
			return false;
		}

		const focusField = this.resolveFocusField(options);
		const recorded = this.history.captureCellChanges(
			[{ index: rowIndex, fields: [PARENT_ENTRY_ID_FIELD] }],
			() => {
				block.data[PARENT_ENTRY_ID_FIELD] = '';
			},
			{
				undo: { rowIndex, field: focusField ?? null },
				redo: { rowIndex, field: focusField ?? null }
			}
		);

		if (!recorded) {
			return false;
		}

		this.refreshGridData();
		this.focusRow(rowIndex, focusField);
		this.scheduleSave();
		return true;
	}

	toggleRowCollapsed(rowIndex: number): void {
		if (!this.ensureSchema()) {
			return;
		}

		const blocks = this.dataStore.getBlocks();
		if (rowIndex < 0 || rowIndex >= blocks.length) {
			logger.error('Invalid row index for collapse toggle:', rowIndex);
			return;
		}

		const block = blocks[rowIndex];
		const parentEntryId = String(block?.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim();
		if (parentEntryId) {
			return;
		}

		const entryId = String(block?.data?.[ENTRY_ID_FIELD] ?? '').trim();
		if (!entryId || !this.hasDirectChildren(blocks, entryId)) {
			return;
		}

		const focusField = this.resolveFocusField();
		const recorded = this.history.captureCellChanges(
			[{ index: rowIndex, fields: [COLLAPSED_STATE_FIELD] }],
			() => {
				const current = String(block.data?.[COLLAPSED_STATE_FIELD] ?? 'false') === 'true';
				block.data[COLLAPSED_STATE_FIELD] = current ? 'false' : 'true';
			},
			{
				undo: { rowIndex, field: focusField ?? null },
				redo: { rowIndex, field: focusField ?? null }
			}
		);

		if (!recorded) {
			return;
		}

		this.refreshGridData();
		this.focusRow(rowIndex, focusField);
		this.scheduleSave();
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

		const deleteIndexes = collectCascadeDeleteIndexes(blocks, [rowIndex]);
		const snapshots = deleteIndexes.map((index) => ({
			index,
			snapshot: this.history.snapshotBlock(blocks[index])
		}));
		const focusField = this.resolveFocusField(options);
		const nextIndex = this.dataStore.deleteRow(rowIndex);
		const fallbackRow = this.ensureFallbackRow();
		const focusIndex =
			fallbackRow?.index ?? (nextIndex !== null && nextIndex >= 0 ? nextIndex : null);
		this.refreshGridData();

		if (focusIndex !== null && focusIndex >= 0) {
			this.focusRow(focusIndex, focusField);
		}

		this.scheduleSave();

		this.history.recordRowDeletions(
			snapshots,
			{
				focus: {
					undo: { rowIndex, field: focusField ?? null },
					redo:
						focusIndex !== null
							? { rowIndex: focusIndex, field: focusField ?? null }
							: { rowIndex: null, field: null }
				},
				fallbackRow: fallbackRow ?? undefined
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
		)
			.sort((a, b) => a - b);
		if (normalized.length === 0) {
			return;
		}

		const deleteIndexes = collectCascadeDeleteIndexes(blocks, normalized);
		const snapshots: Array<{ index: number; snapshot: BlockSnapshot }> = deleteIndexes.map((index) => ({
			index,
			snapshot: this.history.snapshotBlock(blocks[index])
		}));

		const nextIndex = this.dataStore.deleteRows(normalized);
		const fallbackRow = this.ensureFallbackRow();
		const focusIndex =
			fallbackRow?.index ?? (nextIndex !== null && nextIndex >= 0 ? nextIndex : null);
		this.refreshGridData();

		if (focusIndex !== null && focusIndex >= 0) {
			this.focusRow(focusIndex);
		}

		this.scheduleSave();

		this.history.recordRowDeletions(snapshots, {
			focus: {
				undo: { rowIndex: normalized[0], field: null },
				redo:
					focusIndex !== null
						? { rowIndex: focusIndex, field: null }
						: { rowIndex: null, field: null }
			},
			fallbackRow: fallbackRow ?? undefined
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
		const draggedIndexes =
			sourceIndex === null ? [] : this.collectDraggedRowIndexes(blocks, sourceIndex);
		const movesHierarchyBranch = draggedIndexes.length > 1;

		const displayedOrder = Array.isArray(event.displayedRowOrder) ? event.displayedRowOrder : null;
		const hasFullDisplayedOrder = Array.isArray(displayedOrder) && displayedOrder.length === blocks.length;
		if (!hasFullDisplayedOrder) {
			// 过滤/排序视图下不处理拖拽，避免影响隐藏行顺序
			return;
		}
		if (hasFullDisplayedOrder && sourceIndex !== null && movesHierarchyBranch) {
			const orderedBlocks = this.buildOrderedBlocksFromDisplayedOrder(blocks, displayedOrder);
			if (!orderedBlocks || this.isSameBlockOrder(blocks, orderedBlocks)) {
				return;
			}
			const focusField = this.resolveFocusField();
			const sourceBlock = blocks[sourceIndex] ?? null;
			const nextIndex = sourceBlock ? orderedBlocks.indexOf(sourceBlock) : -1;
			this.history.applyRowOrderChange(orderedBlocks, {
				undo: { rowIndex: sourceIndex, field: focusField ?? null },
				redo: { rowIndex: nextIndex >= 0 ? nextIndex : sourceIndex, field: focusField ?? null }
			});
			return;
		}
		if (hasFullDisplayedOrder && sourceIndex !== null && !movesHierarchyBranch) {
			const sourceId =
				event.draggedRow && Object.prototype.hasOwnProperty.call(event.draggedRow, ROW_ID_FIELD)
					? String(event.draggedRow[ROW_ID_FIELD])
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

	private ensureFallbackRow(): FallbackRowEntry | null {
		const blocks = this.dataStore.getBlocks();
		if (blocks.length > 0) {
			return null;
		}
		const insertIndex = this.dataStore.addRow(null, this.getActiveFilterPrefills());
		if (insertIndex < 0) {
			logger.error('Failed to add fallback row after deletion');
			return null;
		}
		const newBlock = this.dataStore.getBlocks()[insertIndex];
		if (!newBlock) {
			logger.error('Fallback row missing after insertion');
			return null;
		}
		return {
			index: insertIndex,
			ref: newBlock,
			snapshot: this.history.snapshotBlock(newBlock)
		};
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

		const draggedIndexes = this.collectDraggedRowIndexes(blocks, sourceIndex);
		if (draggedIndexes.length === 0) {
			return null;
		}
		if (draggedIndexes.includes(targetIndex)) {
			return null;
		}

		const orderedBlocks = this.buildReorderedBlockList(blocks, draggedIndexes, targetIndex, position);
		if (!orderedBlocks) {
			return null;
		}

		const movedBlocks = draggedIndexes
			.map((index) => blocks[index])
			.filter((block): block is H2Block => Boolean(block));
		const anchorBlock = movedBlocks[0] ?? null;
		if (!anchorBlock) {
			return null;
		}
		const orderedInsertionIndex = orderedBlocks.indexOf(anchorBlock);
		if (orderedInsertionIndex < 0) {
			return null;
		}

		const focusField = this.resolveFocusField();
		this.history.applyRowOrderChange(orderedBlocks, {
			undo: { rowIndex: sourceIndex, field: focusField ?? null },
			redo: { rowIndex: orderedInsertionIndex, field: focusField ?? null }
		});

		const reorderedBlocks = this.dataStore.getBlocks();
		const insertionIndex = reorderedBlocks.indexOf(anchorBlock);
		if (insertionIndex < 0) {
			return null;
		}

		const hierarchyChanges =
			movedBlocks.length > 1
				? []
				: this.syncDraggedRowHierarchyAfterReorder(reorderedBlocks, insertionIndex, anchorBlock);

		if (hierarchyChanges.length === 0) {
			this.focusRow(insertionIndex, focusField);
		} else {
			this.refreshGridData();
			this.focusRow(insertionIndex, focusField);
			this.scheduleSave();
		}

		if (hierarchyChanges.length > 0) {
			this.history.recordCellChanges(hierarchyChanges, {
				undo: { rowIndex: insertionIndex, field: focusField ?? null },
				redo: { rowIndex: insertionIndex, field: focusField ?? null }
			});
		}

		return insertionIndex;
	}

	private syncDraggedRowHierarchyAfterReorder(
		blocks: H2Block[],
		rowIndex: number,
		block: H2Block
	): Array<{ ref: H2Block; index: number; field: string; oldValue: string; newValue: string }> {
		const changes: Array<{ ref: H2Block; index: number; field: string; oldValue: string; newValue: string }> = [];
		const currentParentEntryId = String(block.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim();
		const entryId = String(block.data?.[ENTRY_ID_FIELD] ?? '').trim();
		const hasChildren = entryId.length > 0 && this.hasDirectChildren(blocks, entryId);

		let nextParentEntryId = '';
		let nextParentBlock: H2Block | null = null;
		let nextParentRowIndex: number | null = null;

		if (!hasChildren) {
			nextParentRowIndex = this.findNearestPreviousTopLevelRowIndex(blocks, rowIndex);
			if (nextParentRowIndex !== null) {
				nextParentBlock = blocks[nextParentRowIndex] ?? null;
				nextParentEntryId = String(nextParentBlock?.data?.[ENTRY_ID_FIELD] ?? '').trim();
				if (!nextParentEntryId) {
					nextParentBlock = null;
					nextParentRowIndex = null;
				}
			}
		}

		if (nextParentEntryId !== currentParentEntryId) {
			block.data[PARENT_ENTRY_ID_FIELD] = nextParentEntryId;
			changes.push({
				ref: block,
				index: rowIndex,
				field: PARENT_ENTRY_ID_FIELD,
				oldValue: currentParentEntryId,
				newValue: nextParentEntryId
			});
		}

		if (nextParentBlock && nextParentRowIndex !== null) {
			const currentCollapsedState = String(nextParentBlock.data?.[COLLAPSED_STATE_FIELD] ?? 'false');
			if (currentCollapsedState !== 'false') {
				nextParentBlock.data[COLLAPSED_STATE_FIELD] = 'false';
				changes.push({
					ref: nextParentBlock,
					index: nextParentRowIndex,
					field: COLLAPSED_STATE_FIELD,
					oldValue: currentCollapsedState,
					newValue: 'false'
				});
			}
		}

		return changes;
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

	private findNearestPreviousTopLevelRowIndex(blocks: H2Block[], rowIndex: number): number | null {
		for (let index = rowIndex - 1; index >= 0; index--) {
			const parentEntryId = String(blocks[index]?.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim();
			if (!parentEntryId) {
				return index;
			}
		}
		return null;
	}

	private hasDirectChildren(blocks: H2Block[], entryId: string): boolean {
		for (const block of blocks) {
			if (String(block?.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim() === entryId) {
				return true;
			}
		}
		return false;
	}

	private collectDraggedRowIndexes(blocks: H2Block[], sourceIndex: number): number[] {
		const sourceBlock = blocks[sourceIndex];
		if (!sourceBlock) {
			return [];
		}

		const sourceParentEntryId = String(sourceBlock.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim();
		if (sourceParentEntryId) {
			return [sourceIndex];
		}

		const sourceEntryId = String(sourceBlock.data?.[ENTRY_ID_FIELD] ?? '').trim();
		if (!sourceEntryId) {
			return [sourceIndex];
		}

		const draggedIndexes = [sourceIndex];
		for (let index = 0; index < blocks.length; index++) {
			if (index === sourceIndex) {
				continue;
			}
			if (String(blocks[index]?.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim() === sourceEntryId) {
				draggedIndexes.push(index);
			}
		}

		return draggedIndexes.sort((left, right) => left - right);
	}

	private buildReorderedBlockList(
		blocks: H2Block[],
		draggedIndexes: number[],
		targetIndex: number,
		position: 'before' | 'after'
	): H2Block[] | null {
		const targetBlock = blocks[targetIndex];
		if (!targetBlock) {
			return null;
		}

		const orderedBlocks = [...blocks];
		const draggedIndexSet = new Set<number>(draggedIndexes);
		const movedBlocks = draggedIndexes
			.map((index) => blocks[index])
			.filter((block): block is H2Block => Boolean(block));
		if (movedBlocks.length === 0) {
			return null;
		}

		for (let index = orderedBlocks.length - 1; index >= 0; index--) {
			if (draggedIndexSet.has(index)) {
				orderedBlocks.splice(index, 1);
			}
		}

		const normalizedTargetIndex = orderedBlocks.indexOf(targetBlock);
		if (normalizedTargetIndex < 0) {
			return null;
		}

		const insertionIndex = this.clampIndex(
			position === 'after' ? normalizedTargetIndex + 1 : normalizedTargetIndex,
			0,
			orderedBlocks.length
		);
		orderedBlocks.splice(insertionIndex, 0, ...movedBlocks);
		return orderedBlocks;
	}

	private buildOrderedBlocksFromDisplayedOrder(
		blocks: H2Block[],
		displayedOrder: Array<string | number>
	): H2Block[] | null {
		const blockByRowId = new Map<string, H2Block>();
		for (let index = 0; index < blocks.length; index++) {
			const block = blocks[index];
			if (block) {
				blockByRowId.set(String(index), block);
			}
		}

		const rawOrderedBlocks: H2Block[] = [];
		for (const rowId of displayedOrder) {
			const block = blockByRowId.get(String(rowId));
			if (!block) {
				return null;
			}
			rawOrderedBlocks.push(block);
		}

		if (rawOrderedBlocks.length !== blocks.length) {
			return null;
		}

		return reorderBlocksPreservingHierarchy(rawOrderedBlocks);
	}

	private isSameBlockOrder(current: H2Block[], next: H2Block[]): boolean {
		if (current.length !== next.length) {
			return false;
		}
		for (let index = 0; index < current.length; index++) {
			if (current[index] !== next[index]) {
				return false;
			}
		}
		return true;
	}

}
