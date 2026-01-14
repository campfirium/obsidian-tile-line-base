import { Notice } from 'obsidian';
import type { App, TFile } from 'obsidian';
import type { TableView } from '../TableView';
import { ROW_ID_FIELD } from '../grid/GridAdapter';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';
import { getPluginContext } from '../pluginContext';
import type { H2Block } from './MarkdownBlockParser';
import { SchemaBuilder } from './SchemaBuilder';
import { TableDataStore } from './TableDataStore';
import { TableRefreshCoordinator } from './TableRefreshCoordinator';

const logger = getLogger('table-view:csv');
const EXCLUDED_FIELDS = new Set(['#', ROW_ID_FIELD, '__tlb_status', '__tlb_index']);
const UTF8_BOM = '\uFEFF';
const TABLE_FILE_EXTENSION = '.md';
const HIDDEN_ELEMENT_CLASS = 'tlb-visually-hidden';

interface ImportCsvAsNewTableOptions {
	triggerElement?: HTMLElement | null;
	referenceFile?: TFile | null;
	openAfterCreate?: boolean;
}

interface ParsedCsv {
	headers: string[];
	rows: string[][];
}

const DATA_STORE_OPTIONS = {
	rowLimit: 5000,
	errorValue: '#ERR',
	tooltipPrefix: '__tlbFormulaTooltip__'
} as const;
const HARD_FALLBACK_FILE_NAME = 'Imported Table';

export function exportTableToCsv(view: TableView): void {
	if (!view.file) {
		new Notice(t('csv.errorNoFile'));
		return;
	}
	const schema = view.schema;
	if (!schema) {
		new Notice(t('csv.exportFailure'));
		return;
	}

	try {
		const columns = collectExportColumns(view);
		if (columns.length === 0) {
			new Notice(t('csv.exportFailure'));
			return;
		}

		const rows = view.dataStore.extractRowData();
		const lines: string[] = [];
		lines.push(serializeCsvRow(columns));
		for (const row of rows) {
			const values = columns.map((column) => row[column] ?? '');
			lines.push(serializeCsvRow(values));
		}
		const content = lines.join('\r\n');
		triggerDownload(view, content, `${view.file.basename}.csv`);
		new Notice(t('csv.exportSuccess', { rows: rows.length }));
	} catch (error) {
		logger.error('Failed to export CSV', error);
		new Notice(t('csv.exportFailure'));
	}
}

export function importTableFromCsv(view: TableView): void {
	if (!view.file) {
		new Notice(t('csv.errorNoFile'));
		return;
	}

	const ownerDocument = view.containerEl.ownerDocument ?? document;
	const inputEl = ownerDocument.createElement('input');
	inputEl.type = 'file';
	inputEl.accept = '.csv,text/csv';
	inputEl.classList.add(HIDDEN_ELEMENT_CLASS);
	ownerDocument.body.appendChild(inputEl);

	const cleanup = () => {
		inputEl.value = '';
		if (inputEl.parentElement) {
			inputEl.parentElement.removeChild(inputEl);
		}
	};

	const handleFileSelection = async () => {
		try {
			const file = inputEl.files?.[0] ?? null;
			if (!file) {
				return;
			}

			const text = await file.text();
			const parsed = parseCsv(text);
			if (!ensureParsedCsv(parsed)) {
				return;
			}
			await applyParsedCsvToView(view, parsed);
		} catch (error) {
			logger.error('Failed to import CSV', error);
			new Notice(t('csv.importFailure'));
		} finally {
			cleanup();
		}
	};

	inputEl.addEventListener('change', () => {
		void handleFileSelection();
	});

	inputEl.click();
}

export function importCsvAsNewTable(app: App, options: ImportCsvAsNewTableOptions = {}): void {
	const ownerDocument = options.triggerElement?.ownerDocument ?? document;
	const inputEl = ownerDocument.createElement('input');
	inputEl.type = 'file';
	inputEl.accept = '.csv,text/csv';
	inputEl.classList.add(HIDDEN_ELEMENT_CLASS);
	ownerDocument.body.appendChild(inputEl);

	const cleanup = () => {
		inputEl.value = '';
		if (inputEl.parentElement) {
			inputEl.parentElement.removeChild(inputEl);
		}
	};

	const handleFileSelection = async () => {
		try {
			const file = inputEl.files?.[0] ?? null;
			if (!file) {
				return;
			}

			const text = await file.text();
			const parsed = parseCsv(text);
			if (!ensureParsedCsv(parsed)) {
				return;
			}

			const blocks = buildBlocksFromCsv(parsed.headers, parsed.rows);
			const markdown = buildMarkdownFromBlocks(blocks);
			const referenceFile = options.referenceFile ?? app.workspace.getActiveFile();
			const folderPath = resolveTargetFolder(referenceFile);
			const baseName = sanitiseFileName(file.name, t('csv.defaultFileName'));
			const uniquePath = findUniqueFilePath(app, folderPath, baseName);
			const createdFile = await app.vault.create(uniquePath, markdown);
			TableRefreshCoordinator.requestRefreshForPath(createdFile.path, {
				source: 'table-operation',
				structural: true,
				reason: 'csv-import-create',
				immediate: true
			});

			if (options.openAfterCreate !== false) {
				try {
					await openFileInTableView(app, createdFile);
				} catch (error) {
					logger.warn('Failed to open table view for imported CSV', error);
				}
			}

			new Notice(t('csv.createSuccess', { name: createdFile.basename, rows: parsed.rows.length }));
		} catch (error) {
			logger.error('Failed to import CSV as new table', error);
			new Notice(t('csv.createFailure'));
		} finally {
			cleanup();
		}
	};

	inputEl.addEventListener('change', () => {
		void handleFileSelection();
	});

	inputEl.click();
}

function collectExportColumns(view: TableView): string[] {
	const columns: string[] = [];
	const seen = new Set<string>();
	const hiddenFields = view.hiddenSortableFields ?? new Set<string>();

	const pushColumn = (value: string | null | undefined) => {
		if (!value) {
			return;
		}
		if (EXCLUDED_FIELDS.has(value)) {
			return;
		}
		if (hiddenFields.has(value)) {
			return;
		}
		if (seen.has(value)) {
			return;
		}
		seen.add(value);
		columns.push(value);
	};

	const schema = view.schema;
	if (schema?.columnNames) {
		for (const name of schema.columnNames) {
			pushColumn(name);
		}
	}

	if (columns.length === 0) {
		const columnState = view.gridAdapter?.getColumnState?.();
		if (columnState) {
			for (const state of columnState) {
				pushColumn(state.colId ?? undefined);
			}
		}
	}

	return columns;
}

function serializeCsvRow(values: string[]): string {
	return values
		.map((value) => {
			const safeValue = value ?? '';
			const requiresQuote = /[",\n]/.test(safeValue) || /^\s|\s$/.test(safeValue);
			const escaped = safeValue.replace(/"/g, '""');
			return requiresQuote ? `"${escaped}"` : escaped;
		})
		.join(',');
}

function triggerDownload(view: TableView, content: string, fileName: string): void {
	const ownerDocument = view.containerEl.ownerDocument ?? document;
	const blob = new Blob([UTF8_BOM, content], { type: 'text/csv;charset=utf-8;' });
	const url = URL.createObjectURL(blob);
	const anchor = ownerDocument.createElement('a');
	anchor.href = url;
	anchor.download = fileName || 'table.csv';
	anchor.classList.add(HIDDEN_ELEMENT_CLASS);
	ownerDocument.body.appendChild(anchor);
	anchor.click();
	ownerDocument.body.removeChild(anchor);
	URL.revokeObjectURL(url);
}

function ensureParsedCsv(parsed: ParsedCsv): boolean {
	if (parsed.headers.length === 0) {
		new Notice(t('csv.importNoHeaders'));
		return false;
	}
	if (parsed.rows.length === 0) {
		new Notice(t('csv.importNoRows'));
		return false;
	}
	return true;
}

async function applyParsedCsvToView(view: TableView, parsed: ParsedCsv): Promise<void> {
	const blocks = buildBlocksFromCsv(parsed.headers, parsed.rows);
	const columnConfigs = view.dataStore.getColumnConfigs() ?? null;
	const schemaResult = view.schemaBuilder.buildSchema(blocks, columnConfigs);
	view.blocks = schemaResult.blocks;
	const frontmatter = view.dataStore.getFrontmatter();
	const frontmatterPadding = view.dataStore.getFrontmatterPadding();
	view.dataStore.initialise(schemaResult, columnConfigs, { frontmatter, frontmatterPadding });
	view.schema = view.dataStore.getSchema();
	view.hiddenSortableFields = view.dataStore.getHiddenSortableFields();
	const dirtyFlags = view.dataStore.consumeDirtyFlags();
	view.schemaDirty = dirtyFlags.schemaDirty;
	view.sparseCleanupRequired = dirtyFlags.sparseCleanupRequired;

	view.persistenceService.cancelScheduledSave({ resolvePending: false });
	view.markUserMutation('csv-import');
	await view.persistenceService.save();
	view.schemaDirty = false;
	view.sparseCleanupRequired = false;
	new Notice(t('csv.importSuccess', { rows: parsed.rows.length }));
	await view.render();
}

function buildMarkdownFromBlocks(blocks: H2Block[]): string {
	const schemaBuilder = new SchemaBuilder();
	const dataStore = createDataStore();
	const schemaResult = schemaBuilder.buildSchema(blocks, null);
	dataStore.initialise(schemaResult, null);
	const markdown = dataStore.blocksToMarkdown();
	return markdown.endsWith('\n') ? markdown : `${markdown}\n`;
}

function createDataStore(): TableDataStore {
	return new TableDataStore({
		rowLimit: DATA_STORE_OPTIONS.rowLimit,
		errorValue: DATA_STORE_OPTIONS.errorValue,
		tooltipPrefix: DATA_STORE_OPTIONS.tooltipPrefix
	});
}

function resolveTargetFolder(referenceFile: TFile | null | undefined): string {
	return referenceFile?.parent?.path ?? '';
}

function sanitiseFileName(rawFileName: string | null | undefined, fallback: string): string {
	const baseName = stripExtension(rawFileName ?? '');
	const sanitisedBase = sanitiseBaseName(baseName);
	if (sanitisedBase.length > 0) {
		return sanitisedBase;
	}
	const fallbackBase = sanitiseBaseName(fallback);
	if (fallbackBase.length > 0) {
		return fallbackBase;
	}
	return HARD_FALLBACK_FILE_NAME;
}

function stripExtension(fileName: string): string {
	const index = fileName.lastIndexOf('.');
	if (index <= 0) {
		return fileName;
	}
	return fileName.slice(0, index);
}

function sanitiseBaseName(raw: string): string {
	return raw
		.replace(/[\\/:*?"<>|#]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/[. ]+$/g, '');
}

function findUniqueFilePath(app: App, folderPath: string, baseName: string): string {
	const vault = app.vault;
	const candidate = buildFilePath(folderPath, baseName);
	if (!vault.getAbstractFileByPath(candidate)) {
		return candidate;
	}

	let counter = 2;
	while (counter < 1000) {
		const nextCandidate = buildFilePath(folderPath, `${baseName} ${counter}`);
		if (!vault.getAbstractFileByPath(nextCandidate)) {
			return nextCandidate;
		}
		counter += 1;
	}

	return buildFilePath(folderPath, `${baseName} ${Date.now()}`);
}

function buildFilePath(folderPath: string, baseName: string): string {
	const folder = folderPath?.trim();
	const normalizedFolder = folder && folder.length > 0 ? folder.replace(/\\/g, '/') : '';
	const trimmedBase = sanitiseBaseName(baseName);
	const finalBase = trimmedBase.length > 0 ? trimmedBase : HARD_FALLBACK_FILE_NAME;
	return normalizedFolder.length > 0
		? `${normalizedFolder}/${finalBase}${TABLE_FILE_EXTENSION}`
		: `${finalBase}${TABLE_FILE_EXTENSION}`;
}

async function openFileInTableView(app: App, file: TFile): Promise<void> {
	const plugin = getPluginContext();
	if (plugin) {
		await plugin.openFileInTableView(file);
		return;
	}
	await app.workspace.openLinkText(file.path, '', true);
}

function parseCsv(content: string): ParsedCsv {
	const sanitized = content.length > 0 && content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
	const normalized = sanitized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const rows: string[][] = [];
	let currentRow: string[] = [];
	let currentValue = '';
	let inQuotes = false;

	const pushValue = () => {
		currentRow.push(currentValue);
		currentValue = '';
	};

	const pushRow = () => {
		pushValue();
		rows.push(currentRow);
		currentRow = [];
	};

	for (let index = 0; index < normalized.length; index++) {
		const char = normalized[index];
		if (char === '"') {
			if (inQuotes && normalized[index + 1] === '"') {
				currentValue += '"';
				index += 1;
				continue;
			}
			inQuotes = !inQuotes;
			continue;
		}
		if (char === ',' && !inQuotes) {
			pushValue();
			continue;
		}
		if (char === '\n' && !inQuotes) {
			pushRow();
			continue;
		}
		currentValue += char;
	}

	pushValue();
	if (currentRow.length > 1 || currentRow[0] !== '') {
		rows.push(currentRow);
	}

	if (rows.length === 0) {
		return { headers: [], rows: [] };
	}

	const headers = dedupeHeaders(rows[0]);
	const dataRows = rows.slice(1).filter((row) => row.some((value) => value && value.trim().length > 0));
	return { headers, rows: dataRows };
}

function dedupeHeaders(rawHeaders: string[]): string[] {
	const headers: string[] = [];
	const counter = new Map<string, number>();

	for (let index = 0; index < rawHeaders.length; index++) {
		const original = (rawHeaders[index] ?? '').trim();
		const isExcluded = EXCLUDED_FIELDS.has(original);
		const base = original.length > 0 && !isExcluded ? original : `Column ${index + 1}`;
		let suffix = counter.get(base) ?? 0;
		let candidate = base;
		while (headers.includes(candidate)) {
			suffix += 1;
			candidate = `${base}_${suffix}`;
		}
		counter.set(base, suffix);
		headers.push(candidate);
	}

	// Remove trailing empty headers
	while (headers.length > 0) {
		const last = headers[headers.length - 1];
		if (last.trim().length === 0 || EXCLUDED_FIELDS.has(last)) {
			headers.pop();
			continue;
		}
		break;
	}

	return headers;
}

function buildBlocksFromCsv(headers: string[], rows: string[][]): H2Block[] {
	const blocks: H2Block[] = [];
	for (const row of rows) {
		const data: Record<string, string> = {};
		for (let index = 0; index < headers.length; index++) {
			const header = headers[index];
			if (!header) {
				continue;
			}
			data[header] = row[index] ?? '';
		}
		blocks.push({
			title: '',
			data,
			collapsedFields: []
		});
	}
	return blocks;
}
