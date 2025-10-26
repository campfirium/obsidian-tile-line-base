import { getLocaleCode, type TranslationKey } from '../i18n';

export type FormulaFormatPreset =
	| 'auto'
	| 'fixed0'
	| 'fixed1'
	| 'fixed2'
	| 'fixed3'
	| 'fixed4'
	| 'fixed5'
	| 'fixed6'
	| 'thousandFixed0'
	| 'thousandFixed2'
	| 'percentFixed2';

interface FormulaFormatPresetDefinition {
	value: FormulaFormatPreset;
	labelKey: TranslationKey;
	pattern?: string;
}

const FORMAT_PRESET_DEFINITIONS: readonly FormulaFormatPresetDefinition[] = [
	{ value: 'auto', labelKey: 'columnEditorModal.formulaFormatOptionAuto' },
	{ value: 'fixed0', labelKey: 'columnEditorModal.formulaFormatOptionFixed0', pattern: '0' },
	{ value: 'fixed1', labelKey: 'columnEditorModal.formulaFormatOptionFixed1', pattern: '0.0' },
	{ value: 'fixed2', labelKey: 'columnEditorModal.formulaFormatOptionFixed2', pattern: '0.00' },
	{ value: 'fixed3', labelKey: 'columnEditorModal.formulaFormatOptionFixed3', pattern: '0.000' },
	{ value: 'fixed4', labelKey: 'columnEditorModal.formulaFormatOptionFixed4', pattern: '0.0000' },
	{ value: 'fixed5', labelKey: 'columnEditorModal.formulaFormatOptionFixed5', pattern: '0.00000' },
	{ value: 'fixed6', labelKey: 'columnEditorModal.formulaFormatOptionFixed6', pattern: '0.000000' },
	{ value: 'thousandFixed0', labelKey: 'columnEditorModal.formulaFormatOptionThousandFixed0', pattern: '#,##0' },
	{ value: 'thousandFixed2', labelKey: 'columnEditorModal.formulaFormatOptionThousandFixed2', pattern: '#,##0.00' },
	{ value: 'percentFixed2', labelKey: 'columnEditorModal.formulaFormatOptionPercentFixed2', pattern: '0.00%' }
];

const PATTERN_TO_PRESET = new Map<string, FormulaFormatPreset>(
	FORMAT_PRESET_DEFINITIONS.filter((definition) => definition.pattern).map((definition) => [
		(definition.pattern ?? '').toLowerCase(),
		definition.value
	]) as Array<[string, FormulaFormatPreset]>
);

export function getFormulaFormatPresetOptions(): readonly FormulaFormatPresetDefinition[] {
	return FORMAT_PRESET_DEFINITIONS;
}

export function normalizeFormulaFormatPreset(
	value: string | null | undefined
): FormulaFormatPreset | undefined {
	if (!value) {
		return undefined;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}
	const normalized = trimmed.toLowerCase();
	for (const definition of FORMAT_PRESET_DEFINITIONS) {
		if (definition.value.toLowerCase() === normalized) {
			return definition.value;
		}
	}
	return PATTERN_TO_PRESET.get(normalized);
}

export function getFormulaFormatPattern(preset: FormulaFormatPreset | undefined): string | undefined {
	if (!preset) {
		return undefined;
	}
	const definition = FORMAT_PRESET_DEFINITIONS.find((item) => item.value === preset);
	return definition?.pattern;
}

export function isFormulaFormatPreset(value: string | null | undefined): value is FormulaFormatPreset {
	if (!value) {
		return false;
	}
	return FORMAT_PRESET_DEFINITIONS.some((definition) => definition.value === value);
}

export function formatFormulaNumber(
	rawValue: number,
	preset: FormulaFormatPreset | undefined
): string | null {
	if (!preset || preset === 'auto') {
		return null;
	}

	const locale = getLocaleCode();
	const formatterOptions: Intl.NumberFormatOptions = {
		useGrouping: false
	};
	let value = rawValue;

	switch (preset) {
		case 'fixed0':
			formatterOptions.minimumFractionDigits = 0;
			formatterOptions.maximumFractionDigits = 0;
			break;
		case 'fixed1':
			formatterOptions.minimumFractionDigits = 1;
			formatterOptions.maximumFractionDigits = 1;
			break;
		case 'fixed2':
			formatterOptions.minimumFractionDigits = 2;
			formatterOptions.maximumFractionDigits = 2;
			break;
		case 'fixed3':
			formatterOptions.minimumFractionDigits = 3;
			formatterOptions.maximumFractionDigits = 3;
			break;
		case 'fixed4':
			formatterOptions.minimumFractionDigits = 4;
			formatterOptions.maximumFractionDigits = 4;
			break;
		case 'fixed5':
			formatterOptions.minimumFractionDigits = 5;
			formatterOptions.maximumFractionDigits = 5;
			break;
		case 'fixed6':
			formatterOptions.minimumFractionDigits = 6;
			formatterOptions.maximumFractionDigits = 6;
			break;
		case 'thousandFixed0':
			formatterOptions.useGrouping = true;
			formatterOptions.minimumFractionDigits = 0;
			formatterOptions.maximumFractionDigits = 0;
			break;
		case 'thousandFixed2':
			formatterOptions.useGrouping = true;
			formatterOptions.minimumFractionDigits = 2;
			formatterOptions.maximumFractionDigits = 2;
			break;
		case 'percentFixed2':
			value = value * 100;
			formatterOptions.minimumFractionDigits = 2;
			formatterOptions.maximumFractionDigits = 2;
			formatterOptions.useGrouping = false;
			return `${value.toLocaleString(locale, formatterOptions)}%`;
		default:
			return null;
	}

	return value.toLocaleString(locale, formatterOptions);
}
