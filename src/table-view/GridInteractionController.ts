import { Notice } from 'obsidian';
import type { GridAdapter } from '../grid/GridAdapter';
import type { RowInteractionController } from './RowInteractionController';
import type { TableDataStore } from './TableDataStore';
import type { ColumnInteractionController } from './ColumnInteractionController';
import { t } from '../i18n';
import { buildGridContextMenu } from './GridContextMenuBuilder';
import { CopyTemplateController } from './CopyTemplateController';
import { getLogger } from '../utils/logger';

const logger = getLogger('table-view:grid-interaction');

interface GridInteractionDeps {
	columnInteraction: ColumnInteractionController;
	rowInteraction: RowInteractionController;
	dataStore: TableDataStore;
	getGridAdapter: () => GridAdapter | null;
	copyTemplate: CopyTemplateController;
}

export class GridInteractionController {
	private container: HTMLElement | null = null;
	private contextMenu: HTMLElement | null = null;
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
		if (this.contextMenu) {
			this.contextMenu.remove();
			this.contextMenu = null;
		}
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
			const isEditing = activeElement?.classList.contains('ag-cell-edit-input');
			if (isEditing) {
				return;
			}
			const gridAdapter = this.deps.getGridAdapter();
			const selectedRows = gridAdapter?.getSelectedRows?.() || [];
			const hasSelection = selectedRows.length > 0;
			if ((event.metaKey || event.ctrlKey) && event.key === 'd') {
				event.preventDefault();
				if (!hasSelection) {
					return;
				}
			if (selectedRows.length > 1) {
				this.deps.rowInteraction.duplicateRows(selectedRows);
			} else {
				this.deps.rowInteraction.duplicateRow(selectedRows[0]);
			}
		}
	}

	async copySection(blockIndex: number): Promise<void> {
		const blockIndexes = this.resolveBlockIndexesForCopy(blockIndex);
		if (blockIndexes.length === 0) {
			return;
		}
		const clipboardPayload = this.deps.copyTemplate.generateMarkdownPayload(blockIndexes);
		await this.writeClipboard(clipboardPayload, 'gridInteraction.copySelectionSuccess');
	}

	async copySectionAsTemplate(blockIndex: number): Promise<void> {
		const blockIndexes = this.resolveBlockIndexesForCopy(blockIndex);
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

	private resolveBlockIndexesForCopy(primaryIndex: number): number[] {
		const gridAdapter = this.deps.getGridAdapter();
		const selected = gridAdapter?.getSelectedRows?.() ?? [];
		const blocks = this.deps.dataStore.getBlocks();
		const validSelection = selected.filter((index) => index >= 0 && index < blocks.length);

		if (validSelection.length > 1 && validSelection.includes(primaryIndex)) {
			return validSelection;
		}
		if (primaryIndex >= 0 && primaryIndex < blocks.length) {
			return [primaryIndex];
		}
		if (validSelection.length > 0) {
			return validSelection;
		}
		return [];
	}

	private showContextMenu(event: MouseEvent, blockIndex: number, colId?: string): void {
		this.hideContextMenu();

		const ownerDoc = this.container?.ownerDocument ?? document;
		const gridAdapter = this.deps.getGridAdapter();
		const selectedRows = gridAdapter?.getSelectedRows?.() || [];
		const isMultiSelect = selectedRows.length > 1;
		const isIndexColumn = colId === '#';
		const targetIndexes = this.resolveBlockIndexesForCopy(blockIndex);

		this.contextMenu = buildGridContextMenu({
			ownerDoc,
			isIndexColumn,
			isMultiSelect,
			selectedRowCount: selectedRows.length,
			actions: {
				copySelection: () => this.copySection(blockIndex),
				copySelectionAsTemplate: () => this.copySectionAsTemplate(blockIndex),
				editCopyTemplate: () => this.deps.copyTemplate.openEditor(this.container, targetIndexes),
				insertAbove: () => this.deps.rowInteraction.addRow(blockIndex),
				insertBelow: () => this.deps.rowInteraction.addRow(blockIndex + 1),
				duplicateSelection: () => this.deps.rowInteraction.duplicateRows(selectedRows),
				deleteSelection: () => this.deps.rowInteraction.deleteRows(selectedRows),
				duplicateRow: () => this.deps.rowInteraction.duplicateRow(blockIndex),
				deleteRow: () => this.deps.rowInteraction.deleteRow(blockIndex),
				close: () => this.hideContextMenu()
			}
		});

		const defaultView = ownerDoc.defaultView || window;
		const docElement = ownerDoc.documentElement;
		const viewportWidth = defaultView.innerWidth ?? docElement?.clientWidth ?? 0;
		const viewportHeight = defaultView.innerHeight ?? docElement?.clientHeight ?? 0;
		const menuRect = this.contextMenu.getBoundingClientRect();
		const margin = 8;

		let left = event.clientX;
		let top = event.clientY;

		if (left + menuRect.width > viewportWidth - margin) {
			left = Math.max(margin, viewportWidth - menuRect.width - margin);
		}
		if (top + menuRect.height > viewportHeight - margin) {
			top = Math.max(margin, viewportHeight - menuRect.height - margin);
		}
		if (left < margin) {
			left = margin;
		}
		if (top < margin) {
			top = margin;
		}

		this.contextMenu.style.left = `${left}px`;
		this.contextMenu.style.top = `${top}px`;
		this.contextMenu.style.visibility = 'visible';
	}
}
