const CHINESE_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function composeBoardName(base: string, index: number, locale: string): string {
	const normalizedBase = base.length > 0 ? base : 'Board';
	if (locale === 'zh') {
		return `${normalizedBase}${toChineseNumeral(index)}`;
	}
	return normalizedBase.length > 0 ? `${normalizedBase} ${index}` : `Board ${index}`;
}

function toChineseNumeral(value: number): string {
	if (!Number.isFinite(value) || value <= 0) {
		return String(value);
	}
	if (value <= 9) {
		return CHINESE_DIGITS[value];
	}
	if (value === 10) {
		return '十';
	}
	if (value < 20) {
		const units = value % 10;
		return `十${units === 0 ? '' : CHINESE_DIGITS[units]}`;
	}
	if (value < 100) {
		const tens = Math.floor(value / 10);
		const units = value % 10;
		const tensLabel = tens === 1 ? '十' : `${CHINESE_DIGITS[tens]}十`;
		return units === 0 ? tensLabel : `${tensLabel}${CHINESE_DIGITS[units]}`;
	}
	return String(value);
}
