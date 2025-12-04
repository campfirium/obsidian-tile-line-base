import { normalizeStatus, type TaskStatus } from '../renderers/StatusCellRenderer';
import type { CellEditEvent } from '../grid/GridAdapter';
import { getCurrentLocalDateTime } from '../utils/datetime';
import { isReservedColumnId } from '../grid/systemColumnUtils';
import { getLogger } from '../utils/logger';
import { t } from '../i18n';
import type { TableView } from '../TableView';

const logger = getLogger('table-view:cell-interactions');

export function handleStatusChange(view: TableView, rowId: string, newStatus: TaskStatus): void {
	if (!view.schema || !view.gridAdapter) {
		logger.error('Schema or GridAdapter not initialized');
		return;
	}

	const blockIndex = parseInt(rowId, 10);
	if (isNaN(blockIndex) || blockIndex < 0 || blockIndex >= view.blocks.length) {
		logger.error('Invalid blockIndex:', blockIndex);
		return;
	}

	const selectedRows = view.gridAdapter.getSelectedRows();
	const validSelection: number[] = [];
	const seenRows = new Set<number>();
	for (const index of selectedRows) {
		if (!Number.isInteger(index)) {
			continue;
		}
		if (index < 0 || index >= view.blocks.length) {
			continue;
		}
		if (seenRows.has(index)) {
			continue;
		}
		seenRows.add(index);
		validSelection.push(index);
	}
	const targetIndexes = validSelection.length > 1 && validSelection.includes(blockIndex)
		? validSelection
		: [blockIndex];

	const timestamp = getCurrentLocalDateTime();
	const changedIndexes: number[] = [];

	const recorded = view.historyManager.captureCellChanges(
		targetIndexes.map((index) => ({ index, fields: ['status', 'statusChanged'] })),
		() => {
			for (const index of targetIndexes) {
				const block = view.blocks[index];
				if (!block) {
					continue;
				}
				const currentStatus = normalizeStatus(block.data['status']);
				if (currentStatus === newStatus) {
					continue;
				}
				block.data['status'] = newStatus;
				block.data['statusChanged'] = timestamp;
				changedIndexes.push(index);
			}
		},
		(changes) => {
			const focusIndex = changes[0]?.index ?? blockIndex;
			return {
				undo: { rowIndex: focusIndex, field: 'status' },
				redo: { rowIndex: focusIndex, field: 'status' }
			};
		}
	);
	if (!recorded || changedIndexes.length === 0) {
		return;
	}

	const gridApi = (view.gridAdapter as any).gridApi;
	if (gridApi) {
		const rowNodes = [];
		for (const index of changedIndexes) {
			const rowNode = gridApi.getRowNode(String(index));
			if (rowNode) {
				rowNode.setDataValue('status', newStatus);
				rowNode.setDataValue('statusChanged', timestamp);
				rowNodes.push(rowNode);
			}
		}
		if (rowNodes.length > 0) {
			gridApi.redrawRows({ rowNodes });
		}
	}

	view.filterOrchestrator.refresh();
	view.markUserMutation('status-change');
	view.persistenceService.scheduleSave();
}

export function handleCellEdit(view: TableView, event: CellEditEvent): void {
	const { rowData, field, newValue } = event;

	if (isReservedColumnId(field)) {
		return;
	}

	if (!view.schema) {
		logger.error('Schema not initialized');
		return;
	}

	const blockIndex = view.dataStore.getBlockIndexFromRow(rowData);
	if (blockIndex === null) {
		logger.error(t('tableViewInteractions.blockIndexMissing'), { rowData });
		return;
	}

	if (blockIndex < 0 || blockIndex >= view.blocks.length) {
		logger.error('Invalid block index:', blockIndex);
		return;
	}

	const block = view.blocks[blockIndex];
	const previousValue = block.data[field] ?? '';
	const normalizedValue = typeof newValue === 'string' ? newValue : newValue == null ? '' : String(newValue);
	if (previousValue === normalizedValue) {
		return;
	}

	const recorded = view.historyManager.captureCellChanges(
		[{ index: blockIndex, fields: [field] }],
		() => {
			block.data[field] = normalizedValue;
		},
		{
			undo: { rowIndex: blockIndex, field },
			redo: { rowIndex: blockIndex, field }
		}
	);
	if (!recorded) {
		return;
	}
	view.filterOrchestrator.refresh();
	view.markUserMutation('cell-edit');
	view.persistenceService.scheduleSave();
}
