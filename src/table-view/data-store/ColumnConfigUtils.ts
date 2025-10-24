import type { ColumnConfig } from '../MarkdownBlockParser';

export function hasColumnConfigContent(config: ColumnConfig): boolean {
	return Boolean(
		(config.width && config.width.trim().length > 0) ||
		(config.unit && config.unit.trim().length > 0) ||
		config.hide ||
		(config.formula && config.formula.trim().length > 0)
	);
}

export function serializeColumnConfig(config: ColumnConfig): string {
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
