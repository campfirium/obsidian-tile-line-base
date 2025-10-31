import { t, type TranslationKey } from '../i18n';

/**
 * Date/time helpers
 */

export type DateFormatPreset =
	| 'iso'
	| 'ymd_slash'
	| 'ymd_dot'
	| 'mdy_slash'
	| 'dmy_slash'
	| 'short'
	| 'long'
	| 'mdy_long'
	| 'dmy_long'
	| 'month_day'
	| 'chinese_long';

const DATE_FORMAT_PRESETS: readonly DateFormatPreset[] = [
	'iso',
	'ymd_slash',
	'ymd_dot',
	'mdy_slash',
	'dmy_slash',
	'short',
	'long',
	'mdy_long',
	'dmy_long',
	'month_day',
	'chinese_long'
] as const;

type DateFormatFormatter = (parts: DateParts, locale: string) => string;

interface DateFormatDefinition {
	labelKey: TranslationKey;
	formatter: DateFormatFormatter;
}

/**
 * Format a Date instance as local datetime string (YYYY-MM-DD HH:mm:ss)
 */
export function formatLocalDateTime(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const seconds = String(date.getSeconds()).padStart(2, '0');

	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function getCurrentLocalDateTime(): string {
	return formatLocalDateTime(new Date());
}

/**
 * Normalise a user-provided preset into a supported value.
 */
export function normalizeDateFormatPreset(value: string | null | undefined): DateFormatPreset {
	const trimmed = value?.trim();
	if (!trimmed) {
		return 'iso';
	}
	const normalized = trimmed.toLowerCase().replace(/[\s-]+/g, '_');
	return isKnownDateFormat(normalized) ? (normalized as DateFormatPreset) : 'iso';
}

interface DateParts {
	year: number;
	month: number;
	day: number;
}

function parseDateParts(value: string): DateParts | null {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}

	const normalized = trimmed.replace(/[./]/g, '-');
	const simpleMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
	if (simpleMatch) {
		const year = parseInt(simpleMatch[1], 10);
		const month = parseInt(simpleMatch[2], 10);
		const day = parseInt(simpleMatch[3], 10);
		if (isValidDateParts(year, month, day)) {
			return { year, month, day };
		}
		return null;
	}

	const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})[tT]/);
	if (isoMatch) {
		const year = parseInt(isoMatch[1], 10);
		const month = parseInt(isoMatch[2], 10);
		const day = parseInt(isoMatch[3], 10);
		if (isValidDateParts(year, month, day)) {
			return { year, month, day };
		}
	}

	const timestamp = Date.parse(trimmed);
	if (!Number.isNaN(timestamp)) {
		const date = new Date(timestamp);
		const candidate: DateParts = {
			year: date.getFullYear(),
			month: date.getMonth() + 1,
			day: date.getDate()
		};
		if (isValidDateParts(candidate.year, candidate.month, candidate.day)) {
			return candidate;
		}
	}

	return null;
}

function isValidDateParts(year: number, month: number, day: number): boolean {
	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
		return false;
	}
	if (year < 0 || month < 1 || month > 12 || day < 1 || day > 31) {
		return false;
	}
	const date = new Date(year, month - 1, day);
	return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function pad2(value: number): string {
	return String(value).padStart(2, '0');
}

function formatIsoFromParts(parts: DateParts): string {
	return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function getDisplayLocale(): string {
	const navigatorLocale =
		typeof navigator !== 'undefined' && typeof navigator.language === 'string'
			? navigator.language
			: undefined;
	const intlLocale = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().locale : undefined;

	return intlLocale || navigatorLocale || 'en-US';
}

/**
 * Normalise user input into ISO format (yyyy-MM-dd).
 */
export function normalizeDateInput(value: string): string {
	const trimmed = (value ?? '').trim();
	if (!trimmed) {
		return '';
	}

	const interpreted = interpretFlexibleDate(trimmed);
	if (interpreted) {
		return interpreted;
	}

	const parts = parseDateParts(trimmed);
	if (!parts) {
		return trimmed;
	}
	return formatIsoFromParts(parts);
}

function interpretFlexibleDate(raw: string): string | null {
	const digits = raw.replace(/\D/g, '');
	if (!digits) {
		return null;
	}

	const reference = new Date();
	const currentYear = reference.getFullYear();
	const currentMonth = reference.getMonth() + 1;
	const currentDay = reference.getDate();

	let year = currentYear;
	let month = currentMonth;
	let day = currentDay;

	switch (digits.length) {
		case 1:
		case 2:
			day = parseInt(digits, 10);
			break;
		case 3:
			month = parseInt(digits.substring(0, 1), 10);
			day = parseInt(digits.substring(1), 10);
			break;
		case 4:
			month = parseInt(digits.substring(0, 2), 10);
			day = parseInt(digits.substring(2), 10);
			break;
		case 6:
			year = expandTwoDigitYear(parseInt(digits.substring(0, 2), 10), currentYear);
			month = parseInt(digits.substring(2, 4), 10);
			day = parseInt(digits.substring(4, 6), 10);
			break;
		case 8:
			year = parseInt(digits.substring(0, 4), 10);
			month = parseInt(digits.substring(4, 6), 10);
			day = parseInt(digits.substring(6, 8), 10);
			break;
		default:
			return null;
	}

	if (!isValidDateParts(year, month, day)) {
		return null;
	}

	return formatIsoFromParts({ year, month, day });
}

const DATE_FORMAT_DEFINITIONS: Record<DateFormatPreset, DateFormatDefinition> = {
	iso: {
		labelKey: 'dateFormats.iso',
		formatter: (parts) => formatIsoFromParts(parts)
	},
	ymd_slash: {
		labelKey: 'dateFormats.ymdSlash',
		formatter: (parts) => `${parts.year}/${pad2(parts.month)}/${pad2(parts.day)}`
	},
	ymd_dot: {
		labelKey: 'dateFormats.ymdDot',
		formatter: (parts) => `${parts.year}.${pad2(parts.month)}.${pad2(parts.day)}`
	},
	mdy_slash: {
		labelKey: 'dateFormats.mdySlash',
		formatter: (parts) => `${pad2(parts.month)}/${pad2(parts.day)}/${parts.year}`
	},
	dmy_slash: {
		labelKey: 'dateFormats.dmySlash',
		formatter: (parts) => `${pad2(parts.day)}/${pad2(parts.month)}/${parts.year}`
	},
	short: {
		labelKey: 'dateFormats.short',
		formatter: (parts, locale) => formatWithIntl(locale, { dateStyle: 'short' }, parts)
	},
	long: {
		labelKey: 'dateFormats.long',
		formatter: (parts, locale) => formatWithIntl(locale, { dateStyle: 'long' }, parts)
	},
	mdy_long: {
		labelKey: 'dateFormats.mdyLong',
		formatter: (parts) => formatWithIntl('en-US', { month: 'long', day: 'numeric', year: 'numeric' }, parts)
	},
	dmy_long: {
		labelKey: 'dateFormats.dmyLong',
		formatter: (parts) => formatWithIntl('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }, parts)
	},
	month_day: {
		labelKey: 'dateFormats.monthDay',
		formatter: (parts, locale) => formatWithIntl(locale, { month: 'short', day: 'numeric' }, parts)
	},
	chinese_long: {
		labelKey: 'dateFormats.chineseLong',
		formatter: (parts) => `${parts.year}年${parts.month}月${parts.day}日`
	}
};

function isKnownDateFormat(value: string): value is DateFormatPreset {
	return (DATE_FORMAT_PRESETS as readonly string[]).includes(value);
}

function getDefinition(format: DateFormatPreset): DateFormatDefinition {
	return DATE_FORMAT_DEFINITIONS[format] ?? DATE_FORMAT_DEFINITIONS.iso;
}

/**
 * Format value according to preset for display in the grid.
 */
export function formatDateForDisplay(
	value: unknown,
	format: DateFormatPreset,
	localeOverride?: string | null
): string {
	const stringValue = typeof value === 'string' ? value.trim() : '';
	if (!stringValue) {
		return '';
	}

	const parts = parseDateParts(stringValue);
	if (!parts) {
		return stringValue;
	}

	const locale = localeOverride?.trim() || getDisplayLocale();
	const definition = getDefinition(format);
	try {
		return definition.formatter(parts, locale);
	} catch (error) {
		console.error('[TileLineBase] Failed to format date', { format, value, error });
		return formatIsoFromParts(parts);
	}
}

function formatWithIntl(
	locale: string,
	options: Intl.DateTimeFormatOptions,
	parts: DateParts
): string {
	const date = new Date(parts.year, parts.month - 1, parts.day);
	return new Intl.DateTimeFormat(locale, options).format(date);
}

export function getDateFormatLabel(format: DateFormatPreset): string {
	const definition = getDefinition(format);
	return t(definition.labelKey);
}

export function getDateFormatOptions(): Array<{ value: DateFormatPreset; label: string }> {
	return DATE_FORMAT_PRESETS.map((preset) => ({
		value: preset,
		label: getDateFormatLabel(preset)
	}));
}

function expandTwoDigitYear(year: number, referenceYear: number): number {
	const referenceCentury = Math.floor(referenceYear / 100) * 100;
	let candidate = referenceCentury + year;

	if (candidate < referenceYear - 50) {
		candidate += 100;
	} else if (candidate > referenceYear + 50) {
		candidate -= 100;
	}

	return candidate;
}
