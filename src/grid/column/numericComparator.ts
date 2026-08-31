import { formatUnknownValue } from '../../utils/valueFormat';

const NUMERIC_PATTERN = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i;

function parseFiniteNumber(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	const text = formatUnknownValue(value).trim();
	if (!NUMERIC_PATTERN.test(text)) {
		return null;
	}
	const parsed = Number(text);
	return Number.isFinite(parsed) ? parsed : null;
}

/** Compare strict numeric values while keeping malformed legacy values deterministic. */
export function compareNumericCellValues(valueA: unknown, valueB: unknown): number {
	const numberA = parseFiniteNumber(valueA);
	const numberB = parseFiniteNumber(valueB);
	if (numberA !== null && numberB !== null) {
		return numberA - numberB;
	}
	if (numberA !== null) {
		return -1;
	}
	if (numberB !== null) {
		return 1;
	}
	return formatUnknownValue(valueA).localeCompare(formatUnknownValue(valueB));
}
