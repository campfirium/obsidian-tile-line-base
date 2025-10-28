import type { App, Menu } from 'obsidian';
import type { GridAdapter } from '../grid/GridAdapter';
import type { RowInteractionController } from './RowInteractionController';
import type { TableDataStore } from './TableDataStore';
import type { ColumnInteractionController } from './ColumnInteractionController';
import { CopyTemplateController } from './CopyTemplateController';
import { GridCellClipboardController } from './GridCellClipboardController';
import type { TableHistoryManager } from './TableHistoryManager';
import { GridClipboardHelper } from './GridClipboardHelper';
import { createGridContextMenu } from './GridContextMenuPresenter';
import { getLogger } from '../utils/logger';

interface GridInteractionDeps {
	app: App;
	columnInteraction: ColumnInteractionController;
	rowInteraction: RowInteractionController;
	dataStore: TableDataStore;
	getGridAdapter: () => GridAdapter | null;
	copyTemplate: CopyTemplateController;
	history: TableHistoryManager;
}

export class GridInteractionController {
	private container: HTMLElement | null = null;
	private contextMenu: Menu | null = null;
	private contextMenuHandler: ((event: MouseEvent) => void) | null = null;
	private documentClickHandler: (() => void) | null = null;
	private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
	private documentKeydownHandler: ((event: KeyboardEvent) => void) | null = null;
	private readonly cellClipboard: GridCellClipboardController;
	private readonly history: TableHistoryManager;
	private readonly clipboardHelper: GridClipboardHelper;
	private readonly logger = getLogger('table-view:grid-interaction');

	constructor(private readonly deps: GridInteractionDeps) {
		this.history = deps.history;
		this.clipboardHelper = new GridClipboardHelper({
			dataStore: deps.dataStore,
			copyTemplate: deps.copyTemplate,
			getGridAdapter: deps.getGridAdapter
		});
		this.cellClipboard = new GridCellClipboardController({
			dataStore: deps.dataStore,
			rowInteraction: deps.rowInteraction,
			getOwnerDocument: () => this.container?.ownerDocument ?? document,
			writeClipboard: (payload, successKey, options) =>
				this.clipboardHelper.writeClipboard(payload, successKey, options)
		});
	}

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

		this.documentKeydownHandler = (event: KeyboardEvent) => {
			this.handleKeydown(event);
		};

		ownerDoc.addEventListener('keydown', this.documentKeydownHandler, true);
	}

	detach(): void {
		if (this.container && this.contextMenuHandler) {
			this.container.removeEventListener('contextmenu', this.contextMenuHandler);
		}
		if (this.container && this.documentClickHandler) {
			this.container.ownerDocument.removeEventListener('click', this.documentClickHandler);
		}
		if (this.container && this.documentKeydownHandler) {
			this.container.ownerDocument.removeEventListener('keydown', this.documentKeydownHandler, true);
		}

		this.contextMenuHandler = null;
		this.documentClickHandler = null;
		this.keydownHandler = null;
		this.documentKeydownHandler = null;
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
		const target = event.target as HTMLElement | null;
		const activeElement = ownerDoc.activeElement as HTMLElement | null;
		const targetInside = target ? this.isElementWithinGrid(target, container) : false;
		const activeInside = activeElement ? this.isElementWithinGrid(activeElement, container) : false;
		if (!targetInside && !activeInside) {
			this.logger.warn('undo-skip-outside', { key: event.key });
			return;
		}
		if (activeElement?.classList.contains('ag-cell-edit-input')) {
			this.logger.warn('undo-skip-editor', { key: event.key });
			return;
		}

		const ctrlLike = event.metaKey || event.ctrlKey;
		if (ctrlLike && !event.altKey) {
			if (event.key === 'z' || event.key === 'Z') {
				event.preventDefault();
				event.stopPropagation();
				if (event.shiftKey) {
					const applied = this.history.redo();
					if (!applied) {
						this.logger.warn('redo:empty');
					} else {
						this.logger.warn('redo:applied', { reason: 'shift+ctrl+z' });
					}
				} else {
					const applied = this.history.undo();
					if (!applied) {
						this.logger.warn('undo:empty');
					} else {
						this.logger.warn('undo:applied', { reason: 'ctrl+z' });
					}
				}
				return;
			}
			if (event.key === 'y' || event.key === 'Y') {
				event.preventDefault();
				event.stopPropagation();
				const applied = this.history.redo();
				if (!applied) {
					this.logger.warn('redo:empty');
				} else {
					this.logger.warn('redo:applied', { reason: 'ctrl+y' });
				}
				return;
			}
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

	private isElementWithinGrid(element: HTMLElement, container: HTMLElement): boolean {
		if (container.contains(element)) {
			return true;
		}
		if (element.classList.contains('tlb-ime-capture')) {
			return true;
		}
		if (element.closest('.tlb-ime-capture')) {
			return true;
		}
		return Boolean(element.closest('.tlb-table-container'));
	}

	private showContextMenu(event: MouseEvent, blockIndex: number, colId?: string): void {
		this.hideContextMenu();

		const menu = createGridContextMenu({
			app: this.deps.app,
			container: this.container,
			blockIndex,
			colId: colId ?? null,
			dataStore: this.deps.dataStore,
			rowInteraction: this.deps.rowInteraction,
			columnInteraction: this.deps.columnInteraction,
			copyTemplate: this.deps.copyTemplate,
			getGridAdapter: this.deps.getGridAdapter,
			cellClipboard: this.cellClipboard,
			onCopySelection: (index) => {
				void this.clipboardHelper.copySection(index);
			},
			onCopySelectionAsTemplate: (index) => {
				void this.clipboardHelper.copySectionAsTemplate(index);
			},
			onRequestClose: () => this.hideContextMenu()
		});

		if (!menu) {
			return;
		}

		menu.onHide(() => {
			if (this.contextMenu === menu) {
				this.contextMenu = null;
			}
		});

		this.contextMenu = menu;
		const ownerDoc = this.container?.ownerDocument ?? document;
		menu.showAtPosition({ x: event.pageX, y: event.pageY }, ownerDoc);
	}
	async copySection(blockIndex: number): Promise<void> {
		await this.clipboardHelper.copySection(blockIndex);
	}

	async copySectionAsTemplate(blockIndex: number): Promise<void> {
		await this.clipboardHelper.copySectionAsTemplate(blockIndex);
	}
}




