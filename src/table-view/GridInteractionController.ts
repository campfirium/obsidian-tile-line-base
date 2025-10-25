import { Notice } from 'obsidian';
import type { App, Menu } from 'obsidian';
import type { GridAdapter } from '../grid/GridAdapter';
import type { RowInteractionController } from './RowInteractionController';
import type { TableDataStore } from './TableDataStore';
import type { ColumnInteractionController } from './ColumnInteractionController';
import { t } from '../i18n';
import { buildGridContextMenu } from './GridContextMenuBuilder';
import { CopyTemplateController } from './CopyTemplateController';
import { getLogger } from '../utils/logger';
import { createFillSelectionAction, resolveBlockIndexesForCopy } from './GridInteractionMenuHelpers';
import { isReservedColumnId } from '../grid/systemColumnUtils';

const logger = getLogger('table-view:grid-interaction');

interface GridInteractionDeps {
	app: App;
	columnInteraction: ColumnInteractionController;
	rowInteraction: RowInteractionController;
	dataStore: TableDataStore;
	getGridAdapter: () => GridAdapter | null;
	copyTemplate: CopyTemplateController;
}

export class GridInteractionController {
	private container: HTMLElement | null = null;
	private contextMenu: Menu | null = null;
	private contextMenuHandler: ((event: MouseEvent) => void) | null = null;
	private documentClickHandler: (() => void) | null = null;
	private keydownHandler: ((event: KeyboardEvent) => void) | null = null;

	constructor(private readonly deps: GridInteractionDeps) {}

	attach(container: HTMLElement): void {
		if (this.container === container) {
			return;
		}
		this.detach();
		this.container = container;

		this.contextMenuHandler = (event: MouseEvent) => {
			this.handleContextMenu(event);
		};
		container.addEventListener('contextmenu', this.contextMenuHandler);

		const ownerDoc = container.ownerDocument;
		this.documentClickHandler = () => {
			this.hideContextMenu();
		};
		ownerDoc.addEventListener('click', this.documentClickHandler);

		this.keydownHandler = (event: KeyboardEvent) => {
			this.handleKeydown(event);
		};
		container.addEventListener('keydown', this.keydownHandler);
	}

	detach(): void {
		if (this.container && this.contextMenuHandler) {
			this.container.removeEventListener('contextmenu', this.contextMenuHandler);
		}
		if (this.container && this.keydownHandler) {
			this.container.removeEventListener('keydown', this.keydownHandler);
		}
		if (this.container && this.documentClickHandler) {
			this.container.ownerDocument.removeEventListener('click', this.documentClickHandler);
		}

		this.contextMenuHandler = null;
		this.documentClickHandler = null;
		this.keydownHandler = null;
		this.container = null;
		this.hideContextMenu();
	}

	hideContextMenu(): void {
		if (!this.contextMenu) {
			return;
		}
		const activeMenu = this.contextMenu;
		this.contextMenu = null;
		activeMenu.hide();
	}

	private handleContextMenu(event: MouseEvent): void {
		const container = this.container;
		if (!container) {
			return;
		}
		const target = event.target as HTMLElement | null;
		if (!target) {
			return;
		}

		const headerElement = target.closest('.ag-header-cell, .ag-header-group-cell') as HTMLElement | null;
		if (headerElement) {
			const headerColId = headerElement.getAttribute('col-id');
			if (headerColId && headerColId !== 'status' && headerColId !== '#') {
				event.preventDefault();
				event.stopPropagation();
				this.deps.columnInteraction.handleColumnHeaderContextMenu(headerColId, event);
			}
			return;
		}

		const cellElement = target.closest('.ag-cell');
		if (!cellElement) {
			return;
		}

		const colId = cellElement.getAttribute('col-id');
		if (colId === 'status') {
			return;
		}
		event.preventDefault();

		const gridAdapter = this.deps.getGridAdapter();
		const blockIndex = gridAdapter?.getRowIndexFromEvent?.(event);
		if (blockIndex === null || blockIndex === undefined) {
			return;
		}
		const selectedRows = gridAdapter?.getSelectedRows?.() || [];
		if (!selectedRows.includes(blockIndex)) {
			gridAdapter?.selectRow?.(blockIndex, { ensureVisible: true });
		}

		this.showContextMenu(event, blockIndex, colId ?? undefined);
	}

	private handleKeydown(event: KeyboardEvent): void {
		const container = this.container;
		if (!container) {
			return;
		}
		const ownerDoc = container.ownerDocument;
		const activeElement = ownerDoc.activeElement;
		if (activeElement?.classList.contains('ag-cell-edit-input')) {
			return;
		}
		const gridAdapter = this.deps.getGridAdapter();
		const selectedRows = gridAdapter?.getSelectedRows?.() || [];
		if ((event.metaKey || event.ctrlKey) && event.key === 'd' && selectedRows.length > 0) {
			event.preventDefault();
			if (selectedRows.length > 1) {
				this.deps.rowInteraction.duplicateRows(selectedRows);
			} else {
				this.deps.rowInteraction.duplicateRow(selectedRows[0]);
			}
		}
	}

	async copySection(blockIndex: number): Promise<void> {
		const blockIndexes = resolveBlockIndexesForCopy(this.deps.getGridAdapter, this.deps.dataStore, blockIndex);
		if (blockIndexes.length === 0) {
			return;
		}
		const clipboardPayload = this.deps.copyTemplate.generateMarkdownPayload(blockIndexes);
		await this.writeClipboard(clipboardPayload, 'gridInteraction.copySelectionSuccess');
	}

	async copySectionAsTemplate(blockIndex: number): Promise<void> {
		const blockIndexes = resolveBlockIndexesForCopy(this.deps.getGridAdapter, this.deps.dataStore, blockIndex);
		if (blockIndexes.length === 0) {
			return;
		}
		const payload = this.deps.copyTemplate.generateClipboardPayload(blockIndexes);
		await this.writeClipboard(payload, 'copyTemplate.copySuccess');
	}

	private async writeClipboard(payload: string, successKey: Parameters<typeof t>[0]): Promise<void> {
		if (!payload || payload.trim().length === 0) {
			return;
		}
		try {
			await navigator.clipboard.writeText(payload);
			new Notice(t(successKey));
		} catch (error) {
			logger.error(t('copyTemplate.copyFailedLog'), error);
			new Notice(t('copyTemplate.copyFailedNotice'));
		}
	}

	private showContextMenu(event: MouseEvent, blockIndex: number, colId?: string): void {
		this.hideContextMenu();

		const ownerDoc = this.container?.ownerDocument ?? document;
		const gridAdapter = this.deps.getGridAdapter();
		const selectedRows = gridAdapter?.getSelectedRows?.() || [];
		const isMultiSelect = selectedRows.length > 1;
		const isIndexColumn = colId === '#';
		const isSystemColumn = colId ? isReservedColumnId(colId) : true;
		const targetIndexes = resolveBlockIndexesForCopy(this.deps.getGridAdapter, this.deps.dataStore, blockIndex);
		let fillSelection: ReturnType<typeof createFillSelectionAction> = {};
		if (isMultiSelect && !isSystemColumn) {
			fillSelection = createFillSelectionAction(
				{
					app: this.deps.app,
					dataStore: this.deps.dataStore,
					rowInteraction: this.deps.rowInteraction
				},
				{ blockIndex, selectedRows, columnField: colId ?? null }
			);
		}

		const menu = buildGridContextMenu({
			isIndexColumn,
			isMultiSelect,
			selectedRowCount: selectedRows.length,
			fillSelectionLabelParams: fillSelection.params,
			actions: {
				copySelection: () => this.copySection(blockIndex),
				copySelectionAsTemplate: () => this.copySectionAsTemplate(blockIndex),
				editCopyTemplate: () => this.deps.copyTemplate.openEditor(this.container, targetIndexes),
				insertAbove: () => this.deps.rowInteraction.addRow(blockIndex),
				insertBelow: () => this.deps.rowInteraction.addRow(blockIndex + 1),
				fillSelectionWithValue: fillSelection.action,
				duplicateSelection: () => this.deps.rowInteraction.duplicateRows(selectedRows),
				deleteSelection: () => this.deps.rowInteraction.deleteRows(selectedRows),
				duplicateRow: () => this.deps.rowInteraction.duplicateRow(blockIndex),
				deleteRow: () => this.deps.rowInteraction.deleteRow(blockIndex),
				close: () => this.hideContextMenu()
			}
		});

		menu.onHide(() => {
			if (this.contextMenu === menu) {
				this.contextMenu = null;
			}
		});

		this.contextMenu = menu;
		menu.showAtPosition({ x: event.pageX, y: event.pageY }, ownerDoc);
	}
}
