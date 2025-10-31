import { Modal, Notice, Setting } from 'obsidian';
import type { ButtonComponent } from 'obsidian';
import type { TableView } from '../TableView';
import { getPluginContext } from '../pluginContext';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';
import type { BackupManager, BackupDescriptor } from '../services/BackupManager';

const logger = getLogger('table-view:backup-restore');

export async function openBackupRestoreModal(view: TableView): Promise<void> {
	if (!view.file) {
		new Notice(t('backup.errorNoFile'));
		return;
	}
	const plugin = getPluginContext();
	const manager = plugin?.getBackupManager() ?? null;
	if (!manager) {
		new Notice(t('backup.errorUnavailable'));
		return;
	}
	const modal = new BackupRestoreModal(view, manager);
	modal.open();
}

class BackupRestoreModal extends Modal {
	private readonly view: TableView;
	private readonly manager: BackupManager;
	private listEl: HTMLElement | null = null;
	private isRestoring = false;

	constructor(view: TableView, manager: BackupManager) {
		super(view.app);
		this.view = view;
		this.manager = manager;
	}

	async onOpen(): Promise<void> {
		const fileName = this.view.file?.basename ?? '';
		this.titleEl.setText(t('backup.modalTitle', { file: fileName }));
		this.contentEl.empty();
		this.contentEl.addClass('tlb-backup-modal');
		this.listEl = this.contentEl.createDiv({ cls: 'tlb-backup-modal__list' });
		await this.renderEntries();
	}

	onClose(): void {
		this.contentEl.empty();
		this.contentEl.removeClass('tlb-backup-modal');
		this.listEl = null;
	}

	private async renderEntries(): Promise<void> {
		const container = this.listEl;
		if (!container) {
			return;
		}
		clearElement(container);

		if (!this.view.file) {
			this.renderMessage(t('backup.errorNoFile'));
			return;
		}

		let entries: BackupDescriptor[] = [];
		try {
			entries = await this.manager.listBackups(this.view.file);
		} catch (error) {
			logger.error('Failed to load backup list', error);
			this.renderMessage(t('backup.errorLoadFailed'));
			return;
		}

		if (entries.length === 0) {
			this.renderMessage(t('backup.emptyState'));
			return;
		}

		for (const entry of entries) {
			const timestampText = this.formatTimestamp(entry.createdAt);
			const setting = new Setting(container)
				.setName(timestampText)
				.setDesc(t('backup.sizeLabel', { size: this.formatSize(entry.size) }));
			setting.addButton((button) => {
				button
					.setButtonText(t('backup.restoreButton'))
					.setTooltip(t('backup.restoreButtonAria', { timestamp: timestampText }))
					.setCta()
					.onClick(() => {
						void this.handleRestore(entry);
					});
				button.buttonEl.setAttribute('aria-label', t('backup.restoreButtonAria', { timestamp: timestampText }));
			});
		}
	}

	private renderMessage(message: string): void {
		const container = this.listEl;
		if (!container) {
			return;
		}
		clearElement(container);
		container.createEl('p', { cls: 'tlb-backup-modal__empty', text: message });
	}

	private async handleRestore(entry: BackupDescriptor): Promise<void> {
		if (!this.view.file) {
			new Notice(t('backup.errorNoFile'));
			return;
		}

		const timestampLabel = this.formatTimestamp(entry.createdAt);
		if (this.isRestoring) {
			return;
		}

		const confirmModal = new BackupConfirmModal(this.app, t('backup.confirmRestore', { timestamp: timestampLabel }), async () => {
			if (this.isRestoring || !this.view.file) {
				return;
			}
			this.isRestoring = true;
			try {
				await this.manager.restoreBackup(this.view.file, entry.id);
				new Notice(t('backup.noticeRestoreSuccess', { timestamp: timestampLabel }));
				this.close();
				void this.view.render();
			} catch (error) {
				logger.error('Failed to restore backup', error);
				new Notice(t('backup.noticeRestoreFailed'));
			} finally {
				this.isRestoring = false;
			}
		});
		confirmModal.open();
	}

	private formatTimestamp(value: number): string {
		try {
			return new Date(value).toLocaleString();
		} catch {
			return String(value);
		}
	}

	private formatSize(bytes: number): string {
		if (!Number.isFinite(bytes) || bytes <= 0) {
			return '0 B';
		}
		const units = ['B', 'KB', 'MB', 'GB'];
		let unitIndex = 0;
		let size = bytes;
		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024;
			unitIndex += 1;
		}
		return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
	}
}

function clearElement(element: HTMLElement): void {
	while (element.firstChild) {
		element.removeChild(element.firstChild);
	}
}

class BackupConfirmModal extends Modal {
	private readonly message: string;
	private readonly onConfirm: () => Promise<void> | void;
	private busy = false;

	constructor(app: TableView['app'], message: string, onConfirm: () => Promise<void> | void) {
		super(app);
		this.message = message;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		this.titleEl.setText(t('backup.modalTitleConfirm'));
		this.contentEl.empty();
		this.contentEl.createEl('p', { text: this.message });

		const footer = new Setting(this.contentEl);
		footer.addButton((button) => {
			button
				.setButtonText(t('backup.restoreButton'))
				.setCta()
				.onClick(() => {
					void this.handleConfirm(button);
				});
		});
		footer.addButton((button) => {
			button
				.setButtonText(t('backup.restoreCancelButton'))
				.onClick(() => {
					this.close();
				});
		});
	}

	private async handleConfirm(button: ButtonComponent): Promise<void> {
		if (this.busy) {
			return;
		}
		this.busy = true;
		button.setDisabled(true);
		try {
			await this.onConfirm();
			this.close();
		} finally {
			this.busy = false;
			button.setDisabled(false);
		}
	}
}
