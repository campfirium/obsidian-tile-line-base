import type { App, Menu } from 'obsidian';
import type { GridAdapter } from '../grid/GridAdapter';
import type { TableDataStore } from './TableDataStore';
import type { TableHistoryManager } from './TableHistoryManager';
import type { RowInteractionController } from './RowInteractionController';
import type { ColumnInteractionController } from './ColumnInteractionController';
import type { CopyTemplateController } from './CopyTemplateController';
import { buildGridContextMenu } from './GridContextMenuBuilder';
import { createFillSelectionAction, resolveBlockIndexesForCopy } from './GridInteractionMenuHelpers';
import { isReservedColumnId } from '../grid/systemColumnUtils';
import type { GridCellClipboardController } from './GridCellClipboardController';
<<<<<<< HEAD
import type { RowMigrationController } from './RowMigrationController';
=======
import type { ParagraphPromotionController } from './paragraph/ParagraphPromotionController';
>>>>>>> feat/T0108-paragraph-to-note

interface GridContextMenuParams {
	app: App;
	container: HTMLElement | null;
	blockIndex: number;
	colId?: string | null;
	dataStore: TableDataStore;
	rowInteraction: RowInteractionController;
	columnInteraction: ColumnInteractionController;
	copyTemplate: CopyTemplateController;
	getGridAdapter: () => GridAdapter | null;
	rowMigration: RowMigrationController;
	cellClipboard: GridCellClipboardController;
	onCopySelection: (blockIndex: number) => void;
	onCopySelectionAsTemplate: (blockIndex: number) => void;
	onRequestClose: () => void;
	history: TableHistoryManager;
	paragraphPromotion: ParagraphPromotionController;
}

export function createGridContextMenu(params: GridContextMenuParams): Menu | null {
	const gridAdapter = params.getGridAdapter();
	const selectedRows = gridAdapter?.getSelectedRows?.() || [];
	const isMultiSelect = selectedRows.length > 1;
	const isIndexColumn = params.colId === '#';
	const isSystemColumn = params.colId ? isReservedColumnId(params.colId) : true;
	const targetIndexes = resolveBlockIndexesForCopy(params.getGridAdapter, params.dataStore, params.blockIndex);
	const migrateIndexes = targetIndexes;
	const hasMigrateTargets = migrateIndexes.length > 0;

	let fillSelection: ReturnType<typeof createFillSelectionAction> = {};
	if (isMultiSelect && !isSystemColumn) {
		fillSelection = createFillSelectionAction(
			{
				app: params.app,
				dataStore: params.dataStore,
				rowInteraction: params.rowInteraction
			},
			{
				blockIndex: params.blockIndex,
				selectedRows,
				columnField: params.colId ?? null
			}
		);
	}

	const columnField = typeof params.colId === 'string' ? params.colId : null;
	const canCopyCell = columnField !== null && params.cellClipboard.canCopy(columnField);
	const canPasteCell = columnField !== null && params.cellClipboard.canPaste(columnField);
	let cellMenu: { copy?: () => void; paste?: () => void; disablePaste?: boolean } | undefined;
	if (columnField && (canCopyCell || canPasteCell)) {
		const fieldForMenu = columnField;
		cellMenu = {
			copy: canCopyCell
				? () => {
						void params.cellClipboard.copyCellValue(params.blockIndex, fieldForMenu);
					}
				: undefined,
			paste: canPasteCell
				? () => {
						void params.cellClipboard.pasteCellValue(params.blockIndex, fieldForMenu);
					}
				: undefined,
			disablePaste: canCopyCell && !canPasteCell
		};
	}

	const promotionTargets = targetIndexes.length > 0 ? [...targetIndexes] : [];
	const menu = buildGridContextMenu({
		isIndexColumn,
		isMultiSelect,
		selectedRowCount: selectedRows.length,
		promotionCount: promotionTargets.length,
		fillSelectionLabelParams: fillSelection.params,
		undoRedo: {
			canUndo: params.history.canUndo(),
			canRedo: params.history.canRedo(),
			onUndo: () => {
				params.history.undo();
			},
			onRedo: () => {
				params.history.redo();
			}
		},
		cellMenu,
		actions: {
			copySelection: () => {
				params.onCopySelection(params.blockIndex);
			},
			copySelectionAsTemplate: () => {
				params.onCopySelectionAsTemplate(params.blockIndex);
			},
			editCopyTemplate: () => {
				params.copyTemplate.openEditor(params.container, targetIndexes);
			},
			migrateSelection: hasMigrateTargets
				? {
						moveToNew: () => {
							void params.rowMigration.moveSelectionToNewFile(migrateIndexes);
						},
						copyToNew: () => {
							void params.rowMigration.copySelectionToNewFile(migrateIndexes);
						},
						moveToExisting: () => {
							void params.rowMigration.moveSelectionToExistingFile(migrateIndexes);
						}
					}
				: undefined,
			insertAbove: () => params.rowInteraction.addRow(params.blockIndex),
			insertBelow: () => params.rowInteraction.addRow(params.blockIndex + 1),
			fillSelectionWithValue: fillSelection.action,
			duplicateSelection: () => params.rowInteraction.duplicateRows(selectedRows),
			deleteSelection: () => params.rowInteraction.deleteRows(selectedRows),
			duplicateRow: () => params.rowInteraction.duplicateRow(params.blockIndex),
			deleteRow: () => params.rowInteraction.deleteRow(params.blockIndex),
			close: params.onRequestClose,
			promoteToNote: promotionTargets.length > 0
				? () => {
						void params.paragraphPromotion.promoteRows([...promotionTargets]);
					}
				: undefined
		}
	});

	return menu;
}
