import { Notice } from 'obsidian';
import { isReservedColumnId } from '../grid/systemColumnUtils';
import { t } from '../i18n';
import type { H2Block, H2ParseResult } from './MarkdownBlockParser';
import { PARENT_ENTRY_FIELD } from './entryFields';
import type { TableDataStore } from './TableDataStore';

export type LateralAppendCheckResult =
	| { shouldHandle: false }
	| { shouldHandle: true; ok: false; notice: Parameters<typeof t>[0]; params?: Record<string, string> }
	| { shouldHandle: true; ok: true; diff: LateralAppendDiff };

export interface LateralAppendDiff {
	newFields: string[];
	valuesByPrimary: Map<string, Record<string, string>>;
}

interface ComputeOptions {
	tableBlocks: H2Block[];
	tableFields: string[];
	clipboardResult: H2ParseResult;
	isStructured: boolean;
}

export function computeLateralAppendDiff(options: ComputeOptions): LateralAppendCheckResult {
	if (!options.isStructured || options.clipboardResult.invalidSections.length > 0 || options.clipboardResult.straySections.length > 0) {
		return { shouldHandle: false };
	}

	const tablePrimaryField = options.tableFields[0] ?? '';
	const clipboardBlocks = options.clipboardResult.blocks;
	const clipboardPrimaryField = getPrimaryField(clipboardBlocks[0]);
	if (!tablePrimaryField || clipboardPrimaryField !== tablePrimaryField) {
		return { shouldHandle: true, ok: false, notice: 'appendClipboard.lateralPrimaryMismatch' };
	}

	const existingFields = new Set(options.tableFields);
	const newFields = collectNewFields(clipboardBlocks, tablePrimaryField, existingFields);
	if (newFields.reservedField) {
		return {
			shouldHandle: true,
			ok: false,
			notice: 'appendClipboard.lateralReservedField',
			params: { field: newFields.reservedField }
		};
	}
	if (newFields.fields.length === 0) {
		return { shouldHandle: true, ok: false, notice: 'appendClipboard.lateralNoNewFields' };
	}

	const tableIndex = buildPrimaryIndex(options.tableBlocks, tablePrimaryField);
	if (tableIndex.error === 'empty') {
		return { shouldHandle: true, ok: false, notice: 'appendClipboard.lateralEmptyPrimaryInTable' };
	}
	if (tableIndex.error === 'duplicate') {
		return {
			shouldHandle: true,
			ok: false,
			notice: 'appendClipboard.lateralDuplicatePrimaryInTable',
			params: { value: tableIndex.value ?? '' }
		};
	}

	const clipboardIndex = buildPrimaryIndex(clipboardBlocks, tablePrimaryField);
	if (clipboardIndex.error === 'empty') {
		return { shouldHandle: true, ok: false, notice: 'appendClipboard.lateralEmptyPrimaryInClipboard' };
	}
	if (clipboardIndex.error === 'duplicate') {
		return {
			shouldHandle: true,
			ok: false,
			notice: 'appendClipboard.lateralDuplicatePrimaryInClipboard',
			params: { value: clipboardIndex.value ?? '' }
		};
	}

	const valuesByPrimary = new Map<string, Record<string, string>>();
	for (const [primaryValue, clipboardBlock] of clipboardIndex.rows.entries()) {
		if (!tableIndex.rows.has(primaryValue)) {
			return {
				shouldHandle: true,
				ok: false,
				notice: 'appendClipboard.lateralUnmatchedClipboardRow',
				params: { value: primaryValue }
			};
		}
		const values: Record<string, string> = {};
		for (const field of newFields.fields) {
			values[field] = clipboardBlock.data[field] ?? '';
		}
		valuesByPrimary.set(primaryValue, values);
	}

	return {
		shouldHandle: true,
		ok: true,
		diff: {
			newFields: newFields.fields,
			valuesByPrimary
		}
	};
}

export function applyLateralAppendDiff(dataStore: TableDataStore, diff: LateralAppendDiff): boolean {
	const schema = dataStore.getSchema();
	const tableFields = schema?.columnNames ?? [];
	const primaryField = tableFields[0] ?? '';
	if (!schema || !primaryField || diff.newFields.length === 0) {
		return false;
	}

	let afterField = resolveAppendAnchor(tableFields);
	const createdFields: string[] = [];
	for (const field of diff.newFields) {
		const created = dataStore.insertColumnAfter(afterField, field);
		if (!created || created !== field) {
			return false;
		}
		createdFields.push(created);
		afterField = created;
	}

	const blocks = dataStore.getBlocks();
	for (let rowIndex = 0; rowIndex < blocks.length; rowIndex++) {
		const primaryValue = blocks[rowIndex]?.data?.[primaryField]?.trim() ?? '';
		const values = diff.valuesByPrimary.get(primaryValue);
		if (!values) {
			continue;
		}
		for (const field of createdFields) {
			dataStore.updateCell(rowIndex, field, values[field] ?? '');
		}
	}

	return true;
}

export function showLateralAppendFailure(result: Extract<LateralAppendCheckResult, { shouldHandle: true; ok: false }>): void {
	new Notice(t(result.notice, result.params));
}

function collectNewFields(
	blocks: H2Block[],
	primaryField: string,
	existingFields: Set<string>
): { fields: string[]; reservedField: string | null } {
	const fields: string[] = [];
	const seen = new Set<string>();
	for (const block of blocks) {
		for (const field of Object.keys(block.data)) {
			const normalized = field.trim();
			if (!normalized || normalized === primaryField || existingFields.has(normalized) || seen.has(normalized)) {
				continue;
			}
			if (isReservedColumnId(normalized) || normalized === PARENT_ENTRY_FIELD) {
				return { fields, reservedField: normalized };
			}
			seen.add(normalized);
			fields.push(normalized);
		}
	}
	return { fields, reservedField: null };
}

function buildPrimaryIndex(blocks: H2Block[], primaryField: string):
	| { rows: Map<string, H2Block>; error: null; value?: undefined }
	| { rows: Map<string, H2Block>; error: 'empty' | 'duplicate'; value?: string } {
	const rows = new Map<string, H2Block>();
	for (const block of blocks) {
		const primaryValue = block.data[primaryField]?.trim() ?? '';
		if (!primaryValue) {
			return { rows, error: 'empty' };
		}
		if (rows.has(primaryValue)) {
			return { rows, error: 'duplicate', value: primaryValue };
		}
		rows.set(primaryValue, block);
	}
	return { rows, error: null };
}

function getPrimaryField(block: H2Block | undefined): string {
	if (!block) {
		return '';
	}
	return Object.keys(block.data)[0] ?? '';
}

function resolveAppendAnchor(fields: string[]): string {
	const parentIndex = fields.indexOf(PARENT_ENTRY_FIELD);
	if (parentIndex > 0) {
		return fields[parentIndex - 1];
	}
	return fields[fields.length - 1] ?? '';
}
