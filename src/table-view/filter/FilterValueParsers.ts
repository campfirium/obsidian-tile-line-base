import { normalizeTimeInput } from '../../utils/datetime';

const NUMERIC_PATTERN = /^[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?$/i;
const ISO_TIME_PATTERN = /^\d{2}:\d{2}:\d{2}$/;

function coerceYear(value: number): number | null {
	if (!Number.isFinite(value)) {
		return null;
	}
	if (value >= 1000) {
		return value;
	}
	if (value >= 0 && value < 100) {
		return value + 2000;
	}
	return null;
}

function parseDelimitedDate(parts: string[], separator: '/' | '-' | '.'): number | null {
	if (parts.length !== 3) {
		return null;
	}

	const rawA = Number.parseInt(parts[0], 10);
	const rawB = Number.parseInt(parts[1], 10);
	const rawC = Number.parseInt(parts[2], 10);

	const year = separator === '-'
		? coerceYear(rawA)
		: coerceYear(rawC);

	if (year === null) {
		return null;
	}

	const build = (month: number, day: number): number | null => {
		if (!Number.isFinite(month) || !Number.isFinite(day)) {
			return null;
		}
		if (month < 1 || month > 12 || day < 1 || day > 31) {
			return null;
		}
		const pad = (value: number) => value.toString().padStart(2, '0');
		const parsed = Date.parse(`${year}-${pad(month)}-${pad(day)}`);
		return Number.isNaN(parsed) ? null : parsed;
	};

	if (separator === '-') {
		return build(rawB, rawC);
	}

	const candidateMonthFirst = build(rawA, rawB);
	const candidateDayFirst = build(rawB, rawA);

	if (candidateMonthFirst !== null && candidateDayFirst !== null) {
		return Math.min(candidateMonthFirst, candidateDayFirst);
	}
	return candidateMonthFirst ?? candidateDayFirst;
}

export function tryParseNumber(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	if (value == null) {
		return null;
	}
	const text = String(value).trim();
	if (text.length === 0) {
		return null;
	}
	if (!NUMERIC_PATTERN.test(text)) {
		return null;
	}
	const parsed = Number(text);
	return Number.isFinite(parsed) ? parsed : null;
}

export function tryParseDate(value: unknown): number | null {
	if (value instanceof Date) {
		const time = value.getTime();
		return Number.isNaN(time) ? null : time;
	}
	if (value == null) {
		return null;
	}
	const text = String(value).trim();
	if (text.length === 0) {
		return null;
	}

	const direct = Date.parse(text);
	if (!Number.isNaN(direct)) {
		return direct;
	}

	const normalized = text.replace(/[.]/g, '-').replace(/\s+/g, ' ').trim();
	if (normalized !== text) {
		const normalizedParsed = Date.parse(normalized);
		if (!Number.isNaN(normalizedParsed)) {
			return normalizedParsed;
		}
	}

	const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
	if (slashMatch) {
		const parts = [slashMatch[1], slashMatch[2], slashMatch[3]];
		const parsed = parseDelimitedDate(parts, '/');
		if (parsed !== null) {
			return parsed;
		}
	}

	const dotMatch = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
	if (dotMatch) {
		const parts = [dotMatch[1], dotMatch[2], dotMatch[3]];
		const parsed = parseDelimitedDate(parts, '.');
		if (parsed !== null) {
			return parsed;
		}
	}

	const dashMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
	if (dashMatch) {
		const parts = [dashMatch[1], dashMatch[2], dashMatch[3]];
		const parsed = parseDelimitedDate(parts, '-');
		if (parsed !== null) {
			return parsed;
		}
	}

	return null;
}

export function tryParseTime(value: unknown): number | null {
	if (value instanceof Date) {
		const hours = value.getHours();
		const minutes = value.getMinutes();
		const seconds = value.getSeconds();
		return ((hours * 60 + minutes) * 60 + seconds) * 1000;
	}
	if (value == null) {
		return null;
	}
	const text = String(value).trim();
	if (text.length === 0) {
		return null;
	}
	const normalized = normalizeTimeInput(text);
	if (!ISO_TIME_PATTERN.test(normalized)) {
		return null;
	}
	const [hourStr, minuteStr, secondStr] = normalized.split(':');
	const hour = Number.parseInt(hourStr, 10);
	const minute = Number.parseInt(minuteStr, 10);
	const second = Number.parseInt(secondStr, 10);
	if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) {
		return null;
	}
	return ((hour * 60 + minute) * 60 + second) * 1000;
}
