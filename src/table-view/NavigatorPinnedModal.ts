import type { App } from "obsidian";
import { Modal } from "obsidian";
import { t } from "../i18n";

class NavigatorPinnedModal extends Modal {
	onOpen(): void {
		const { contentEl, titleEl } = this;
		contentEl.empty();
		titleEl.setText(t("settings.navigatorPinnedModalTitle"));
		const header = contentEl.createEl('h2', { text: t("settings.navigatorPinnedModalHeading") });
		header.addClass('tlb-compat-title');
		const body = contentEl.createDiv({ cls: 'tlb-compat-body' });
		body.createEl('p', { text: t("settings.navigatorPinnedModalBody1") });
		body.createEl('p', { text: t("settings.navigatorPinnedModalBody2") });
		body.createEl('p', { text: t("settings.navigatorPinnedModalAction") }).addClass('mod-muted');
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export function showNavigatorPinnedModal(app: App): void {
	const modal = new NavigatorPinnedModal(app);
	modal.open();
}
