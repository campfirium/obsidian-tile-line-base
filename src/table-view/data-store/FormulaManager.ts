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
import {
	formatDateForDisplay,
	formatTimeForDisplay,
	normalizeDateFormatPreset,
	normalizeTimeFormatPreset
} from '../../utils/datetime';

export interface FormulaState {
	columns: Map<string, CompiledFormula>;
	compileErrors: Map<string, string>;
	columnOrder: string[];
	limitNoticeIssued: boolean;
	formats: Map<string, FormulaFormatPreset>;
	displayFormatters: Map<string, (value: unknown) => string>;
}

export function createFormulaState(): FormulaState {
	return {
		columns: new Map<string, CompiledFormula>(),
		compileErrors: new Map<string, string>(),
		columnOrder: [],
		limitNoticeIssued: false,
		formats: new Map<string, FormulaFormatPreset>(),
		displayFormatters: new Map<string, (value: unknown) => string>()
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
	state.displayFormatters.clear();

	if (!columnConfigs) {
		if (schema) {
			schema.columnConfigs = undefined;
		}
		return;
	}

	if (schema) {
		schema.columnConfigs = columnConfigs;
	}

	const configsSource = schema?.columnConfigs ?? columnConfigs ?? [];
	for (const config of configsSource) {
		if (config.type === 'date') {
			const preset = normalizeDateFormatPreset(config.dateFormat ?? null);
			state.displayFormatters.set(config.name, (value: unknown) =>
				formatDateForDisplay(value, preset)
			);
		} else if (config.type === 'time') {
			const preset = normalizeTimeFormatPreset(config.timeFormat ?? null);
			state.displayFormatters.set(config.name, (value: unknown) =>
				formatTimeForDisplay(value, preset)
			);
		}
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
		const { value, error, kind, numericValue } = evaluateFormula(compiled, row, (field) =>
			resolveFormulaContextValue(state, row, field)
		);
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

function resolveFormulaContextValue(state: FormulaState, row: RowData, field: string): unknown {
	const formatter = state.displayFormatters.get(field);
	const rawValue = row[field];
	if (!formatter) {
		return rawValue;
	}
	try {
		return formatter(rawValue);
	} catch {
		return rawValue;
	}
}
