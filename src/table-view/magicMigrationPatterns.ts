export function countPlaceholders(template: string): number {
	return (template.match(/\*/g) ?? []).length;
}

export function buildColumnNames(placeholderCount: number, columnNames: string[]): string[] {
	const columns: string[] = [];
	const count = Math.max(placeholderCount, 1);
	for (let index = 0; index < count; index++) {
		const override = (columnNames[index] ?? '').trim();
		columns.push(override || `Column ${index + 1}`);
	}
	return columns;
}

export function normalizeCapturedValue(raw: string): string {
	return raw.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

export function buildRecordUnits(content: string, sample: string, isSingleStar: boolean, template: string): string[] {
	if (isSingleStar) {
		if (sample.includes('\n')) {
			return content
				.split(/\n\s*\n/)
				.map((block) => block.trim())
				.filter((block) => block.length > 0);
		}
		return content
			.split(/\n+/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	}

	if (template.includes('\n')) {
		return content
			.split(/\n\s*\n/)
			.map((block) => block.trim())
			.filter((block) => block.length > 0);
	}

	return content
		.split(/\n+/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

export function buildRegex(
	template: string,
	placeholderCount: number,
	logger: { warn: (...args: unknown[]) => void }
): RegExp | null {
	const trimmed = template.trim();
	if (placeholderCount === 0) {
		return null;
	}

	const tokens = trimmed.split('*');
	const parts: string[] = [];
	parts.push('^');

	for (let index = 0; index < placeholderCount; index++) {
		const literal = tokens[index] ?? '';
		if (literal.length > 0) {
			parts.push(escapeLiteral(literal));
		}
		const isLast = index === placeholderCount - 1;
		parts.push(isLast ? '([\\s\\S]+)' : '([\\s\\S]+?)');
	}

	const tailLiteral = tokens[placeholderCount] ?? '';
	if (tailLiteral.length > 0) {
		parts.push(escapeLiteral(tailLiteral));
	}
	parts.push('$');

	try {
		return new RegExp(parts.join(''), 'u');
	} catch (error) {
		logger.warn('Failed to compile star template', error);
		return null;
	}
}

function escapeLiteral(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}
