import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { t } from '../i18n';

type SidebarSettingHost = Plugin & {
	isHideRightSidebarEnabled(): boolean;
	setHideRightSidebarEnabled(value: boolean): Promise<void>;
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
	}
}
