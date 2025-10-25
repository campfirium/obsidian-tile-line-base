import { getCurrentLocalDateTime } from '../utils/datetime';
import type { ColumnConfig, H2Block } from './MarkdownBlockParser';

export interface Schema {
	columnNames: string[];
	columnConfigs?: ColumnConfig[];
	columnIds?: string[];
}

export interface SchemaBuildResult {
	schema: Schema | null;
	hiddenSortableFields: Set<string>;
	schemaDirty: boolean;
	sparseCleanupRequired: boolean;
	blocks: H2Block[];
}

const HIDDEN_SYSTEM_FIELDS = new Set(['statusChanged']);
const STATUS_FIELD = 'status';
const STATUS_ALIASES = new Set(['状态', '狀態', 'status', 'Status', 'STATUS']);

function resolveStatusFieldName(key: string): string {
	const trimmed = key.trim();
	if (trimmed.length === 0) {
		return key;
	}

	if (STATUS_ALIASES.has(trimmed) || STATUS_ALIASES.has(trimmed.toLowerCase())) {
		return STATUS_FIELD;
	}
	return key;
}

function normalizeStatusFieldOnBlock(block: H2Block): void {
	const originalKeys = Object.keys(block.data);
	for (const key of originalKeys) {
		const resolved = resolveStatusFieldName(key);
		if (resolved === key) {
			continue;
		}

		if (block.data[resolved] === undefined || block.data[resolved] === '') {
			block.data[resolved] = block.data[key];
		}
		delete block.data[key];
	}
}

function normalizeStatusFieldOnConfigs(columnConfigs: ColumnConfig[] | null | undefined): void {
	if (!columnConfigs) {
		return;
	}
	for (const config of columnConfigs) {
		const resolved = resolveStatusFieldName(config.name);
		config.name = resolved;
	}
}

export class SchemaBuilder {
	buildSchema(blocks: H2Block[], columnConfigs: ColumnConfig[] | null): SchemaBuildResult {
		const hiddenSortableFields = new Set<string>(HIDDEN_SYSTEM_FIELDS);
		let schemaDirty = false;
		let sparseCleanupRequired = false;

		if (blocks.length === 0) {
			return {
				schema: null,
				hiddenSortableFields,
				schemaDirty,
				sparseCleanupRequired,
				blocks
			};
		}

		const schemaBlock = blocks[0];
		for (const block of blocks) {
			normalizeStatusFieldOnBlock(block);
		}
		normalizeStatusFieldOnConfigs(columnConfigs);
		const columnNames: string[] = [];
		const seenKeys = new Set<string>();

		const appendKey = (key: string) => {
			if (HIDDEN_SYSTEM_FIELDS.has(key)) {
				hiddenSortableFields.add(key);
				return;
			}
			if (seenKeys.has(key)) {
				return;
			}
			columnNames.push(key);
			seenKeys.add(key);
		};

		for (const key of Object.keys(schemaBlock.data)) {
			appendKey(key);
		}

		if (columnConfigs && columnConfigs.length > 0) {
			for (const config of columnConfigs) {
				const alreadySeen = seenKeys.has(config.name);
				appendKey(config.name);
				if (!alreadySeen && schemaBlock.data[config.name] === undefined) {
					schemaBlock.data[config.name] = '';
					schemaDirty = true;
				}
			}
		}

		for (let i = 1; i < blocks.length; i++) {
			const block = blocks[i];
			for (const key of Object.keys(block.data)) {
				const value = block.data[key];

				if (!seenKeys.has(key) && !HIDDEN_SYSTEM_FIELDS.has(key)) {
					appendKey(key);
					if (schemaBlock.data[key] === undefined) {
						schemaBlock.data[key] = '';
					}
					schemaDirty = true;
				}

				if (HIDDEN_SYSTEM_FIELDS.has(key)) {
					hiddenSortableFields.add(key);
					if (typeof value === 'string' && value.trim().length === 0) {
						delete block.data[key];
						sparseCleanupRequired = true;
					}
					continue;
				}

				const normalized = typeof value === 'string' ? value.trim() : value;
				if (normalized === '' || normalized === null || normalized === undefined) {
					delete block.data[key];
					sparseCleanupRequired = true;
				}
			}
		}

		const statusIndex = columnNames.indexOf(STATUS_FIELD);
		if (statusIndex !== -1) {
			columnNames.splice(statusIndex, 1);
		}
		const insertIndex = columnNames.length > 0 ? 1 : 0;
		columnNames.splice(insertIndex, 0, STATUS_FIELD);
		seenKeys.add(STATUS_FIELD);
		if (statusIndex === -1 && schemaBlock.data[STATUS_FIELD] === undefined) {
			schemaBlock.data[STATUS_FIELD] = 'todo';
			if (schemaBlock.data['statusChanged'] === undefined) {
				schemaBlock.data['statusChanged'] = getCurrentLocalDateTime();
			}
			schemaDirty = true;
		}

		const orderedConfigs = columnConfigs
			? columnNames
				.map((name) => columnConfigs.find((config) => config.name === name))
				.filter((config): config is ColumnConfig => Boolean(config))
			: undefined;

		const schema: Schema = {
			columnNames,
			columnConfigs: orderedConfigs && orderedConfigs.length > 0 ? orderedConfigs : undefined
		};

		return {
			schema,
			hiddenSortableFields,
			schemaDirty,
			sparseCleanupRequired,
			blocks
		};
	}
}
