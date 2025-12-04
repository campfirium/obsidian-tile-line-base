import { Modal, Setting } from 'obsidian';
import { t } from '../../i18n';

export class KanbanBoardConfirmModal extends Modal {
	constructor(
		app: Modal['app'],
		private readonly options: { message: string; onConfirm: () => void; onCancel: () => void }
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tlb-kanban-confirm-modal');
		contentEl.createEl('p', { text: this.options.message });

		const controls = new Setting(contentEl);
		controls.addButton((button) => {
			button.setButtonText(t('kanbanView.toolbar.deleteBoardConfirmAction'));
			button.setCta();
			button.onClick(() => {
				this.close();
				this.options.onConfirm();
			});
		});
		controls.addButton((button) => {
			button.setButtonText(t('filterViewModals.cancelButton'));
			button.onClick(() => {
				this.close();
				this.options.onCancel();
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
