import { App, Plugin, PluginSettingTab, Setting, setIcon } from 'obsidian';
import { t, getAvailableLocales, getLocaleCode, setLocale } from '../i18n';
import { computeRecommendedStripeColor } from '../table-view/stripeStyles';
import type { BorderColorMode, StripeColorMode } from '../types/appearance';
import type { LocaleCode, TranslationKey } from '../i18n';
import type { LogLevelName } from '../utils/logger';
import { getLogger } from '../utils/logger';

type SidebarSettingHost = Plugin & {
	isHideRightSidebarEnabled(): boolean;
	setHideRightSidebarEnabled(value: boolean): Promise<void>;
	getStripeColorMode(): StripeColorMode;
	setStripeColorMode(mode: StripeColorMode): Promise<void>;
	getStripeCustomColor(): string | null;
	setStripeCustomColor(value: string | null): Promise<void>;
	getBorderContrast(): number;
	getBorderColorMode(): BorderColorMode;
	setBorderColorMode(mode: BorderColorMode): Promise<void>;
	getBorderCustomColor(): string | null;
	setBorderCustomColor(value: string | null): Promise<void>;
	setBorderContrast(value: number): Promise<void>;
	getLoggingLevel(): LogLevelName;
	setLoggingLevel(level: LogLevelName): Promise<void>;
	getNavigatorCompatibilityEnabled(): boolean;
	setNavigatorCompatibilityEnabled(enabled: boolean): Promise<void>;
	isBackupEnabled(): boolean;
	setBackupEnabled(value: boolean): Promise<void>;
	getBackupCapacityLimit(): number;
	setBackupCapacityLimit(value: number): Promise<void>;
	getLocaleOverride(): LocaleCode | null;
	setLocaleOverride(value: LocaleCode | null): Promise<void>;
	getLocalizedLocalePreference(): LocaleCode;
	useLocalizedLocalePreference(): Promise<void>;
	getResolvedLocale(): LocaleCode;
};

type QuickLinkVariant = 'primary' | 'quiet';
type QuickLinkButtonOptions = {
	labelKey: TranslationKey;
	tooltipKey: TranslationKey;
	icon: string;
	url: string;
	variant?: QuickLinkVariant;
};

const LOG_LEVEL_OPTIONS: LogLevelName[] = ['error', 'warn', 'info', 'debug', 'trace'];
const LOG_LEVEL_LABEL_KEYS: Record<LogLevelName, TranslationKey> = {
	error: 'settings.loggingLevelOptionError',
	warn: 'settings.loggingLevelOptionWarn',
	info: 'settings.loggingLevelOptionInfo',
	debug: 'settings.loggingLevelOptionDebug',
	trace: 'settings.loggingLevelOptionTrace'
};
const LOCALE_LABEL_KEYS: Record<LocaleCode, TranslationKey> = {
	en: 'settings.interfaceLanguageOptionEn',
	de: 'settings.interfaceLanguageOptionDe',
	es: 'settings.interfaceLanguageOptionEs',
	fr: 'settings.interfaceLanguageOptionFr',
	it: 'settings.interfaceLanguageOptionIt',
	nl: 'settings.interfaceLanguageOptionNl',
	pl: 'settings.interfaceLanguageOptionPl',
	pt: 'settings.interfaceLanguageOptionPt',
	ja: 'settings.interfaceLanguageOptionJa',
	ko: 'settings.interfaceLanguageOptionKo',
	'zh-hans': 'settings.interfaceLanguageOptionZhHans',
	'zh-hant': 'settings.interfaceLanguageOptionZhHant'
};
const AUTO_LOCALE_OPTION = 'auto';
const STRIPE_COLOR_OPTION_LABEL_KEYS: Record<StripeColorMode, TranslationKey> = {
	recommended: 'settings.stripeColorOptionRecommended',
	primary: 'settings.stripeColorOptionPrimary',
	custom: 'settings.stripeColorOptionCustom'
};

function isLogLevel(value: string): value is LogLevelName {
	return (LOG_LEVEL_OPTIONS as readonly string[]).includes(value);
}
export class TileLineBaseSettingTab extends PluginSettingTab {
	private readonly plugin: SidebarSettingHost;
	private readonly logger = getLogger('settings:tab');

	constructor(app: App, plugin: SidebarSettingHost) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const resolvedLocale = this.plugin.getResolvedLocale();
		this.logger.info('apply-locale', { resolvedLocale });
		setLocale(resolvedLocale);
		this.logger.info('render', { locale: getLocaleCode(), heading: t('settings.generalHeading') });

		this.renderQuickLinks(containerEl);
		this.renderGeneralSection(containerEl);
		this.renderLoggingSection(containerEl);
		this.renderBackupSection(containerEl);
	}

	private renderQuickLinks(containerEl: HTMLElement): void {
		const root = containerEl.createDiv({ cls: 'tlb-settings-quick-links' });
		const info = root.createDiv({ cls: 'tlb-settings-quick-links__info' });
		info.createDiv({ cls: 'tlb-settings-quick-links__title', text: t('settings.quickLinksTitle') });
		const description = t('settings.quickLinksDesc');
		if (description.trim().length > 0) {
			info.createDiv({ cls: 'tlb-settings-quick-links__desc', text: description });
		}

		const actions = root.createDiv({ cls: 'tlb-settings-quick-links__actions' });

		this.createQuickLinkButton(actions, {
			labelKey: 'settings.quickLinksFeedbackLabel',
			tooltipKey: 'settings.quickLinksFeedbackTooltip',
			icon: 'message-circle',
			url: 'https://github.com/campfirium/obsidian-tile-line-base/issues/new/choose',
			variant: 'primary'
		});
		this.createQuickLinkButton(actions, {
			labelKey: 'settings.quickLinksVideosLabel',
			tooltipKey: 'settings.quickLinksVideosTooltip',
			icon: 'play',
			url: 'https://youtu.be/8uoVBkD2--A'
		});
		this.createQuickLinkButton(actions, {
			labelKey: 'settings.quickLinksStarLabel',
			tooltipKey: 'settings.quickLinksStarTooltip',
			icon: 'star',
			url: 'https://github.com/campfirium/obsidian-tile-line-base',
			variant: 'quiet'
		});
	}

	private renderGeneralSection(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('settings.generalHeading'))
			.setHeading();

		const availableLocales = getAvailableLocales();
		const isLocaleCode = (value: string): value is LocaleCode =>
			availableLocales.includes(value as LocaleCode);

		new Setting(containerEl)
			.setName(t('settings.interfaceLanguageLabel'))
			.addDropdown((dropdown) => {
				dropdown.addOption(AUTO_LOCALE_OPTION, t('settings.interfaceLanguageOptionAuto'));
				for (const locale of availableLocales) {
					const label = this.getLocaleLabel(locale);
					dropdown.addOption(locale, label);
				}
				const currentOverride = this.plugin.getLocaleOverride();
				dropdown.setValue(currentOverride ?? AUTO_LOCALE_OPTION);
				dropdown.selectEl.setAttribute('aria-label', t('settings.interfaceLanguageLabel'));
				dropdown.onChange(async (value) => {
					const selectedLocale = value === AUTO_LOCALE_OPTION
						? null
						: isLocaleCode(value) ? value : null;
					if (selectedLocale) {
						await this.plugin.setLocaleOverride(selectedLocale);
					} else {
						await this.plugin.useLocalizedLocalePreference();
					}
					this.display();
				});
			});

		new Setting(containerEl)
			.setName(t('settings.hideRightSidebarLabel'))
			.setDesc(t('settings.hideRightSidebarDesc'))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.isHideRightSidebarEnabled());
				toggle.onChange(async (value) => {
					await this.plugin.setHideRightSidebarEnabled(value);
				});
			});

		new Setting(containerEl)
			.setName(t('settings.tableViewHeading'))
			.setHeading();

		const stripeMode = this.normalizeStripeMode(this.plugin.getStripeColorMode());
		const stripeCustomColor = this.plugin.getStripeCustomColor();
		const stripeRecommended = this.getRecommendedStripeColor(containerEl);

		const stripeSetting = new Setting(containerEl)
			.setName(t('settings.stripeColorLabel'))
			.setDesc(t('settings.stripeColorDesc'));
		const controls = stripeSetting.controlEl;

		const colorInput = controls.createEl('input', { type: 'color', cls: 'tlb-color-input' });
		const dropdown = controls.createEl('select', { cls: 'tlb-stripe-select' });

		const resolveStripeColor = (mode: StripeColorMode, custom: string | null): string => {
			const primary = this.getPrimaryColor(containerEl);
			if (mode === 'primary') {
				return primary;
			}
			if (mode === 'custom') {
				return custom ?? primary;
			}
			return stripeRecommended;
		};

		const syncControls = (mode: StripeColorMode, custom: string | null) => {
			dropdown.value = mode;
			const color = resolveStripeColor(mode, custom);
			colorInput.value = color;
			colorInput.disabled = mode !== 'custom';
		};

		[
			{ value: 'recommended', labelKey: STRIPE_COLOR_OPTION_LABEL_KEYS.recommended },
			{ value: 'primary', labelKey: STRIPE_COLOR_OPTION_LABEL_KEYS.primary },
			{ value: 'custom', labelKey: STRIPE_COLOR_OPTION_LABEL_KEYS.custom }
		].forEach((option) => {
			const opt = dropdown.createEl('option', { value: option.value });
			opt.textContent = t(option.labelKey);
		});

		dropdown.addEventListener('change', () => {
			const value = this.normalizeStripeMode(dropdown.value);
			void this.plugin.setStripeColorMode(value);
			const latestCustom = this.plugin.getStripeCustomColor();
			const nextColor = resolveStripeColor(value, latestCustom);
			if (value === 'custom') {
				void this.plugin.setStripeCustomColor(nextColor);
			}
			syncControls(value, latestCustom);
		});

		colorInput.addEventListener('input', () => {
			const currentMode = this.normalizeStripeMode(dropdown.value);
			if (currentMode !== 'custom') {
				dropdown.value = 'custom';
				void this.plugin.setStripeColorMode('custom');
			}
			const value = colorInput.value;
			void this.plugin.setStripeCustomColor(value);
			syncControls('custom', value);
		});

		syncControls(stripeMode, stripeCustomColor ?? null);

		new Setting(containerEl)
			.setName(t('settings.borderContrastLabel'))
			.setDesc(t('settings.borderContrastDesc'))
			.addSlider((slider) => {
				const current = this.plugin.getBorderContrast();
				slider.setLimits(0, 100, 1);
				slider.setValue(Math.round(current * 100));
				slider.onChange(async (value) => {
					const normalized = Math.max(0, Math.min(100, value)) / 100;
					await this.plugin.setBorderContrast(normalized);
				});
				slider.setDynamicTooltip();
			});

	}

	private renderLoggingSection(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('settings.loggingHeading'))
			.setHeading();

			new Setting(containerEl)
				.setName(t('settings.loggingLevelLabel'))
				.setDesc(t('settings.loggingLevelDesc'))
				.addDropdown((dropdown) => {
					for (const option of LOG_LEVEL_OPTIONS) {
					dropdown.addOption(option, t(LOG_LEVEL_LABEL_KEYS[option]));
				}

				const current = this.plugin.getLoggingLevel();
				if (isLogLevel(current)) {
					dropdown.setValue(current);
				}
				dropdown.selectEl.setAttribute('aria-label', t('settings.loggingLevelLabel'));

				dropdown.onChange(async (value) => {
					if (!isLogLevel(value)) {
						return;
					}
					await this.plugin.setLoggingLevel(value);
					const latest = this.plugin.getLoggingLevel();
						if (isLogLevel(latest) && dropdown.getValue() !== latest) {
							dropdown.setValue(latest);
						}
					});
				});

			new Setting(containerEl)
				.setName(t('settings.compatibilityHeading'))
				.setHeading();

			new Setting(containerEl)
				.setName(t('settings.navigatorCompatLabel'))
				.setDesc(t('settings.navigatorCompatDesc'))
				.addToggle((toggle) => {
					toggle.setValue(this.plugin.getNavigatorCompatibilityEnabled());
					toggle.onChange(async (value) => {
						await this.plugin.setNavigatorCompatibilityEnabled(value);
					});
				});
	}

	private renderBackupSection(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('settings.backupHeading'))
			.setHeading();

		new Setting(containerEl)
			.setName(t('settings.backupEnableLabel'))
			.setDesc(t('settings.backupEnableDesc'))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.isBackupEnabled());
				toggle.onChange(async (value) => {
					await this.plugin.setBackupEnabled(value);
				});
			});

		const capacitySetting = new Setting(containerEl)
			.setName(t('settings.backupCapacityLabel'))
			.setDesc(t('settings.backupCapacityDesc'));

		capacitySetting.addText((text) => {
			const current = this.plugin.getBackupCapacityLimit();
			text.setValue(String(current));
			text.setPlaceholder(String(current));
			text.inputEl.type = 'number';
			text.inputEl.min = '1';
			text.inputEl.max = '10240';
			text.inputEl.setAttribute('aria-label', t('settings.backupCapacityLabel'));
			text.onChange(async (raw) => {
				const trimmed = raw.trim();
				if (trimmed.length === 0) {
					return;
				}
				const parsed = Number(trimmed);
				if (!Number.isFinite(parsed)) {
					return;
				}
				await this.plugin.setBackupCapacityLimit(parsed);
				});
			text.inputEl.addEventListener('blur', () => {
				const updated = this.plugin.getBackupCapacityLimit();
				if (text.getValue() !== String(updated)) {
					text.setValue(String(updated));
				}
				});
		});

	}

	private createQuickLinkButton(actionsEl: HTMLElement, options: QuickLinkButtonOptions): void {
		const button = actionsEl.createEl('button', { cls: 'tlb-settings-quick-links__button' });
		if (options.variant) {
			button.addClass(`tlb-settings-quick-links__button--${options.variant}`);
		}
		button.setAttribute('type', 'button');

		const tooltip = t(options.tooltipKey);
		button.setAttribute('aria-label', tooltip);
		button.setAttribute('data-tooltip-position', 'top');
		button.setAttribute('data-tooltip', tooltip);

		const iconEl = button.createSpan({ cls: 'tlb-settings-quick-links__icon' });
		iconEl.setAttribute('aria-hidden', 'true');
		setIcon(iconEl, options.icon);

		button.createSpan({ cls: 'tlb-settings-quick-links__label', text: t(options.labelKey) });

		button.addEventListener('click', (event) => {
			event.preventDefault();
			this.openExternal(options.url);
		});
	}

	private openExternal(url: string): void {
		try {
			const electronRequire = (window as Window & { require?: (module: string) => { shell?: { openExternal?: (target: string) => Promise<void> | void } } }).require;
			const electron = electronRequire?.("electron");
			const shell = electron?.shell;
			if (shell?.openExternal) {
				const result = shell.openExternal(url);
				const resultPromise = result instanceof Promise ? result : null;
				if (resultPromise) {
					resultPromise.catch((error) => {
						this.logger.error("Failed to open quick link", { error, url });
					});
				}
				return;
			}

						this.logger.error('Failed to open quick link', { error, url });
					});
				}
				return;
			}
			window.open(url, '_blank', 'noopener');
		} catch (error) {
			this.logger.error('Failed to open quick link', { error, url });
		}
	}

	private normalizeStripeMode(value: string | null | undefined): StripeColorMode {
		return value === 'primary' || value === 'custom' ? value : 'recommended';
	}

	private getLocaleLabel(locale: LocaleCode): string {
		const labelKey = LOCALE_LABEL_KEYS[locale];
		const localized = labelKey ? t(labelKey) : null;
		return localized ?? locale;
	}

	private getPrimaryColor(containerEl: HTMLElement): string {
		const doc = containerEl.ownerDocument;
		const styles = doc.defaultView ? doc.defaultView.getComputedStyle(doc.body) : null;
		const primary = styles?.getPropertyValue('--background-primary')?.trim() ?? '';
		const parsed = this.toHex(primary);
		return parsed ?? '#000000';
	}

	private getRecommendedStripeColor(containerEl: HTMLElement): string {
		const doc = containerEl.ownerDocument;
		const isDarkMode = doc.body.classList.contains('theme-dark');
		const styles = doc.defaultView ? doc.defaultView.getComputedStyle(doc.body) : null;
		const primary = styles?.getPropertyValue('--background-primary')?.trim() ?? '';
		const primaryColor = this.toHex(primary) ?? '#000000';
		return computeRecommendedStripeColor(primaryColor, isDarkMode);
	}

	private toHex(value: string | null | undefined): string | null {
		if (!value) return null;
		const el = document.createElement('div');
		el.style.color = value;
		document.body.appendChild(el);
		const computed = getComputedStyle(el).color;
		el.remove();
		const parts = computed.match(/[\d.]+/g);
		if (!parts || parts.length < 3) {
			return null;
		}
		const [r, g, b] = parts.map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))));
		const toHex = (n: number) => n.toString(16).padStart(2, '0');
		return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
	}

}
