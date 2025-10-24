import { ROW_ID_FIELD, type RowData } from '../../grid/GridAdapter';
import type { H2Block } from '../MarkdownBlockParser';
import type { Schema } from '../SchemaBuilder';
import { applyFormulaResults, shouldNotifyFormulaLimit, type FormulaState } from './FormulaManager';
import type { ExtractRowOptions, FormulaOptions } from './types';

interface ExtractRowDataParams {
	schema: Schema | null;
	blocks: H2Block[];
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

	const data: RowData[] = [];
	const rowCount = blocks.length;
	const formulasEnabled = rowCount <= formulaOptions.rowLimit;

	if (
		!formulasEnabled &&
		shouldNotifyFormulaLimit(formulaState, rowCount, formulaOptions.rowLimit)
	) {
		options?.onFormulaLimitExceeded?.(formulaOptions.rowLimit);
	}

	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];
		const row: RowData = {};

		row['#'] = String(i + 1);
		row[ROW_ID_FIELD] = String(i);

		for (const key of schema.columnNames) {
			if (key === 'status' && !block.data[key]) {
				block.data[key] = 'todo';
				if (!block.data['statusChanged']) {
					block.data['statusChanged'] = getTimestamp();
				}
			}
			row[key] = block.data[key] || '';
		}

		for (const hiddenField of hiddenSortableFields) {
			if (hiddenField === '#') {
				continue;
			}
			row[hiddenField] = block.data[hiddenField] || '';
		}

		applyFormulaResults(formulaState, formulaOptions, row, formulasEnabled);

		data.push(row);
	}

	return data;
}
