import en from '../locales/en.json';
import zh from '../locales/zh.json';

const locales = {
	en,
	zh
} as const;

type LocaleMap = typeof locales;
export type LocaleCode = keyof LocaleMap;
type LocaleTree = LocaleMap[LocaleCode];

type LeafPaths<T, Prefix extends string = ''> =
	T extends string
		? Prefix
		: T extends Record<string, unknown>
			? {
					[K in Extract<keyof T, string>]: LeafPaths<
						T[K],
						Prefix extends '' ? K : `${Prefix}.${K}`
					>
				}[Extract<keyof T, string>]
			: never;

export type TranslationKey = Exclude<LeafPaths<LocaleTree>, ''>;

const FALLBACK_LOCALE: LocaleCode = 'en';
let activeLocale: LocaleCode = FALLBACK_LOCALE;
const hasOwn = <T extends object>(target: T, property: PropertyKey): boolean =>
	Object.prototype.hasOwnProperty.call(target, property);

function getLocaleObject(locale: LocaleCode): LocaleTree {
	return locales[locale];
}

function resolveKey(locale: LocaleTree, path: string[]): unknown {
	return path.reduce<unknown>((current, segment) => {
		if (current && typeof current === 'object' && segment in current) {
			return (current as Record<string, unknown>)[segment];
		}
		return undefined;
	}, locale);
}

function applyReplacements(template: string, replacements?: Record<string, string | number>): string {
	if (!replacements) {
		return template;
	}
	return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
		const replacement = replacements[key];
		return replacement !== undefined ? String(replacement) : match;
	});
}

export function normalizeLocaleCode(localeLike: string | null | undefined): LocaleCode | null {
	if (!localeLike) {
		return null;
	}
	const normalized = localeLike.trim().toLowerCase().replace('_', '-');
	if (!normalized) {
		return null;
	}
	if (hasOwn(locales, normalized as PropertyKey)) {
		return normalized as LocaleCode;
	}
	const primary = normalized.split('-')[0];
	if (hasOwn(locales, primary as PropertyKey)) {
		return primary as LocaleCode;
	}
	return null;
}

export function resolveLocaleCode(...candidates: Array<string | null | undefined>): LocaleCode {
	for (const candidate of candidates) {
		const normalized = normalizeLocaleCode(candidate);
		if (normalized) {
			return normalized;
		}
	}
	return FALLBACK_LOCALE;
}

export function setLocale(locale: LocaleCode): void {
	if (hasOwn.call(locales, locale)) {
		activeLocale = locale;
	}
}

export function getLocaleCode(): LocaleCode {
	return activeLocale;
}

export function getAvailableLocales(): LocaleCode[] {
	return Object.keys(locales) as LocaleCode[];
}

export function t<K extends TranslationKey>(key: K, replacements?: Record<string, string | number>): string {
	const path = key.split('.');
	const activeValue = resolveKey(getLocaleObject(activeLocale), path);
	const fallbackValue = resolveKey(getLocaleObject(FALLBACK_LOCALE), path);
	const template = typeof activeValue === 'string'
		? activeValue
		: typeof fallbackValue === 'string'
			? fallbackValue
			: key;
	return applyReplacements(template, replacements);
}
