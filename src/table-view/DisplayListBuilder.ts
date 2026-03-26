import { ROW_ID_FIELD, type RowData } from '../grid/GridAdapter';
import type { H2Block } from './MarkdownBlockParser';
import type { Schema } from './SchemaBuilder';
import {
	COLLAPSED_STATE_FIELD,
	ENTRY_ID_FIELD,
	PARENT_ENTRY_ID_FIELD
} from './entryFields';

export const DISPLAY_ORDER_FIELD = '__tlb_index';
export const ROW_LEVEL_FIELD = '__tlb_level';
export const ROW_HAS_CHILDREN_FIELD = '__tlb_has_children';
export const ROW_COLLAPSED_FIELD = '__tlb_is_collapsed';

export interface DisplayListBuildResult {
	rows: RowData[];
	changed: boolean;
}

interface DisplayEntry {
	blockIndex: number;
	block: H2Block;
	entryId: string;
	parentEntryId: string;
	isCollapsed: boolean;
	hasChildren: boolean;
	level: number;
}

export function buildDisplayList(params: {
	schema: Schema | null;
	blocks: H2Block[];
	hiddenSortableFields: Set<string>;
	getTimestamp: () => string;
}): DisplayListBuildResult {
	const { schema, blocks, hiddenSortableFields, getTimestamp } = params;
	if (!schema) {
		return { rows: [], changed: false };
	}

	const changed = normalizeParentLinks(blocks);
	const entryMap = new Map<string, DisplayEntry>();
	for (let index = 0; index < blocks.length; index++) {
		const block = blocks[index];
		const entryId = String(block.data[ENTRY_ID_FIELD] ?? '').trim();
		entryMap.set(entryId, {
			blockIndex: index,
			block,
			entryId,
			parentEntryId: String(block.data[PARENT_ENTRY_ID_FIELD] ?? '').trim(),
			isCollapsed: block.data[COLLAPSED_STATE_FIELD] === 'true',
			hasChildren: false,
			level: 0
		});
	}

	const childIndexesByParent = new Map<string, number[]>();
	for (const entry of entryMap.values()) {
		if (!entry.parentEntryId) {
			continue;
		}
		const list = childIndexesByParent.get(entry.parentEntryId) ?? [];
		list.push(entry.blockIndex);
		childIndexesByParent.set(entry.parentEntryId, list);
	}

	for (const entry of entryMap.values()) {
		entry.hasChildren = (childIndexesByParent.get(entry.entryId)?.length ?? 0) > 0;
	}

	const rows: RowData[] = [];
	let visibleOrder = 0;
	for (let index = 0; index < blocks.length; index++) {
		const block = blocks[index];
		const entryId = String(block.data[ENTRY_ID_FIELD] ?? '').trim();
		const entry = entryMap.get(entryId);
		if (!entry || entry.parentEntryId) {
			continue;
		}

		visibleOrder += 1;
		rows.push(buildRow({
			block,
			blockIndex: index,
			visibleOrder,
			level: 0,
			hasChildren: entry.hasChildren,
			isCollapsed: entry.isCollapsed,
			schema,
			hiddenSortableFields,
			getTimestamp
		}));

		if (entry.isCollapsed) {
			continue;
		}

		const childIndexes = childIndexesByParent.get(entry.entryId) ?? [];
		for (const childIndex of childIndexes) {
			const childBlock = blocks[childIndex];
			if (!childBlock) {
				continue;
			}
			visibleOrder += 1;
			rows.push(buildRow({
				block: childBlock,
				blockIndex: childIndex,
				visibleOrder,
				level: 1,
				hasChildren: false,
				isCollapsed: false,
				schema,
				hiddenSortableFields,
				getTimestamp
			}));
		}
	}

	return { rows, changed };
}

export function collectCascadeDeleteIndexes(blocks: H2Block[], rowIndexes: number[]): number[] {
	if (rowIndexes.length === 0) {
		return [];
	}

	const entryIdByIndex = new Map<number, string>();
	const childrenByParent = new Map<string, number[]>();
	for (let index = 0; index < blocks.length; index++) {
		const block = blocks[index];
		const entryId = String(block.data[ENTRY_ID_FIELD] ?? '').trim();
		const parentEntryId = String(block.data[PARENT_ENTRY_ID_FIELD] ?? '').trim();
		entryIdByIndex.set(index, entryId);
		if (!parentEntryId) {
			continue;
		}
		const childIndexes = childrenByParent.get(parentEntryId) ?? [];
		childIndexes.push(index);
		childrenByParent.set(parentEntryId, childIndexes);
	}

	const result = new Set<number>();
	for (const rowIndex of rowIndexes) {
		if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= blocks.length) {
			continue;
		}
		result.add(rowIndex);
		const entryId = entryIdByIndex.get(rowIndex);
		if (!entryId) {
			continue;
		}
		for (const childIndex of childrenByParent.get(entryId) ?? []) {
			result.add(childIndex);
		}
	}

	return Array.from(result).sort((a, b) => a - b);
}

export function normalizeParentLinks(blocks: H2Block[]): boolean {
	let changed = false;
	const entryMap = new Map<string, { parentEntryId: string }>();
	for (const block of blocks) {
		const entryId = String(block.data[ENTRY_ID_FIELD] ?? '').trim();
		entryMap.set(entryId, {
			parentEntryId: String(block.data[PARENT_ENTRY_ID_FIELD] ?? '').trim()
		});
	}

	for (const block of blocks) {
		const parentEntryId = String(block.data[PARENT_ENTRY_ID_FIELD] ?? '').trim();
		if (!parentEntryId) {
			continue;
		}
		const parent = entryMap.get(parentEntryId);
		if (!parent || parent.parentEntryId) {
			block.data[PARENT_ENTRY_ID_FIELD] = '';
			changed = true;
		}
	}

	return changed;
}

function buildRow(params: {
	block: H2Block;
	blockIndex: number;
	visibleOrder: number;
	level: number;
	hasChildren: boolean;
	isCollapsed: boolean;
	schema: Schema;
	hiddenSortableFields: Set<string>;
	getTimestamp: () => string;
}): RowData {
	const {
		block,
		blockIndex,
		visibleOrder,
		level,
		hasChildren,
		isCollapsed,
		schema,
		hiddenSortableFields,
		getTimestamp
	} = params;

	const row: RowData = {};
	row['#'] = String(visibleOrder);
	row[ROW_ID_FIELD] = String(blockIndex);
	row[DISPLAY_ORDER_FIELD] = String(visibleOrder);
	row[ROW_LEVEL_FIELD] = String(level);
	row[ROW_HAS_CHILDREN_FIELD] = hasChildren ? 'true' : 'false';
	row[ROW_COLLAPSED_FIELD] = isCollapsed ? 'true' : 'false';

	for (const key of schema.columnNames) {
		if (key === 'status' && !block.data[key]) {
			block.data[key] = 'todo';
			if (!block.data['statusChanged']) {
				block.data['statusChanged'] = getTimestamp();
			}
		}
		row[key] = block.data[key] || '';
	}

	for (const hiddenField of hiddenSortableFields) {
		if (hiddenField === '#') {
			continue;
		}
		row[hiddenField] = block.data[hiddenField] || '';
	}

	return row;
}
