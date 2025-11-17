import type { App } from 'obsidian';
import type { TileLineBaseSettings } from '../services/SettingsService';
import { applyEnvironmentLocale, type LocaleResolutionResult } from '../i18n/localeEnvironment';
import { getLogger } from '../utils/logger';
import type { TableViewTitleRefresher } from './TableViewTitleRefresher';
import type { ViewActionManager } from './ViewActionManager';

const logger = getLogger('plugin:locale-sync');

interface LocaleSyncOptions {
	app: App;
	settings: TileLineBaseSettings;
	titleRefresher: TableViewTitleRefresher | null;
	viewActionManager: ViewActionManager | null;
}

export function syncLocale(options: LocaleSyncOptions): LocaleResolutionResult {
	const result = applyEnvironmentLocale(options.app, options.settings);
	logger.debug('applyLocaleSettings', { locale: result.locale, candidates: result.candidates });
	options.app.workspace.trigger('tile-line-base:locale-changed', result.locale);
	options.titleRefresher?.refreshAll();
	options.viewActionManager?.refreshAll();
	return result;
}
