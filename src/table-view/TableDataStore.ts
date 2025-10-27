import { ROW_ID_FIELD, type RowData } from '../grid/GridAdapter';
import { getCurrentLocalDateTime, normalizeDateFormatPreset, type DateFormatPreset } from '../utils/datetime';
import type { ColumnConfig, H2Block } from './MarkdownBlockParser';
import type { Schema, SchemaBuildResult } from './SchemaBuilder';
import { t } from '../i18n';
import {
	createFormulaState,
	getFormulaTooltipField as getTooltipFieldInternal,
	isFormulaColumn as isFormulaColumnInternal,
	prepareFormulaColumns,
	type FormulaState
} from './data-store/FormulaManager';
import {
	addRow as addRowInternal,
	deleteRow as deleteRowInternal,
	deleteRows as deleteRowsInternal,
	duplicateRow as duplicateRowInternal,
	duplicateRows as duplicateRowsInternal
} from './data-store/RowOperations';
import {
	blockToMarkdown as blockToMarkdownInternal,
	blocksToMarkdown as blocksToMarkdownInternal
} from './data-store/MarkdownSerializer';
import {
	generateUniqueColumnName,
	insertColumn,
	normalizeColumnConfigs as normalizeColumnConfigsInternal,
	removeColumn as removeColumnInternal,
	renameColumn as renameColumnInternal,
	reorderColumns as reorderColumnsInternal
} from './data-store/ColumnOperations';
import {
	hasColumnConfigContent as hasColumnConfigContentInternal,
	serializeColumnConfig as serializeColumnConfigInternal
} from './data-store/ColumnConfigUtils';
import type { ExtractRowOptions, FormulaOptions } from './data-store/types';
import { extractRowData as extractRowDataInternal } from './data-store/RowDataExtractor';

export class TableDataStore {
	private blocks: H2Block[] = [];
	private schema: Schema | null = null;
	private hiddenSortableFields: Set<string> = new Set();
	private schemaDirty = false;
	private sparseCleanupRequired = false;
	private readonly formulaState: FormulaState = createFormulaState();

	constructor(private readonly formulaOptions: FormulaOptions) {}

	private refreshFormulaState(): void {
		prepareFormulaColumns(this.formulaState, this.schema, this.schema?.columnConfigs ?? null);
	}

	initialise(result: SchemaBuildResult, columnConfigs: ColumnConfig[] | null): void {
		this.blocks = result.blocks;
		this.schema = result.schema;
		this.hiddenSortableFields = new Set(result.hiddenSortableFields);
		this.schemaDirty = result.schemaDirty;
		this.sparseCleanupRequired = result.sparseCleanupRequired;
		prepareFormulaColumns(this.formulaState, this.schema, columnConfigs ?? null);
	}

	getSchema(): Schema | null {
		return this.schema;
	}

	getColumnNames(): string[] {
		return this.schema?.columnNames ?? [];
	}

	getColumnConfigs(): ColumnConfig[] | undefined {
		return this.schema?.columnConfigs;
	}

	getColumnConfig(name: string): ColumnConfig | null {
		const configs = this.schema?.columnConfigs;
		if (!configs) return null;
		return configs.find((config) => config.name === name) ?? null;
	}

	getColumnDisplayType(name: string): 'formula' | 'date' | 'text' {
		if (this.isFormulaColumn(name)) {
			return 'formula';
		}
		const config = this.getColumnConfig(name);
		if (config?.type === 'date') {
			return 'date';
		}
		return 'text';
	}

	getDateFormat(name: string): DateFormatPreset {
		const config = this.getColumnConfig(name);
		if (config && config.type === 'date') {
			return normalizeDateFormatPreset(config.dateFormat ?? null);
		}
		return 'iso';
	}

	setColumnConfigs(configs: ColumnConfig[] | undefined): void {
		if (!this.schema) return;
		this.schema.columnConfigs = configs;
		this.refreshFormulaState();
	}

	getBlocks(): H2Block[] {
		return this.blocks;
	}

	getHiddenSortableFields(): Set<string> {
		return this.hiddenSortableFields;
	}

	consumeDirtyFlags(): { schemaDirty: boolean; sparseCleanupRequired: boolean } {
		const flags = {
			schemaDirty: this.schemaDirty,
			sparseCleanupRequired: this.sparseCleanupRequired
		};
		this.schemaDirty = false;
		this.sparseCleanupRequired = false;
		return flags;
	}

	hasColumnConfigContent(config: ColumnConfig): boolean {
		return hasColumnConfigContentInternal(config);
	}

	serializeColumnConfig(config: ColumnConfig): string {
		return serializeColumnConfigInternal(config);
	}

	isFormulaColumn(name: string): boolean {
		return isFormulaColumnInternal(this.formulaState, name);
	}

	getFormulaTooltipField(columnName: string): string {
		return getTooltipFieldInternal(this.formulaOptions, columnName);
	}

	extractRowData(options?: ExtractRowOptions): RowData[] {
		return extractRowDataInternal({
			schema: this.schema,
			blocks: this.blocks,
			hiddenSortableFields: this.hiddenSortableFields,
			formulaState: this.formulaState,
			formulaOptions: this.formulaOptions,
			options,
			getTimestamp: getCurrentLocalDateTime
		});
	}

	blockToMarkdown(block: H2Block): string {
		return blockToMarkdownInternal(this.schema, block, this.hiddenSortableFields);
	}

	blocksToMarkdown(): string {
		return blocksToMarkdownInternal(this.schema, this.blocks, this.hiddenSortableFields);
	}

	updateCell(rowIndex: number, field: string, newValue: string): boolean {
		if (!this.schema) return false;
		if (rowIndex < 0 || rowIndex >= this.blocks.length) return false;
		const block = this.blocks[rowIndex];
		block.data[field] = newValue;
		return true;
	}

	addRow(beforeRowIndex?: number | null, prefills?: Record<string, string>): number {
		return addRowInternal({
			schema: this.schema,
			blocks: this.blocks,
			beforeRowIndex: beforeRowIndex ?? null,
			prefills,
			newRowPrefix: t('tableDataStore.newRowPrefix'),
			getTimestamp: getCurrentLocalDateTime
		});
	}

	deleteRow(rowIndex: number): number | null {
		return deleteRowInternal(this.schema, this.blocks, rowIndex);
	}

	deleteRows(rowIndexes: number[]): number | null {
		return deleteRowsInternal(this.schema, this.blocks, rowIndexes);
	}

	duplicateRow(rowIndex: number): number | null {
		return duplicateRowInternal(this.schema, this.blocks, rowIndex);
	}

	duplicateRows(rowIndexes: number[]): number | null {
		return duplicateRowsInternal(this.schema, this.blocks, rowIndexes);
	}

	reorderColumns(orderedFields: string[]): boolean {
		return reorderColumnsInternal(this.schema, orderedFields);
	}

	duplicateColumn(field: string): string | null {
		const baseName = t('tableDataStore.duplicateColumnBase', { field });
		const fallback = t('tableDataStore.newColumnName');
		const newName = generateUniqueColumnName(this.schema, baseName, fallback);
		const created = insertColumn({
			schema: this.schema,
			blocks: this.blocks,
			hiddenSortableFields: this.hiddenSortableFields,
			formulaState: this.formulaState,
			newName,
			afterField: field,
			templateField: field,
			copyData: true
		});
		if (!created) return null;
		this.refreshFormulaState();
		return newName;
	}

	insertColumnAfter(field: string, baseName?: string): string | null {
		const fallback = t('tableDataStore.newColumnName');
		const effectiveBaseName = baseName ?? fallback;
		const newName = generateUniqueColumnName(this.schema, effectiveBaseName, fallback);
		const created = insertColumn({
			schema: this.schema,
			blocks: this.blocks,
			hiddenSortableFields: this.hiddenSortableFields,
			formulaState: this.formulaState,
			newName,
			afterField: field
		});
		if (!created) return null;
		this.refreshFormulaState();
		return newName;
	}

	removeColumn(field: string): boolean {
		if (!removeColumnInternal(
			this.schema,
			this.blocks,
			this.hiddenSortableFields,
			this.formulaState,
			field
		)) return false;
		this.refreshFormulaState();
		return true;
	}

	renameColumn(oldName: string, newName: string): boolean {
		if (!renameColumnInternal(
			this.schema,
			this.blocks,
			this.hiddenSortableFields,
			oldName,
			newName
		)) return false;
		this.refreshFormulaState();
		return true;
	}

	getBlockIndexFromRow(rowData: RowData | undefined): number | null {
		if (!rowData) {
			return null;
		}
		const direct = rowData[ROW_ID_FIELD];
		if (direct !== undefined) {
			const parsed = parseInt(String(direct), 10);
			if (!Number.isNaN(parsed)) {
				return parsed;
			}
		}
		const fallback = rowData['#'];
		if (fallback !== undefined) {
			const parsedFallback = parseInt(String(fallback), 10) - 1;
			if (!Number.isNaN(parsedFallback)) {
				return parsedFallback;
			}
		}
		return null;
	}

	normalizeColumnConfigs(configs: ColumnConfig[] | undefined): ColumnConfig[] | undefined {
		return normalizeColumnConfigsInternal(this.schema, configs);
	}
}

export type { FormulaOptions, ExtractRowOptions } from './data-store/types';
