import type { Schema } from './SchemaBuilder';
import type { TableDataStore } from './TableDataStore';
import type { H2Block } from './MarkdownBlockParser';
import { collectCascadeDeleteIndexes } from './DisplayListBuilder';
import { getLogger } from '../utils/logger';
import { isReservedColumnId } from '../grid/systemColumnUtils';
import type { TableHistoryManager, BlockSnapshot } from './TableHistoryManager';
import type { RowDragEndPayload } from '../grid/GridAdapter';
import { COLLAPSED_STATE_FIELD, ENTRY_ID_FIELD, PARENT_ENTRY_ID_FIELD } from './entryFields';
import { appendDragDebugLog } from '../utils/dragDebugLog';

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
interface DragParentResolution {
	parentEntryId: string;
}

interface PartialSingleRowPlacement {
	parentResolution: DragParentResolution;
	targetIndex: number;
	position: 'before' | 'after';
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
	getCurrentFilePath: () => string | null;
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
	private readonly getCurrentFilePath: () => string | null;

	constructor(deps: RowInteractionDeps) {
		this.dataStore = deps.dataStore;
		this.getSchema = deps.getSchema;
		this.getFocusedField = deps.getFocusedField;
		this.refreshGridData = deps.refreshGridData;
		this.focusRow = deps.focusRow;
		this.scheduleSave = deps.scheduleSave;
		this.getActiveFilterPrefills = deps.getActiveFilterPrefills;
		this.history = deps.history;
		this.getCurrentFilePath = deps.getCurrentFilePath;
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
			logger.warn('ctrlEnter:addChildRow:missingSchema', { parentRowIndex });
			return;
		}

		const blocks = this.dataStore.getBlocks();
		if (parentRowIndex < 0 || parentRowIndex >= blocks.length) {
			logger.error('Invalid parent row index:', parentRowIndex);
			return;
		}

		const focusField = this.resolveFocusField(options);
		const filterPrefills = this.getActiveFilterPrefills();
		const optionPrefills = options?.prefills ?? {};
		const block = blocks[parentRowIndex];
		const parentEntryId = String(block?.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim();
		const insertContext = parentEntryId
			? this.buildSiblingInsertContext(blocks, parentRowIndex, parentEntryId)
			: this.buildFirstChildInsertContext(blocks, parentRowIndex);
		if (!insertContext) {
			logger.error('Failed to resolve child entry insertion context');
			return;
		}
		logger.warn('ctrlEnter:addChildRow:start', {
			parentRowIndex,
			focusField,
			parentEntryId: parentEntryId || null,
			insertIndex: insertContext.insertIndex
		});
		const mergedPrefills = {
			...filterPrefills,
			...insertContext.prefills,
			...optionPrefills
		};
		const insertIndex = this.dataStore.addRow(insertContext.insertIndex, mergedPrefills);
		if (insertIndex < 0) {
			logger.error('Failed to add child entry');
			return;
		}
		logger.warn('ctrlEnter:addChildRow:inserted', {
			parentRowIndex,
			insertIndex,
			focusField
		});

		if (insertContext.parentBlock) {
			insertContext.parentBlock.data[COLLAPSED_STATE_FIELD] = 'false';
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
				undo: { rowIndex: insertContext.undoRowIndex, field: focusField ?? null },
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
		this.logDragDebug('row-drag-end', {
			filePath: this.getCurrentFilePath(),
			sourceIndex,
			targetIndex,
			overIndex: event.overIndex,
			direction: event.direction,
			draggedIndexes,
			movesHierarchyBranch,
			hasFullDisplayedOrder,
			draggedRowId: event.draggedRow?.[ENTRY_ID_FIELD] ?? null,
			draggedRowParentEntryId: event.draggedRow?.[PARENT_ENTRY_ID_FIELD] ?? null,
			targetRowId: event.targetRow?.[ENTRY_ID_FIELD] ?? null,
			targetRowParentEntryId: event.targetRow?.[PARENT_ENTRY_ID_FIELD] ?? null,
			displayedRowOrder: displayedOrder
		});
		if (!hasFullDisplayedOrder && movesHierarchyBranch && sourceIndex !== null) {
			if (this.applyBranchPartialDisplayedOrder(blocks, sourceIndex, draggedIndexes, displayedOrder)) {
				return;
			}
			// If the partial branch handler couldn't resolve, do nothing —
			// we must not blindly reorder when hidden rows exist.
			return;
		}
		if (!hasFullDisplayedOrder && movesHierarchyBranch) {
			return;
		}
		if (hasFullDisplayedOrder && sourceIndex !== null && movesHierarchyBranch) {
			if (this.applyBranchDisplayedOrder(blocks, sourceIndex, draggedIndexes, displayedOrder)) {
				return;
			}
		}
		if (hasFullDisplayedOrder && sourceIndex !== null && !movesHierarchyBranch) {
			if (this.applySingleRowDisplayedOrder(blocks, sourceIndex, displayedOrder, targetIndex)) {
				return;
			}
		}
		if (!hasFullDisplayedOrder && sourceIndex !== null && !movesHierarchyBranch) {
			if (this.applySingleRowPartialDisplayedOrder(blocks, sourceIndex, displayedOrder)) {
				return;
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

	private buildFirstChildInsertContext(
		blocks: H2Block[],
		parentRowIndex: number
	): { insertIndex: number; prefills: Record<string, string>; parentBlock: H2Block; undoRowIndex: number } | null {
		const parentBlock = blocks[parentRowIndex];
		if (!parentBlock) {
			return null;
		}
		const entryId = String(parentBlock.data?.[ENTRY_ID_FIELD] ?? '').trim();
		if (!entryId) {
			return null;
		}
		return {
			insertIndex: parentRowIndex + 1,
			prefills: { [PARENT_ENTRY_ID_FIELD]: entryId },
			parentBlock,
			undoRowIndex: parentRowIndex
		};
	}

	private buildSiblingInsertContext(
		blocks: H2Block[],
		rowIndex: number,
		parentEntryId: string
	): { insertIndex: number; prefills: Record<string, string>; parentBlock: H2Block | null; undoRowIndex: number } | null {
		if (!parentEntryId) {
			return null;
		}
		const parentRowIndex = blocks.findIndex(
			(candidate) => String(candidate?.data?.[ENTRY_ID_FIELD] ?? '').trim() === parentEntryId
		);
		return {
			insertIndex: rowIndex + 1,
			prefills: { [PARENT_ENTRY_ID_FIELD]: parentEntryId },
			parentBlock: parentRowIndex >= 0 ? blocks[parentRowIndex] ?? null : null,
			undoRowIndex: rowIndex
		};
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
				: this.syncDraggedRowHierarchyAfterReorder(
					reorderedBlocks,
					insertionIndex,
					anchorBlock,
					this.resolveParentByPosition(reorderedBlocks, insertionIndex, String(anchorBlock.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim())
				);

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

	private applySingleRowPartialDisplayedOrder(
		blocks: H2Block[],
		sourceIndex: number,
		displayedOrder: Array<string | number> | null
	): boolean {
		const visibleBlocks = this.buildPartialOrderedBlocksFromDisplayedOrder(blocks, displayedOrder);
		const anchorBlock = blocks[sourceIndex] ?? null;
		if (!visibleBlocks || !anchorBlock) {
			return false;
		}

		const visibleIndex = visibleBlocks.indexOf(anchorBlock);
		if (visibleIndex < 0) {
			return false;
		}

		const previousVisibleBlock = visibleIndex > 0 ? visibleBlocks[visibleIndex - 1] ?? null : null;
		const nextVisibleBlock =
			visibleIndex < visibleBlocks.length - 1 ? visibleBlocks[visibleIndex + 1] ?? null : null;
		const placement = this.resolvePartialSingleRowPlacement(
			anchorBlock,
			blocks,
			previousVisibleBlock,
			nextVisibleBlock
		);
		const orderedBlocks = placement
			? this.buildReorderedBlockList(blocks, [sourceIndex], placement.targetIndex, placement.position)
			: null;

		if (!orderedBlocks || this.isSameBlockOrder(blocks, orderedBlocks)) {
			return false;
		}

		const orderedInsertionIndex = orderedBlocks.indexOf(anchorBlock);
		if (orderedInsertionIndex < 0) {
			return false;
		}

		const focusField = this.resolveFocusField();
		this.history.applyRowOrderChange(orderedBlocks, {
			undo: { rowIndex: sourceIndex, field: focusField ?? null },
			redo: { rowIndex: orderedInsertionIndex, field: focusField ?? null }
		});

		const reorderedBlocks = this.dataStore.getBlocks();
		const insertionIndex = reorderedBlocks.indexOf(anchorBlock);
		if (insertionIndex < 0) {
			return false;
		}

		const hierarchyChanges = this.syncDraggedRowHierarchyAfterReorder(
			reorderedBlocks,
			insertionIndex,
			anchorBlock,
			placement?.parentResolution ?? null
		);
		this.logDragDebug('single-row-partial-displayed-order', {
			filePath: this.getCurrentFilePath(),
			sourceIndex,
			visibleIndex,
			orderedInsertionIndex,
			insertionIndex,
			anchorEntryId: anchorBlock.data?.[ENTRY_ID_FIELD] ?? null,
			anchorParentEntryIdBefore: anchorBlock.data?.[PARENT_ENTRY_ID_FIELD] ?? null,
			previousVisibleEntryId: previousVisibleBlock?.data?.[ENTRY_ID_FIELD] ?? null,
			previousVisibleParentEntryId: previousVisibleBlock?.data?.[PARENT_ENTRY_ID_FIELD] ?? null,
			nextVisibleEntryId: nextVisibleBlock?.data?.[ENTRY_ID_FIELD] ?? null,
			nextVisibleParentEntryId: nextVisibleBlock?.data?.[PARENT_ENTRY_ID_FIELD] ?? null,
			placementTargetIndex: placement?.targetIndex ?? null,
			placementPosition: placement?.position ?? null,
			placementParentEntryId: placement?.parentResolution.parentEntryId ?? null,
			displayedOrder
		});

		if (hierarchyChanges.length === 0) {
			this.focusRow(insertionIndex, focusField);
			return true;
		}

		this.refreshGridData();
		this.focusRow(insertionIndex, focusField);
		this.scheduleSave();
		this.history.recordCellChanges(hierarchyChanges, {
			undo: { rowIndex: insertionIndex, field: focusField ?? null },
			redo: { rowIndex: insertionIndex, field: focusField ?? null }
		});
		return true;
	}

	/**
	 * Handle branch (parent + children) reorder in a partial (filtered /
	 * collapsed) view.  We use the visible blocks to find where the parent
	 * ended up among non-branch rows, then move the entire branch to that
	 * position in the full block list.
	 */
	private applyBranchPartialDisplayedOrder(
		blocks: H2Block[],
		sourceIndex: number,
		draggedIndexes: number[],
		displayedOrder: Array<string | number> | null
	): boolean {
		const visibleBlocks = this.buildPartialOrderedBlocksFromDisplayedOrder(blocks, displayedOrder);
		const anchorBlock = blocks[sourceIndex] ?? null;
		if (!visibleBlocks || !anchorBlock) {
			return false;
		}

		const visibleIndex = visibleBlocks.indexOf(anchorBlock);
		if (visibleIndex < 0) {
			return false;
		}

		const draggedIndexSet = new Set(draggedIndexes);
		const draggedBlockSet = new Set(draggedIndexes.map(i => blocks[i]).filter(Boolean));

		// Find the first non-branch visible row before the anchor.
		let targetBlock: H2Block | null = null;
		let position: 'before' | 'after' = 'after';
		for (let i = visibleIndex - 1; i >= 0; i--) {
			const b = visibleBlocks[i];
			if (b && !draggedBlockSet.has(b)) {
				targetBlock = b;
				position = 'after';
				break;
			}
		}
		if (!targetBlock) {
			for (let i = visibleIndex + 1; i < visibleBlocks.length; i++) {
				const b = visibleBlocks[i];
				if (b && !draggedBlockSet.has(b)) {
					targetBlock = b;
					position = 'before';
					break;
				}
			}
		}
		if (!targetBlock) {
			return false;
		}

		let targetIndex = blocks.indexOf(targetBlock);
		if (targetIndex < 0 || draggedIndexSet.has(targetIndex)) {
			return false;
		}

		// When a branch lands inside another parent's child group, redirect
		// it to after the last child of that group.
		const targetParentEntryId = String(targetBlock.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim();
		const targetEntryId = String(targetBlock.data?.[ENTRY_ID_FIELD] ?? '').trim();
		let groupParentEntryId = '';
		if (targetParentEntryId) {
			groupParentEntryId = targetParentEntryId;
		} else if (position === 'after' && targetEntryId) {
			const nextIdx = targetIndex + 1;
			const nextBlk = nextIdx < blocks.length ? blocks[nextIdx] : null;
			if (nextBlk && !draggedIndexSet.has(nextIdx)) {
				const nextPid = String(nextBlk.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim();
				if (nextPid === targetEntryId) {
					groupParentEntryId = targetEntryId;
				}
			}
		}
		if (groupParentEntryId) {
			const lastChildIdx = this.findLastChildIndexOfGroup(blocks, groupParentEntryId, draggedIndexSet);
			if (lastChildIdx >= 0) {
				targetBlock = blocks[lastChildIdx] ?? targetBlock;
				targetIndex = lastChildIdx;
				position = 'after';
			}
		}

		const orderedBlocks = this.buildReorderedBlockList(blocks, draggedIndexes, targetIndex, position);
		if (!orderedBlocks || this.isSameBlockOrder(blocks, orderedBlocks)) {
			return false;
		}

		const orderedInsertionIndex = orderedBlocks.indexOf(anchorBlock);
		if (orderedInsertionIndex < 0) {
			return false;
		}

		const focusField = this.resolveFocusField();
		this.history.applyRowOrderChange(orderedBlocks, {
			undo: { rowIndex: sourceIndex, field: focusField ?? null },
			redo: { rowIndex: orderedInsertionIndex, field: focusField ?? null }
		});

		const reorderedBlocks = this.dataStore.getBlocks();
		const insertionIndex = reorderedBlocks.indexOf(anchorBlock);
		if (insertionIndex < 0) {
			return false;
		}

		this.logDragDebug('branch-partial-displayed-order', {
			filePath: this.getCurrentFilePath(),
			sourceIndex,
			targetIndex,
			position,
			draggedIndexes,
			insertionIndex
		});

		this.refreshGridData();
		this.focusRow(insertionIndex, focusField);
		this.scheduleSave();
		return true;
	}

	/**
	 * Handle branch (parent + children) reorder using the displayed order.
	 *
	 * AG Grid's rowDragManaged only moves the parent row visually.  We use
	 * displayedOrder to figure out where the parent ended up among the
	 * non-branch rows, then relocate the entire branch to that position.
	 */
	private applyBranchDisplayedOrder(
		blocks: H2Block[],
		sourceIndex: number,
		draggedIndexes: number[],
		displayedOrder: Array<string | number>
	): boolean {
		const anchorBlock = blocks[sourceIndex] ?? null;
		if (!anchorBlock) {
			return false;
		}

		// Build a rowId→block map so we can interpret displayedOrder.
		const blockByRowId = new Map<string, H2Block>();
		for (let i = 0; i < blocks.length; i++) {
			const b = blocks[i];
			if (b) {
				blockByRowId.set(String(i), b);
			}
		}

		// Find the anchor (parent) row's position in the AG Grid displayed order.
		const anchorRowId = String(sourceIndex);
		const anchorDisplayIdx = displayedOrder.indexOf(anchorRowId);
		if (anchorDisplayIdx < 0) {
			return false;
		}

		// Look at the row just before the anchor in displayedOrder to find the
		// insertion target.  Skip over any rows that are part of the branch
		// itself (children that might still be adjacent).
		const draggedIndexSet = new Set(draggedIndexes);
		let targetBlock: H2Block | null = null;
		let position: 'before' | 'after' = 'after';
		for (let i = anchorDisplayIdx - 1; i >= 0; i--) {
			const block = blockByRowId.get(String(displayedOrder[i]));
			if (!block) {
				return false;
			}
			const blockOrigIndex = blocks.indexOf(block);
			if (!draggedIndexSet.has(blockOrigIndex)) {
				targetBlock = block;
				position = 'after';
				break;
			}
		}
		if (!targetBlock) {
			// Anchor moved to the very top — find the first non-branch row
			// to insert before.
			for (let i = anchorDisplayIdx + 1; i < displayedOrder.length; i++) {
				const block = blockByRowId.get(String(displayedOrder[i]));
				if (!block) {
					return false;
				}
				const blockOrigIndex = blocks.indexOf(block);
				if (!draggedIndexSet.has(blockOrigIndex)) {
					targetBlock = block;
					position = 'before';
					break;
				}
			}
		}
		if (!targetBlock) {
			return false;
		}

		let targetIndex = blocks.indexOf(targetBlock);
		if (targetIndex < 0 || draggedIndexSet.has(targetIndex)) {
			return false;
		}

		// When a branch lands inside another parent's child group, redirect
		// it to after the last child of that group (i.e. place the branch
		// right after the target group, not inside it).
		const targetParentEntryId = String(targetBlock.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim();
		const targetEntryId = String(targetBlock.data?.[ENTRY_ID_FIELD] ?? '').trim();
		let groupParentEntryId = '';
		if (targetParentEntryId) {
			// Target is a child → the group's parent is targetParentEntryId.
			groupParentEntryId = targetParentEntryId;
		} else if (position === 'after' && targetEntryId) {
			const nextIdx = targetIndex + 1;
			const nextBlk = nextIdx < blocks.length ? blocks[nextIdx] : null;
			if (nextBlk && !draggedIndexSet.has(nextIdx)) {
				const nextPid = String(nextBlk.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim();
				if (nextPid === targetEntryId) {
					// Inserting between a parent and its first child.
					groupParentEntryId = targetEntryId;
				}
			}
		}
		if (groupParentEntryId) {
			const lastChildIdx = this.findLastChildIndexOfGroup(blocks, groupParentEntryId, draggedIndexSet);
			if (lastChildIdx >= 0) {
				targetBlock = blocks[lastChildIdx] ?? targetBlock;
				targetIndex = lastChildIdx;
				position = 'after';
			}
			this.logDragDebug('branch-redirected-after-child-group', {
				filePath: this.getCurrentFilePath(),
				sourceIndex,
				targetIndex,
				groupParentEntryId
			});
		}

		const orderedBlocks = this.buildReorderedBlockList(blocks, draggedIndexes, targetIndex, position);
		if (!orderedBlocks || this.isSameBlockOrder(blocks, orderedBlocks)) {
			return false;
		}

		const orderedInsertionIndex = orderedBlocks.indexOf(anchorBlock);
		if (orderedInsertionIndex < 0) {
			return false;
		}

		const focusField = this.resolveFocusField();
		this.history.applyRowOrderChange(orderedBlocks, {
			undo: { rowIndex: sourceIndex, field: focusField ?? null },
			redo: { rowIndex: orderedInsertionIndex, field: focusField ?? null }
		});

		const reorderedBlocks = this.dataStore.getBlocks();
		const insertionIndex = reorderedBlocks.indexOf(anchorBlock);
		if (insertionIndex < 0) {
			return false;
		}

		this.logDragDebug('branch-displayed-order', {
			filePath: this.getCurrentFilePath(),
			sourceIndex,
			targetIndex,
			position,
			draggedIndexes,
			orderedInsertionIndex,
			insertionIndex,
			anchorEntryId: anchorBlock.data?.[ENTRY_ID_FIELD] ?? null
		});

		this.refreshGridData();
		this.focusRow(insertionIndex, focusField);
		this.scheduleSave();
		return true;
	}

	private applySingleRowDisplayedOrder(
		blocks: H2Block[],
		sourceIndex: number,
		displayedOrder: Array<string | number>,
		targetIndex: number | null
	): boolean {
		const orderedBlocks = this.buildRawOrderedBlocksFromDisplayedOrder(blocks, displayedOrder);
		if (!orderedBlocks || this.isSameBlockOrder(blocks, orderedBlocks)) {
			return false;
		}

		const anchorBlock = blocks[sourceIndex] ?? null;
		const targetBlock =
			targetIndex !== null && targetIndex >= 0 && targetIndex < blocks.length
				? blocks[targetIndex] ?? null
				: null;
		if (!anchorBlock) {
			return false;
		}

		const orderedInsertionIndex = orderedBlocks.indexOf(anchorBlock);
		if (orderedInsertionIndex < 0) {
			return false;
		}

		const focusField = this.resolveFocusField();
		this.history.applyRowOrderChange(orderedBlocks, {
			undo: { rowIndex: sourceIndex, field: focusField ?? null },
			redo: { rowIndex: orderedInsertionIndex, field: focusField ?? null }
		});

		const reorderedBlocks = this.dataStore.getBlocks();
		const insertionIndex = reorderedBlocks.indexOf(anchorBlock);
		if (insertionIndex < 0) {
			return false;
		}

		const hierarchyChanges = this.syncDraggedRowHierarchyAfterReorder(
			reorderedBlocks,
			insertionIndex,
			anchorBlock,
			this.resolveParentByPosition(reorderedBlocks, insertionIndex, String(anchorBlock.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim())
		);
		this.logDragDebug('single-row-displayed-order', {
			filePath: this.getCurrentFilePath(),
			sourceIndex,
			targetIndex,
			orderedInsertionIndex,
			insertionIndex,
			anchorEntryId: anchorBlock.data?.[ENTRY_ID_FIELD] ?? null,
			anchorParentEntryIdBefore: anchorBlock.data?.[PARENT_ENTRY_ID_FIELD] ?? null,
			targetEntryId: targetBlock?.data?.[ENTRY_ID_FIELD] ?? null,
			targetParentEntryId: targetBlock?.data?.[PARENT_ENTRY_ID_FIELD] ?? null,
			displayedOrder
		});

		if (hierarchyChanges.length === 0) {
			this.focusRow(insertionIndex, focusField);
			return true;
		}

		this.refreshGridData();
		this.focusRow(insertionIndex, focusField);
		this.scheduleSave();
		this.history.recordCellChanges(hierarchyChanges, {
			undo: { rowIndex: insertionIndex, field: focusField ?? null },
			redo: { rowIndex: insertionIndex, field: focusField ?? null }
		});
		return true;
	}

	private syncDraggedRowHierarchyAfterReorder(
		blocks: H2Block[],
		rowIndex: number,
		block: H2Block,
		resolution?: DragParentResolution | null
	): Array<{ ref: H2Block; index: number; field: string; oldValue: string; newValue: string }> {
		const changes: Array<{ ref: H2Block; index: number; field: string; oldValue: string; newValue: string }> = [];
		const currentParentEntryId = String(block.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim();
		const entryId = String(block.data?.[ENTRY_ID_FIELD] ?? '').trim();
		const hasChildren = entryId.length > 0 && this.hasDirectChildren(blocks, entryId);

		let nextParentEntryId = '';
		let nextParentBlock: H2Block | null = null;
		let nextParentRowIndex: number | null = null;

		if (resolution) {
			nextParentEntryId = resolution.parentEntryId;
			const resolvedParentRowIndex =
				nextParentEntryId.length > 0
					? blocks.findIndex(
						(candidate) => String(candidate?.data?.[ENTRY_ID_FIELD] ?? '').trim() === nextParentEntryId
					)
					: -1;
			if (resolvedParentRowIndex >= 0) {
				nextParentRowIndex = resolvedParentRowIndex;
				nextParentBlock = blocks[resolvedParentRowIndex] ?? null;
			}
		} else {
			nextParentEntryId = currentParentEntryId;
			if (!hasChildren && currentParentEntryId.length > 0) {
				const currentParentIndex = blocks.findIndex(
					(candidate) => String(candidate?.data?.[ENTRY_ID_FIELD] ?? '').trim() === currentParentEntryId
				);
				if (currentParentIndex >= 0) {
					nextParentRowIndex = currentParentIndex;
					nextParentBlock = blocks[currentParentIndex] ?? null;
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
		this.logDragDebug('sync-dragged-row-hierarchy', {
			filePath: this.getCurrentFilePath(),
			rowIndex,
			entryId,
			hasChildren,
			currentParentEntryId,
			nextParentEntryId,
			resolutionParentEntryId: resolution?.parentEntryId ?? null,
			nextParentRowIndex,
			nextParentBlockEntryId: nextParentBlock?.data?.[ENTRY_ID_FIELD] ?? null
		});

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

	/**
	 * Resolve parent for a row based on its actual position in the block list
	 * after reordering. This is more reliable than using AG Grid's overNode
	 * because it looks at the row's real neighbors instead of the unstable
	 * drop target reported by the grid.
	 *
	 * Applicable to BOTH top-level and child source rows.
	 *
	 * Rules (based on the previous row at the new position):
	 * - No previous row (position 0) → top-level.
	 * - Previous row is a child → adopt its parent (become sibling).
	 * - Previous row is a top-level row AND the next row is its child
	 *   → become its child (landed inside a parent group).
	 * - Previous row is a top-level row AND the next row is NOT its child
	 *   → top-level (landed between two top-level rows).
	 */
	private resolveParentByPosition(
		blocks: H2Block[],
		rowIndex: number,
		sourceParentEntryId: string
	): DragParentResolution | null {
		if (rowIndex <= 0) {
			// Dropped at the very top → top-level.
			return { parentEntryId: '' };
		}

		const previousBlock = blocks[rowIndex - 1];
		if (!previousBlock) {
			return null;
		}

		const prevParentEntryId = String(previousBlock.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim();
		if (prevParentEntryId) {
			// Previous row is a child → adopt its parent (become sibling).
			return { parentEntryId: prevParentEntryId };
		}

		// Previous row is top-level. Check the next row to decide.
		const prevEntryId = String(previousBlock.data?.[ENTRY_ID_FIELD] ?? '').trim();
		const nextBlock = rowIndex + 1 < blocks.length ? blocks[rowIndex + 1] : null;
		const nextParentEntryId = nextBlock
			? String(nextBlock.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim()
			: '';

		if (prevEntryId && nextParentEntryId === prevEntryId) {
			// Next row is a child of the previous top-level row
			// → we landed inside a parent group → become its child.
			return { parentEntryId: prevEntryId };
		}

		// #6: Source was a child, landed between two top-level rows
		// → stay as a child of the previous top-level row.
		if (sourceParentEntryId && prevEntryId) {
			return { parentEntryId: prevEntryId };
		}

		// Source is top-level, landed between top-level rows → stay top-level.
		return { parentEntryId: '' };
	}

	/**
	 * Resolve placement for a single row in a partial (filtered / collapsed)
	 * view.  The rules mirror `resolveParentByPosition` but work with the
	 * visible neighbours instead of physical neighbours, so the behaviour is
	 * consistent regardless of whether hidden rows exist.
	 */
	private resolvePartialSingleRowPlacement(
		sourceBlock: H2Block,
		blocks: H2Block[],
		previousVisibleBlock: H2Block | null,
		nextVisibleBlock: H2Block | null
	): PartialSingleRowPlacement | null {
		const sourceParentEntryId = String(sourceBlock.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim();

		if (previousVisibleBlock) {
			const previousVisibleIndex = blocks.indexOf(previousVisibleBlock);
			if (previousVisibleIndex < 0) {
				return null;
			}
			const prevParentEntryId = String(
				previousVisibleBlock.data?.[PARENT_ENTRY_ID_FIELD] ?? ''
			).trim();

			if (prevParentEntryId) {
				// Previous visible row is a child → adopt its parent.
				return {
					parentResolution: { parentEntryId: prevParentEntryId },
					targetIndex: previousVisibleIndex,
					position: 'after'
				};
			}

			// Previous visible row is top-level.
			const prevEntryId = String(previousVisibleBlock.data?.[ENTRY_ID_FIELD] ?? '').trim();
			const nextParentEntryId = nextVisibleBlock
				? String(nextVisibleBlock.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim()
				: '';

			if (prevEntryId && nextParentEntryId === prevEntryId) {
				// #2/#7: Next visible row is a child of the previous top-level row
				// → landed inside a parent group → become its child.
				return {
					parentResolution: { parentEntryId: prevEntryId },
					targetIndex: previousVisibleIndex,
					position: 'after'
				};
			}

			if (sourceParentEntryId && prevEntryId) {
				// #6: Source is a child, landed between two top-level rows
				// → attach to the previous top-level row.
				return {
					parentResolution: { parentEntryId: prevEntryId },
					targetIndex: previousVisibleIndex,
					position: 'after'
				};
			}

			// #1: Source is top-level, landed between top-level rows → stay top-level.
			return {
				parentResolution: { parentEntryId: '' },
				targetIndex: previousVisibleIndex,
				position: 'after'
			};
		}

		if (nextVisibleBlock) {
			const nextVisibleIndex = blocks.indexOf(nextVisibleBlock);
			if (nextVisibleIndex < 0) {
				return null;
			}
			const nextParentEntryId = String(nextVisibleBlock.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim();
			if (nextParentEntryId) {
				return {
					parentResolution: { parentEntryId: nextParentEntryId },
					targetIndex: nextVisibleIndex,
					position: 'before'
				};
			}
			return {
				parentResolution: { parentEntryId: '' },
				targetIndex: nextVisibleIndex,
				position: 'before'
			};
		}

		return null;
	}

	private logDragDebug(event: string, payload: Record<string, unknown>): void {
		appendDragDebugLog(event, payload);
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

	private buildRawOrderedBlocksFromDisplayedOrder(
		blocks: H2Block[],
		displayedOrder: Array<string | number> | null
	): H2Block[] | null {
		if (!Array.isArray(displayedOrder) || displayedOrder.length === 0) {
			return null;
		}
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

		return rawOrderedBlocks;
	}

	private buildPartialOrderedBlocksFromDisplayedOrder(
		blocks: H2Block[],
		displayedOrder: Array<string | number> | null
	): H2Block[] | null {
		if (!Array.isArray(displayedOrder) || displayedOrder.length === 0) {
			return null;
		}

		const blockByRowId = new Map<string, H2Block>();
		for (let index = 0; index < blocks.length; index++) {
			const block = blocks[index];
			if (block) {
				blockByRowId.set(String(index), block);
			}
		}

		const visibleBlocks: H2Block[] = [];
		for (const rowId of displayedOrder) {
			const block = blockByRowId.get(String(rowId));
			if (!block) {
				return null;
			}
			visibleBlocks.push(block);
		}

		return visibleBlocks;
	}

	/**
	 * Given a child row at `childIndex`, find the index of the last
	 * consecutive child that belongs to the same parent group.
	 */
	private findLastChildIndexOfGroup(
		blocks: H2Block[],
		parentEntryId: string,
		draggedIndexSet?: Set<number>
	): number {
		let lastIndex = -1;
		for (let i = 0; i < blocks.length; i++) {
			if (draggedIndexSet?.has(i)) {
				continue;
			}
			const pid = String(blocks[i]?.data?.[PARENT_ENTRY_ID_FIELD] ?? '').trim();
			if (pid === parentEntryId) {
				lastIndex = i;
			}
		}
		return lastIndex;
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
