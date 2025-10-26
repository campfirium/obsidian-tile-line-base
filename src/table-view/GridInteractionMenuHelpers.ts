import type { App } from 'obsidian';
import type { GridAdapter } from '../grid/GridAdapter';
import type { TableDataStore } from './TableDataStore';
import type { RowInteractionController } from './RowInteractionController';
import { GridBulkFillModal } from './GridBulkFillModal';
import { isReservedColumnId } from '../grid/systemColumnUtils';
import { getDateFormatLabel } from '../utils/datetime';

interface FillSelectionDeps {
	app: App;
	dataStore: TableDataStore;
	rowInteraction: RowInteractionController;
}

interface FillSelectionInput {
	blockIndex: number;
	selectedRows: number[];
	columnField: string | null;
}

export interface FillSelectionResult {
	action?: () => void;
	params?: Record<string, string>;
}

export function createFillSelectionAction(
	deps: FillSelectionDeps,
	context: FillSelectionInput
): FillSelectionResult {
	const { blockIndex, selectedRows, columnField } = context;
	if (!columnField || isReservedColumnId(columnField) || selectedRows.length <= 1) {
		return {};
	}
	const columnType = deps.dataStore.getColumnDisplayType(columnField);
	if (columnType === 'formula') {
		return {};
	}

	const blocks = deps.dataStore.getBlocks();
	const baseBlock = blockIndex >= 0 && blockIndex < blocks.length ? blocks[blockIndex] : null;
	const rawValue = baseBlock?.data?.[columnField] ?? '';
	const normalizedValue =
		typeof rawValue === 'string' ? rawValue : rawValue === null || rawValue === undefined ? '' : String(rawValue);

	return {
		params: { column: columnField, count: String(selectedRows.length) },
		action: () => {
			const dateFormatPreset = columnType === 'date' ? deps.dataStore.getDateFormat(columnField) : null;
			const modal = new GridBulkFillModal(deps.app, {
				columnName: columnField,
				columnType: columnType === 'date' ? 'date' : 'text',
				dateFormat: dateFormatPreset ? getDateFormatLabel(dateFormatPreset) : null,
				initialValue: normalizedValue,
				onSubmit: (value) => {
					deps.rowInteraction.fillColumnWithValue(selectedRows, columnField, value, {
						focusField: columnField,
						focusRowIndex: blockIndex
					});
				}
			});
			modal.open();
		}
	};
}

export function resolveBlockIndexesForCopy(
	getGridAdapter: () => GridAdapter | null,
	dataStore: TableDataStore,
	primaryIndex: number
): number[] {
	const gridAdapter = getGridAdapter();
	const selected = gridAdapter?.getSelectedRows?.() ?? [];
	const blocks = dataStore.getBlocks();
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
