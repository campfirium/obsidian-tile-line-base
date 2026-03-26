import { ROW_ID_FIELD, type RowData } from '../../grid/GridAdapter';
import type { Schema } from '../SchemaBuilder';
import { buildDisplayList } from '../DisplayListBuilder';
import { applyFormulaResults, shouldNotifyFormulaLimit, type FormulaState } from './FormulaManager';
import type { ExtractRowOptions, FormulaOptions } from './types';

interface ExtractRowDataParams {
	schema: Schema | null;
	blocks: Parameters<typeof buildDisplayList>[0]['blocks'];
	hiddenSortableFields: Set<string>;
	formulaState: FormulaState;
	formulaOptions: FormulaOptions;
	options?: ExtractRowOptions;
	getTimestamp: () => string;
}

export function extractRowData(params: ExtractRowDataParams): RowData[] {
	const { schema, blocks, hiddenSortableFields, formulaState, formulaOptions, options, getTimestamp } = params;
	if (!schema) {
		return [];
	}

	const displayList = buildDisplayList({
		schema,
		blocks,
		hiddenSortableFields,
		getTimestamp
	});
	const data = displayList.rows;
	const rowCount = data.length;
	const formulasEnabled = rowCount <= formulaOptions.rowLimit;

	if (
		!formulasEnabled &&
		shouldNotifyFormulaLimit(formulaState, rowCount, formulaOptions.rowLimit)
	) {
		options?.onFormulaLimitExceeded?.(formulaOptions.rowLimit);
	}

	for (let i = 0; i < data.length; i++) {
		const row = data[i];
		if (!Object.prototype.hasOwnProperty.call(row, ROW_ID_FIELD)) {
			row[ROW_ID_FIELD] = String(i);
		}
		applyFormulaResults(formulaState, formulaOptions, row, formulasEnabled);
	}

	return data;
}
