/**
 * 日期时间工具函数
 */

export type DateFormatPreset = 'iso' | 'short' | 'long';

const DATE_FORMAT_PRESETS: DateFormatPreset[] = ['iso', 'short', 'long'];

/**
 * 将 Date 对象格式化为本地时间字符串
 * 格式：2025-10-13 14:30:25
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

/**
 * 获取当前本地时间字符串
 */
export function getCurrentLocalDateTime(): string {
	return formatLocalDateTime(new Date());
}

/**
 * 规范化日期格式配置，返回支持的预设值（默认 iso）
 */
export function normalizeDateFormatPreset(value: string | null | undefined): DateFormatPreset {
	const trimmed = value?.trim().toLowerCase();
	if (!trimmed) {
		return 'iso';
	}
	return (DATE_FORMAT_PRESETS.includes(trimmed as DateFormatPreset) ? trimmed : 'iso') as DateFormatPreset;
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
 * 将用户输入的日期字符串规范化为 ISO 格式（yyyy-MM-dd）。
 * 若无法解析则返回原始输入的裁剪值。
 */
export function normalizeDateInput(value: string): string {
	const trimmed = (value ?? '').trim();
	if (!trimmed) {
		return '';
	}

	const parts = parseDateParts(trimmed);
	if (!parts) {
		return trimmed;
	}
	return formatIsoFromParts(parts);
}

/**
 * 按预设样式格式化日期值用于展示。
 * 若无法解析则回退为原始字符串。
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

	if (format === 'iso') {
		return formatIsoFromParts(parts);
	}

	const locale = localeOverride?.trim() || getDisplayLocale();
	const date = new Date(parts.year, parts.month - 1, parts.day);
	const formatter = new Intl.DateTimeFormat(locale, {
		dateStyle: format === 'long' ? 'long' : 'short'
	});
	return formatter.format(date);
}
