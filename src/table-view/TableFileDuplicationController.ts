import type { App, TFile } from 'obsidian';
import { Notice } from 'obsidian';
import { getLogger } from '../utils/logger';
import { t } from '../i18n';
import type { TableConfigManager } from './TableConfigManager';
import type { TablePersistenceService } from './TablePersistenceService';

interface TableFileDuplicationControllerOptions {
	app: App;
	configManager: TableConfigManager;
	persistence: TablePersistenceService;
	getCurrentFile(): TFile | null;
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

	private async persistConfigForFile(targetFile: TFile): Promise<void> {
		const payload = this.options.persistence.getConfigPayload();
		await this.options.configManager.save(targetFile, payload);
	}

	private async buildTargetPath(file: TFile): Promise<string> {
		const parentPath = file.parent?.path ?? '';
		const extension = file.extension ? `.${file.extension}` : '';
		const baseName = file.basename.trim() || t('fileDuplication.fallbackName');
		const suffix = this.getCopySuffix();
		const baseCandidate = `${baseName} ${suffix}`.trim();

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
}
