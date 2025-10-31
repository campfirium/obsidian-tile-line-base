import { compileFormula, evaluateFormula, type CompiledFormula } from '../../formula/FormulaEngine';
import type { RowData } from '../../grid/GridAdapter';
import { t } from '../../i18n';
import type { ColumnConfig } from '../MarkdownBlockParser';
import type { Schema } from '../SchemaBuilder';
import type { FormulaOptions } from './types';
import {
	formatFormulaNumber,
	type FormulaFormatPreset
} from '../formulaFormatPresets';

export interface FormulaState {
	columns: Map<string, CompiledFormula>;
	compileErrors: Map<string, string>;
	columnOrder: string[];
	limitNoticeIssued: boolean;
	formats: Map<string, FormulaFormatPreset>;
}

export function createFormulaState(): FormulaState {
	return {
		columns: new Map<string, CompiledFormula>(),
		compileErrors: new Map<string, string>(),
		columnOrder: [],
		limitNoticeIssued: false,
		formats: new Map<string, FormulaFormatPreset>()
	};
}

export function prepareFormulaColumns(
	state: FormulaState,
	schema: Schema | null,
	columnConfigs: ColumnConfig[] | null
): void {
	state.columns.clear();
	state.compileErrors.clear();
	state.columnOrder = [];
	state.limitNoticeIssued = false;
	state.formats.clear();

	if (!columnConfigs) {
		if (schema) {
			schema.columnConfigs = undefined;
		}
		return;
	}

	if (schema) {
		schema.columnConfigs = columnConfigs;
	}

	for (const config of columnConfigs) {
		if (config.formulaFormat && config.formulaFormat !== 'auto') {
			state.formats.set(config.name, config.formulaFormat);
		}

		const rawFormula = config.formula?.trim();
		if (!rawFormula) {
			continue;
		}
		state.columnOrder.push(config.name);
		try {
			const compiled = compileFormula(rawFormula);
			if (compiled.dependencies.includes(config.name)) {
				state.compileErrors.set(config.name, t('tableDataStore.formulaSelfReference'));
				continue;
			}
			state.columns.set(config.name, compiled);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			state.compileErrors.set(config.name, message);
		}
	}
}

export function applyFormulaResults(
	state: FormulaState,
	options: FormulaOptions,
	row: RowData,
	formulasEnabled: boolean
): void {
	if (state.columnOrder.length === 0) {
		return;
	}

	for (const columnName of state.columnOrder) {
		const tooltipField = getFormulaTooltipField(options, columnName);
		const compileError = state.compileErrors.get(columnName);
		if (compileError) {
			row[columnName] = options.errorValue;
			row[tooltipField] = t('tableDataStore.formulaParseFailed', { error: compileError });
			continue;
		}

		if (!formulasEnabled) {
			row[tooltipField] = t('tableDataStore.formulaDisabled', { limit: String(options.rowLimit) });
			continue;
		}

		const compiled = state.columns.get(columnName);
		if (!compiled) {
			continue;
		}
		const { value, error, kind, numericValue } = evaluateFormula(compiled, row);
		if (error) {
			row[columnName] = options.errorValue;
			row[tooltipField] = t('tableDataStore.formulaError', { error });
		} else {
			const preset = state.formats.get(columnName);
			if (kind === 'number' && preset && numericValue !== undefined && Number.isFinite(numericValue)) {
				const formatted = formatFormulaNumber(numericValue, preset);
				row[columnName] = formatted ?? value;
			} else {
				row[columnName] = value;
			}
			row[tooltipField] = '';
		}
	}
}

export function isFormulaColumn(state: FormulaState, name: string): boolean {
	return state.columns.has(name) || state.compileErrors.has(name);
}

export function getFormulaTooltipField(options: FormulaOptions, columnName: string): string {
	return `${options.tooltipPrefix}${columnName}`;
}

export function shouldNotifyFormulaLimit(
	state: FormulaState,
	rowCount: number,
	rowLimit: number
): boolean {
	if (rowCount <= rowLimit) {
		return false;
	}
	if (state.columnOrder.length === 0) {
		return false;
	}
	if (state.limitNoticeIssued) {
		return false;
	}
	state.limitNoticeIssued = true;
	return true;
}
