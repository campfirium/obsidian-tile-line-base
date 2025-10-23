import { ROW_ID_FIELD, type RowData } from '../grid/GridAdapter';
import { compileFormula, evaluateFormula, type CompiledFormula } from '../formula/FormulaEngine';
import { getCurrentLocalDateTime } from '../utils/datetime';
import type { ColumnConfig, H2Block } from './MarkdownBlockParser';
import type { Schema, SchemaBuildResult } from './SchemaBuilder';
import { t } from '../i18n';

const SYSTEM_FIELDS = new Set(['status', 'statusChanged']);

export interface FormulaOptions {
        rowLimit: number;
        errorValue: string;
        tooltipPrefix: string;
}

export interface ExtractRowOptions {
        onFormulaLimitExceeded?: (limit: number) => void;
}

/**
 * 集中管理 Markdown 块、Schema 与列配置，提供表格数据的读写操作。
 */
export class TableDataStore {
        private blocks: H2Block[] = [];
        private schema: Schema | null = null;
        private hiddenSortableFields: Set<string> = new Set();
        private schemaDirty = false;
        private sparseCleanupRequired = false;
        private readonly formulaColumns = new Map<string, CompiledFormula>();
        private readonly formulaCompileErrors = new Map<string, string>();
        private formulaColumnOrder: string[] = [];
        private formulaLimitNoticeIssued = false;

	constructor(private readonly formulaOptions: FormulaOptions) {}

        initialise(result: SchemaBuildResult, columnConfigs: ColumnConfig[] | null): void {
                        this.blocks = result.blocks;
                        this.schema = result.schema;
                        this.hiddenSortableFields = new Set(result.hiddenSortableFields);
                        this.schemaDirty = result.schemaDirty;
                        this.sparseCleanupRequired = result.sparseCleanupRequired;
                        this.prepareFormulaColumns(columnConfigs ?? null);
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

        setColumnConfigs(configs: ColumnConfig[] | undefined): void {
                if (!this.schema) {
                        return;
                }
                this.schema.columnConfigs = configs;
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
                return Boolean(
                        (config.width && config.width.trim().length > 0) ||
                        (config.unit && config.unit.trim().length > 0) ||
                        config.hide ||
                        (config.formula && config.formula.trim().length > 0)
                );
        }

        serializeColumnConfig(config: ColumnConfig): string {
                const segments: string[] = [];
                if (config.width && config.width.trim().length > 0) {
                        segments.push(`width: ${config.width.trim()}`);
                }
                if (config.unit && config.unit.trim().length > 0) {
                        segments.push(`unit: ${config.unit.trim()}`);
                }
                if (config.formula && config.formula.trim().length > 0) {
                        segments.push(`formula: ${config.formula.trim()}`);
                }
                if (config.hide) {
                        segments.push('hide');
                }

                const name = config.name.trim();
                if (segments.length === 0) {
                        return name;
                }
                return `${name} ${segments.map((segment) => `(${segment})`).join(' ')}`;
        }

        isFormulaColumn(name: string): boolean {
                return this.formulaColumns.has(name) || this.formulaCompileErrors.has(name);
        }

        getFormulaTooltipField(columnName: string): string {
                return `${this.formulaOptions.tooltipPrefix}${columnName}`;
        }

        extractRowData(options?: ExtractRowOptions): RowData[] {
                if (!this.schema) {
                        return [];
                }

                const data: RowData[] = [];
                const rowCount = this.blocks.length;
                const formulasEnabled = rowCount <= this.formulaOptions.rowLimit;

                if (!formulasEnabled && !this.formulaLimitNoticeIssued && this.formulaColumnOrder.length > 0) {
                        options?.onFormulaLimitExceeded?.(this.formulaOptions.rowLimit);
                        this.formulaLimitNoticeIssued = true;
                }

                for (let i = 0; i < this.blocks.length; i++) {
                        const block = this.blocks[i];
                        const row: RowData = {};

                        row['#'] = String(i + 1);
                        row[ROW_ID_FIELD] = String(i);

                        for (const key of this.schema.columnNames) {
                                if (key === 'status' && !block.data[key]) {
                                        block.data[key] = 'todo';
                                        if (!block.data['statusChanged']) {
                                                block.data['statusChanged'] = getCurrentLocalDateTime();
                                        }
                                }
                                row[key] = block.data[key] || '';
                        }

                        for (const hiddenField of this.hiddenSortableFields) {
                                if (hiddenField === '#') {
                                        continue;
                                }
                                row[hiddenField] = block.data[hiddenField] || '';
                        }

                        this.applyFormulaResults(row, rowCount, formulasEnabled);

                        data.push(row);
                }

                return data;
        }

        blockToMarkdown(block: H2Block): string {
                if (!this.schema) {
                        return '';
                }

                const lines: string[] = [];
                let isFirstKey = true;

                for (const key of this.schema.columnNames) {
                        if (SYSTEM_FIELDS.has(key)) {
                                continue;
                        }
                        const value = block.data[key] || '';
                        if (!value.trim()) {
                                continue;
                        }

                        if (isFirstKey) {
                                lines.push(`## ${key}：${value}`);
                                isFirstKey = false;
                        } else {
                                lines.push(`${key}：${value}`);
                        }
                }

                return lines.join('\n');
        }

        blocksToMarkdown(): string {
                if (!this.schema) {
                        return '';
                }

                const lines: string[] = [];

                for (let blockIndex = 0; blockIndex < this.blocks.length; blockIndex++) {
                        const block = this.blocks[blockIndex];
                        const isSchemaBlock = blockIndex === 0;
                        let isFirstKey = true;

                        for (const key of this.schema.columnNames) {
                                const rawValue = block.data[key];
                                const value = rawValue ?? '';
                                const hasValue = value.trim().length > 0;

                                if (isFirstKey) {
                                        lines.push(`## ${key}：${value}`);
                                        isFirstKey = false;
                                } else {
                                        if (hasValue) {
                                                lines.push(`${key}：${value}`);
                                        } else if (isSchemaBlock) {
                                                lines.push(`${key}：`);
                                        }
                                }
                        }

                        if (block.data['statusChanged']) {
                                lines.push(`statusChanged：${block.data['statusChanged']}`);
                        }

                        lines.push('');
                }

                return lines.join('\n');
        }

        updateCell(rowIndex: number, field: string, newValue: string): boolean {
                if (!this.schema) {
                        return false;
                }
                if (rowIndex < 0 || rowIndex >= this.blocks.length) {
                        return false;
                }
                const block = this.blocks[rowIndex];
                block.data[field] = newValue;
                return true;
        }

	addRow(beforeRowIndex?: number | null, prefills?: Record<string, string>): number {
		if (!this.schema) {
			return -1;
		}

		const entryNumber = this.blocks.length + 1;
		const newBlock: H2Block = {
			title: '',
			data: {}
		};
		const newRowPrefix = t('tableDataStore.newRowPrefix');

		for (let i = 0; i < this.schema.columnNames.length; i++) {
			const key = this.schema.columnNames[i];
			const prefilledValue = prefills ? prefills[key] : undefined;
			if (prefilledValue !== undefined) {
				newBlock.data[key] = prefilledValue;
			} else if (key === 'status') {
				newBlock.data[key] = 'todo';
			} else if (i === 0) {
				newBlock.data[key] = `${newRowPrefix} ${entryNumber}`;
			} else {
				newBlock.data[key] = '';
			}
		}

		newBlock.data['statusChanged'] = getCurrentLocalDateTime();

		if (beforeRowIndex !== undefined && beforeRowIndex !== null) {
			this.blocks.splice(beforeRowIndex, 0, newBlock);
			return beforeRowIndex;
		}

		this.blocks.push(newBlock);
		return this.blocks.length - 1;
	}

        deleteRow(rowIndex: number): number | null {
                if (!this.schema) {
                        return null;
                }
                if (rowIndex < 0 || rowIndex >= this.blocks.length) {
                        return null;
                }
                this.blocks.splice(rowIndex, 1);
                if (this.blocks.length === 0) {
                        return null;
                }
                return Math.min(rowIndex, this.blocks.length - 1);
        }

        deleteRows(rowIndexes: number[]): number | null {
                if (!this.schema || rowIndexes.length === 0) {
                        return null;
                }
                const sorted = [...rowIndexes].sort((a, b) => b - a);
                for (const index of sorted) {
                        if (index >= 0 && index < this.blocks.length) {
                                this.blocks.splice(index, 1);
                        }
                }
                if (this.blocks.length === 0) {
                        return null;
                }
                const minIndex = Math.min(...rowIndexes);
                return Math.min(minIndex, this.blocks.length - 1);
        }

        duplicateRow(rowIndex: number): number | null {
                if (!this.schema) {
                        return null;
                }
                if (rowIndex < 0 || rowIndex >= this.blocks.length) {
                        return null;
                }
                const source = this.blocks[rowIndex];
                const duplicated: H2Block = {
                        title: source.title,
                        data: { ...source.data }
                };
                this.blocks.splice(rowIndex + 1, 0, duplicated);
                return rowIndex + 1;
        }

        duplicateRows(rowIndexes: number[]): number | null {
                if (!this.schema || rowIndexes.length === 0) {
                        return null;
                }
                const sorted = [...rowIndexes].sort((a, b) => b - a);
                for (const index of sorted) {
                        if (index < 0 || index >= this.blocks.length) {
                                continue;
                        }
                        const sourceBlock = this.blocks[index];
                        const duplicated: H2Block = {
                                title: sourceBlock.title,
                                data: { ...sourceBlock.data }
                        };
                        this.blocks.splice(index + 1, 0, duplicated);
                }
                const minIndex = Math.min(...rowIndexes);
                return minIndex + 1;
        }

        reorderColumns(orderedFields: string[]): boolean {
                if (!this.schema) {
                        return false;
                }

                const currentOrder = this.schema.columnNames;
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
                        .filter((field) => field.length > 0 && field !== '#' && field !== ROW_ID_FIELD);

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
                        if (!field) {
                                return;
                        }
                        if (!nextOrder.includes(field)) {
                                nextOrder.push(field);
                        }
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

                this.schema.columnNames.splice(0, this.schema.columnNames.length, ...nextOrder);

                if (this.schema.columnConfigs && this.schema.columnConfigs.length > 0) {
                        const configMap = new Map(this.schema.columnConfigs.map((config) => [config.name, config]));
                        const orderedConfigs: ColumnConfig[] = [];
                        const seen = new Set<string>();

                        for (const field of nextOrder) {
                                const config = configMap.get(field);
                                if (config && !seen.has(config.name)) {
                                        orderedConfigs.push(config);
                                        seen.add(config.name);
                                }
                        }

                        for (const config of this.schema.columnConfigs) {
                                if (!seen.has(config.name)) {
                                        orderedConfigs.push(config);
                                        seen.add(config.name);
                                }
                        }

                        this.schema.columnConfigs = orderedConfigs.length > 0 ? orderedConfigs : undefined;
                }

                return true;
        }

	duplicateColumn(field: string): string | null {
		const baseName = t('tableDataStore.duplicateColumnBase', { field });
		const newName = this.generateUniqueColumnName(baseName);
                const created = this.insertColumnInternal({
                        newName,
                        afterField: field,
                        templateField: field,
                        copyData: true
                });
                return created ? newName : null;
        }

	insertColumnAfter(field: string, baseName?: string): string | null {
		const effectiveBaseName = baseName ?? t('tableDataStore.newColumnName');
		const newName = this.generateUniqueColumnName(effectiveBaseName);
		const created = this.insertColumnInternal({
			newName,
			afterField: field
		});
		return created ? newName : null;
	}

        removeColumn(field: string): boolean {
                if (!this.schema) {
                        return false;
                }

                const target = field.trim();
                if (!target || target === '#' || target === 'status' || target === ROW_ID_FIELD) {
                        return false;
                }

                const index = this.schema.columnNames.indexOf(target);
                if (index === -1) {
                        return false;
                }

                this.schema.columnNames.splice(index, 1);

                if (this.schema.columnConfigs && this.schema.columnConfigs.length > 0) {
                        const nextConfigs = this.schema.columnConfigs.filter((config) => config.name !== target);
                        this.schema.columnConfigs = this.normalizeColumnConfigs(nextConfigs);
                }

                this.hiddenSortableFields.delete(target);
                this.formulaColumns.delete(target);
                this.formulaCompileErrors.delete(target);
                const orderIndex = this.formulaColumnOrder.indexOf(target);
                if (orderIndex !== -1) {
                        this.formulaColumnOrder.splice(orderIndex, 1);
                }

                for (const block of this.blocks) {
                        if (Object.prototype.hasOwnProperty.call(block.data, target)) {
                                delete block.data[target];
                        }
                }

                return true;
        }

        renameColumn(oldName: string, newName: string): boolean {
                if (!this.schema) {
                        return false;
                }
                const trimmed = newName.trim();
                if (!trimmed || trimmed === '#' || trimmed === 'status' || trimmed === ROW_ID_FIELD) {
                        return false;
                }
                if (trimmed === oldName) {
                        return true;
                }
                if (this.schema.columnNames.includes(trimmed)) {
                        return false;
                }
                const index = this.schema.columnNames.indexOf(oldName);
                if (index === -1) {
                        return false;
                }
                this.schema.columnNames[index] = trimmed;

                if (this.schema.columnConfigs && this.schema.columnConfigs.length > 0) {
                        const nextConfigs = this.schema.columnConfigs.map((config) => ({ ...config }));
                        for (const config of nextConfigs) {
                                if (config.name === oldName) {
                                        config.name = trimmed;
                                }
                        }
                        this.schema.columnConfigs = this.normalizeColumnConfigs(nextConfigs);
                }

                if (this.hiddenSortableFields.has(oldName)) {
                        this.hiddenSortableFields.delete(oldName);
                        this.hiddenSortableFields.add(trimmed);
                }

                for (const block of this.blocks) {
                        if (Object.prototype.hasOwnProperty.call(block.data, oldName)) {
                                const value = block.data[oldName];
                                delete block.data[oldName];
                                block.data[trimmed] = value;
                        }
                }

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

	private prepareFormulaColumns(columnConfigs: ColumnConfig[] | null): void {
		this.formulaColumns.clear();
		this.formulaCompileErrors.clear();
		this.formulaColumnOrder = [];
		this.formulaLimitNoticeIssued = false;

                if (!columnConfigs) {
                        if (this.schema) {
                                this.schema.columnConfigs = undefined;
                        }
                        return;
                }

                if (this.schema) {
                        this.schema.columnConfigs = columnConfigs;
                }

		for (const config of columnConfigs) {
			const rawFormula = config.formula?.trim();
			if (!rawFormula) {
				continue;
			}
			this.formulaColumnOrder.push(config.name);
			try {
				const compiled = compileFormula(rawFormula);
				if (compiled.dependencies.includes(config.name)) {
					this.formulaCompileErrors.set(config.name, t('tableDataStore.formulaSelfReference'));
					continue;
				}
                                this.formulaColumns.set(config.name, compiled);
                        } catch (error) {
                                const message = error instanceof Error ? error.message : String(error);
                                this.formulaCompileErrors.set(config.name, message);
                        }
                }
        }

	private applyFormulaResults(row: RowData, rowCount: number, formulasEnabled: boolean): void {
		if (this.formulaColumnOrder.length === 0) {
			return;
		}

		for (const columnName of this.formulaColumnOrder) {
			const tooltipField = this.getFormulaTooltipField(columnName);
			const compileError = this.formulaCompileErrors.get(columnName);
			if (compileError) {
				row[columnName] = this.formulaOptions.errorValue;
				row[tooltipField] = t('tableDataStore.formulaParseFailed', { error: compileError });
				continue;
			}

			if (!formulasEnabled) {
				row[tooltipField] = t('tableDataStore.formulaDisabled', { limit: String(this.formulaOptions.rowLimit) });
				continue;
			}

                        const compiled = this.formulaColumns.get(columnName);
                        if (!compiled) {
                                continue;
                        }

			const { value, error } = evaluateFormula(compiled, row);
			if (error) {
				row[columnName] = this.formulaOptions.errorValue;
				row[tooltipField] = t('tableDataStore.formulaError', { error });
			} else {
				row[columnName] = value;
				row[tooltipField] = '';
			}
                }
        }

	private generateUniqueColumnName(base: string): string {
		const fallback = t('tableDataStore.newColumnName');
		const normalizedBase = base.trim().length > 0 ? base.trim() : fallback;
                if (!this.schema) {
                        return normalizedBase;
                }
                const existing = new Set(this.schema.columnNames);
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

        private insertColumnInternal(options: {
                newName: string;
                afterField?: string | null;
                templateField?: string | null;
                copyData?: boolean;
        }): boolean {
                if (!this.schema) {
                        return false;
                }
                const trimmedName = options.newName.trim();
                if (!trimmedName || this.schema.columnNames.includes(trimmedName)) {
                        return false;
                }
                let insertIndex = this.schema.columnNames.length;
                if (options.afterField) {
                        const idx = this.schema.columnNames.indexOf(options.afterField);
                        if (idx !== -1) {
                                insertIndex = idx + 1;
                        }
                }
                this.schema.columnNames.splice(insertIndex, 0, trimmedName);

                const templateField = options.templateField ?? null;
                const currentConfigs = this.schema.columnConfigs ?? [];
                const clonedConfigs = currentConfigs.map((config) => ({ ...config }));
                if (templateField) {
                        const sourceConfig = currentConfigs.find((config) => config.name === templateField) ?? null;
                        if (sourceConfig) {
                                clonedConfigs.push({ ...sourceConfig, name: trimmedName });
                        } else {
                                const compiled = this.formulaColumns.get(templateField);
                                if (compiled) {
                                        clonedConfigs.push({ name: trimmedName, formula: compiled.original });
                                }
                        }
                }
                this.schema.columnConfigs = this.normalizeColumnConfigs(clonedConfigs);

                const shouldCopyData = Boolean(options.copyData && templateField);
                for (const block of this.blocks) {
                        const baseValue = shouldCopyData && templateField
                                ? block.data[templateField] ?? ''
                                : '';
                        block.data[trimmedName] = baseValue;
                }

                if (templateField && this.hiddenSortableFields.has(templateField)) {
                        this.hiddenSortableFields.add(trimmedName);
                }

                return true;
        }

        public normalizeColumnConfigs(configs: ColumnConfig[] | undefined): ColumnConfig[] | undefined {
                if (!configs || configs.length === 0) {
                        return undefined;
                }
                if (!this.schema) {
                        return configs;
                }
                const orderMap = new Map<string, number>();
                this.schema.columnNames.forEach((name, index) => orderMap.set(name, index));
                const filtered = configs.filter((config) => orderMap.has(config.name));
                if (filtered.length === 0) {
                        return undefined;
                }
                filtered.sort((a, b) => (orderMap.get(a.name) ?? 0) - (orderMap.get(b.name) ?? 0));
                return filtered;
        }
}

