import { Notice } from 'obsidian';
import { getCurrentLocalDateTime } from '../utils/datetime';
import type { TaskStatus } from '../renderers/StatusCellRenderer';
import type { CellEditEvent, HeaderEditEvent } from '../grid/GridAdapter';
import type { TableView } from '../TableView';
import { t } from '../i18n';

export function handleStatusChange(view: TableView, rowId: string, newStatus: TaskStatus): void {
	if (!view.schema || !view.gridAdapter) {
		console.error('Schema or GridAdapter not initialized');
		return;
	}

	const blockIndex = parseInt(rowId, 10);
	if (isNaN(blockIndex) || blockIndex < 0 || blockIndex >= view.blocks.length) {
		console.error('Invalid blockIndex:', blockIndex);
		return;
	}

	const block = view.blocks[blockIndex];
	block.data['status'] = newStatus;
	block.data['statusChanged'] = getCurrentLocalDateTime();

	const gridApi = (view.gridAdapter as any).gridApi;
	if (gridApi) {
		const rowNode = gridApi.getRowNode(rowId);
		if (rowNode) {
			rowNode.setDataValue('status', newStatus);
			gridApi.redrawRows({ rowNodes: [rowNode] });
		}
	}

	view.persistenceService.scheduleSave();
}

export function getActiveFilterPrefills(view: TableView): Record<string, string> {
	const prefills: Record<string, string> = {};
	const activeId = view.filterViewState.activeViewId;
	if (!activeId) {
		return prefills;
	}

	const activeView = view.filterViewState.views.find((filterView) => filterView.id === activeId);
	if (!activeView || !activeView.filterRule) {
		return prefills;
	}

	for (const condition of activeView.filterRule.conditions) {
		if (condition.operator !== 'equals') {
			continue;
		}
		const rawValue = condition.value ?? '';
		if (rawValue.trim().length === 0) {
			continue;
		}
		if (condition.column === 'statusChanged') {
			continue;
		}
		prefills[condition.column] = rawValue;
	}

	return prefills;
}

export function handleCellEdit(view: TableView, event: CellEditEvent): void {
	const { rowData, field, newValue } = event;

	if (field === '#') {
		return;
	}

	if (!view.schema) {
		console.error('Schema not initialized');
		return;
	}

	const blockIndex = view.dataStore.getBlockIndexFromRow(rowData);
	if (blockIndex === null) {
		console.error(t('tableViewInteractions.blockIndexMissing'), { rowData });
		return;
	}

	if (blockIndex < 0 || blockIndex >= view.blocks.length) {
		console.error('Invalid block index:', blockIndex);
		return;
	}

	const block = view.blocks[blockIndex];
	block.data[field] = newValue;
	view.filterOrchestrator.refresh();
	view.persistenceService.scheduleSave();
}

export function handleHeaderEditEvent(view: TableView, event: HeaderEditEvent): void {
	if (!view.schema) {
		return;
	}
	const colIndex = view.schema.columnNames.indexOf(event.field);
	if (colIndex === -1) {
		return;
	}
	handleHeaderEdit(view, colIndex, event.newName);
}

export function handleHeaderEdit(view: TableView, colIndex: number, newValue: string): void {
	if (!view.schema || colIndex < 0 || colIndex >= view.schema.columnNames.length) {
		console.error('Invalid schema or column index');
		return;
	}
	const oldName = view.schema.columnNames[colIndex];
	const trimmed = newValue.trim();
	if (!trimmed || trimmed === oldName) {
		return;
	}
	const renamed = view.dataStore.renameColumn(oldName, trimmed);
	if (!renamed) {
		new Notice(t('tableViewInteractions.renameFailed', { name: trimmed }));
		return;
	}
	view.columnLayoutStore.rename(oldName, trimmed);
	renameColumnInFilterViews(view, oldName, trimmed);
	view.filterOrchestrator.refresh();
	view.persistenceService.scheduleSave();
}

export function persistColumnStructureChange(view: TableView, options?: { notice?: string }): void {
	if (!view.schema) {
		return;
	}
	view.schema = view.dataStore.getSchema();
	view.hiddenSortableFields = view.dataStore.getHiddenSortableFields();
	view.filterOrchestrator.refresh();
	if (options?.notice) {
		new Notice(options.notice);
	}
	view.persistenceService.cancelScheduledSave();
	void (async () => {
		try {
			await view.persistenceService.save();
			await view.render();
		} catch (error) {
			console.error('[TileLineBase] Failed to persist column change', error);
		}
	})();
}

export function renameColumnInFilterViews(view: TableView, oldName: string, newName: string): void {
	if (!view.filterViewState || !Array.isArray(view.filterViewState.views)) {
		return;
	}
	for (const filterView of view.filterViewState.views) {
		let modified = false;
		if (filterView.filterRule) {
			for (const condition of filterView.filterRule.conditions) {
				if (condition.column === oldName) {
					condition.column = newName;
					modified = true;
				}
			}
		}
		if (Array.isArray(filterView.sortRules)) {
			for (const rule of filterView.sortRules) {
				if (rule.column === oldName) {
					rule.column = newName;
					modified = true;
				}
			}
		}
		if (modified) {
			filterView.columnState = null;
		}
	}
}

export function removeColumnFromFilterViews(view: TableView, column: string): void {
	if (!view.filterViewState || !Array.isArray(view.filterViewState.views)) {
		return;
	}
	for (const filterView of view.filterViewState.views) {
		let modified = false;
		if (filterView.filterRule) {
			const conditions = filterView.filterRule.conditions.filter((condition) => condition.column !== column);
			if (conditions.length !== filterView.filterRule.conditions.length) {
				filterView.filterRule.conditions = conditions;
				modified = true;
			}
			if (filterView.filterRule.conditions.length === 0) {
				filterView.filterRule = null;
				modified = true;
			}
		}
		if (Array.isArray(filterView.sortRules)) {
			const nextSort = filterView.sortRules.filter((rule) => rule.column !== column);
			if (nextSort.length !== filterView.sortRules.length) {
				filterView.sortRules = nextSort;
				modified = true;
			}
		}
		if (modified) {
			filterView.columnState = null;
		}
	}
}

export function cleanupEventListeners(view: TableView): void {
	view.gridInteractionController.detach();
	view.gridLayoutController.detach();
	view.focusManager.clearPendingFocus('cleanup');
}

export async function handleOnClose(view: TableView): Promise<void> {
	view.globalQuickFilterController.cleanup();
	if (view.filterViewBar) {
		view.filterViewBar.destroy();
		view.filterViewBar = null;
	}
	cleanupEventListeners(view);
	view.gridInteractionController.hideContextMenu();
	view.focusManager.clearPendingFocus('view-close');
	view.gridController.destroy();
	view.gridAdapter = null;
	view.tableContainer = null;
	view.persistenceService.cancelScheduledSave();
	view.persistenceService.dispose();
}

export function handleColumnResize(view: TableView, field: string, width: number): void {
	if (!view.file || field === '#' || field === 'status') {
		return;
	}
	if (!view.columnLayoutStore.updateWidth(field, width)) {
		return;
	}
	view.persistenceService.scheduleSave();
}

export function handleColumnOrderChange(view: TableView, orderedFields: string[]): void {
	if (view.dataStore.reorderColumns(orderedFields)) {
		view.persistenceService.scheduleSave();
	}
}
