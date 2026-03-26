import type { H2Block } from './MarkdownBlockParser';

export const ENTRY_ID_FIELD = 'entryId';
export const PARENT_ENTRY_ID_FIELD = 'parentEntryId';
export const COLLAPSED_STATE_FIELD = 'collapsed';
export const STATUS_CHANGED_FIELD = 'statusChanged';

export const HIDDEN_ENTRY_FIELD_SET = new Set<string>([
	ENTRY_ID_FIELD,
	PARENT_ENTRY_ID_FIELD,
	COLLAPSED_STATE_FIELD,
	STATUS_CHANGED_FIELD
]);

export function ensureHiddenEntryFields(block: H2Block): boolean {
	let changed = false;

	if (!hasNonEmptyValue(block.data[ENTRY_ID_FIELD])) {
		block.data[ENTRY_ID_FIELD] = createEntryId();
		changed = true;
	}

	if (block.data[PARENT_ENTRY_ID_FIELD] === undefined) {
		block.data[PARENT_ENTRY_ID_FIELD] = '';
		changed = true;
	}

	if (!hasBooleanStringValue(block.data[COLLAPSED_STATE_FIELD])) {
		block.data[COLLAPSED_STATE_FIELD] = 'false';
		changed = true;
	}

	return changed;
}

export function assignFreshEntryId(block: H2Block): void {
	block.data[ENTRY_ID_FIELD] = createEntryId();
}

function hasNonEmptyValue(value: unknown): boolean {
	return typeof value === 'string' && value.trim().length > 0;
}

function hasBooleanStringValue(value: unknown): boolean {
	return value === 'true' || value === 'false';
}

function createEntryId(): string {
	if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
		return globalThis.crypto.randomUUID();
	}

	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
		const random = Math.floor(Math.random() * 16);
		const next = char === 'x' ? random : ((random & 0x3) | 0x8);
		return next.toString(16);
	});
}
