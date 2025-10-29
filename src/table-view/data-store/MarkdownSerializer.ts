import type { H2Block } from '../MarkdownBlockParser';
import type { Schema } from '../SchemaBuilder';
import {
	buildCollapsedCallout,
	SYSTEM_COLLAPSED_FIELD_SET,
	type CollapsedFieldEntry
} from '../collapsed/CollapsedFieldCodec';

function buildHiddenFieldSet(schema: Schema, hiddenFields: Set<string>): Set<string> {
	const result = new Set<string>(hiddenFields);
	for (const config of schema.columnConfigs ?? []) {
		if (config.hide) {
			result.add(config.name);
		}
	}
	for (const systemField of SYSTEM_COLLAPSED_FIELD_SET) {
		result.add(systemField);
	}
	return result;
}

function collectCollapsedEntries(schema: Schema, block: H2Block, hiddenFields: Set<string>): CollapsedFieldEntry[] {
	const entries: CollapsedFieldEntry[] = [];
	const seen = new Set<string>();
	const pushEntry = (name: string, value: string, isSystem: boolean) => {
		if (!name || seen.has(name)) {
			return;
		}
		seen.add(name);
		entries.push({ name, value, isSystem });
	};

	if (Array.isArray(block.collapsedFields)) {
		for (const entry of block.collapsedFields) {
			const name = entry.name;
			if (!name) {
				continue;
			}
			const value = typeof block.data[name] === 'string' ? block.data[name] : entry.value ?? '';
			const isSystem = entry.isSystem === true || SYSTEM_COLLAPSED_FIELD_SET.has(name);
			pushEntry(name, value ?? '', isSystem);
		}
	}

	for (const name of hiddenFields) {
		const value = block.data[name];
		if (value === undefined) {
			continue;
		}
		const isSystem = SYSTEM_COLLAPSED_FIELD_SET.has(name);
		pushEntry(name, value ?? '', isSystem);
	}

	if (!seen.has('statusChanged')) {
		let statusValue =
			typeof block.data['statusChanged'] === 'string' ? block.data['statusChanged'] : '';
		if (!statusValue && Array.isArray(block.collapsedFields)) {
			const legacyStatus = block.collapsedFields.find((entry) => entry.name === 'statusChanged');
			if (legacyStatus?.value) {
				statusValue = legacyStatus.value;
			}
		}
		if (statusValue) {
			block.data['statusChanged'] = statusValue;
			pushEntry('statusChanged', statusValue, true);
		}
	}

	return entries;
}

function serializeVisibleColumns(schema: Schema, block: H2Block, hiddenFields: Set<string>, isSchemaBlock: boolean): string[] {
	const lines: string[] = [];
	let isFirstKey = true;

	for (const key of schema.columnNames) {
		if (hiddenFields.has(key)) {
			continue;
		}
		const value = block.data[key] ?? '';
		const trimmed = value.trim();

		if (isFirstKey) {
			lines.push(`## ${key}\uFF1A${value}`);
			isFirstKey = false;
			continue;
		}

		if (trimmed.length > 0) {
			lines.push(`${key}\uFF1A${value}`);
		} else if (isSchemaBlock) {
			lines.push(`${key}\uFF1A`);
		}
	}

	return lines;
}

function serializeBlock(schema: Schema, block: H2Block, hiddenFields: Set<string>, isSchemaBlock: boolean): string[] {
	const lines = serializeVisibleColumns(schema, block, hiddenFields, isSchemaBlock);
	const collapsedEntries = collectCollapsedEntries(schema, block, hiddenFields);
	block.collapsedFields = collapsedEntries.map((entry) => ({ ...entry }));

	const calloutLines = buildCollapsedCallout(collapsedEntries);
	if (calloutLines.length > 0) {
		lines.push(...calloutLines);
	}

	return lines;
}

export function blockToMarkdown(schema: Schema | null, block: H2Block, hiddenFields: Set<string>): string {
	if (!schema) {
		return '';
	}
	const hiddenSet = buildHiddenFieldSet(schema, hiddenFields);
	const lines = serializeBlock(schema, block, hiddenSet, false);
	return lines.join('\n');
}

export function blocksToMarkdown(schema: Schema | null, blocks: H2Block[], hiddenFields: Set<string>): string {
	if (!schema) {
		return '';
	}
	const hiddenSet = buildHiddenFieldSet(schema, hiddenFields);
	const lines: string[] = [];

	for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
		const block = blocks[blockIndex];
		const blockLines = serializeBlock(schema, block, hiddenSet, blockIndex === 0);
		lines.push(...blockLines);
		lines.push('');
	}

	return lines.join('\n');
}
