import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { t } from '../i18n';

type SidebarSettingHost = Plugin & {
	isHideRightSidebarEnabled(): boolean;
	setHideRightSidebarEnabled(value: boolean): Promise<void>;
	isBackupEnabled(): boolean;
	setBackupEnabled(value: boolean): Promise<void>;
	getBackupCapacityLimit(): number;
	setBackupCapacityLimit(value: number): Promise<void>;
};

export class TileLineBaseSettingTab extends PluginSettingTab {
	private readonly plugin: SidebarSettingHost;

	constructor(app: App, plugin: SidebarSettingHost) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: t('settings.generalHeading') });

		new Setting(containerEl)
			.setName(t('settings.hideRightSidebarLabel'))
			.setDesc(t('settings.hideRightSidebarDesc'))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.isHideRightSidebarEnabled());
				toggle.onChange(async (value) => {
					await this.plugin.setHideRightSidebarEnabled(value);
				});
			});

		containerEl.createEl('h2', { text: t('settings.backupHeading') });

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
			text.onChange(async (raw) => {
				if (!raw || raw.trim().length === 0) {
					return;
				}
				const parsed = Number(raw);
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
