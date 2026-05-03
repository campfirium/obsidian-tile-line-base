import { Notice, TFile, type App } from 'obsidian';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';
import type { BackupManager } from '../services/BackupManager';
import { MarkdownBlockParser } from './MarkdownBlockParser';

const logger = getLogger('table-view:append-clipboard');
const parser = new MarkdownBlockParser();

interface AppendClipboardOptions {
	app: App;
	file: TFile;
	text: string;
	getBackupManager: () => BackupManager | null;
	markSelfMutation: (file: TFile) => void;
	replaceConversionBaseline: (content: string) => void;
}

export async function appendTextFromClipboardToFile(options: AppendClipboardOptions): Promise<string | null> {
	const normalizedText = options.text.replace(/\r\n?/g, '\n');
	if (normalizedText.trim().length === 0) {
		new Notice(t('appendClipboard.emptyNotice'));
		return null;
	}
	if (!isValidAppendMarkdown(normalizedText)) {
		new Notice(t('appendClipboard.invalidNotice'));
		return null;
	}

	const targetFile = options.app.vault.getAbstractFileByPath(options.file.path);
	if (!(targetFile instanceof TFile) || targetFile !== options.file) {
		new Notice(t('appendClipboard.noFileNotice'));
		return null;
	}

	const currentContent = await options.app.vault.read(targetFile);
	const backupManager = options.getBackupManager();
	if (backupManager) {
		try {
			await backupManager.ensureBackup(targetFile, currentContent);
		} catch (error) {
			logger.warn('Backup snapshot failed before clipboard append', error);
		}
	}

	const nextContent = appendToMarkdownEnd(currentContent, normalizedText);
	options.markSelfMutation(targetFile);
	await options.app.vault.modify(targetFile, nextContent);
	options.replaceConversionBaseline(nextContent);
	new Notice(t('appendClipboard.successNotice'));
	return nextContent;
}

function appendToMarkdownEnd(content: string, addition: string): string {
	const base = content.trimEnd();
	const suffix = addition.endsWith('\n') ? addition : `${addition}\n`;
	if (base.length === 0) {
		return suffix;
	}
	return `${base}\n\n${suffix}`;
}

function isValidAppendMarkdown(content: string): boolean {
	const parsed = parser.parseH2(content);
	if (parsed.invalidSections.length > 0 || parsed.straySections.length > 0) {
		return false;
	}
	if (!parser.hasStructuredH2Blocks(parsed.blocks)) {
		return false;
	}
	return true;
}
