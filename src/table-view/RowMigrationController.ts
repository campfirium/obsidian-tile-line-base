import type { App } from 'obsidian';
import { Notice, TFile } from 'obsidian';
import type { TablePersistenceService } from './TablePersistenceService';
import type { TableDataStore } from './TableDataStore';
import type { RowInteractionController } from './RowInteractionController';
import type { Schema } from './SchemaBuilder';
import type { H2Block } from './MarkdownBlockParser';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';
import { RowMigrationTargetModal } from './RowMigrationTargetModal';
import { TableConfigManager } from './TableConfigManager';
import { getPluginContext } from '../pluginContext';

interface RowMigrationDeps {
	app: App;
	dataStore: TableDataStore;
	persistence: TablePersistenceService;
	rowInteraction: RowInteractionController;
	getCurrentFile: () => TFile | null;
}

type ExportMode = 'move' | 'copy';

export class RowMigrationController {
	private readonly logger = getLogger('table-view:row-migration');
	private static readonly FULL_WIDTH_COLON = '\uFF1A';

	constructor(private readonly deps: RowMigrationDeps) {}

	async moveSelectionToNewFile(blockIndexes: number[]): Promise<void> {
		await this.exportSelectionToNewFile(blockIndexes, 'move');
	}

	async copySelectionToNewFile(blockIndexes: number[]): Promise<void> {
		await this.exportSelectionToNewFile(blockIndexes, 'copy');
	}

	async moveSelectionToExistingFile(blockIndexes: number[]): Promise<void> {
		const context = this.ensureContext(blockIndexes);
		if (!context) {
			return;
		}

			const candidates = this.getKnownTableFiles(context.file);
			if (candidates.length === 0) {
				new Notice(t('gridInteraction.migrateSelectionNoTargets'));
				this.logger.warn('migrate:no-existing-targets');
				return;
			}

			const targetFile = await this.promptForTargetFile(context.file, candidates);
			if (!targetFile) {
				this.logger.info('migrate:select-existing-cancelled');
				return;
			}

		if (targetFile.path === context.file.path) {
			new Notice(t('gridInteraction.migrateSelectionSameFile'));
			this.logger.warn('migrate:same-file-selected', { path: targetFile.path });
			return;
		}

		const preparedBlocks = this.prepareBlocks(context.schema, context.sourceBlocks, context.indexes);
		const blockMarkdown = this.serializeBlocks(context.schema, preparedBlocks);

		try {
			await this.appendBlocksToExistingFile(targetFile, blockMarkdown);
			this.deps.rowInteraction.deleteRows(context.indexes);
			new Notice(
				t('gridInteraction.migrateSelectionMergeSuccess', {
					count: String(context.indexes.length),
					fileName: targetFile.basename
				})
			);
			this.logger.info('migrate:merge-existing-success', {
				target: targetFile.path,
				count: context.indexes.length
			});
		} catch (error) {
			this.logger.error('migrate:merge-existing-failed', error);
			new Notice(t('gridInteraction.migrateSelectionFailed'));
		}
	}

	
	private async selectExistingTarget(currentFile: TFile): Promise<TFile | null> {
		const candidates = this.getKnownTableFiles(currentFile);
		if (candidates.length === 0) {
			new Notice(t('gridInteraction.migrateSelectionNoTargets'));
			this.logger.warn('migrate:no-existing-targets');
			return null;
		}

		const targetFile = await this.promptForTargetFile(currentFile, candidates);
		if (!targetFile) {
			this.logger.info('migrate:select-existing-cancelled');
			return null;
		}
		return targetFile;
	}

private async exportSelectionToNewFile(blockIndexes: number[], mode: ExportMode): Promise<void> {
		const context = this.ensureContext(blockIndexes);
		if (!context) {
			return;
		}

		const preparedBlocks = this.prepareBlocks(context.schema, context.sourceBlocks, context.indexes);
		const blockMarkdown = this.serializeBlocks(context.schema, preparedBlocks);
		const baseName = this.buildSelectionFileName(context.file);
		const folderPath = context.file.parent?.path ?? '';
		let newFile: TFile | null = null;

		try {
			const { path, fileName } = await this.resolveAvailableFilePath(folderPath, baseName);
			newFile = await this.deps.app.vault.create(path, blockMarkdown);
			await this.writeConfigForNewFile(newFile);

			if (mode === 'move') {
				this.deps.rowInteraction.deleteRows(context.indexes);
			}

			const successKey =
				mode === 'move'
					? 'gridInteraction.migrateSelectionSuccess'
					: 'gridInteraction.migrateSelectionCopySuccess';
			new Notice(
				t(successKey, {
					count: String(context.indexes.length),
					fileName: fileName.replace(/\.md$/i, '')
				})
			);
			this.logger.info('migrate:new-file-success', { path, count: context.indexes.length, mode });
		} catch (error) {
			this.logger.error('migrate:new-file-failed', error);
			if (newFile) {
				try {
					await this.deps.app.vault.delete(newFile);
				} catch (cleanupError) {
					this.logger.error('migrate:new-file-cleanup-failed', cleanupError);
				}
			}
			new Notice(t('gridInteraction.migrateSelectionFailed'));
		}
	}

	private ensureContext(blockIndexes: number[]): {
		file: TFile;
		schema: Schema;
		sourceBlocks: H2Block[];
		indexes: number[];
	} | null {
		const file = this.deps.getCurrentFile();
		if (!file) {
			this.logger.warn('migrate:missing-file');
			new Notice(t('gridInteraction.migrateSelectionNoFile'));
			return null;
		}

		const schema = this.deps.dataStore.getSchema();
		if (!schema) {
			this.logger.warn('migrate:no-schema');
			new Notice(t('gridInteraction.migrateSelectionFailed'));
			return null;
		}

		const sourceBlocks = this.deps.dataStore.getBlocks();
		const indexes = this.normalizeIndexes(blockIndexes, sourceBlocks);
		if (indexes.length === 0) {
			this.logger.warn('migrate:no-valid-index');
			return null;
		}

		return { file, schema, sourceBlocks, indexes };
	}

	private normalizeIndexes(indexes: number[], blocks: H2Block[]): number[] {
		const seen = new Set<number>();
		const valid: number[] = [];
		for (const index of indexes) {
			if (!Number.isInteger(index) || index < 0 || index >= blocks.length) {
				continue;
			}
			if (seen.has(index)) {
				continue;
			}
			seen.add(index);
			valid.push(index);
		}
		return valid.sort((a, b) => a - b);
	}

	private prepareBlocks(schema: Schema, sourceBlocks: H2Block[], indexes: number[]): H2Block[] {
		const columnNames = schema.columnNames ?? [];
		return indexes
			.map((index) => {
				const block = sourceBlocks[index];
				if (!block) {
					return null;
				}
				const cloned: H2Block = {
					title: block.title,
					data: { ...block.data },
					collapsedFields: Array.isArray(block.collapsedFields)
						? block.collapsedFields.map((entry) => ({ ...entry }))
						: undefined
				};
				for (const column of columnNames) {
					if (!Object.prototype.hasOwnProperty.call(cloned.data, column)) {
						cloned.data[column] = '';
					}
				}
				return cloned;
			})
			.filter((entry): entry is H2Block => entry !== null);
	}

	private serializeBlocks(schema: Schema, blocks: H2Block[]): string {
		if (blocks.length === 0) {
			return '';
		}

		const columnNames = schema.columnNames ?? [];
		if (columnNames.length === 0) {
			return blocks
				.map((block) => this.deps.dataStore.blockToMarkdown(block).trimEnd())
				.filter((segment) => segment.length > 0)
				.join('\n\n')
				.concat('\n');
		}

		const columnSet = new Set(columnNames);
		const colon = RowMigrationController.FULL_WIDTH_COLON;

		const segments = blocks.map((block) => {
			const baseLines = this.deps.dataStore.blockToMarkdown(block).split(/\r?\n/);
			const extrasStart = baseLines.findIndex((line) => !this.isColumnLine(line, columnSet));
			const extras = extrasStart >= 0 ? baseLines.slice(extrasStart) : [];

			const fieldLines: string[] = [];
			for (let columnIndex = 0; columnIndex < columnNames.length; columnIndex++) {
				const field = columnNames[columnIndex];
				const value = block.data[field] ?? '';
				if (columnIndex === 0) {
					fieldLines.push(`## ${field}${colon}${value}`);
				} else {
					fieldLines.push(`${field}${colon}${value}`);
				}
			}
			const combined = [...fieldLines];
			if (extras.length > 0) {
				if (combined[combined.length - 1]?.trim().length > 0) {
					combined.push('');
				}
				combined.push(...extras);
			}
			return combined.join('\n').trimEnd();
		});

		const body = segments.filter((segment) => segment.length > 0).join('\n\n').trimEnd();
		return body.length > 0 ? `${body}\n` : '';
	}

	private isColumnLine(line: string, columnSet: Set<string>): boolean {
		const trimmed = line.trim();
		if (!trimmed) {
			return false;
		}
		const colon = RowMigrationController.FULL_WIDTH_COLON;
		if (!trimmed.includes(colon)) {
			return false;
		}

		if (trimmed.startsWith('## ')) {
			const afterHeader = trimmed.slice(3);
			const colonIndex = afterHeader.indexOf(colon);
			if (colonIndex === -1) {
				return false;
			}
			const key = afterHeader.slice(0, colonIndex).trim();
			return columnSet.has(key);
		}

		const colonIndex = trimmed.indexOf(colon);
		if (colonIndex === -1) {
			return false;
		}
		const key = trimmed.slice(0, colonIndex).trim();
		return columnSet.has(key);
	}

	private buildSelectionFileName(file: TFile): string {
		const base = `${file.basename} selection`.trim();
		return this.sanitizeFileName(base);
	}

	private sanitizeFileName(name: string): string {
		const stripped = name.replace(/[\\/:*?"<>|\r\n]+/g, '').replace(/\s+/g, ' ').trim();
		return stripped.replace(/[. ]+$/g, '');
	}

	private async resolveAvailableFilePath(
		folderPath: string,
		baseName: string
	): Promise<{ path: string; fileName: string }> {
		const sanitizedBase = this.sanitizeFileName(baseName) || t('rowMigration.defaultFileName');
		let attempt = 0;
		let candidate = sanitizedBase;

		while (attempt < 1000) {
			const fileName = `${candidate}.md`;
			const path = folderPath ? `${folderPath}/${fileName}` : fileName;
			const existing = this.deps.app.vault.getAbstractFileByPath(path);
			if (!existing) {
				return { path, fileName };
			}
			attempt += 1;
			const nextName = this.sanitizeFileName(
				t('rowMigration.duplicatePattern', {
					base: sanitizedBase,
					index: String(attempt + 1)
				})
			);
			candidate = nextName.length > 0 ? nextName : `${sanitizedBase}-${attempt + 1}`;
		}

		throw new Error('row-migration:failed-to-resolve-filename');
	}

	private async writeConfigForNewFile(file: TFile): Promise<void> {
		const payload = this.deps.persistence.getConfigPayload();
		const configManager = new TableConfigManager(this.deps.app);
		await configManager.save(file, payload);
	}

	private async appendBlocksToExistingFile(targetFile: TFile, blockMarkdown: string): Promise<void> {
		const existingContent = await this.deps.app.vault.read(targetFile);
		const { contentWithoutConfig, configSection } = this.separateConfigSection(existingContent);
		const trimmedBase = contentWithoutConfig.trimEnd();

		let newContent = trimmedBase.length > 0 ? `${trimmedBase}\n\n${blockMarkdown}` : blockMarkdown;
		if (!newContent.endsWith('\n')) {
			newContent += '\n';
		}

		if (configSection) {
			newContent = `${newContent.trimEnd()}\n\n${configSection}`;
			if (!newContent.endsWith('\n')) {
				newContent += '\n';
			}
		}

		await this.deps.app.vault.modify(targetFile, newContent);
	}

	private separateConfigSection(source: string): { contentWithoutConfig: string; configSection: string | null } {
		const configMatch = source.match(/\n\s*>[^\n]*\[!tlb-config][\s\S]*$/i);
		if (!configMatch) {
			return { contentWithoutConfig: source, configSection: null };
		}
		const startIndex = configMatch.index ?? 0;
		const contentWithoutConfig = source.slice(0, startIndex).trimEnd();
		const configSection = source.slice(startIndex).trimStart();
		return { contentWithoutConfig, configSection };
	}

	private getKnownTableFiles(currentFile: TFile): TFile[] {
		const plugin = getPluginContext();
		const cacheManager = plugin?.cacheManager ?? null;
		if (!plugin || !cacheManager) {
			return [];
		}

		const paths = cacheManager.listFilePaths();
		const vault = this.deps.app.vault;
		const files: TFile[] = [];
		for (const path of paths) {
			if (!path || path === currentFile.path) {
				continue;
			}
			const file = vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				files.push(file);
			}
		}

		files.sort((a, b) => a.basename.localeCompare(b.basename, undefined, { sensitivity: 'base' }));
		return files;
	}

	private promptForTargetFile(currentFile: TFile, candidates: TFile[]): Promise<TFile | null> {
		return new Promise((resolve) => {
			const modal = new RowMigrationTargetModal(this.deps.app, currentFile, candidates, {
				onChoose: (file) => resolve(file),
				onCancel: () => resolve(null)
			});
			modal.open();
		});
	}
}
