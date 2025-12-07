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

interface MagicMigrationContext {
	container?: HTMLElement;
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
const COLUMN_LABEL_BASE = 'Column';

export class MagicMigrationController {
	private readonly logger = getLogger('table-view:magic-migration');
	private activeModal: MagicMigrationModal | null = null;
	private readonly templateCache = new Map<string, string>();
	private readonly sampleCache = new Map<string, string>();
	private readonly columnCache = new Map<string, string[]>();

	constructor(private readonly view: TableView) {}

	handleNonStandardFile(context: MagicMigrationContext): void {
		if (!context.container) {
			return;
		}
		this.renderInlinePrompt(context.container, context.content, context.file);
	}

	resetPromptState(): void {
		if (this.activeModal) {
			this.activeModal.close();
			this.activeModal = null;
		}
	}

	public launchWizard(context: MagicMigrationContext): void {
		this.openWizard(context);
	}

	private renderInlinePrompt(container: HTMLElement, content: string, file: TFile): void {
		container.empty();
		const wrapper = container.createDiv({ cls: 'tlb-magic-inline' });
		wrapper.createEl('h3', { text: t('magicMigration.inlineTitle') });
		wrapper.createEl('p', { text: t('magicMigration.inlineMessage') });
		const cta = wrapper.createDiv({ cls: 'tlb-magic-inline__cta' });
		const openButton = cta.createEl('button', {
			text: t('magicMigration.inlineOpenButton'),
			cls: 'mod-cta'
		});
		openButton.addEventListener('click', () => {
			if (this.activeModal) {
				return;
			}
			this.openWizard({ content, file });
		});
	}

	private openWizard(context: MagicMigrationContext): void {
		if (this.activeModal) {
			return;
		}
		const initialTemplate = this.getInitialTemplate(context);
		const initialSample = this.getInitialSample(context);
		const initialColumns = this.getInitialColumns(context, initialTemplate);
		const modal = new MagicMigrationModal(this.view.app, {
			initialTemplate,
			initialSample,
			initialColumns,
			sourceContent: context.content,
			targetFileName: this.buildTargetFileName(context.file),
			computePreview: (template, sample, columnNames) =>
				this.buildPreview(template, sample, context.content, columnNames),
			onSubmit: async (template, sample, columnNames) => {
				this.templateCache.set(context.file.path, template);
				this.sampleCache.set(context.file.path, sample);
				this.columnCache.set(context.file.path, columnNames);
				return this.convertFile(context.file, context.content, template, sample, columnNames);
			},
			onClose: (latestTemplate, latestSample, latestColumns) => {
				this.templateCache.set(context.file.path, latestTemplate);
				this.sampleCache.set(context.file.path, latestSample);
				this.columnCache.set(context.file.path, latestColumns);
				this.activeModal = null;
			}
		});
		this.activeModal = modal;
		modal.open();
	}

	private buildPreview(
		template: string,
		sample: string,
		content: string,
		columnNames: string[]
	): MagicMigrationPreview {
		const extraction = this.extractMatches(template, sample, content, PREVIEW_ROW_LIMIT, columnNames);
		const previewRows = extraction.rows.slice(0, PREVIEW_ROW_LIMIT);
		return {
			columns: extraction.columns,
			rows: previewRows,
			error: extraction.error,
			matchCount: extraction.totalMatches,
			truncated: extraction.truncated || extraction.totalMatches > previewRows.length
		};
	}

	private extractMatches(
		template: string,
		sample: string,
		content: string,
		previewLimit: number,
		columnNames: string[]
	): ExtractionResult {
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

		const columns = this.buildColumnNames(placeholderCount, columnNames);
		const normalizedContent = this.stripFrontmatter(content).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
		const contentSlice = this.sliceFromSample(normalizedContent, sample);
		if (!contentSlice) {
			return {
				columns,
				rows: [],
				placeholderCount,
				truncated: false,
				totalMatches: 0,
				error: t('magicMigration.errorSampleNoMatch')
			};
		}

		const rows: string[][] = [];
		let totalMatches = 0;
		let truncated = false;

		const isSingleStar = normalizedTemplate === '*';
		const units = this.buildRecordUnits(contentSlice, sample, isSingleStar, normalizedTemplate);
		const regex = this.buildRegex(normalizedTemplate);
		if (!regex) {
			return {
				columns,
				rows: [],
				placeholderCount,
				truncated: false,
				totalMatches: 0,
				error: t('magicMigration.errorInvalidPattern')
			};
		}

		for (const unit of units) {
			const match = regex.exec(unit);
			if (!match) {
				continue;
			}
			const captures = match
				.slice(1, placeholderCount + 1)
				.map((value) => this.normalizeCapturedValue(value ?? ''));
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

	private async convertFile(
		file: TFile,
		content: string,
		template: string,
		sample: string,
		columnNames: string[]
	): Promise<boolean> {
		const extraction = this.extractMatches(template, sample, content, MATCH_LIMIT, columnNames);
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
			const markdownBody = this.blocksToMarkdown(blocks);
			const { frontmatter } = this.splitFrontmatter(content);
			const markdown = this.mergeFrontmatter(frontmatter, markdownBody);
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
		const primaryField = extraction.columns[0] ?? `${COLUMN_LABEL_BASE} 1`;
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

	private getInitialTemplate(context: MagicMigrationContext): string {
		const cached = this.templateCache.get(context.file.path);
		if (cached && cached.trim().length > 0) {
			return cached;
		}
		return this.extractSample(context.content);
	}

	private getInitialSample(context: MagicMigrationContext): string {
		const cached = this.sampleCache.get(context.file.path);
		if (cached && cached.trim().length > 0) {
			return cached;
		}
		return this.extractSample(context.content);
	}

	private getInitialColumns(context: MagicMigrationContext, template: string): string[] {
		const placeholderCount = Math.max(this.countPlaceholders(template.trim()), 1);
		const cached = this.columnCache.get(context.file.path);
		if (cached && cached.length > 0) {
			return this.buildColumnNames(placeholderCount, cached);
		}
		return this.buildColumnNames(placeholderCount, []);
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
		return this.splitFrontmatter(content).body;
	}

	private splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
		if (!content.startsWith('---')) {
			return { frontmatter: null, body: content };
		}
		const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/u.exec(content);
		if (!match) {
			return { frontmatter: null, body: content };
		}
		return {
			frontmatter: match[0],
			body: content.slice(match[0].length)
		};
	}

	private mergeFrontmatter(frontmatter: string | null, markdown: string): string {
		if (!frontmatter) {
			return markdown;
		}
		const normalized = frontmatter.endsWith('\n') ? frontmatter : `${frontmatter}\n`;
		const needsBlankLine = /(\r?\n){2}$/.test(normalized);
		const spacer = needsBlankLine ? '' : '\n';
		return `${normalized}${spacer}${markdown}`;
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

	private sliceFromSample(content: string, sample: string): string | null {
		const trimmedSample = sample.trim();
		if (!trimmedSample) {
			return content;
		}
		const anchorIndex = content.indexOf(trimmedSample);
		if (anchorIndex === -1) {
			return null;
		}
		return content.slice(anchorIndex);
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

	public runExtractionForTest(
		template: string,
		sample: string,
		content: string,
		columnNames: string[] = []
	): ExtractionResult {
		return this.extractMatches(template, sample, content, MATCH_LIMIT, columnNames);
	}

	private buildRecordUnits(content: string, sample: string, isSingleStar: boolean, template: string): string[] {
		if (isSingleStar) {
			if (sample.includes('\n')) {
				return content
					.split(/\n\s*\n/)
					.map((block) => block.trim())
					.filter((block) => block.length > 0);
			}
			return content
				.split(/\n+/)
				.map((line) => line.trim())
				.filter((line) => line.length > 0);
		}

		if (template.includes('\n')) {
			return content
				.split(/\n\s*\n/)
				.map((block) => block.trim())
				.filter((block) => block.length > 0);
		}

		return content
			.split(/\n+/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	}

	private countPlaceholders(template: string): number {
		return (template.match(/\*/g) ?? []).length;
	}

	private buildColumnNames(placeholderCount: number, columnNames: string[]): string[] {
		const columns: string[] = [];
		const count = Math.max(placeholderCount, 1);
		for (let index = 0; index < count; index++) {
			const override = (columnNames[index] ?? '').trim();
			columns.push(override || `${COLUMN_LABEL_BASE} ${index + 1}`);
		}
		return columns;
	}

	private normalizeCapturedValue(raw: string): string {
		return raw.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
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
