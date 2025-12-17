import de from '../locales/de.json';
import en from '../locales/en.json';
import es from '../locales/es.json';
import fr from '../locales/fr.json';
import it from '../locales/it.json';
import ja from '../locales/ja.json';
import ko from '../locales/ko.json';
import nl from '../locales/nl.json';
import pl from '../locales/pl.json';
import pt from '../locales/pt.json';
import zhHans from '../locales/zh-hans.json';
import zhHant from '../locales/zh-hant.json';

const locales = {
	en,
	de,
	es,
	fr,
	it,
	nl,
	pl,
	pt,
	ja,
	ko,
	'zh-hans': zhHans,
	'zh-hant': zhHant
} as const;

type LocaleMap = typeof locales;
export type LocaleCode = keyof LocaleMap;
type LocaleAliasMap = Partial<Record<string, LocaleCode>>;
type LocaleTree = LocaleMap[LocaleCode];
type TranslationTree = typeof en;

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

export type TranslationKey = Exclude<LeafPaths<TranslationTree>, ''>;

const FALLBACK_LOCALE: LocaleCode = 'en';
const LOCALE_ALIASES: LocaleAliasMap = {
	zh: 'zh-hans',
	'zh-cn': 'zh-hans',
	'zh-sg': 'zh-hans',
	'zh-tw': 'zh-hant',
	'zh-hk': 'zh-hant',
	'zh-mo': 'zh-hant'
};
const GLOBAL_LOCALE_KEY = '__TILE_LINE_BASE_ACTIVE_LOCALE__';
const globalScope: Record<string, LocaleCode | undefined> =
	typeof window !== 'undefined'
		? (window as unknown as Record<string, LocaleCode | undefined>)
		: (globalThis as unknown as Record<string, LocaleCode | undefined>);

let activeLocale: LocaleCode = globalScope[GLOBAL_LOCALE_KEY] ?? FALLBACK_LOCALE;
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
	const alias = LOCALE_ALIASES[normalized];
	if (alias) {
		return alias;
	}
	if (hasOwn(locales, normalized as PropertyKey)) {
		return normalized as LocaleCode;
	}
	const primary = normalized.split('-')[0];
	const primaryAlias = LOCALE_ALIASES[primary];
	if (primaryAlias) {
		return primaryAlias;
	}
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
	if (hasOwn(locales, locale)) {
		activeLocale = locale;
		globalScope[GLOBAL_LOCALE_KEY] = locale;
	}
}

export function getLocaleCode(): LocaleCode {
	return globalScope[GLOBAL_LOCALE_KEY] ?? activeLocale;
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
