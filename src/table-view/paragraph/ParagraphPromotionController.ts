import { App, Notice, TFile, normalizePath } from 'obsidian';
import type { Schema } from '../SchemaBuilder';
import type { TableDataStore } from '../TableDataStore';
import type { TableHistoryManager } from '../TableHistoryManager';
import type { H2Block } from '../MarkdownBlockParser';
import { openParagraphPromotionModal } from './ParagraphPromotionModal';
import { t } from '../../i18n';
import { getLogger } from '../../utils/logger';
import { ROW_ID_FIELD } from '../../grid/GridAdapter';

interface ParagraphPromotionDeps {
	app: App;
	dataStore: TableDataStore;
	history: TableHistoryManager;
	getSchema: () => Schema | null;
	getFile: () => TFile | null;
	persistColumnStructureChange: (options?: { notice?: string }) => void;
	refreshGrid: () => void;
	scheduleSave: () => void;
}

interface PromotionResult {
	createdFile: TFile;
	linkValue: string;
	rowIndex: number;
}

const logger = getLogger('table-view:paragraph-promotion');

export class ParagraphPromotionController {
	private readonly app: App;
	private readonly dataStore: TableDataStore;
	private readonly history: TableHistoryManager;
	private readonly getSchema: () => Schema | null;
	private readonly getFile: () => TFile | null;
	private readonly persistColumnStructureChange: (options?: { notice?: string }) => void;
	private readonly refreshGrid: () => void;
	private readonly scheduleSave: () => void;
	private linkColumnField: string | null = null;

	constructor(deps: ParagraphPromotionDeps) {
		this.app = deps.app;
		this.dataStore = deps.dataStore;
		this.history = deps.history;
		this.getSchema = deps.getSchema;
		this.getFile = deps.getFile;
		this.persistColumnStructureChange = deps.persistColumnStructureChange;
		this.refreshGrid = deps.refreshGrid;
		this.scheduleSave = deps.scheduleSave;
	}

	async promoteRows(rowIndexes: number[]): Promise<void> {
		const schema = this.getSchema();
		if (!schema) {
			logger.error('promoteRows aborted: schema unavailable');
			return;
		}

		const normalizedIndexes = this.normalizeRowIndexes(rowIndexes);
		if (normalizedIndexes.length === 0) {
			new Notice(t('paragraphPromotion.noSelectionNotice'));
			return;
		}

		const existingLinkField = this.resolveExistingLinkColumn(schema);
		const primaryField = schema.columnNames[0] ?? null;
		const availableColumns = schema.columnNames.filter((field) =>
			this.isSelectableColumn(field, existingLinkField, primaryField)
		);

		if (availableColumns.length === 0) {
			new Notice(t('paragraphPromotion.noColumns'));
			return;
		}

		const modalResult = await openParagraphPromotionModal(this.app, {
			columns: availableColumns,
			includeEmptyFields: true
		});
		if (!modalResult) {
			logger.debug('promoteRows cancelled by user');
			return;
		}
		const { selected, includeEmpty } = modalResult;
		const selectedColumns = Array.from(new Set(selected));
		const bodyColumns = availableColumns.filter((column) => !selectedColumns.includes(column));

		const schemaAfterModal = this.getSchema();
		if (!schemaAfterModal) {
			logger.error('promoteRows aborted: schema lost after modal');
			return;
		}

		const { field: linkField, created } = this.ensureLinkColumn(schemaAfterModal);
		if (!linkField) {
			logger.error('promoteRows aborted: link column unavailable');
			new Notice(t('paragraphPromotion.linkColumnFailed'));
			return;
		}

		const sourceFile = this.getFile();
		const folderPath = sourceFile?.parent?.path ?? '';
		const usedPaths = new Set<string>();
		const successes: PromotionResult[] = [];
		let failures = 0;

		for (const rowIndex of normalizedIndexes) {
			const block = this.dataStore.getBlocks()[rowIndex];
			if (!block) {
				logger.warn('Skipped promotion for missing block', { rowIndex });
				failures += 1;
				continue;
			}

			try {
				const { path: targetPath } = this.generateUniquePath(block, selectedColumns, folderPath, usedPaths);
				const content = this.buildNoteContent(block, selectedColumns, bodyColumns, includeEmpty);
				const createdFile = await this.app.vault.create(targetPath, content);
				usedPaths.add(createdFile.path);
				const linkValue = this.buildLinkValue(createdFile, sourceFile);
				successes.push({ createdFile, linkValue, rowIndex });
			} catch (error) {
				failures += 1;
				logger.error('Failed to promote block to note', { error, rowIndex });
			}
		}

		if (successes.length > 0) {
			this.applyLinkUpdates(linkField, successes);
		}

		if (created) {
			this.persistColumnStructureChange({
				notice: t('paragraphPromotion.linkColumnCreatedNotice', { name: linkField })
			});
		}

		this.emitResultNotices(successes.length, failures);
	}

	private normalizeRowIndexes(rowIndexes: number[]): number[] {
		const blocks = this.dataStore.getBlocks();
		const seen = new Set<number>();
		const normalized: number[] = [];
		for (const index of rowIndexes) {
			if (!Number.isInteger(index)) {
				continue;
			}
			if (index < 0 || index >= blocks.length) {
				continue;
			}
			if (seen.has(index)) {
				continue;
			}
			seen.add(index);
			normalized.push(index);
		}
		normalized.sort((a, b) => a - b);
		return normalized;
	}

	private isSelectableColumn(field: string | undefined, linkField: string | null, primaryField: string | null): boolean {
		if (!field) {
			return false;
		}
		const trimmed = field.trim();
		if (!trimmed || trimmed === ROW_ID_FIELD) {
			return false;
		}
		if (primaryField && trimmed === primaryField.trim()) {
			return false;
		}
		if (linkField && trimmed === linkField) {
			return false;
		}
		const baseName = t('paragraphPromotion.linkColumnName');
		if (trimmed === baseName) {
			return false;
		}
		return true;
	}

	private resolveExistingLinkColumn(schema: Schema): string | null {
		if (this.linkColumnField && schema.columnNames.includes(this.linkColumnField)) {
			return this.linkColumnField;
		}
		const baseName = t('paragraphPromotion.linkColumnName');
		const normalizedBase = baseName.toLowerCase();
		const direct = schema.columnNames.find((name) => name.toLowerCase() === normalizedBase);
		if (direct) {
			this.linkColumnField = direct;
			return direct;
		}
		const prefixed = schema.columnNames.find((name) => name.toLowerCase().startsWith(`${normalizedBase} `));
		if (prefixed) {
			this.linkColumnField = prefixed;
			return prefixed;
		}
		return null;
	}

	private ensureLinkColumn(schema: Schema): { field: string | null; created: boolean } {
		const existing = this.resolveExistingLinkColumn(schema);
		if (existing) {
			return { field: existing, created: false };
		}

		const baseName = t('paragraphPromotion.linkColumnName');
		const lastField = schema.columnNames[schema.columnNames.length - 1] ?? null;
		const created = this.dataStore.insertColumnAfter(lastField ?? '', baseName);
		if (!created) {
			return { field: null, created: false };
		}
		this.linkColumnField = created;
		return { field: created, created: true };
	}

	private generateUniquePath(
		block: H2Block,
		selectedColumns: string[],
		folderPath: string,
		usedPaths: Set<string>
	): { fileName: string; path: string } {
		const baseName = this.resolveBaseName(block, selectedColumns);
		const folderNormalized = folderPath ? normalizePath(folderPath) : '';

		for (let attempt = 0; attempt < 500; attempt++) {
			const suffix = attempt === 0 ? '' : ` ${attempt + 1}`;
			const candidateName = `${baseName}${suffix}`.trim();
			const fileName = candidateName.length > 0 ? candidateName : t('paragraphPromotion.noteNameFallback');
			const rawPath = folderNormalized
				? `${folderNormalized}/${fileName}.md`
				: `${fileName}.md`;
			const normalized = normalizePath(rawPath);
			if (usedPaths.has(normalized)) {
				continue;
			}
			if (!this.app.vault.getAbstractFileByPath(normalized)) {
				return { fileName, path: normalized };
			}
		}

		throw new Error('Unable to resolve unique file name');
	}

	private resolveBaseName(block: H2Block, selectedColumns: string[]): string {
		const candidates: string[] = [];
		if (block.title) {
			const trimmedTitle = block.title.trim();
			if (trimmedTitle.length > 0) {
				candidates.push(trimmedTitle);
			}
		}
		for (const field of selectedColumns) {
			const raw = block.data?.[field];
			if (typeof raw === 'string' && raw.trim().length > 0) {
				candidates.push(raw.trim());
			}
		}
		const fallback = t('paragraphPromotion.noteNameFallback');
		const chosen = candidates.find((value) => value.length > 0) ?? fallback;
		return this.sanitizeFileName(chosen) || fallback;
	}

	private sanitizeFileName(raw: string): string {
		const replaced = raw
			.replace(/[\\:*?"<>|#]/g, ' ')
			.replace(/\//g, ' ')
			.replace(/\[/g, ' ')
			.replace(/\]/g, ' ');
		const collapsed = replaced.replace(/\s+/g, ' ').trim();
		const trimmed = collapsed.replace(/[. ]+$/g, '');
		return trimmed.slice(0, 80);
	}

	private buildNoteContent(block: H2Block, yamlColumns: string[], bodyColumns: string[], includeEmptyFields: boolean): string {
		const lines: string[] = [];
		const frontmatter = this.buildFrontmatter(block, yamlColumns, includeEmptyFields);
		if (frontmatter.length > 0) {
			lines.push('---', ...frontmatter, '---', '');
		}
		const heading = block.title?.trim() || t('paragraphPromotion.noteNameFallback');
		lines.push(`# ${heading}`, '');
		const body = this.buildBodyContent(block, bodyColumns, includeEmptyFields);
		if (body.length > 0) {
			lines.push(...body, '');
		}
		return `${lines.join('\n').trimEnd()}\n`;
	}

	private buildFrontmatter(block: H2Block, selectedColumns: string[], includeEmptyFields: boolean): string[] {
		const lines: string[] = [];
		for (const field of selectedColumns) {
			const raw = block.data?.[field];
			if (raw === undefined) {
				if (!includeEmptyFields) {
					continue;
				}
			}
			if (!includeEmptyFields) {
				if (raw === null) {
					continue;
				}
				if (typeof raw === 'string' && raw.trim().length === 0) {
					continue;
				}
				if (typeof raw !== 'string' && String(raw).trim().length === 0) {
					continue;
				}
			}
			const value = typeof raw === 'string' ? raw : raw === null || raw === undefined ? '' : String(raw);
			const normalizedValue = value.replace(/\r\n?/g, '\n');
			const key = this.escapeYamlKey(field);
			const formattedValue = this.formatYamlValue(normalizedValue);
			lines.push(`${key}: ${formattedValue}`);
		}
		return lines;
	}

	private buildBodyContent(block: H2Block, bodyColumns: string[], includeEmptyFields: boolean): string[] {
		const lines: string[] = [];
		for (const field of bodyColumns) {
			const raw = block.data?.[field];
			if (raw === undefined || raw === null) {
				if (!includeEmptyFields) {
					continue;
				}
			}
			const value = typeof raw === 'string' ? raw : raw === null || raw === undefined ? '' : String(raw);
			if (!includeEmptyFields && value.trim().length === 0) {
				continue;
			}
			const normalizedValue = value.replace(/\r\n?/g, '\n');
			if (normalizedValue.length === 0) {
				lines.push(`- ${field}`);
			} else if (normalizedValue.includes('\n')) {
				lines.push(`- ${field}:`);
				for (const part of normalizedValue.split('\n')) {
					lines.push(`  ${part}`);
				}
			} else {
				lines.push(`- ${field}: ${normalizedValue}`);
			}
		}
		return lines;
	}

	private escapeYamlKey(key: string): string {
		const trimmed = key.trim();
		if (/^[A-Za-z0-9_-]+$/.test(trimmed)) {
			return trimmed;
		}
		return `"${trimmed.replace(/"/g, '\\"')}"`;
	}

	private formatYamlValue(value: string): string {
		if (value.length === 0) {
			return '""';
		}
		if (/^[\w\s-]+$/.test(value) && !value.includes('\n') && !/^\s|\s$/.test(value)) {
			return value;
		}
		const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
		return `"${escaped}"`;
	}

	private buildLinkValue(createdFile: TFile, sourceFile: TFile | null): string {
		const sourcePath = sourceFile?.path ?? '';
		try {
			const linkText = this.app.metadataCache.fileToLinktext(createdFile, sourcePath, false);
			return `[[${linkText}]]`;
		} catch (error) {
			logger.warn('Failed to resolve linktext, falling back to basename', { error, target: createdFile.path });
			return `[[${createdFile.basename}]]`;
		}
	}

	private applyLinkUpdates(field: string, results: PromotionResult[]): void {
		const targets = results.map((result) => ({ index: result.rowIndex, fields: [field] }));
		this.history.captureCellChanges(
			targets,
			() => {
				for (const entry of results) {
					this.dataStore.updateCell(entry.rowIndex, field, entry.linkValue);
				}
			},
			{
				undo: { rowIndex: results[0]?.rowIndex ?? null, field },
				redo: { rowIndex: results[0]?.rowIndex ?? null, field }
			}
		);
		this.refreshGrid();
		this.scheduleSave();
	}

	private emitResultNotices(successCount: number, failureCount: number): void {
		if (successCount > 0 && failureCount === 0) {
			new Notice(t('paragraphPromotion.successNotice', { count: String(successCount) }));
			return;
		}
		if (successCount > 0 && failureCount > 0) {
			new Notice(
				t('paragraphPromotion.partialNotice', {
					success: String(successCount),
					failed: String(failureCount)
				})
			);
			return;
		}
		new Notice(t('paragraphPromotion.failureNotice'));
	}
}
