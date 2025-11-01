import type { App } from 'obsidian';
import type { TileLineBaseSettings } from '../services/SettingsService';
import { resolveLocaleCode, setLocale, type LocaleCode } from './index';

interface LocaleCandidates {
	settingsLocale: string | null;
	configLocale: string | null;
	momentLocale: string | null;
	navigatorLocale: string | null;
}

function readVaultLocale(app: App): string | null {
	try {
		const vaultWithConfig = app.vault as unknown as { getConfig?: (key: string) => unknown };
		if (typeof vaultWithConfig.getConfig !== 'function') {
			return null;
		}
		const raw = vaultWithConfig.getConfig('locale');
		return typeof raw === 'string' ? raw : null;
	} catch {
		return null;
	}
}

function readMomentLocale(): string | null {
	if (typeof window === 'undefined') {
		return null;
	}
	const globalMoment = (window as typeof window & { moment?: { locale?: () => string } }).moment;
	if (globalMoment && typeof globalMoment.locale === 'function') {
		try {
			return globalMoment.locale();
		} catch {
			return null;
		}
	}
	return null;
}

function readNavigatorLocale(): string | null {
	return typeof navigator !== 'undefined' && typeof navigator.language === 'string'
		? navigator.language
		: null;
}

function collectLocaleCandidates(app: App, settings?: TileLineBaseSettings | null): LocaleCandidates {
	const settingsLocale = (settings as { locale?: string } | null)?.locale ?? null;
	return {
		settingsLocale,
		configLocale: readVaultLocale(app),
		momentLocale: readMomentLocale(),
		navigatorLocale: readNavigatorLocale()
	};
}

export interface LocaleResolutionResult {
	locale: LocaleCode;
	candidates: LocaleCandidates;
}

export function resolveEnvironmentLocale(app: App, settings?: TileLineBaseSettings | null): LocaleResolutionResult {
	const candidates = collectLocaleCandidates(app, settings ?? null);
	const locale = resolveLocaleCode(
		candidates.settingsLocale,
		candidates.configLocale,
		candidates.momentLocale,
		candidates.navigatorLocale
	);
	return { locale, candidates };
}

export function applyEnvironmentLocale(app: App, settings?: TileLineBaseSettings | null): LocaleResolutionResult {
	const result = resolveEnvironmentLocale(app, settings ?? null);
	setLocale(result.locale);
	return result;
}
