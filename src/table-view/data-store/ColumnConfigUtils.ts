import type { ColumnConfig } from '../MarkdownBlockParser';
import { normalizeDateFormatPreset, normalizeTimeFormatPreset } from '../../utils/datetime';
import { getFormulaFormatPattern } from '../formulaFormatPresets';

export function hasColumnConfigContent(config: ColumnConfig): boolean {
	const preset = config.dateFormat ? normalizeDateFormatPreset(config.dateFormat) : null;
	const timePreset = config.timeFormat ? normalizeTimeFormatPreset(config.timeFormat) : null;
	return Boolean(
		(config.width && config.width.trim().length > 0) ||
		(config.unit && config.unit.trim().length > 0) ||
		config.hide ||
		(config.formula && config.formula.trim().length > 0) ||
		(config.formulaFormat && config.formulaFormat !== 'auto') ||
		config.type === 'date' ||
		config.type === 'time' ||
		config.type === 'text' ||
		config.type === 'image' ||
		(preset && preset !== 'iso') ||
		(timePreset && timePreset !== 'hh_mm')
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
	const formatPattern = getFormulaFormatPattern(config.formulaFormat);
	if (formatPattern) {
		segments.push(`format: ${formatPattern}`);
	}
	if (config.type === 'date') {
		segments.push('type: date');
		const preset = normalizeDateFormatPreset(config.dateFormat ?? null);
		if (preset !== 'iso') {
			segments.push(`dateFormat: ${preset}`);
		}
	} else if (config.type === 'time') {
		segments.push('type: time');
		const preset = normalizeTimeFormatPreset(config.timeFormat ?? null);
		if (preset !== 'hh_mm') {
			segments.push(`timeFormat: ${preset}`);
		}
	} else if (config.type === 'text') {
		segments.push('type: text');
	} else if (config.type === 'image') {
		segments.push('type: image');
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
