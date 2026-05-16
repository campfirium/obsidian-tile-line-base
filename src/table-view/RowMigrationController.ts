import type { App } from 'obsidian';

import { Notice, TFile } from 'obsidian';

import type { TablePersistenceService } from './TablePersistenceService';

import type { TableDataStore } from './TableDataStore';

import type { RowInteractionController } from './RowInteractionController';

import type { Schema } from './SchemaBuilder';

import type { H2Block } from './MarkdownBlockParser';
import { encodeFieldValue, isTildeFenceMarker } from './MultilineFieldCodec';


import { t } from '../i18n';

import { getLogger } from '../utils/logger';

import { TableConfigManager } from './TableConfigManager';


import { TableRefreshCoordinator } from './TableRefreshCoordinator';



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

			const { path, fileName } = this.resolveAvailableFilePath(folderPath, baseName);

			newFile = await this.deps.app.vault.create(path, blockMarkdown);

			await this.writeConfigForNewFile(newFile);

			TableRefreshCoordinator.requestRefreshForPath(newFile.path, {

				source: 'table-operation',

				structural: true,

				reason: mode === 'move' ? 'row-migration:move-new-file' : 'row-migration:copy-new-file',

				immediate: true

			});



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

					await this.deps.app.fileManager.trashFile(newFile);

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

			let scanIndex = 0;
			while (scanIndex < baseLines.length) {
				const currentLine = baseLines[scanIndex] ?? '';
				if (!this.isColumnLine(currentLine, columnSet)) {
					break;
				}
				const trimmed = currentLine.trim();
				const dataLine = trimmed.startsWith('## ') ? trimmed.slice(3) : trimmed;
				const colonIndex = dataLine.indexOf(colon);
				const valuePart = colonIndex >= 0 ? dataLine.slice(colonIndex + 1).trim() : '';
				const fenceStart = scanIndex;
				let fence: string | null = null;
				let nextScanIndex: number | null = null;

				if (!valuePart) {
					const nextFence = baseLines[scanIndex + 1] ?? '';
					if (isTildeFenceMarker(nextFence)) {
						fence = nextFence;
						nextScanIndex = scanIndex + 2;
					}
				}

				if (!fence || nextScanIndex === null) {
					scanIndex += 1;
					continue;
				}

				scanIndex = nextScanIndex;
				let closed = false;
				while (scanIndex < baseLines.length) {
					const candidate = baseLines[scanIndex] ?? '';
					if (candidate === fence) {
						closed = true;
						scanIndex += 1;
						break;
					}
					scanIndex += 1;
				}
				if (!closed) {
					scanIndex = fenceStart;
					break;
				}
			}

			const extras = scanIndex < baseLines.length ? baseLines.slice(scanIndex) : [];

			const fieldLines: string[] = [];

			for (let columnIndex = 0; columnIndex < columnNames.length; columnIndex++) {

				const field = columnNames[columnIndex];

				const value = block.data[field] ?? '';
				const encoded = encodeFieldValue(value);
				const linePrefix = columnIndex === 0 ? `## ${field}${colon}` : `${field}${colon}`;
				if (encoded.fence && encoded.contentLines) {
					fieldLines.push(linePrefix);
					fieldLines.push(encoded.fence);
					fieldLines.push(...encoded.contentLines);
					fieldLines.push(encoded.fence);
				} else {
					fieldLines.push(`${linePrefix}${encoded.inlineValue}`);
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



	private resolveAvailableFilePath(

		folderPath: string,

		baseName: string

	): { path: string; fileName: string } {

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

		const configManager = new TableConfigManager();

		await configManager.save(file, payload);

	}



}
