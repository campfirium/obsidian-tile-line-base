import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';
import type { LogLevelName } from '../utils/logger';

type SidebarSettingHost = Plugin & {
	isHideRightSidebarEnabled(): boolean;
	setHideRightSidebarEnabled(value: boolean): Promise<void>;
	getLoggingLevel(): LogLevelName;
	setLoggingLevel(level: LogLevelName): Promise<void>;
	isBackupEnabled(): boolean;
	setBackupEnabled(value: boolean): Promise<void>;
	getBackupCapacityLimit(): number;
	setBackupCapacityLimit(value: number): Promise<void>;
};

const LOG_LEVEL_OPTIONS: LogLevelName[] = ['error', 'warn', 'info', 'debug', 'trace'];
const LOG_LEVEL_LABEL_KEYS: Record<LogLevelName, TranslationKey> = {
	error: 'settings.loggingLevelOptionError',
	warn: 'settings.loggingLevelOptionWarn',
	info: 'settings.loggingLevelOptionInfo',
	debug: 'settings.loggingLevelOptionDebug',
	trace: 'settings.loggingLevelOptionTrace'
};

function isLogLevel(value: string): value is LogLevelName {
	return (LOG_LEVEL_OPTIONS as readonly string[]).includes(value);
}

export class TileLineBaseSettingTab extends PluginSettingTab {
	private readonly plugin: SidebarSettingHost;

	constructor(app: App, plugin: SidebarSettingHost) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderGeneralSection(containerEl);
		this.renderLoggingSection(containerEl);
		this.renderBackupSection(containerEl);
	}

	private renderGeneralSection(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('settings.generalHeading'))
			.setHeading();

		new Setting(containerEl)
			.setName(t('settings.hideRightSidebarLabel'))
			.setDesc(t('settings.hideRightSidebarDesc'))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.isHideRightSidebarEnabled());
				toggle.onChange(async (value) => {
					await this.plugin.setHideRightSidebarEnabled(value);
				});
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
}
