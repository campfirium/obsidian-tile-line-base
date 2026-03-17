import { App, Notice } from 'obsidian';
import { ROW_ID_FIELD, type RowData } from '../../grid/GridAdapter';
import { t } from '../../i18n';
import type { SortRule } from '../../types/filterView';
import type { TableDataStore } from '../TableDataStore';
import type { Schema } from '../SchemaBuilder';
import type { TableHistoryManager } from '../TableHistoryManager';
import { FilterDataProcessor } from '../filter/FilterDataProcessor';
import type { FilterStateStore } from '../filter/FilterStateStore';
import { RowOrderModal } from './RowOrderModal';
import type { H2Block } from '../MarkdownBlockParser';

interface RowOrderControllerDeps {
	app: App;
	dataStore: TableDataStore;
	history: TableHistoryManager;
	filterStateStore: FilterStateStore;
	getSchema: () => Schema | null;
	getAvailableColumns: () => string[];
	refreshGrid: () => void;
	scheduleSave: () => void;
}

export class RowOrderController {
	private readonly app: App;
	private readonly dataStore: TableDataStore;
	private readonly history: TableHistoryManager;
	private readonly filterStateStore: FilterStateStore;
	private readonly getSchema: () => Schema | null;
	private readonly getAvailableColumns: () => string[];
	private readonly refreshGrid: () => void;
	private readonly scheduleSave: () => void;

	constructor(deps: RowOrderControllerDeps) {
		this.app = deps.app;
		this.dataStore = deps.dataStore;
		this.history = deps.history;
		this.filterStateStore = deps.filterStateStore;
		this.getSchema = deps.getSchema;
		this.getAvailableColumns = deps.getAvailableColumns;
		this.refreshGrid = deps.refreshGrid;
		this.scheduleSave = deps.scheduleSave;
	}

	openSortModal(): void {
		if (!this.getSchema()) {
			return;
		}
		const columns = this.getSortableColumns();
		if (columns.length === 0) {
			new Notice(t('filterViewController.noColumns'));
			return;
		}
		const modal = new RowOrderModal(this.app, {
			columns,
			onSubmit: (sortRules) => {
				this.applySortRules(sortRules);
			}
		});
		modal.open();
	}

	reorderColumnsPhysically(): void {
		const schema = this.getSchema();
		if (!schema) {
			return;
		}

		const blocks = this.dataStore.getBlocks();
		if (blocks.length === 0) {
			return;
		}

		const beforeOrders = blocks.map((block, index) => ({
			ref: block,
			index,
			keys: Object.keys(block.data)
		}));
		const changed = this.dataStore.reorderAllBlockFields();
		if (!changed) {
			return;
		}
		const afterOrders = blocks.map((block, index) => ({
			ref: block,
			index,
			keys: Object.keys(block.data)
		}));

		this.refreshGrid();
		this.scheduleSave();

		this.history.record({
			undo: () => {
				this.applyStoredBlockFieldOrders(beforeOrders);
			},
			redo: () => {
				this.applyStoredBlockFieldOrders(afterOrders);
			}
		});
	}

	private applySortRules(sortRules: SortRule[]): void {
		const schema = this.getSchema();
		if (!schema) {
			return;
		}
		const sanitized = this.filterStateStore.sanitizeSortRules(sortRules);
		if (sanitized.length === 0) {
			return;
		}
		const columns = this.getSortableColumns();
		const normalizedRules = sanitized.filter((rule) => columns.includes(rule.column));
		if (normalizedRules.length === 0) {
			new Notice(t('filterViewController.noColumns'));
			return;
		}

		const rows = this.dataStore.extractRowData();
		if (rows.length === 0) {
			return;
		}
		const enforcedRules: SortRule[] = [
			...normalizedRules,
			{ column: ROW_ID_FIELD, direction: 'asc' }
		];

		const sorted = FilterDataProcessor.sortRowData(rows, enforcedRules);
		const orderedBlocks = this.resolveOrderedBlocks(sorted);
		if (orderedBlocks.length === 0) {
			return;
		}

		this.history.applyRowOrderChange(orderedBlocks, {
			undo: { rowIndex: 0, field: null },
			redo: { rowIndex: 0, field: null }
		});
	}

	private resolveOrderedBlocks(sortedRows: RowData[]): H2Block[] {
		const blocks = this.dataStore.getBlocks();
		const map = new Map<string, H2Block>();
		blocks.forEach((block, index) => {
			map.set(String(index), block);
		});

		const resolved: H2Block[] = [];

		for (const row of sortedRows) {
			const raw = row[ROW_ID_FIELD];
			const key = typeof raw === 'string' ? raw : raw == null ? null : String(raw);
			if (!key) {
				continue;
			}
			const block = map.get(key);
			if (!block) {
				continue;
			}
			resolved.push(block);
			map.delete(key);
		}

		for (const block of map.values()) {
			resolved.push(block);
		}

		return resolved;
	}

	private getSortableColumns(): string[] {
		return this.getAvailableColumns();
	}

	private applyStoredBlockFieldOrders(entries: Array<{ ref: H2Block; index: number; keys: string[] }>): void {
		for (const entry of entries) {
			const blockIndex = this.resolveBlockIndex(entry.ref, entry.index);
			if (blockIndex < 0) {
				continue;
			}
			this.dataStore.applyBlockFieldOrder(blockIndex, entry.keys);
		}
		this.refreshGrid();
		this.scheduleSave();
	}

	private resolveBlockIndex(ref: H2Block, fallbackIndex: number): number {
		const blocks = this.dataStore.getBlocks();
		const refIndex = blocks.indexOf(ref);
		if (refIndex >= 0) {
			return refIndex;
		}
		if (fallbackIndex >= 0 && fallbackIndex < blocks.length) {
			return fallbackIndex;
		}
		return -1;
	}
}
