import type { App, TFile } from 'obsidian';
import { Notice } from 'obsidian';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';
import { getCurrentLocalDateTime } from '../utils/datetime';
import type { H2Block } from './MarkdownBlockParser';
import { SchemaBuilder } from './SchemaBuilder';
import { TableDataStore } from './TableDataStore';
import { TableCreationModal } from './TableCreationModal';
import { TableRefreshCoordinator } from './TableRefreshCoordinator';
import type { RefreshRequest } from './TableRefreshCoordinator';
import { getPluginContext } from '../pluginContext';

interface TableCreationControllerOptions {
	app: App;
	getCurrentFile: () => TFile | null;
}

interface TableCreationParams {
	name: string;
	rows: number;
	columns: number;
	triggerElement: HTMLElement | null;
}

const DEFAULT_ROW_COUNT = 6;
const DEFAULT_COLUMN_COUNT = 6;
const MIN_ROWS = 1;
const MAX_ROWS = 50;
const MIN_COLUMNS = 3;
const MAX_COLUMNS = 20;
const RESERVED_SYSTEM_COLUMNS = 2;
const LOGGER = getLogger('table-view:table-creation');

export class TableCreationController {
	private readonly options: TableCreationControllerOptions;
	private activeModal: TableCreationModal | null = null;

	constructor(options: TableCreationControllerOptions) {
		this.options = options;
	}

	openCreationModal(triggerElement: HTMLElement | null): void {
		if (this.activeModal) {
			this.activeModal.close();
			this.activeModal = null;
		}

		const modal = new TableCreationModal(this.options.app, {
			initialName: t('tableCreation.defaultTableName'),
			initialRows: DEFAULT_ROW_COUNT,
			initialColumns: DEFAULT_COLUMN_COUNT,
			minRows: MIN_ROWS,
			maxRows: MAX_ROWS,
			minColumns: MIN_COLUMNS,
			maxColumns: MAX_COLUMNS,
			triggerElement,
			onSubmit: (payload) => {
				void this.handleSubmit({ ...payload, triggerElement });
			},
			onCancel: () => {
				this.activeModal = null;
			}
		});

		modal.open();
		this.activeModal = modal;
	}

	private async handleSubmit(params: TableCreationParams): Promise<void> {
		this.activeModal = null;
		try {
			const sanitizedName = this.sanitiseName(params.name) || t('tableCreation.defaultTableName');
			const { folderPath, fileName } = this.resolveTargetPath(sanitizedName);
			const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;
			const uniquePath = await this.findUniquePath(filePath);

			const markdown = this.buildMarkdown({
				tableName: sanitizedName,
				rows: params.rows,
				columns: params.columns
			});

			const createdFile = await this.options.app.vault.create(uniquePath, markdown);
			this.emitRefresh(createdFile);
			await this.switchToCreatedTable(createdFile);
			new Notice(t('tableCreation.successNotice', { name: createdFile.basename }));
		} catch (error) {
			LOGGER.error('Failed to create table file', error);
			new Notice(t('tableCreation.failureNotice'));
		}
	}

	private buildMarkdown(input: { tableName: string; rows: number; columns: number }): string {
		const primaryField = t('tableCreation.primaryFieldName');
		const additionalFields = this.buildAdditionalFields(input.columns);
		const totalRows = this.clamp(input.rows, MIN_ROWS, MAX_ROWS);
		const blocks = this.buildBlocks({
			tableName: input.tableName,
			primaryField,
			additionalFields,
			rowCount: totalRows
		});

		const schemaBuilder = new SchemaBuilder();
		const result = schemaBuilder.buildSchema(blocks, null);
		const dataStore = new TableDataStore({
			rowLimit: 5000,
			errorValue: '#ERR',
			tooltipPrefix: '__tlbFormulaTooltip__'
		});
		dataStore.initialise(result, null);
		const markdown = dataStore.blocksToMarkdown();
		return `${markdown.trimEnd()}\n`;
	}

	private buildAdditionalFields(totalColumns: number): string[] {
		const target = this.clamp(totalColumns, MIN_COLUMNS, MAX_COLUMNS);
		const base = t('tableCreation.fieldBaseName');
		const additionalCount = Math.max(target - RESERVED_SYSTEM_COLUMNS, 0);
		const fields: string[] = [];
		for (let index = 1; index <= additionalCount; index++) {
			fields.push(`${base} ${index}`);
		}
		return fields;
	}

	private buildBlocks(params: { tableName: string; primaryField: string; additionalFields: string[]; rowCount: number }): H2Block[] {
		const blocks: H2Block[] = [];
		const timestamp = () => getCurrentLocalDateTime();
		const newRowPrefix = t('tableDataStore.newRowPrefix');

		for (let rowIndex = 0; rowIndex < params.rowCount; rowIndex++) {
			const data: Record<string, string> = {};
			const titleValue = rowIndex === 0 ? params.tableName : `${newRowPrefix} ${rowIndex + 1}`;
			data[params.primaryField] = titleValue;
			data['status'] = 'todo';
			for (const field of params.additionalFields) {
				data[field] = '';
			}
			data['statusChanged'] = timestamp();

			blocks.push({
				title: '',
				data,
				collapsedFields: []
			});
		}

		return blocks;
	}

	private resolveTargetPath(baseName: string): { folderPath: string; fileName: string } {
		const currentFile = this.options.getCurrentFile();
		const folderPath = currentFile?.parent?.path ?? '';
		const fileName = `${baseName}.md`;
		return { folderPath, fileName };
	}

	private async findUniquePath(initialPath: string): Promise<string> {
		const vault = this.options.app.vault;
		if (!vault.getAbstractFileByPath(initialPath)) {
			return initialPath;
		}

		const { folder, base } = this.splitPath(initialPath);
		let counter = 2;
		while (counter < 1000) {
			const candidateName = `${base} ${counter}.md`;
			const candidatePath = folder ? `${folder}/${candidateName}` : candidateName;
			if (!vault.getAbstractFileByPath(candidatePath)) {
				return candidatePath;
			}
			counter += 1;
		}
		return `${folder ? `${folder}/` : ''}${base} ${Date.now()}.md`;
	}

	private splitPath(path: string): { folder: string; base: string } {
		const segments = path.split('/');
		const fileName = segments.pop() ?? path;
		const folder = segments.join('/');
		const base = fileName.endsWith('.md') ? fileName.slice(0, -3) : fileName;
		return { folder, base };
	}

	private async switchToCreatedTable(file: TFile): Promise<void> {
		try {
			await this.openFileInTableView(file);
		} catch (error) {
			LOGGER.warn('Table creation view switch failed, opening via workspace fallback', error);
			await this.options.app.workspace.openLinkText(file.path, '', true);
		}
	}

	private async openFileInTableView(file: TFile): Promise<void> {
		const plugin = getPluginContext();
		if (plugin && typeof (plugin as any).openFileInTableView === 'function') {
			await (plugin as any).openFileInTableView(file);
			return;
		}
		await this.options.app.workspace.openLinkText(file.path, '', true);
	}

	private emitRefresh(file: TFile): void {
		const context: RefreshRequest = {
			source: 'table-operation',
			structural: true,
			reason: 'table-created',
			immediate: true
		};
		TableRefreshCoordinator.requestRefreshForPath(file.path, context);
	}

	private sanitiseName(raw: string): string {
		const replaced = raw
			.replace(/[\\/:*?"<>|#]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		const trimmed = replaced.replace(/[. ]+$/g, '');
		return trimmed.length > 0 ? trimmed : '';
	}

	private clamp(value: number, min: number, max: number): number {
		if (!Number.isFinite(value)) {
			return min;
		}
		if (value < min) {
			return min;
		}
		if (value > max) {
			return max;
		}
		return value;
	}
}
