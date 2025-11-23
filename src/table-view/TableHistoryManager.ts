/* eslint-disable max-lines -- pending refactor to smaller helpers */
import type { TableView } from '../TableView';
import type { H2Block } from './MarkdownBlockParser';
import { getLogger } from '../utils/logger';

interface HistoryEntry {
	undo(): void;
	redo(): void;
}

interface FocusTarget {
	rowIndex?: number | null;
	field?: string | null;
}

interface CellChangeEntry {
	ref: H2Block | null;
	index: number;
	field: string;
	oldValue: string;
	newValue: string;
}

interface RowEntry {
	ref: H2Block | null;
	index: number;
	snapshot: BlockSnapshot;
}

export interface BlockSnapshot {
	title: string;
	data: Record<string, string>;
}

export interface HistoryFocusOptions {
	undo?: FocusTarget;
	redo?: FocusTarget;
}

const DEFAULT_HISTORY_LIMIT = 100;
const logger = getLogger('table-view:history');

/**
 * TableHistoryManager maintains a bounded undo/redo stack for row & cell level mutations.
 * 每个历史条目负责自己的可逆逻辑，统一通过 applyChange 调用刷新、聚焦与持久化。
 */
export class TableHistoryManager {
	private readonly limit: number;
	private undoStack: HistoryEntry[] = [];
	private redoStack: HistoryEntry[] = [];
	private suppressRecording = false;

	constructor(private readonly view: TableView, options?: { limit?: number }) {
		this.limit = Math.max(1, options?.limit ?? DEFAULT_HISTORY_LIMIT);
	}

	reset(): void {
		this.undoStack = [];
		this.redoStack = [];
		logger.debug('reset');
	}

	canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	undo(): boolean {
		if (!this.canUndo()) {
			logger.debug('undo:empty-stack');
			return false;
		}
		const entry = this.undoStack.pop();
		if (!entry) {
			logger.debug('undo:pop-null');
			return false;
		}
		this.suppressRecording = true;
		try {
			entry.undo();
		} finally {
			this.suppressRecording = false;
		}
		this.redoStack.push(entry);
		logger.debug('undo:applied', { undoSize: this.undoStack.length, redoSize: this.redoStack.length });
		return true;
	}

	redo(): boolean {
		if (!this.canRedo()) {
			logger.debug('redo:empty-stack');
			return false;
		}
		const entry = this.redoStack.pop();
		if (!entry) {
			logger.debug('redo:pop-null');
			return false;
		}
		this.suppressRecording = true;
		try {
			entry.redo();
		} finally {
			this.suppressRecording = false;
		}
		this.undoStack.push(entry);
		logger.debug('redo:applied', { undoSize: this.undoStack.length, redoSize: this.redoStack.length });
		return true;
	}

	record(entry: HistoryEntry): void {
		if (this.suppressRecording) {
			logger.debug('record:suppressed');
			return;
		}
		this.undoStack.push(entry);
		if (this.undoStack.length > this.limit) {
			this.undoStack.shift();
		}
		this.redoStack = [];
		logger.debug('record:generic', { undoSize: this.undoStack.length });
	}

	recordCellChanges(changes: CellChangeEntry[], focus?: HistoryFocusOptions): void {
		if (changes.length === 0) {
			return;
		}
		const entries = changes.map((change) => ({
			ref: change.ref,
			index: change.index,
			field: change.field,
			oldValue: change.oldValue,
			newValue: change.newValue
		}));

		const undoFocus = focus?.undo ?? this.buildDefaultCellFocus(entries);
		const redoFocus = focus?.redo ?? this.buildDefaultCellFocus(entries);

		this.record({
			undo: () => {
				logger.debug('recordCellChanges:undo', { count: entries.length });
				this.applyChange(() => {
					for (const entry of entries) {
						const resolved = this.resolveRowEntry(entry);
						if (!resolved) {
							continue;
						}
						resolved.block.data[entry.field] = entry.oldValue;
						entry.ref = resolved.block;
						entry.index = resolved.index;
					}
				}, undoFocus);
			},
			redo: () => {
				logger.debug('recordCellChanges:redo', { count: entries.length });
				this.applyChange(() => {
					for (const entry of entries) {
						const resolved = this.resolveRowEntry(entry);
						if (!resolved) {
							continue;
						}
						resolved.block.data[entry.field] = entry.newValue;
						entry.ref = resolved.block;
						entry.index = resolved.index;
					}
				}, redoFocus);
			}
		});
	}

	captureCellChanges(
		targets: Array<{ index: number; fields: string[] }>,
		mutator: () => void,
		focus?: HistoryFocusOptions | ((changes: CellChangeEntry[]) => HistoryFocusOptions | undefined)
	): boolean {
		if (!targets || targets.length === 0) {
			mutator();
			return false;
		}

		const normalizedTargets = new Map<number, Set<string>>();
		for (const target of targets) {
			if (!target) {
				continue;
			}
			const rowIndex = Number.isInteger(target.index) ? target.index : NaN;
			if (!Number.isInteger(rowIndex)) {
				continue;
			}
			const fieldSet = normalizedTargets.get(rowIndex) ?? new Set<string>();
			for (const field of target.fields ?? []) {
				if (typeof field === 'string' && field.length > 0) {
					fieldSet.add(field);
				}
			}
			if (fieldSet.size > 0) {
				normalizedTargets.set(rowIndex, fieldSet);
			}
		}

		if (normalizedTargets.size === 0) {
			mutator();
			return false;
		}

		const blocksBefore = this.getBlocks();
		const snapshots = new Map<string, { index: number; field: string; ref: H2Block; oldValue: string }>();

		for (const [rowIndex, fields] of normalizedTargets.entries()) {
			if (rowIndex < 0 || rowIndex >= blocksBefore.length) {
				continue;
			}
			const block = blocksBefore[rowIndex];
			if (!block) {
				continue;
			}
			for (const field of fields) {
				const raw = block.data?.[field];
				const oldValue = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
				snapshots.set(`${rowIndex}:${field}`, { index: rowIndex, field, ref: block, oldValue });
			}
		}

		if (snapshots.size === 0) {
			mutator();
			return false;
		}

		mutator();

		const blocksAfter = this.getBlocks();
		const changes: CellChangeEntry[] = [];

		for (const snapshot of snapshots.values()) {
			const block = blocksAfter[snapshot.index];
			if (!block) {
				continue;
			}
			const raw = block.data?.[snapshot.field];
			const newValue = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
			if (newValue === snapshot.oldValue) {
				continue;
			}
			changes.push({
				ref: block,
				index: snapshot.index,
				field: snapshot.field,
				oldValue: snapshot.oldValue,
				newValue
			});
		}

		if (changes.length === 0) {
			return false;
		}

		const resolvedFocus =
			typeof focus === 'function'
				? focus(changes)
				: focus;

		this.recordCellChanges(changes, resolvedFocus);
		return true;
	}

	recordRowInsertions(rows: Array<{ index: number; ref: H2Block }>, focus?: HistoryFocusOptions): void {
		if (rows.length === 0) {
			return;
		}
		const entries: RowEntry[] = rows
			.map((row) => ({
				ref: row.ref,
				index: row.index,
				snapshot: this.snapshotBlock(row.ref)
			}))
			.sort((a, b) => a.index - b.index);

		const defaultUndoRowIndex = entries[0].index > 0 ? entries[0].index - 1 : null;
		const undoFocus = focus?.undo ?? (defaultUndoRowIndex !== null ? { rowIndex: defaultUndoRowIndex, field: null } : undefined);
		const redoFocus = focus?.redo ?? { rowIndex: entries[0].index, field: null };

		this.record({
			undo: () => {
				logger.debug('recordRowInsertions:undo', { count: entries.length });
				this.applyChange(() => {
					this.removeRowEntries(entries);
				}, undoFocus);
			},
			redo: () => {
				logger.debug('recordRowInsertions:redo', { count: entries.length });
				this.applyChange(() => {
					this.insertRowEntries(entries);
				}, redoFocus);
			}
		});
	}

	recordRowDeletions(rows: Array<{ index: number; snapshot: BlockSnapshot }>, focus?: HistoryFocusOptions): void {
		if (rows.length === 0) {
			return;
		}
		const entries: RowEntry[] = rows
			.map((row) => ({
				ref: null,
				index: row.index,
				snapshot: cloneSnapshot(row.snapshot)
			}))
			.sort((a, b) => a.index - b.index);

		const undoFocus =
			focus?.undo ?? {
				rowIndex: entries[0].index,
				field: null
			};
		const redoFocus =
			focus?.redo ?? {
				rowIndex: entries[entries.length - 1].index,
				field: null
			};

		this.record({
			undo: () => {
				logger.debug('recordRowDeletions:undo', { count: entries.length });
				this.applyChange(() => {
					this.insertRowEntries(entries);
				}, undoFocus);
			},
			redo: () => {
				logger.debug('recordRowDeletions:redo', { count: entries.length });
				this.applyChange(() => {
					this.removeRowEntries(entries);
				}, redoFocus);
			}
		});
	}

	recordRowMove(move: { ref: H2Block; fromIndex: number; toIndex: number }, focus?: HistoryFocusOptions): void {
		const undoFocus =
			focus?.undo ??
			({
				rowIndex: move.fromIndex,
				field: null
			} as FocusTarget);
		const redoFocus =
			focus?.redo ??
			({
				rowIndex: move.toIndex,
				field: null
			} as FocusTarget);

		this.record({
			undo: () => {
				logger.debug('recordRowMove:undo', { from: move.fromIndex, to: move.toIndex });
				this.applyChange(() => {
					this.moveBlockToIndex(move.ref, move.fromIndex);
				}, undoFocus);
			},
			redo: () => {
				logger.debug('recordRowMove:redo', { from: move.fromIndex, to: move.toIndex });
				this.applyChange(() => {
					this.moveBlockToIndex(move.ref, move.toIndex);
				}, redoFocus);
			}
		});
	}

	applyRowOrderChange(order: H2Block[], focus?: HistoryFocusOptions): void {
		if (!Array.isArray(order) || order.length === 0) {
			return;
		}
		const beforeEntries = this.buildRowOrderEntries(this.getBlocks());
		const afterEntries = this.buildRowOrderEntries(order);
		const defaultFocus = focus?.redo ?? focus?.undo ?? ({ rowIndex: 0, field: null } as FocusTarget);

		this.applyChange(() => {
			this.applyRowOrder(afterEntries);
		}, defaultFocus);

		this.record({
			undo: () => {
				logger.debug('recordRowOrderChange:undo', { count: beforeEntries.length });
				this.applyChange(() => {
					this.applyRowOrder(beforeEntries);
				}, focus?.undo ?? defaultFocus);
			},
			redo: () => {
				logger.debug('recordRowOrderChange:redo', { count: afterEntries.length });
				this.applyChange(() => {
					this.applyRowOrder(afterEntries);
				}, focus?.redo ?? defaultFocus);
			}
		});
	}

	snapshotBlock(block: H2Block): BlockSnapshot {
		return {
			title: block.title,
			data: { ...block.data }
		};
	}

	private buildDefaultCellFocus(entries: CellChangeEntry[]): FocusTarget {
		if (entries.length === 0) {
			return {};
		}
		const first = entries[0];
		return {
			rowIndex: first.index,
			field: first.field
		};
	}

	private insertRowEntries(entries: RowEntry[]): void {
		const sorted = [...entries].sort((a, b) => a.index - b.index);
		const blocks = this.getBlocks();
		let offset = 0;
		for (const entry of sorted) {
			const insertIndex = clampIndex(entry.index + offset, 0, blocks.length);
			const clone = materializeSnapshot(entry.snapshot);
			blocks.splice(insertIndex, 0, clone);
			entry.ref = clone;
			entry.index = insertIndex;
			offset += 1;
		}
	}

	private removeRowEntries(entries: RowEntry[]): void {
		const blocks = this.getBlocks();
		const indexes = entries
			.map((entry) => {
				const resolved = this.resolveRowEntry(entry);
				return resolved ? resolved.index : -1;
			})
			.filter((index) => index >= 0)
			.sort((a, b) => b - a);

		for (const index of indexes) {
			blocks.splice(index, 1);
		}
		for (const entry of entries) {
			entry.ref = null;
		}
	}

	private resolveRowEntry(entry: { ref: H2Block | null; index: number; snapshot?: BlockSnapshot }): { block: H2Block; index: number } | null {
		const blocks = this.getBlocks();
		if (entry.ref) {
			const refIndex = blocks.indexOf(entry.ref);
			if (refIndex !== -1) {
				entry.index = refIndex;
				return { block: entry.ref, index: refIndex };
			}
		}

		if (entry.index >= 0 && entry.index < blocks.length) {
			const candidate = blocks[entry.index];
			if (!entry.snapshot || isSnapshotMatch(candidate, entry.snapshot)) {
				entry.ref = candidate;
				return { block: candidate, index: entry.index };
			}
		}

		if (entry.snapshot) {
			const fallbackIndex = findBlockIndexBySnapshot(blocks, entry.snapshot);
			if (fallbackIndex !== -1) {
				const block = blocks[fallbackIndex];
				entry.ref = block;
				entry.index = fallbackIndex;
				return { block, index: fallbackIndex };
			}
		}

		return null;
	}

	private buildRowOrderEntries(order: H2Block[]): RowEntry[] {
		return order.map((block, index) => ({
			ref: block,
			index,
			snapshot: this.snapshotBlock(block)
		}));
	}

	private applyRowOrder(entries: RowEntry[]): void {
		const blocks = this.getBlocks();
		if (entries.length === 0 || blocks.length === 0) {
			return;
		}
		const resolved: H2Block[] = [];
		const seen = new Set<H2Block>();

		for (const entry of entries) {
			const resolvedEntry = this.resolveRowEntry(entry);
			if (!resolvedEntry) {
				continue;
			}
			entry.ref = resolvedEntry.block;
			entry.index = resolvedEntry.index;
			if (seen.has(resolvedEntry.block)) {
				continue;
			}
			seen.add(resolvedEntry.block);
			resolved.push(resolvedEntry.block);
		}

		if (resolved.length !== blocks.length) {
			logger.warn('applyRowOrder:incomplete-resolution', {
				entryCount: entries.length,
				resolvedCount: resolved.length,
				blockCount: blocks.length
			});
			for (const block of blocks) {
				if (!seen.has(block)) {
					resolved.push(block);
					seen.add(block);
				}
			}
		}

		blocks.length = 0;
		for (const block of resolved) {
			blocks.push(block);
		}
	}

	private applyChange(mutator: () => void, focus?: FocusTarget): void {
		mutator();

		this.view.filterOrchestrator?.refresh();
		if (focus && typeof focus.rowIndex === 'number' && focus.rowIndex >= 0) {
			this.view.focusManager?.focusRow(focus.rowIndex, focus.field ?? null);
		}
		this.view.markUserMutation('history-change');
		this.view.persistenceService?.scheduleSave();
	}

	private getBlocks(): H2Block[] {
		return this.view.dataStore.getBlocks();
	}

	private moveBlockToIndex(ref: H2Block, targetIndex: number): void {
		const blocks = this.getBlocks();
		const currentIndex = blocks.indexOf(ref);
		if (currentIndex === -1) {
			logger.warn('moveBlockToIndex:ref-missing', { targetIndex });
			return;
		}
		const [block] = blocks.splice(currentIndex, 1);
		if (!block) {
			return;
		}
		const insertionIndex = clampIndex(targetIndex, 0, blocks.length);
		blocks.splice(insertionIndex, 0, block);
	}
}

function materializeSnapshot(snapshot: BlockSnapshot): H2Block {
	return {
		title: snapshot.title,
		data: { ...snapshot.data }
	};
}

function cloneSnapshot(snapshot: BlockSnapshot): BlockSnapshot {
	return {
		title: snapshot.title,
		data: { ...snapshot.data }
	};
}

function findBlockIndexBySnapshot(blocks: H2Block[], snapshot: BlockSnapshot): number {
	for (let i = 0; i < blocks.length; i++) {
		if (isSnapshotMatch(blocks[i], snapshot)) {
			return i;
		}
	}
	return -1;
}

function isSnapshotMatch(block: H2Block | null | undefined, snapshot: BlockSnapshot): boolean {
	if (!block) {
		return false;
	}
	if (block.title !== snapshot.title) {
		return false;
	}
	const blockKeys = Object.keys(block.data);
	const snapshotKeys = Object.keys(snapshot.data);
	if (blockKeys.length !== snapshotKeys.length) {
		return false;
	}
	for (const key of blockKeys) {
		if (block.data[key] !== snapshot.data[key]) {
			return false;
		}
	}
	return true;
}

function clampIndex(value: number, min: number, max: number): number {
	if (Number.isNaN(value)) {
		return min;
	}
	return Math.max(min, Math.min(max, value));
}
