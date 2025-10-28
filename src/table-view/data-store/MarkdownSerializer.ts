import type { H2Block } from '../MarkdownBlockParser';
import type { Schema } from '../SchemaBuilder';

const SYSTEM_FIELDS = new Set(['status', 'statusChanged']);

export function blockToMarkdown(schema: Schema | null, block: H2Block): string {
	if (!schema) {
		return '';
	}

	const lines: string[] = [];
	let isFirstKey = true;

	for (const key of schema.columnNames) {
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

export function blocksToMarkdown(schema: Schema | null, blocks: H2Block[]): string {
	if (!schema) {
		return '';
	}

	const lines: string[] = [];

	for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
		const block = blocks[blockIndex];
		const isSchemaBlock = blockIndex === 0;
		let isFirstKey = true;

		for (const key of schema.columnNames) {
			const rawValue = block.data[key];
			const value = rawValue ?? '';
			const hasValue = value.trim().length > 0;

			if (isFirstKey) {
				lines.push(`## ${key}：${value}`);
				isFirstKey = false;
			} else if (hasValue) {
				lines.push(`${key}：${value}`);
			} else if (isSchemaBlock) {
				lines.push(`${key}：`);
			}
		}

		if (block.data['statusChanged']) {
			lines.push(`statusChanged：${block.data['statusChanged']}`);
		}

		lines.push('');
	}

	return lines.join('\n');
}
