import type { ColumnConfig, H2Block } from '../MarkdownBlockParser';
import type { Schema } from '../SchemaBuilder';
import { isReservedColumnId } from '../../grid/systemColumnUtils';
import type { FormulaState } from './FormulaManager';

export function reorderColumns(schema: Schema | null, orderedFields: string[]): boolean {
	if (!schema) {
		return false;
	}

	const currentOrder = schema.columnNames;
	if (currentOrder.length === 0) {
		return false;
	}

	const primaryField = currentOrder[0] ?? null;
	const fixedFields = new Set<string>();
	if (primaryField) {
		fixedFields.add(primaryField);
	}
	if (currentOrder.includes('status')) {
		fixedFields.add('status');
	}

	const movableFields = currentOrder.filter((field) => !fixedFields.has(field));
	if (movableFields.length === 0) {
		return false;
	}

	const normalizedOrder = orderedFields
		.map((field) => (typeof field === 'string' ? field.trim() : ''))
		.filter((field) => field.length > 0 && !isReservedColumnId(field));

	const reorderedMovable: string[] = [];
	for (const field of normalizedOrder) {
		if (fixedFields.has(field)) {
			continue;
		}
		if (!movableFields.includes(field)) {
			continue;
		}
		if (!reorderedMovable.includes(field)) {
			reorderedMovable.push(field);
		}
	}

	for (const field of movableFields) {
		if (!reorderedMovable.includes(field)) {
			reorderedMovable.push(field);
		}
	}

	const nextOrder: string[] = [];
	const appendUnique = (field: string | null) => {
		if (!field || nextOrder.includes(field)) {
			return;
		}
		nextOrder.push(field);
	};

	appendUnique(primaryField);
	if (fixedFields.has('status')) {
		appendUnique('status');
	}
	for (const field of reorderedMovable) {
		appendUnique(field);
	}

	if (nextOrder.length !== currentOrder.length) {
		return false;
	}

	let changed = false;
	for (let i = 0; i < nextOrder.length; i++) {
		if (nextOrder[i] !== currentOrder[i]) {
			changed = true;
			break;
		}
	}

	if (!changed) {
		return false;
	}

	schema.columnNames.splice(0, schema.columnNames.length, ...nextOrder);

	if (schema.columnConfigs && schema.columnConfigs.length > 0) {
		const configMap = new Map(schema.columnConfigs.map((config) => [config.name, config]));
		const orderedConfigs: ColumnConfig[] = [];
		const seen = new Set<string>();

		for (const field of nextOrder) {
			const config = configMap.get(field);
			if (config && !seen.has(config.name)) {
				orderedConfigs.push(config);
				seen.add(config.name);
			}
		}

		for (const config of schema.columnConfigs) {
			if (!seen.has(config.name)) {
				orderedConfigs.push(config);
				seen.add(config.name);
			}
		}

		schema.columnConfigs = orderedConfigs.length > 0 ? orderedConfigs : undefined;
	}

	return true;
}

interface InsertColumnParams {
	schema: Schema | null;
	blocks: H2Block[];
	hiddenSortableFields: Set<string>;
	formulaState: FormulaState;
	newName: string;
	afterField?: string | null;
	templateField?: string | null;
	copyData?: boolean;
}

export function insertColumn(params: InsertColumnParams): boolean {
	const { schema, blocks, hiddenSortableFields, formulaState, newName, afterField, templateField, copyData } = params;
	if (!schema) {
		return false;
	}

	const trimmedName = newName.trim();
	if (!trimmedName || schema.columnNames.includes(trimmedName)) {
		return false;
	}

	let insertIndex = schema.columnNames.length;
	if (afterField) {
		const idx = schema.columnNames.indexOf(afterField);
		if (idx !== -1) {
			insertIndex = idx + 1;
		}
	}
	schema.columnNames.splice(insertIndex, 0, trimmedName);

	const currentConfigs = schema.columnConfigs ?? [];
	const clonedConfigs = currentConfigs.map((config) => ({ ...config }));
	if (templateField) {
		const sourceConfig = currentConfigs.find((config) => config.name === templateField) ?? null;
		if (sourceConfig) {
			clonedConfigs.push({ ...sourceConfig, name: trimmedName });
		} else {
			const compiled = formulaState.columns.get(templateField);
			if (compiled) {
				clonedConfigs.push({ name: trimmedName, formula: compiled.original });
			}
		}
	}
	schema.columnConfigs = normalizeColumnConfigs(schema, clonedConfigs);

	const shouldCopyData = Boolean(copyData && templateField);
	for (const block of blocks) {
		const baseValue = shouldCopyData && templateField ? block.data[templateField] ?? '' : '';
		block.data[trimmedName] = baseValue;
	}

	if (templateField && hiddenSortableFields.has(templateField)) {
		hiddenSortableFields.add(trimmedName);
	}

	return true;
}

export function removeColumn(
	schema: Schema | null,
	blocks: H2Block[],
	hiddenSortableFields: Set<string>,
	formulaState: FormulaState,
	field: string
): boolean {
	if (!schema) {
		return false;
	}

	const target = field.trim();
	if (!target || isReservedColumnId(target)) {
		return false;
	}

	const index = schema.columnNames.indexOf(target);
	if (index === -1) {
		return false;
	}

	schema.columnNames.splice(index, 1);

	if (schema.columnConfigs && schema.columnConfigs.length > 0) {
		const nextConfigs = schema.columnConfigs.filter((config) => config.name !== target);
		schema.columnConfigs = normalizeColumnConfigs(schema, nextConfigs);
	}

	hiddenSortableFields.delete(target);
	formulaState.columns.delete(target);
	formulaState.compileErrors.delete(target);
	const orderIndex = formulaState.columnOrder.indexOf(target);
	if (orderIndex !== -1) {
		formulaState.columnOrder.splice(orderIndex, 1);
	}

	for (const block of blocks) {
		if (Object.prototype.hasOwnProperty.call(block.data, target)) {
			delete block.data[target];
		}
	}

	return true;
}

export function renameColumn(
	schema: Schema | null,
	blocks: H2Block[],
	hiddenSortableFields: Set<string>,
	oldName: string,
	newName: string
): boolean {
	if (!schema) {
		return false;
	}
	const trimmed = newName.trim();
	if (!trimmed || isReservedColumnId(trimmed)) {
		return false;
	}
	if (trimmed === oldName) {
		return true;
	}
	if (schema.columnNames.includes(trimmed)) {
		return false;
	}
	const index = schema.columnNames.indexOf(oldName);
	if (index === -1) {
		return false;
	}
	schema.columnNames[index] = trimmed;

	if (schema.columnConfigs && schema.columnConfigs.length > 0) {
		const nextConfigs = schema.columnConfigs.map((config) => ({ ...config }));
		for (const config of nextConfigs) {
			if (config.name === oldName) {
				config.name = trimmed;
			}
		}
		schema.columnConfigs = normalizeColumnConfigs(schema, nextConfigs);
	}

	if (hiddenSortableFields.has(oldName)) {
		hiddenSortableFields.delete(oldName);
		hiddenSortableFields.add(trimmed);
	}

	for (const block of blocks) {
		if (Object.prototype.hasOwnProperty.call(block.data, oldName)) {
			const value = block.data[oldName];
			delete block.data[oldName];
			block.data[trimmed] = value;
		}
	}

	return true;
}

export function generateUniqueColumnName(schema: Schema | null, base: string, fallback: string): string {
	const fallbackName = fallback.trim();
	const normalizedBase = base.trim().length > 0 ? base.trim() : fallbackName;
	if (!schema) {
		return normalizedBase;
	}
	const existing = new Set(schema.columnNames);
	if (!existing.has(normalizedBase)) {
		return normalizedBase;
	}
	let counter = 2;
	let candidate = `${normalizedBase} ${counter}`;
	while (existing.has(candidate)) {
		counter++;
		candidate = `${normalizedBase} ${counter}`;
	}
	return candidate;
}

export function normalizeColumnConfigs(
	schema: Schema | null,
	configs: ColumnConfig[] | undefined
): ColumnConfig[] | undefined {
	if (!configs || configs.length === 0) {
		return undefined;
	}
	if (!schema) {
		return configs;
	}
	const orderMap = new Map<string, number>();
	schema.columnNames.forEach((name, index) => orderMap.set(name, index));
	const filtered = configs.filter((config) => orderMap.has(config.name));
	if (filtered.length === 0) {
		return undefined;
	}
	filtered.sort((a, b) => (orderMap.get(a.name) ?? 0) - (orderMap.get(b.name) ?? 0));
	return filtered;
}
