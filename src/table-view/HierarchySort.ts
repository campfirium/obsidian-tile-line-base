import type { PostSortRowsParams, RowNode } from 'ag-grid-community';
import type { RowData } from '../grid/GridAdapter';
import { ENTRY_ID_FIELD, PARENT_ENTRY_ID_FIELD } from './entryFields';

export function reorderRowsPreservingHierarchy(rows: RowData[]): RowData[] {
	return reorderItemsPreservingHierarchy(rows, (row) => row);
}

export function postSortNodesPreservingHierarchy(params: PostSortRowsParams<RowData>): void {
	const orderedNodes = reorderItemsPreservingHierarchy(params.nodes, (node) => node.data);
	if (orderedNodes.length !== params.nodes.length) {
		return;
	}
	params.nodes.splice(0, params.nodes.length, ...orderedNodes);
}

function reorderItemsPreservingHierarchy<T>(
	items: T[],
	getRow: (item: T) => RowData | undefined
): T[] {
	if (items.length <= 1) {
		return [...items];
	}

	const itemByEntryId = new Map<string, T>();
	const childrenByParentId = new Map<string, T[]>();
	const roots: T[] = [];

	for (const item of items) {
		const entryId = normalizeHierarchyValue(getRow(item)?.[ENTRY_ID_FIELD]);
		if (!entryId) {
			continue;
		}
		itemByEntryId.set(entryId, item);
	}

	let hasHierarchy = false;
	for (const item of items) {
		const row = getRow(item);
		const entryId = normalizeHierarchyValue(row?.[ENTRY_ID_FIELD]);
		const parentEntryId = normalizeHierarchyValue(row?.[PARENT_ENTRY_ID_FIELD]);
		if (!parentEntryId || parentEntryId === entryId || !itemByEntryId.has(parentEntryId)) {
			roots.push(item);
			continue;
		}
		hasHierarchy = true;
		const siblings = childrenByParentId.get(parentEntryId) ?? [];
		siblings.push(item);
		childrenByParentId.set(parentEntryId, siblings);
	}

	if (!hasHierarchy) {
		return [...items];
	}

	const ordered: T[] = [];
	const visitedNodes = new Set<RowNode<RowData> | T>();
	const visitingEntryIds = new Set<string>();

	const appendBranch = (item: T): void => {
		if (visitedNodes.has(item)) {
			return;
		}
		visitedNodes.add(item);
		ordered.push(item);

		const entryId = normalizeHierarchyValue(getRow(item)?.[ENTRY_ID_FIELD]);
		if (!entryId || visitingEntryIds.has(entryId)) {
			return;
		}

		visitingEntryIds.add(entryId);
		for (const child of childrenByParentId.get(entryId) ?? []) {
			appendBranch(child);
		}
		visitingEntryIds.delete(entryId);
	};

	for (const root of roots) {
		appendBranch(root);
	}

	for (const item of items) {
		appendBranch(item);
	}

	return ordered;
}

function normalizeHierarchyValue(value: unknown): string {
	if (typeof value === 'string') {
		return value.trim();
	}
	if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
		return `${value}`.trim();
	}
	return '';
}
