import { Notice } from 'obsidian';
import type { GridAdapter } from '../grid/GridAdapter';
import type { RowInteractionController } from './RowInteractionController';
import type { TableDataStore } from './TableDataStore';
import type { ColumnInteractionController } from './ColumnInteractionController';
import { t } from '../i18n';

interface GridInteractionDeps {
	columnInteraction: ColumnInteractionController;
	rowInteraction: RowInteractionController;
	dataStore: TableDataStore;
	getGridAdapter: () => GridAdapter | null;
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
		const blocks = this.deps.dataStore.getBlocks();
		const segments: string[] = [];
		for (const index of blockIndexes) {
			const block = blocks[index];
			if (!block) {
				continue;
			}
			segments.push(this.deps.dataStore.blockToMarkdown(block));
		}

		if (segments.length === 0) {
			return;
		}

		const markdown = segments.join('\n\n');
		try {
			await navigator.clipboard.writeText(markdown);
			new Notice(t('gridInteraction.copySectionSuccess'));
		} catch (error) {
			console.error(t('gridInteraction.copyFailedLog'), error);
			new Notice(t('gridInteraction.copyFailedNotice'));
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

		this.contextMenu = ownerDoc.body.createDiv({ cls: 'tlb-context-menu' });
		this.contextMenu.style.visibility = 'hidden';
		this.contextMenu.style.left = '0px';
		this.contextMenu.style.top = '0px';

		if (isIndexColumn) {
			const copySection = this.contextMenu.createDiv({ cls: 'tlb-context-menu-item' });
			copySection.createSpan({ text: t('gridInteraction.copySection') });
			copySection.addEventListener('click', () => {
				this.copySection(blockIndex);
				this.hideContextMenu();
			});
			this.contextMenu.createDiv({ cls: 'tlb-context-menu-separator' });
		}

		const insertAbove = this.contextMenu.createDiv({ cls: 'tlb-context-menu-item' });
		insertAbove.createSpan({ text: t('gridInteraction.insertRowAbove') });
		insertAbove.addEventListener('click', () => {
			this.deps.rowInteraction.addRow(blockIndex);
			this.hideContextMenu();
		});

		const insertBelow = this.contextMenu.createDiv({ cls: 'tlb-context-menu-item' });
		insertBelow.createSpan({ text: t('gridInteraction.insertRowBelow') });
		insertBelow.addEventListener('click', () => {
			this.deps.rowInteraction.addRow(blockIndex + 1);
			this.hideContextMenu();
		});

		this.contextMenu.createDiv({ cls: 'tlb-context-menu-separator' });

		if (isMultiSelect) {
			const duplicateRows = this.contextMenu.createDiv({ cls: 'tlb-context-menu-item' });
			duplicateRows.createSpan({
				text: t('gridInteraction.duplicateSelected', { count: String(selectedRows.length) })
			});
			duplicateRows.addEventListener('click', () => {
				this.deps.rowInteraction.duplicateRows(selectedRows);
				this.hideContextMenu();
			});

			const deleteRows = this.contextMenu.createDiv({ cls: 'tlb-context-menu-item tlb-context-menu-item-danger' });
			deleteRows.createSpan({
				text: t('gridInteraction.deleteSelected', { count: String(selectedRows.length) })
			});
			deleteRows.addEventListener('click', () => {
				this.deps.rowInteraction.deleteRows(selectedRows);
				this.hideContextMenu();
			});
		} else {
			const duplicateRow = this.contextMenu.createDiv({ cls: 'tlb-context-menu-item' });
			duplicateRow.createSpan({ text: t('gridInteraction.duplicateRow') });
			duplicateRow.addEventListener('click', () => {
				this.deps.rowInteraction.duplicateRow(blockIndex);
				this.hideContextMenu();
			});

			const deleteRow = this.contextMenu.createDiv({ cls: 'tlb-context-menu-item tlb-context-menu-item-danger' });
			deleteRow.createSpan({ text: t('gridInteraction.deleteRow') });
			deleteRow.addEventListener('click', () => {
				this.deps.rowInteraction.deleteRow(blockIndex);
				this.hideContextMenu();
			});
		}

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
