import type { TaskStatus } from '../renderers/StatusCellRenderer';
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

	const block = view.blocks[blockIndex];
	const previousStatus = block.data['status'] ?? '';
	const previousStatusChanged = block.data['statusChanged'] ?? '';
	const timestamp = getCurrentLocalDateTime();
	block.data['status'] = newStatus;
	block.data['statusChanged'] = timestamp;

	const gridApi = (view.gridAdapter as any).gridApi;
	if (gridApi) {
		const rowNode = gridApi.getRowNode(rowId);
		if (rowNode) {
			rowNode.setDataValue('status', newStatus);
			rowNode.setDataValue('statusChanged', timestamp);
			gridApi.redrawRows({ rowNodes: [rowNode] });
		}
	}

	view.historyManager.recordCellChanges(
		[
			{
				ref: block,
				index: blockIndex,
				field: 'status',
				oldValue: previousStatus,
				newValue: newStatus
			},
			{
				ref: block,
				index: blockIndex,
				field: 'statusChanged',
				oldValue: previousStatusChanged,
				newValue: timestamp
			}
		],
		{
			undo: { rowIndex: blockIndex, field: 'status' },
			redo: { rowIndex: blockIndex, field: 'status' }
		}
	);

	view.filterOrchestrator.refresh();
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

	block.data[field] = normalizedValue;
	view.historyManager.recordCellChanges(
		[
			{
				ref: block,
				index: blockIndex,
				field,
				oldValue: previousValue,
				newValue: normalizedValue
			}
		],
		{
			undo: { rowIndex: blockIndex, field },
			redo: { rowIndex: blockIndex, field }
		}
	);
	view.filterOrchestrator.refresh();
	view.persistenceService.scheduleSave();
}
