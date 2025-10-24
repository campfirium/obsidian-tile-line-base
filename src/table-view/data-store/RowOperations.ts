import type { H2Block } from '../MarkdownBlockParser';
import type { Schema } from '../SchemaBuilder';

interface AddRowParams {
	schema: Schema | null;
	blocks: H2Block[];
	beforeRowIndex?: number | null;
	prefills?: Record<string, string>;
	newRowPrefix: string;
	getTimestamp: () => string;
}

export function addRow(params: AddRowParams): number {
	const { schema, blocks, beforeRowIndex, prefills, newRowPrefix, getTimestamp } = params;
	if (!schema) {
		return -1;
	}

	const entryNumber = blocks.length + 1;
	const newBlock: H2Block = {
		title: '',
		data: {}
	};

	for (let i = 0; i < schema.columnNames.length; i++) {
		const key = schema.columnNames[i];
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

	newBlock.data['statusChanged'] = getTimestamp();

	if (beforeRowIndex !== undefined && beforeRowIndex !== null) {
		blocks.splice(beforeRowIndex, 0, newBlock);
		return beforeRowIndex;
	}

	blocks.push(newBlock);
	return blocks.length - 1;
}

export function deleteRow(schema: Schema | null, blocks: H2Block[], rowIndex: number): number | null {
	if (!schema) {
		return null;
	}
	if (rowIndex < 0 || rowIndex >= blocks.length) {
		return null;
	}
	blocks.splice(rowIndex, 1);
	if (blocks.length === 0) {
		return null;
	}
	return Math.min(rowIndex, blocks.length - 1);
}

export function deleteRows(schema: Schema | null, blocks: H2Block[], rowIndexes: number[]): number | null {
	if (!schema || rowIndexes.length === 0) {
		return null;
	}

	const sorted = [...rowIndexes].sort((a, b) => b - a);
	for (const index of sorted) {
		if (index >= 0 && index < blocks.length) {
			blocks.splice(index, 1);
		}
	}

	if (blocks.length === 0) {
		return null;
	}

	const minIndex = Math.min(...rowIndexes);
	return Math.min(minIndex, blocks.length - 1);
}

export function duplicateRow(schema: Schema | null, blocks: H2Block[], rowIndex: number): number | null {
	if (!schema) {
		return null;
	}
	if (rowIndex < 0 || rowIndex >= blocks.length) {
		return null;
	}

	const source = blocks[rowIndex];
	const duplicated: H2Block = {
		title: source.title,
		data: { ...source.data }
	};
	blocks.splice(rowIndex + 1, 0, duplicated);
	return rowIndex + 1;
}

export function duplicateRows(schema: Schema | null, blocks: H2Block[], rowIndexes: number[]): number | null {
	if (!schema || rowIndexes.length === 0) {
		return null;
	}

	const sorted = [...rowIndexes].sort((a, b) => b - a);
	for (const index of sorted) {
		if (index < 0 || index >= blocks.length) {
			continue;
		}
		const sourceBlock = blocks[index];
		const duplicated: H2Block = {
			title: sourceBlock.title,
			data: { ...sourceBlock.data }
		};
		blocks.splice(index + 1, 0, duplicated);
	}

	const minIndex = Math.min(...rowIndexes);
	return minIndex + 1;
}
