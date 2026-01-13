import { ButtonComponent, Modal, Notice, Setting, normalizePath } from 'obsidian';
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
	private isExporting = false;

	constructor(view: TableView, manager: BackupManager) {
		super(view.app);
		this.view = view;
		this.manager = manager;
	}

	async onOpen(): Promise<void> {
		const fileName = this.view.file?.basename ?? '';
		this.titleEl.setText(t('backup.modalTitle', { file: fileName }));
		this.contentEl.empty();
		this.modalEl.addClass('tlb-backup-modal');
		this.contentEl.addClass('tlb-backup-modal__content');
		this.listEl = this.contentEl.createDiv({ cls: 'tlb-backup-modal__list' });
		await this.renderEntries();
	}

	onClose(): void {
		this.contentEl.empty();
		this.modalEl.removeClass('tlb-backup-modal');
		this.contentEl.removeClass('tlb-backup-modal__content');
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

		this.renderHeader(container);

		for (const entry of entries) {
			this.renderEntryRow(container, entry);
		}
	}

	private renderHeader(container: HTMLElement): void {
		const header = container.createDiv({ cls: 'tlb-backup-modal__header' });
		header.createDiv({ cls: 'tlb-backup-modal__cell', text: t('backup.listHeaderTimestamp') });
		header.createDiv({ cls: 'tlb-backup-modal__cell', text: t('backup.listHeaderRow') });
		header.createDiv({ cls: 'tlb-backup-modal__cell', text: t('backup.listHeaderChanges') });
		header.createDiv({ cls: 'tlb-backup-modal__cell tlb-backup-modal__cell--actions', text: t('backup.listHeaderActions') });
	}

	private renderEntryRow(container: HTMLElement, entry: BackupDescriptor): void {
		const row = container.createDiv({ cls: 'tlb-backup-modal__row' });
		const timestampText = this.formatTimestamp(entry.createdAt);
		const isInitial = entry.isInitial === true;
		const name = isInitial ? `${t('backup.initialEntryLabel')} · ${timestampText}` : timestampText;

		const timeCell = row.createDiv({ cls: 'tlb-backup-modal__cell tlb-backup-modal__cell--time' });
		timeCell.createDiv({ cls: 'tlb-backup-modal__time', text: name });
		timeCell.createDiv({ cls: 'tlb-backup-modal__meta', text: t('backup.sizeLabel', { size: this.formatSize(entry.size) }) });

		const primaryCell = row.createDiv({ cls: 'tlb-backup-modal__cell tlb-backup-modal__cell--primary' });
		const primaryFieldValue = entry.primaryFieldValue?.trim() || t('backup.detailUnavailable');
		primaryCell.createDiv({ cls: 'tlb-backup-modal__primary-name', text: primaryFieldValue });

		const changeCell = row.createDiv({ cls: 'tlb-backup-modal__cell tlb-backup-modal__cell--changes' });
		const changePreview = this.resolveChangePreview(entry);
		const previewEl = changeCell.createDiv({ cls: 'tlb-backup-modal__change-preview tlb-backup-modal__clamp', text: changePreview });
		if (changePreview.length > 0) {
			previewEl.setAttribute('title', changePreview);
		}

		const actionsCell = row.createDiv({ cls: 'tlb-backup-modal__cell tlb-backup-modal__cell--actions' });
		const restoreButton = new ButtonComponent(actionsCell);
		restoreButton
			.setButtonText(t('backup.restoreButton'))
			.setTooltip(
				isInitial
					? t('backup.restoreInitialTooltip', { timestamp: timestampText })
					: t('backup.restoreButtonAria', { timestamp: timestampText })
			)
			.setCta()
			.onClick(() => {
				void this.handleRestore(entry);
			});
		const restoreLabel = isInitial
			? t('backup.restoreInitialTooltip', { timestamp: timestampText })
			: t('backup.restoreButtonAria', { timestamp: timestampText });
		restoreButton.buttonEl.setAttribute('aria-label', restoreLabel);

		const exportButton = new ButtonComponent(actionsCell);
		exportButton
			.setButtonText(t('backup.exportButton'))
			.setTooltip(t('backup.exportButtonAria', { timestamp: timestampText }))
			.onClick(() => {
				void this.handleExport(entry);
			});
		exportButton.buttonEl.setAttribute('aria-label', t('backup.exportButtonAria', { timestamp: timestampText }));
	}

	private renderMessage(message: string): void {
		const container = this.listEl;
		if (!container) {
			return;
		}
		clearElement(container);
		container.createEl('p', { cls: 'tlb-backup-modal__empty', text: message });
	}

	private resolveChangePreview(entry: BackupDescriptor): string {
		if (entry.isInitial) {
			return t('backup.changePreviewInitial');
		}
		if (entry.changePreview === undefined) {
			return t('backup.changePreviewUnavailable');
		}
		if (entry.changePreview.trim().length === 0) {
			return t('backup.changePreviewNoChanges');
		}
		return entry.changePreview;
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

				if (entry.isInitial) {
					const plugin = getPluginContext();
					if (plugin) {
						try {
							await plugin.toggleLeafView(this.view.leaf);
						} catch (toggleError) {
							logger.warn('Failed to toggle to markdown view after restoring initial backup', toggleError);
						}
						return;
					}
				}

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

	private async handleExport(entry: BackupDescriptor): Promise<void> {
		if (!this.view.file) {
			new Notice(t('backup.errorNoFile'));
			return;
		}

		if (this.isExporting) {
			return;
		}

		const timestampLabel = this.formatTimestamp(entry.createdAt);
		this.isExporting = true;
		try {
			const content = await this.manager.readBackupContent(this.view.file, entry.id);
			const basePath = this.buildExportPath(this.view.file.path, entry);
			const exportPath = this.getUniqueExportPath(basePath);
			await this.view.app.vault.create(exportPath, content);
			new Notice(t('backup.noticeExportSuccess', { file: exportPath }));
			logger.info('Exported backup to new file', {
				source: this.view.file.path,
				exportPath,
				timestampLabel
			});
		} catch (error) {
			logger.error('Failed to export backup', error);
			new Notice(t('backup.noticeExportFailed'));
		} finally {
			this.isExporting = false;
		}
	}

	private buildExportPath(filePath: string, entry: BackupDescriptor): string {
		const normalized = normalizePath(filePath);
		const lastSlashIndex = normalized.lastIndexOf('/');
		const dir = lastSlashIndex === -1 ? '' : normalized.slice(0, lastSlashIndex + 1);
		const fileName = lastSlashIndex === -1 ? normalized : normalized.slice(lastSlashIndex + 1);

		const lastDotIndex = fileName.lastIndexOf('.');
		const baseName = lastDotIndex === -1 ? fileName : fileName.slice(0, lastDotIndex);
		const extension = lastDotIndex === -1 ? '' : fileName.slice(lastDotIndex);

		const timestampSuffix = this.formatExportTimestamp(entry.createdAt);
		const exportName = `${baseName} (${timestampSuffix})${extension || '.md'}`;
		return normalizePath(`${dir}${exportName}`);
	}

	private getUniqueExportPath(basePath: string): string {
		const vault = this.view.app.vault;
		let candidate = basePath;

		if (!vault.getAbstractFileByPath(candidate)) {
			return candidate;
		}

		const lastSlashIndex = candidate.lastIndexOf('/');
		const dir = lastSlashIndex === -1 ? '' : candidate.slice(0, lastSlashIndex + 1);
		const fileName = lastSlashIndex === -1 ? candidate : candidate.slice(lastSlashIndex + 1);

		const lastDotIndex = fileName.lastIndexOf('.');
		const baseName = lastDotIndex === -1 ? fileName : fileName.slice(0, lastDotIndex);
		const extension = lastDotIndex === -1 ? '' : fileName.slice(lastDotIndex);

		let index = 1;
		while (true) {
			const nextName = `${baseName} (${index})${extension}`;
			const nextPath = normalizePath(`${dir}${nextName}`);
			if (!vault.getAbstractFileByPath(nextPath)) {
				return nextPath;
			}
			index += 1;
		}
	}

	private formatTimestamp(value: number): string {
		try {
			return new Date(value).toLocaleString();
		} catch {
			return String(value);
		}
	}

	private formatExportTimestamp(value: number): string {
		try {
			const date = new Date(value);
			const pad = (input: number, length = 2) => input.toString().padStart(length, '0');
			const year = date.getFullYear();
			const month = pad(date.getMonth() + 1);
			const day = pad(date.getDate());
			const hours = pad(date.getHours());
			const minutes = pad(date.getMinutes());
			const seconds = pad(date.getSeconds());
			return `${year}-${month}-${day}_${hours}${minutes}${seconds}`;
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
