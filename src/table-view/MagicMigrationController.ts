import { Notice, TFile } from 'obsidian';
import type { TableView } from '../TableView';
import { t } from '../i18n';
import { MagicMigrationModal, type MagicMigrationPreview } from './MagicMigrationModal';
import { getLogger } from '../utils/logger';
import { SchemaBuilder } from './SchemaBuilder';
import { TableDataStore } from './TableDataStore';
import type { H2Block } from './MarkdownBlockParser';
import { getPluginContext } from '../pluginContext';
import { TableRefreshCoordinator } from './TableRefreshCoordinator';
import { getCurrentLocalDateTime } from '../utils/datetime';

interface MissingFormatContext {
	container: HTMLElement;
	content: string;
	file: TFile;
}

interface ExtractionResult {
	columns: string[];
	rows: string[][];
	placeholderCount: number;
	truncated: boolean;
	totalMatches: number;
	error: string | null;
}

const PREVIEW_ROW_LIMIT = 8;
const MATCH_LIMIT = 20000;

export class MagicMigrationController {
	private readonly logger = getLogger('table-view:magic-migration');
	private activeModal: MagicMigrationModal | null = null;
	private lastPromptedPath: string | null = null;
	private readonly templateCache = new Map<string, string>();
	private readonly sampleCache = new Map<string, string>();

	constructor(private readonly view: TableView) {}

	handleNonStandardFile(context: MissingFormatContext): void {
		this.renderInlinePrompt(context);
		if (this.activeModal) {
			return;
		}
		if (this.lastPromptedPath === context.file.path) {
			return;
		}
		this.lastPromptedPath = context.file.path;
		this.openWizard(context);
	}

	resetPromptState(): void {
		this.lastPromptedPath = null;
	}

	private renderInlinePrompt(context: MissingFormatContext): void {
		const { container, file, content } = context;
		container.empty();
		container.addClass('tlb-magic-inline');
		container.createEl('h3', { text: t('magicMigration.inlineTitle') });
		container.createEl('p', { text: t('magicMigration.inlineMessage') });
		const button = container.createEl('button', {
			text: t('magicMigration.inlineOpenButton'),
			cls: 'mod-cta tlb-magic-inline__cta'
		});
		button.addEventListener('click', () => {
			this.openWizard({ container, file, content });
		});
	}

	private openWizard(context: MissingFormatContext): void {
		const initialTemplate = this.getInitialTemplate(context);
		const initialSample = this.getInitialSample(context);
		const modal = new MagicMigrationModal(this.view.app, {
			initialTemplate,
			initialSample,
			targetFileName: this.buildTargetFileName(context.file),
			computePreview: (template, sample) => this.buildPreview(template, sample, context.content),
			onSubmit: async (template, sample) => {
				this.templateCache.set(context.file.path, template);
				this.sampleCache.set(context.file.path, sample);
				return this.convertFile(context.file, context.content, template, sample);
			},
			onClose: (latestTemplate, latestSample) => {
				this.templateCache.set(context.file.path, latestTemplate);
				this.sampleCache.set(context.file.path, latestSample);
				this.activeModal = null;
			}
		});
		this.activeModal = modal;
		modal.open();
	}

	private buildPreview(template: string, sample: string, content: string): MagicMigrationPreview {
		const extraction = this.extractMatches(template, sample, content, PREVIEW_ROW_LIMIT);
		const previewRows = extraction.rows.slice(0, PREVIEW_ROW_LIMIT);
		return {
			columns: extraction.columns,
			rows: previewRows,
			error: extraction.error,
			matchCount: extraction.totalMatches,
			truncated: extraction.truncated || extraction.totalMatches > previewRows.length
		};
	}

	private extractMatches(template: string, sample: string, content: string, previewLimit: number): ExtractionResult {
		const normalizedTemplate = template.trim();
		if (!normalizedTemplate) {
			return {
				columns: [],
				rows: [],
				placeholderCount: 0,
				truncated: false,
				totalMatches: 0,
				error: t('magicMigration.errorTemplateRequired')
			};
		}

		const placeholderCount = this.countPlaceholders(normalizedTemplate);
		if (placeholderCount === 0) {
			return {
				columns: [],
				rows: [],
				placeholderCount,
				truncated: false,
				totalMatches: 0,
				error: t('magicMigration.errorNeedPlaceholder')
			};
		}

		const compiled = this.buildRegex(normalizedTemplate);
		if (!compiled) {
			return {
				columns: [],
				rows: [],
				placeholderCount,
				truncated: false,
				totalMatches: 0,
				error: t('magicMigration.errorInvalidPattern')
			};
		}

		const candidates = this.getCandidateParagraphs(content, sample);
		if (candidates.length === 0) {
			return {
				columns: [],
				rows: [],
				placeholderCount,
				truncated: false,
				totalMatches: 0,
				error: t('magicMigration.errorSampleNoMatch')
			};
		}

		const columns = this.buildColumnNames(placeholderCount);
		const rows: string[][] = [];
		let totalMatches = 0;
		let truncated = false;

		for (const paragraph of candidates) {
			const match = compiled.exec(paragraph);
			if (!match) {
				continue;
			}
			const captures = match.slice(1, placeholderCount + 1).map((value) => (value ?? '').trim());
			if (captures.every((value) => value.length === 0)) {
				continue;
			}
			rows.push(captures);
			totalMatches += 1;
			if (rows.length >= MATCH_LIMIT) {
				truncated = true;
				break;
			}
		}

		if (rows.length === 0) {
			return {
				columns,
				rows: [],
				placeholderCount,
				truncated,
				totalMatches,
				error: t('magicMigration.errorNoMatch')
			};
		}

		return {
			columns,
			rows: rows.slice(0, previewLimit),
			placeholderCount,
			truncated: truncated || rows.length > previewLimit,
			totalMatches,
			error: null
		};
	}

	private async convertFile(file: TFile, content: string, template: string, sample: string): Promise<boolean> {
		const extraction = this.extractMatches(template, sample, content, MATCH_LIMIT);
		if (extraction.error) {
			new Notice(extraction.error);
			return false;
		}
		if (extraction.rows.length === 0) {
			new Notice(t('magicMigration.errorNoMatch'));
			return false;
		}

		try {
			const blocks = this.buildBlocks(extraction);
			if (blocks.length === 0) {
				new Notice(t('magicMigration.errorNoMatch'));
				return false;
			}
			const markdown = this.blocksToMarkdown(blocks);
			const targetPath = await this.resolveTargetPath(file, this.buildTargetFileName(file));
			const newFile = await this.view.app.vault.create(targetPath, markdown);
			TableRefreshCoordinator.requestRefreshForPath(newFile.path, {
				source: 'table-operation',
				structural: true,
				reason: 'magic-migration'
			});
			await this.openFileInTableView(newFile);
			new Notice(t('magicMigration.successNotice', { fileName: newFile.basename }));
			return true;
		} catch (error) {
			this.logger.error('Magic migration failed', error);
			new Notice(t('magicMigration.failureNotice'));
			return false;
		}
	}

	private buildBlocks(extraction: ExtractionResult): H2Block[] {
		const primaryField = extraction.columns[0] ?? t('magicMigration.defaultPrimaryField');
		const fieldNames = extraction.columns.slice(1);
		const blocks: H2Block[] = [];
		const statusTimestamp = getCurrentLocalDateTime();

		for (const row of extraction.rows) {
			const [first, ...rest] = row;
			const data: Record<string, string> = {};
			data[primaryField] = first ?? '';
			data['status'] = 'todo';
			data['statusChanged'] = statusTimestamp;
			for (let index = 0; index < fieldNames.length; index++) {
				data[fieldNames[index]] = rest[index] ?? '';
			}
			blocks.push({
				title: first ?? '',
				data,
				collapsedFields: []
			});
		}

		return blocks;
	}

	private blocksToMarkdown(blocks: H2Block[]): string {
		const schemaBuilder = new SchemaBuilder();
		const dataStore = new TableDataStore({
			rowLimit: 5000,
			errorValue: '#ERR',
			tooltipPrefix: '__tlbFormulaTooltip__'
		});
		const result = schemaBuilder.buildSchema(blocks, null);
		dataStore.initialise(result, null);
		return `${dataStore.blocksToMarkdown().trimEnd()}\n`;
	}

	private getInitialTemplate(context: MissingFormatContext): string {
		const cached = this.templateCache.get(context.file.path);
		if (cached && cached.trim().length > 0) {
			return cached;
		}
		return this.extractSample(context.content);
	}

	private getInitialSample(context: MissingFormatContext): string {
		const cached = this.sampleCache.get(context.file.path);
		if (cached && cached.trim().length > 0) {
			return cached;
		}
		return this.extractSample(context.content);
	}

	private extractSample(content: string): string {
		const withoutFrontmatter = this.stripFrontmatter(content);
		const segments = withoutFrontmatter.split(/\n\s*\n/);
		for (const segment of segments) {
			const normalized = segment
				.split('\n')
				.map((line) => line.trim())
				.filter((line) => line.length > 0)
				.join('\n');
			if (this.isTopHeadingOnly(normalized)) {
				continue;
			}
			if (normalized.length > 0) {
				return this.truncateTemplate(normalized);
			}
		}

		const firstLine = withoutFrontmatter
			.split('\n')
			.map((line) => line.trim())
			.find((line) => line.length > 0 && !/^#\s+/.test(line));
		return this.truncateTemplate(firstLine ?? '');
	}

	private truncateTemplate(raw: string): string {
		const limit = 320;
		if (raw.length <= limit) {
			return raw;
		}
		return `${raw.slice(0, limit)}...`;
	}

	private stripFrontmatter(content: string): string {
		if (!content.startsWith('---')) {
			return content;
		}
		const endIndex = content.indexOf('\n---', 3);
		if (endIndex === -1) {
			return content;
		}
		return content.slice(endIndex + 4);
	}

	private isTopHeadingOnly(text: string): boolean {
		if (!text.trim()) {
			return false;
		}
		const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
		if (lines.length === 0) {
			return false;
		}
		return lines.every((line) => /^#\s+/.test(line) && !/^##/.test(line));
	}

	private getCandidateParagraphs(content: string, sample: string): string[] {
		const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
		const trimmedSample = sample.trim();
		if (!trimmedSample) {
			return normalizedContent
				.split(/\n\s*\n/)
				.map((block) => block.trim())
				.filter((block) => block.length > 0);
		}

		return [sample];
	}

	private buildTargetFileName(file: TFile): string {
		const base = `${file.basename}_tlb`;
		return this.sanitizeFileName(base) || t('magicMigration.defaultFileName');
	}

	private async resolveTargetPath(file: TFile, baseName: string): Promise<string> {
		const folder = file.parent?.path ?? '';
		let candidate = folder ? `${folder}/${baseName}.md` : `${baseName}.md`;
		const vault = this.view.app.vault;
		if (!vault.getAbstractFileByPath(candidate)) {
			return candidate;
		}
		let counter = 2;
		while (counter < 500) {
			const nextBase = `${baseName} ${counter}`;
			candidate = folder ? `${folder}/${nextBase}.md` : `${nextBase}.md`;
			if (!vault.getAbstractFileByPath(candidate)) {
				return candidate;
			}
			counter += 1;
		}
		return folder ? `${folder}/${baseName} ${Date.now()}.md` : `${baseName} ${Date.now()}.md`;
	}

	private sanitizeFileName(raw: string): string {
		return raw
			.replace(/[\\/:*?"<>|#]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.replace(/[. ]+$/g, '');
	}

	private buildRegex(template: string): RegExp | null {
		const trimmed = template.trim();
		const placeholderCount = this.countPlaceholders(trimmed);
		if (placeholderCount === 0) {
			return null;
		}

		const tokens = trimmed.split('*');
		const parts: string[] = [];
		parts.push('^');

		for (let index = 0; index < placeholderCount; index++) {
			const literal = tokens[index] ?? '';
			if (literal.length > 0) {
				parts.push(this.escapeLiteral(literal, false));
			}
			const isLast = index === placeholderCount - 1;
			parts.push(isLast ? '([\\s\\S]+)' : '([\\s\\S]+?)');
		}

		const tailLiteral = tokens[placeholderCount] ?? '';
		if (tailLiteral.length > 0) {
			parts.push(this.escapeLiteral(tailLiteral, false));
		}
		parts.push('$');

		try {
			return new RegExp(parts.join(''), 'u');
		} catch (error) {
			this.logger.warn('Failed to compile star template', error);
			return null;
		}
	}

	private escapeLiteral(literal: string, allowFlexibleWhitespace: boolean): string {
		if (!allowFlexibleWhitespace) {
			return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		}
		return literal
			.split(/(\s+)/)
			.map((part) => {
				if (/^\s+$/.test(part)) {
					return '\\s+';
				}
				return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			})
			.join('');
	}

	public runExtractionForTest(template: string, sample: string, content: string): ExtractionResult {
		return this.extractMatches(template, sample, content, MATCH_LIMIT);
	}

	private countPlaceholders(template: string): number {
		return (template.match(/\*/g) ?? []).length;
	}

	private buildColumnNames(placeholderCount: number): string[] {
		const columns: string[] = [];
		const primary = t('magicMigration.defaultPrimaryField');
		columns.push(primary);
		const base = t('magicMigration.fieldBaseName');
		const additional = Math.max(placeholderCount - 1, 0);
		for (let index = 1; index <= additional; index++) {
			columns.push(`${base} ${index}`);
		}
		return columns;
	}

	private async openFileInTableView(file: TFile): Promise<void> {
		const plugin = getPluginContext();
		if (plugin && typeof (plugin as any).openFileInTableView === 'function') {
			await (plugin as any).openFileInTableView(file);
			return;
		}
		await this.view.app.workspace.openLinkText(file.path, '', true);
	}
}
