import type { App, TFile } from 'obsidian';
import { Notice } from 'obsidian';
import { getLogger } from '../utils/logger';
import { t } from '../i18n';
import type { TableConfigManager } from './TableConfigManager';
import type { TablePersistenceService } from './TablePersistenceService';
import { buildConfigCalloutBlock } from './config/ConfigBlockIO';

interface TableFileDuplicationControllerOptions {
	app: App;
	configManager: TableConfigManager;
	persistence: TablePersistenceService;
	getCurrentFile(): TFile | null;
	getOwnerDocument(): Document | null;
}

export class TableFileDuplicationController {
	private readonly logger = getLogger('table-view:file-duplication');

	constructor(private readonly options: TableFileDuplicationControllerOptions) {}

	async duplicateCurrentFile(): Promise<void> {
		const sourceFile = this.options.getCurrentFile();
		if (!sourceFile) {
			new Notice(t('fileDuplication.errorNoFile'));
			this.logger.warn('duplicateCurrentFile:no-file');
			return;
		}

		try {
			const targetPath = await this.buildTargetPath(sourceFile);
			const content = await this.options.app.vault.read(sourceFile);
			const duplicatedFile = await this.options.app.vault.create(targetPath, content);
			await this.persistConfigForFile(duplicatedFile);

			new Notice(t('fileDuplication.successNotice', { fileName: duplicatedFile.basename }));
			this.logger.info('duplicateCurrentFile:success', {
				source: sourceFile.path,
				target: duplicatedFile.path
			});
		} catch (error) {
			this.logger.error('duplicateCurrentFile:failed', error);
			new Notice(t('fileDuplication.failureNotice'));
		}
	}

	async exportWithConfigBlock(): Promise<void> {
		const sourceFile = this.options.getCurrentFile();
		if (!sourceFile) {
			new Notice(t('fileDuplication.errorNoFile'));
			this.logger.warn('exportWithConfigBlock:no-file');
			return;
		}

		try {
			const payload = this.options.persistence.getConfigPayload();
			const markdown = this.options.persistence.getMarkdownSnapshot();
			const segments: string[] = [];
			if (markdown.trim().length > 0) {
				segments.push(markdown);
			}
			segments.push(buildConfigCalloutBlock(payload));
			const content = `${segments.join('\n\n')}\n`;
			const fileName = this.buildExportFileName(sourceFile);
			this.triggerDownload(content, fileName);

			new Notice(t('fileDuplication.exportSuccessNotice', { fileName }));
			this.logger.info('exportWithConfigBlock:success', {
				source: sourceFile.path,
				fileName
			});
		} catch (error) {
			this.logger.error('exportWithConfigBlock:failed', error);
			new Notice(t('fileDuplication.exportFailureNotice'));
		}
	}

	private async persistConfigForFile(targetFile: TFile): Promise<void> {
		const payload = this.options.persistence.getConfigPayload();
		await this.options.configManager.save(targetFile, payload);
	}

	private async buildTargetPath(file: TFile): Promise<string> {
		return this.buildPathWithSuffix(file, this.getCopySuffix(), t('fileDuplication.fallbackName'));
	}

	private async buildPathWithSuffix(file: TFile, suffix: string, fallbackName: string): Promise<string> {
		const parentPath = file.parent?.path ?? '';
		const extension = file.extension ? `.${file.extension}` : '';
		const baseName = file.basename.trim() || fallbackName;
		const baseCandidate = suffix.length > 0 ? `${baseName} ${suffix}`.trim() : baseName;

		for (let attempt = 0; attempt < 200; attempt++) {
			const candidateName = attempt === 0 ? baseCandidate : `${baseCandidate} ${attempt + 1}`;
			const fileName = `${candidateName}${extension}`;
			const candidatePath = parentPath ? `${parentPath}/${fileName}` : fileName;
			if (!this.options.app.vault.getAbstractFileByPath(candidatePath)) {
				return candidatePath;
			}
		}

		throw new Error('file-duplication:unable-to-resolve-target-path');
	}

	private getCopySuffix(): string {
		const suffix = t('fileDuplication.copyNameSuffix').trim();
		return suffix.length > 0 ? suffix : 'copy';
	}

	private getExportSuffix(): string {
		const suffix = t('fileDuplication.exportNameSuffix').trim();
		return suffix.length > 0 ? suffix : 'export';
	}

	private buildExportFileName(file: TFile): string {
		const suffix = this.getExportSuffix();
		const fallback = t('fileDuplication.exportFallbackName');
		const baseName = file.basename.trim() || fallback;
		const extension = file.extension ? `.${file.extension}` : '.md';
		const candidate = suffix.length > 0 ? `${baseName} ${suffix}`.trim() : baseName;
		return `${candidate}${extension}`;
	}

	private triggerDownload(content: string, fileName: string): void {
		const ownerDocument = this.options.getOwnerDocument() ?? document;
		const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const anchor = ownerDocument.createElement('a');
		anchor.href = url;
		anchor.download = fileName;
		anchor.classList.add('tlb-visually-hidden');
		ownerDocument.body.appendChild(anchor);
		anchor.click();
		ownerDocument.body.removeChild(anchor);
		URL.revokeObjectURL(url);
	}
}
