import { Notice, TFile } from 'obsidian';
import type { TableView } from '../TableView';
import { t } from '../i18n';
import { MagicMigrationModal, type MagicMigrationPreview } from './MagicMigrationModal';
import { getLogger } from '../utils/logger';
import { SchemaBuilder } from './SchemaBuilder';
import { TableDataStore } from './TableDataStore';
import type { H2Block, InvalidH2Section, StrayContentSection } from './MarkdownBlockParser';
import { getPluginContext } from '../pluginContext';
import { TABLE_VIEW_TYPE } from '../TableView';
import { TableRefreshCoordinator } from './TableRefreshCoordinator';
import { getCurrentLocalDateTime } from '../utils/datetime';
import { MalformedH2Modal } from './MalformedH2Modal';
import {
	buildColumnNames,
	buildRecordUnits,
	buildRegex,
	countPlaceholders,
	normalizeCapturedValue
} from './magicMigrationPatterns';
import {
	buildTargetFileName,
	extractSample,
	mergeFrontmatter,
	resolveTargetPath,
	sliceFromSample,
	splitFrontmatter,
	stripFrontmatter
} from './magicMigrationContent';

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
	private activeMalformedModal: MalformedH2Modal | null = null;
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

	handleMalformedH2Sections(context: {
		file: TFile;
		content: string;
		sections: InvalidH2Section[];
		straySections: StrayContentSection[];
		convertibleCount: number;
		onApplied?: () => void;
		onIgnore?: () => Promise<void> | void;
	}): boolean {
		const allSections = [...context.sections, ...context.straySections].sort((a, b) => a.startLine - b.startLine);
		if (this.activeMalformedModal || allSections.length === 0) {
			return false;
		}
		const plugin = getPluginContext();
		const canToggle =
			plugin && typeof (plugin as { toggleLeafView?: (leaf: TableView['leaf']) => Promise<void> | void }).toggleLeafView === 'function';
		const startedInTable = this.view.leaf.view?.getViewType?.() === TABLE_VIEW_TYPE;
		const shouldReturnToTable = startedInTable && Boolean(canToggle);
		if (startedInTable && canToggle) {
			void (plugin as { toggleLeafView: (leaf: TableView['leaf']) => Promise<void> | void }).toggleLeafView(this.view.leaf);
		}
		this.activeMalformedModal = new MalformedH2Modal({
			app: this.view.app,
			sections: allSections,
			convertibleCount: context.convertibleCount,
			onApply: async (edits) => {
				await this.applySectionEdits(context.file, context.content, edits);
				context.onApplied?.();
				if (shouldReturnToTable && this.view.leaf.view?.getViewType?.() !== TABLE_VIEW_TYPE && canToggle) {
					void (plugin as { toggleLeafView: (leaf: TableView['leaf']) => Promise<void> | void }).toggleLeafView(this.view.leaf);
				}
			},
			onIgnore: async () => {
				const clearEdits = allSections.map((section) => ({ section, text: '' }));
				await this.applySectionEdits(context.file, context.content, clearEdits);
				await context.onIgnore?.();
				if (shouldReturnToTable && this.view.leaf.view?.getViewType?.() !== TABLE_VIEW_TYPE && canToggle) {
					void (plugin as { toggleLeafView: (leaf: TableView['leaf']) => Promise<void> | void }).toggleLeafView(this.view.leaf);
				}
			},
			onClose: () => {
				this.activeMalformedModal = null;
			}
		});
		this.activeMalformedModal.open();
		return true;
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

	private async applySectionEdits(
		file: TFile,
		originalContent: string,
		edits: Array<{ section: { startLine: number; endLine: number }; text: string }>
	): Promise<void> {
		let baseContent = originalContent;
		try {
			baseContent = await this.view.app.vault.read(file);
		} catch (error) {
			this.logger.warn('Failed to read latest content before applying malformed edits', { error });
		}
		const updated = this.replaceMalformedSections(baseContent, edits);
		try {
			await this.view.app.vault.modify(file, updated);
			new Notice(t('magicMigration.malformedSaveSuccess'));
		} catch (error) {
			this.logger.error('Failed to save malformed H2 edits', { error });
			new Notice(t('magicMigration.malformedSaveError'));
		}
	}

	private replaceMalformedSections(content: string, edits: Array<{ section: { startLine: number; endLine: number }; text: string }>): string {
		const lines = content.split('\n');
		const sorted = [...edits].sort((a, b) => b.section.startLine - a.section.startLine);
		for (const edit of sorted) {
			const replacement = edit.text.replace(/\r\n/g, '\n').split('\n');
			const start = Math.max(0, edit.section.startLine);
			const end = Math.max(edit.section.startLine, edit.section.endLine);
			lines.splice(start, end - start + 1, ...replacement);
		}
		return lines.join('\n');
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
			targetFileName: buildTargetFileName(context.file),
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

		const placeholderCount = countPlaceholders(normalizedTemplate);
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

		const columns = buildColumnNames(placeholderCount, columnNames);
		const normalizedContent = stripFrontmatter(content).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
		const contentSlice = sliceFromSample(normalizedContent, sample);
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
		const units = buildRecordUnits(contentSlice, sample, isSingleStar, normalizedTemplate);
		const regex = buildRegex(normalizedTemplate, placeholderCount, this.logger);
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
				.map((value) => normalizeCapturedValue(value ?? ''));
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
			const { frontmatter } = splitFrontmatter(content);
			const markdown = mergeFrontmatter(frontmatter, markdownBody);
			const targetPath = await resolveTargetPath(this.view.app.vault, file, buildTargetFileName(file));
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
		return extractSample(context.content);
	}

	private getInitialSample(context: MagicMigrationContext): string {
		const cached = this.sampleCache.get(context.file.path);
		if (cached && cached.trim().length > 0) {
			return cached;
		}
		return extractSample(context.content);
	}

	private getInitialColumns(context: MagicMigrationContext, template: string): string[] {
		const placeholderCount = Math.max(countPlaceholders(template.trim()), 1);
		const cached = this.columnCache.get(context.file.path);
		if (cached && cached.length > 0) {
			return buildColumnNames(placeholderCount, cached);
		}
		return buildColumnNames(placeholderCount, []);
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
