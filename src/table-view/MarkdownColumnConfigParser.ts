import type { ColumnConfig } from './MarkdownBlockParser';
import { normalizeDateFormatPreset, normalizeTimeFormatPreset } from '../utils/datetime';
import { normalizeFormulaFormatPreset } from './formulaFormatPresets';


export function parseColumnDefinition(line: string): ColumnConfig | null {
	const trimmed = line.trim();
	if (trimmed.length === 0) {
		return null;
	}

	const config: ColumnConfig = { name: '' };
	const length = trimmed.length;
	let index = 0;
	let nameBuilder = '';

	while (index < length) {
		const char = trimmed[index];
		if (char !== '(') {
			nameBuilder += char;
			index++;
			continue;
		}

		const closingIndex = findMatchingParenthesis(trimmed, index);
		if (closingIndex === -1) {
			nameBuilder += char;
			index++;
			continue;
		}

		const segment = trimmed.slice(index + 1, closingIndex);
		if (isConfigSegment(segment)) {
			applyColumnConfigSegment(config, segment);
		} else {
			nameBuilder += trimmed.slice(index, closingIndex + 1);
		}

		index = closingIndex + 1;
	}

	const normalizedName = nameBuilder.trim();
	if (normalizedName.length === 0) {
		config.name = trimmed;
	} else {
		config.name = normalizedName.replace(/\s+/g, ' ');
	}

	if (config.name.length === 0) {
		return null;
	}

	return config;
}

function applyColumnConfigSegment(config: ColumnConfig, segment: string): void {
	const colonIndex = segment.indexOf(':');
	if (colonIndex === -1) {
		if (segment.trim().toLowerCase() === 'hide') {
			config.hide = true;
		}
		return;
	}

	const key = segment.slice(0, colonIndex).trim();
	let value = segment.slice(colonIndex + 1).trim();
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		value = value.slice(1, -1);
	}

	switch (key) {
		case 'width':
			config.width = value;
			break;
		case 'unit':
			config.unit = value;
			break;
		case 'formula':
			config.formula = value;
			break;
		case 'type': {
			const normalizedType = value.trim().toLowerCase();
			if (normalizedType === 'date') {
				config.type = 'date';
			} else if (normalizedType === 'time') {
				config.type = 'time';
			} else if (normalizedType === 'text') {
				config.type = 'text';
			}
			break;
		}
		case 'dateFormat': {
			const preset = normalizeDateFormatPreset(value);
			config.dateFormat = preset;
			break;
		}
		case 'timeFormat': {
			const preset = normalizeTimeFormatPreset(value);
			config.timeFormat = preset;
			break;
		}
		case 'format': {
			const preset = normalizeFormulaFormatPreset(value);
			if (preset && preset !== 'auto') {
				config.formulaFormat = preset;
			} else {
				delete config.formulaFormat;
			}
			break;
		}
	}
}

function isConfigSegment(segment: string): boolean {
	if (!segment || segment.trim().length === 0) {
		return false;
	}
	const normalized = segment.trim().toLowerCase();
	if (normalized === 'hide') {
		return true;
	}
	const colonIndex = segment.indexOf(':');
	if (colonIndex === -1) {
		return false;
	}
	const key = segment.slice(0, colonIndex).trim().toLowerCase();
	return (
		key === 'width' ||
		key === 'unit' ||
		key === 'formula' ||
		key === 'type' ||
		key === 'dateformat' ||
		key === 'timeformat' ||
		key === 'format'
	);
}

function findMatchingParenthesis(source: string, startIndex: number): number {
	let depth = 0;
	for (let i = startIndex; i < source.length; i++) {
		const current = source[i];
		if (current === '(') {
			depth++;
		} else if (current === ')') {
			depth--;
			if (depth === 0) {
				return i;
			}
		}
	}
	return -1;
}

