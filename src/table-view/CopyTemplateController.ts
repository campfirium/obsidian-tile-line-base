import type { App } from 'obsidian';
import type { RowData } from '../grid/GridAdapter';
import type { TableDataStore } from './TableDataStore';
import type { Schema } from './SchemaBuilder';
import type { H2Block } from './MarkdownBlockParser';
import { CopyTemplateModal } from './CopyTemplateModal';
import { getLogger } from '../utils/logger';
import { formatUnknownValue } from '../utils/valueFormat';

const logger = getLogger('table-view:copy-template');

interface CopyTemplateControllerDeps {
	app: App;
	dataStore: TableDataStore;
	getSchema: () => Schema | null;
	getBlocks: () => H2Block[];
	getTemplate: () => string | null;
	setTemplate: (template: string | null) => void;
	persistTemplate: () => Promise<void> | void;
}

export class CopyTemplateController {
	private readonly app: App;
	private readonly dataStore: TableDataStore;
	private readonly getSchema: () => Schema | null;
	private readonly getBlocks: () => H2Block[];
	private readonly getTemplate: () => string | null;
	private readonly setTemplate: (template: string | null) => void;
	private readonly persistTemplate: () => Promise<void> | void;

	constructor(deps: CopyTemplateControllerDeps) {
		this.app = deps.app;
		this.dataStore = deps.dataStore;
		this.getSchema = deps.getSchema;
		this.getBlocks = deps.getBlocks;
		this.getTemplate = deps.getTemplate;
		this.setTemplate = deps.setTemplate;
		this.persistTemplate = deps.persistTemplate;
	}

	openEditor(triggerElement?: HTMLElement | null, sampleIndexes?: number[]): void {
		const initialTemplate = this.resolveInitialTemplate(sampleIndexes);
		const modal = new CopyTemplateModal(this.app, {
			initialTemplate,
			availableFields: this.getAvailableFields(),
			triggerElement: triggerElement ?? null,
			onSubmit: (template) => {
				void this.applyTemplate(template);
			},
			onReset: () => this.handleReset(sampleIndexes),
			onCancel: () => undefined
		});
		modal.open();
	}

	generateClipboardPayload(blockIndexes: number[]): string {
		const templatePayload = this.generateTemplatePayload(blockIndexes);
		if (templatePayload && templatePayload.trim().length > 0) {
			return templatePayload;
		}
		return this.generateMarkdownPayload(blockIndexes);
	}

	generateTemplatePayload(blockIndexes: number[]): string | null {
		const template = this.normalizeTemplate(this.getTemplate());
		if (!template) {
			return null;
		}

		const { validIndexes, blocks, schema, rowDataSnapshot } = this.prepareSelectionContext(blockIndexes);
		if (!schema || validIndexes.length === 0) {
			return null;
		}

		const segments = validIndexes
			.map((blockIndex, selectionIndex) => {
				const block = blocks[blockIndex];
				if (!block) {
					return '';
				}
				const row = rowDataSnapshot?.[blockIndex];
				return this.renderTemplate(schema, block, selectionIndex, template, row);
			})
			.filter((segment) => segment.trim().length > 0);

		return segments.length > 0 ? segments.join('\n\n') : null;
	}

	generateMarkdownPayload(blockIndexes: number[]): string {
		const { validIndexes, blocks, schema, rowDataSnapshot } = this.prepareSelectionContext(blockIndexes);
		if (validIndexes.length === 0) {
			return '';
		}

		return validIndexes
			.map((index) => {
				const block = blocks[index];
				if (!block) {
					return '';
				}
				if (schema && rowDataSnapshot) {
					return this.buildMarkdownFromRow(schema, block, rowDataSnapshot[index]);
				}
				return this.dataStore.blockToMarkdown(block);
			})
			.filter((segment) => segment.trim().length > 0)
			.join('\n\n');
	}

	private async applyTemplate(value: string): Promise<void> {
		const normalized = this.normalizeTemplate(value);
		const trimmed = normalized?.trim() ?? '';
		const defaultTemplate = this.getDefaultTemplate();
		const defaultTrimmed = defaultTemplate?.trim() ?? null;

		let templateToPersist: string | null;
		if (!trimmed) {
			templateToPersist = null;
		} else if (defaultTrimmed && trimmed === defaultTrimmed) {
			templateToPersist = null;
		} else {
			templateToPersist = normalized ?? null;
		}

		this.setTemplate(templateToPersist);
		try {
			await Promise.resolve(this.persistTemplate());
		} catch (error) {
			logger.error('Failed to persist copy template', error);
		}
	}

	private normalizeTemplate(value: string | null | undefined): string | null {
		if (!value) {
			return null;
		}
		return value.replace(/\r\n/g, '\n');
	}

	private resolveInitialTemplate(sampleIndexes?: number[]): string {
		const existing = this.getTemplate();
		if (existing && existing.trim().length > 0) {
			return existing;
		}
		const defaultTemplate = this.getDefaultTemplate();
		if (defaultTemplate && defaultTemplate.trim().length > 0) {
			return defaultTemplate;
		}
		const sample = this.generateSampleTemplate(sampleIndexes);
		return sample ?? '';
	}

	private handleReset(sampleIndexes?: number[]): string {
		void this.applyTemplate('');
		const defaultTemplate = this.getDefaultTemplate();
		if (defaultTemplate && defaultTemplate.trim().length > 0) {
			return defaultTemplate;
		}
		return this.generateSampleTemplate(sampleIndexes) ?? '';
	}

	private generateSampleTemplate(sampleIndexes?: number[]): string | null {
		const blocks = this.getBlocks();
		const schema = this.getSchema();
		const rowDataSnapshot = schema ? this.dataStore.extractRowData() : null;
		const indexes = (sampleIndexes && sampleIndexes.length > 0) ? sampleIndexes : [0];
		const segments: string[] = [];
		for (const index of indexes) {
			if (index < 0 || index >= blocks.length) {
				continue;
			}
			const block = blocks[index];
			if (!block) {
				continue;
			}
			const row = rowDataSnapshot?.[index];
			const segment = schema ? this.buildMarkdownFromRow(schema, block, row) : this.dataStore.blockToMarkdown(block);
			if (segment.trim().length > 0) {
				segments.push(segment.trimEnd());
			}
		}
		if (segments.length === 0) {
			return null;
		}
		return segments.join('\n\n');
	}

	private getDefaultTemplate(): string | null {
		const schema = this.getSchema();
		if (!schema) {
			return null;
		}
		const placeholderPrefix = '__tlbCopyTemplate__';
		const probeBlock: H2Block = {
			title: '',
			data: {}
		};
		for (const field of schema.columnNames) {
			probeBlock.data[field] = `${placeholderPrefix}${field}__`;
		}
		const sample = this.normalizeTemplate(this.dataStore.blockToMarkdown(probeBlock));
		if (!sample || sample.trim().length === 0) {
			return null;
		}
		let template = sample;
		for (const field of schema.columnNames) {
			const token = `${placeholderPrefix}${field}__`;
			template = template.split(token).join(`{${field}}`);
		}
		return template.trim();
	}

	private getAvailableFields(): string[] {
		const schema = this.getSchema();
		if (!schema) {
			return [];
		}
		const fields: string[] = [];
		const seen = new Set<string>();
		for (const name of schema.columnNames) {
			if (!name || name === '#') {
				continue;
			}
			const trimmed = name.trim();
			if (!trimmed || seen.has(trimmed)) {
				continue;
			}
			seen.add(trimmed);
			fields.push(trimmed);
		}
		for (const extra of ['rowNumber', 'rowIndex']) {
			if (!seen.has(extra)) {
				seen.add(extra);
				fields.push(extra);
			}
		}
		return fields;
	}

	private prepareSelectionContext(blockIndexes: number[]): {
		validIndexes: number[];
		blocks: H2Block[];
		schema: Schema | null;
		rowDataSnapshot: RowData[] | null;
	} {
		const blocks = this.getBlocks();
		const validIndexes = blockIndexes.filter((index) => index >= 0 && index < blocks.length);
		if (validIndexes.length === 0) {
			return { validIndexes, blocks, schema: null, rowDataSnapshot: null };
		}
		const schema = this.getSchema();
		const rowDataSnapshot = schema ? this.dataStore.extractRowData() : null;
		return {
			validIndexes,
			blocks,
			schema: schema ?? null,
			rowDataSnapshot
		};
	}

	private buildMarkdownFromRow(schema: Schema, block: H2Block, row?: RowData): string {
		if (!row) {
			return this.dataStore.blockToMarkdown(block);
		}
		const merged: H2Block = {
			title: block.title,
			data: { ...block.data }
		};
		for (const field of schema.columnNames) {
			if (row[field] !== undefined && row[field] !== null) {
				merged.data[field] = this.formatValue(row[field]);
			}
		}
		return this.dataStore.blockToMarkdown(merged);
	}

	private renderTemplate(schema: Schema, block: H2Block, selectionIndex: number, template: string, row?: RowData): string {
		const replacements = new Map<string, string>();
		for (const field of schema.columnNames) {
			if (row && row[field] !== undefined && row[field] !== null) {
				replacements.set(field, this.formatValue(row[field]));
			} else {
				replacements.set(field, block.data[field] ?? '');
			}
		}
		replacements.set('rowNumber', String(selectionIndex + 1));
		replacements.set('rowIndex', String(selectionIndex));

		return template.replace(/\{([^{}\r\n]+)\}/g, (_match, rawKey) => {
			const key = String(rawKey).trim();
			if (!key) {
				return '';
			}
			return replacements.get(key) ?? '';
		});
	}

	private formatValue(value: unknown): string {
		if (value === null || value === undefined) {
			return '';
		}
		return typeof value === 'string' ? value : formatUnknownValue(value);
	}
}
