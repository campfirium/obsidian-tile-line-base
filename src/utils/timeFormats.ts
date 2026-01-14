import type { TranslationKey } from '../i18n';
import { getLogger } from './logger';

const logger = getLogger('utils:timeFormats');

export type TimeFormatPreset =
	| 'hh_mm'
	| 'hh_mm_ss'
	| 'h_mm_a'
	| 'h_mm_ss_a'
	| 'en_h_mm_a'
	| 'en_h_mm_ss_a';

const TIME_FORMAT_PRESETS: readonly TimeFormatPreset[] = [
	'hh_mm',
	'hh_mm_ss',
	'h_mm_a',
	'h_mm_ss_a',
	'en_h_mm_a',
	'en_h_mm_ss_a'
] as const;

type TimeFormatFormatter = (parts: TimeParts, locale: string) => string;

interface TimeFormatDefinition {
	labelKey: TranslationKey;
	formatter: TimeFormatFormatter;
}

interface TimeParts {
	hour: number;
	minute: number;
	second: number;
}

export function normalizeTimeFormatPreset(value: string | null | undefined): TimeFormatPreset {
	const trimmed = value?.trim();
	if (!trimmed) {
		return 'hh_mm';
	}
	const normalized = trimmed.toLowerCase().replace(/[\s-]+/g, '_');
	return isKnownTimeFormat(normalized) ? normalized : 'hh_mm';
}

export function normalizeTimeInput(value: string): string {
	const trimmed = (value ?? '').trim();
	if (!trimmed) {
		return '';
	}

	const lowered = trimmed.toLowerCase();
	if (lowered === 'now' || lowered === 'current') {
		return formatIsoTime(getCurrentTimeParts());
}

	const flexible = interpretFlexibleTime(trimmed);
	if (flexible) {
		return formatIsoTime(flexible);
	}

	const direct = parseDirectTimeString(trimmed);
	if (direct) {
		return formatIsoTime(direct);
	}

	return trimmed;
}

export function formatTimeForDisplay(
	value: unknown,
	format: TimeFormatPreset,
	localeOverride?: string | null
): string {
	const stringValue = typeof value === 'string' ? value.trim() : '';
	if (!stringValue) {
		return '';
	}

	const parts = parseTimeParts(stringValue);
	if (!parts) {
		return stringValue;
	}

	const locale = localeOverride?.trim() || getDisplayLocale();
	const definition = getTimeDefinition(format);
	try {
		return definition.formatter(parts, locale);
	} catch (error) {
		logger.error('[TileLineBase] Failed to format time', { format, value, error });
		return formatIsoTime(parts);
	}
}

export function getTimeFormatLabel(format: TimeFormatPreset): string {
	const definition = getTimeDefinition(format);
	const locale = getLabelLocale(format);
	return definition.formatter(SAMPLE_TIME, locale);
}

export function getTimeFormatOptions(): Array<{ value: TimeFormatPreset; label: string }> {
	return TIME_FORMAT_PRESETS.map((preset) => ({
		value: preset,
		label: getTimeFormatLabel(preset)
	}));
}

const SAMPLE_TIME: TimeParts = { hour: 14, minute: 30, second: 45 };

const TIME_FORMAT_DEFINITIONS: Record<TimeFormatPreset, TimeFormatDefinition> = {
	hh_mm: {
		labelKey: 'timeFormats.hhMm',
		formatter: (parts) => `${pad2(parts.hour)}:${pad2(parts.minute)}`
	},
	hh_mm_ss: {
		labelKey: 'timeFormats.hhMmSs',
		formatter: (parts) => `${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`
	},
	h_mm_a: {
		labelKey: 'timeFormats.hMmA',
		formatter: (parts, locale) =>
			formatTimeWithIntl(locale, { hour: 'numeric', minute: 'numeric', hour12: true }, parts)
	},
	h_mm_ss_a: {
		labelKey: 'timeFormats.hMmSsA',
		formatter: (parts, locale) =>
			formatTimeWithIntl(
				locale,
				{ hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: true },
				parts
			)
	},
	en_h_mm_a: {
		labelKey: 'timeFormats.enHMmA',
		formatter: (parts) =>
			formatTimeWithIntl('en-US', { hour: 'numeric', minute: 'numeric', hour12: true }, parts)
	},
	en_h_mm_ss_a: {
		labelKey: 'timeFormats.enHMmSsA',
		formatter: (parts) =>
			formatTimeWithIntl(
				'en-US',
				{ hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: true },
				parts
			)
	}
};

function isKnownTimeFormat(value: string): value is TimeFormatPreset {
	return TIME_FORMAT_PRESETS.some((preset) => preset === value);
}

function getTimeDefinition(format: TimeFormatPreset): TimeFormatDefinition {
	return TIME_FORMAT_DEFINITIONS[format] ?? TIME_FORMAT_DEFINITIONS.hh_mm;
}

function getDisplayLocale(): string {
	const navigatorLocale =
		typeof navigator !== 'undefined' && typeof navigator.language === 'string'
			? navigator.language
			: undefined;
	const intlLocale =
		typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().locale : undefined;

	return intlLocale || navigatorLocale || 'en-US';
}

function getLabelLocale(format: TimeFormatPreset): string {
	return format.startsWith('en_') ? 'en-US' : getDisplayLocale();
}

function pad2(value: number): string {
	return String(value).padStart(2, '0');
}

function formatIsoTime(parts: TimeParts): string {
	return `${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
}

function parseDirectTimeString(raw: string): TimeParts | null {
	const normalized = raw
		.replace(/\uFF1A/g, ':')
		.replace(/[.]/g, ':')
		.trim();
	const match = normalized.match(/^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?\s*(am|pm)?$/i);
	if (!match) {
		return null;
	}
	let hour = parseInt(match[1], 10);
	const minute = match[2] ? parseInt(match[2], 10) : 0;
	const second = match[3] ? parseInt(match[3], 10) : 0;
	if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) {
		return null;
	}
	const suffix = match[4]?.toLowerCase() ?? null;
	if (suffix === 'am' || suffix === 'pm') {
		if (hour === 12) {
			hour = suffix === 'am' ? 0 : 12;
		} else if (suffix === 'pm') {
			hour += 12;
		}
	}
	if (!isValidTimeParts(hour, minute, second)) {
		return null;
	}
	return { hour, minute, second };
}

function interpretFlexibleTime(raw: string): TimeParts | null {
	const digits = raw.replace(/\D/g, '');
	if (!digits) {
		return null;
	}

	let hour = 0;
	let minute = 0;
	let second = 0;

	switch (digits.length) {
		case 1:
		case 2:
			hour = parseInt(digits, 10);
			break;
		case 3:
			hour = parseInt(digits.substring(0, 1), 10);
			minute = parseInt(digits.substring(1), 10);
			break;
		case 4:
			hour = parseInt(digits.substring(0, 2), 10);
			minute = parseInt(digits.substring(2), 10);
			break;
		case 5:
			hour = parseInt(digits.substring(0, 1), 10);
			minute = parseInt(digits.substring(1, 3), 10);
			second = parseInt(digits.substring(3, 5), 10);
			break;
		case 6:
			hour = parseInt(digits.substring(0, 2), 10);
			minute = parseInt(digits.substring(2, 4), 10);
			second = parseInt(digits.substring(4, 6), 10);
			break;
		default:
			return null;
	}

	if (!isValidTimeParts(hour, minute, second)) {
		return null;
	}

	return { hour, minute, second };
}

function parseTimeParts(value: string): TimeParts | null {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	const direct = parseDirectTimeString(trimmed);
	if (direct) {
		return direct;
	}
	return interpretFlexibleTime(trimmed);
}

function getCurrentTimeParts(): TimeParts {
	const now = new Date();
	return {
		hour: now.getHours(),
		minute: now.getMinutes(),
		second: now.getSeconds()
	};
}

function isValidTimeParts(hour: number, minute: number, second: number): boolean {
	if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) {
		return false;
	}
	if (hour < 0 || hour > 23) {
		return false;
	}
	if (minute < 0 || minute > 59) {
		return false;
	}
	if (second < 0 || second > 59) {
		return false;
	}
	return true;
}

function formatTimeWithIntl(
	locale: string,
	options: Intl.DateTimeFormatOptions,
	parts: TimeParts
): string {
	const date = new Date(1970, 0, 1, parts.hour, parts.minute, parts.second);
	return new Intl.DateTimeFormat(locale, options).format(date);
}
