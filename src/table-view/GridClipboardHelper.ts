import { Notice } from 'obsidian';
import type { GridAdapter } from '../grid/GridAdapter';
import type { TableDataStore } from './TableDataStore';
import type { CopyTemplateController } from './CopyTemplateController';
import { resolveBlockIndexesForCopy } from './GridInteractionMenuHelpers';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';

const logger = getLogger('table-view:grid-clipboard-helper');

function sanitizeMarkdownPayload(payload: string | null | undefined): string {
	if (!payload) {
		return '';
	}
	const lines = String(payload).split(/\r?\n/);
	const filtered: string[] = [];
	let skipCollapsedComment = false;
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith('> [!tlb-collapsed')) {
			skipCollapsedComment = true;
			continue;
		}
		if (trimmed.startsWith('<!--') && trimmed.includes('tlb.collapsed')) {
			skipCollapsedComment = false;
			continue;
		}
		if (skipCollapsedComment) {
			skipCollapsedComment = false;
			continue;
		}
		filtered.push(line);
	}
	while (filtered.length > 0 && filtered[filtered.length - 1].trim().length === 0) {
		filtered.pop();
	}
	return filtered.join('\n');
}

interface GridClipboardHelperDeps {
	dataStore: TableDataStore;
	copyTemplate: CopyTemplateController;
	getGridAdapter: () => GridAdapter | null;
}

export class GridClipboardHelper {
	private readonly dataStore: TableDataStore;
	private readonly copyTemplate: CopyTemplateController;
	private readonly getGridAdapter: () => GridAdapter | null;

	constructor(deps: GridClipboardHelperDeps) {
		this.dataStore = deps.dataStore;
		this.copyTemplate = deps.copyTemplate;
		this.getGridAdapter = deps.getGridAdapter;
	}

	async copySection(blockIndex: number): Promise<void> {
		const blockIndexes = resolveBlockIndexesForCopy(this.getGridAdapter, this.dataStore, blockIndex);
		if (blockIndexes.length === 0) {
			return;
		}
		const payload = sanitizeMarkdownPayload(this.copyTemplate.generateMarkdownPayload(blockIndexes));
		await this.writeClipboard(payload, 'gridInteraction.copySelectionSuccess');
	}

	async copySectionAsTemplate(blockIndex: number): Promise<void> {
		const blockIndexes = resolveBlockIndexesForCopy(this.getGridAdapter, this.dataStore, blockIndex);
		if (blockIndexes.length === 0) {
			return;
		}
		const payload = sanitizeMarkdownPayload(this.copyTemplate.generateClipboardPayload(blockIndexes));
		await this.writeClipboard(payload, 'copyTemplate.copySuccess');
	}

	async writeClipboard(
		payload: string | null | undefined,
		successKey: Parameters<typeof t>[0],
		options?: { allowEmpty?: boolean }
	): Promise<void> {
		const normalized = typeof payload === 'string' ? payload : payload == null ? '' : String(payload);
		if (!options?.allowEmpty && normalized.trim().length === 0) {
			return;
		}
		try {
			await navigator.clipboard.writeText(normalized);
			new Notice(t(successKey));
		} catch (error) {
			logger.error(t('copyTemplate.copyFailedLog'), error);
			new Notice(t('copyTemplate.copyFailedNotice'));
		}
	}
}
