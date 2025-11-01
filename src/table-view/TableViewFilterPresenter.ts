import type { TableView } from '../TableView';
import { FilterViewBar, type FilterViewBarTagGroupState } from './filter/FilterViewBar';
import { ROW_ID_FIELD, type RowData } from '../grid/GridAdapter';
import { STATUS_BASELINE_VALUES } from './filter/statusDefaults';
import { openBackupRestoreModal } from './BackupRestoreModal';
import { getPluginContext } from '../pluginContext';

export type FilterColumnKind = 'status' | 'date' | 'time' | 'text';

export interface FilterColumnOption {
	name: string;
	kind: FilterColumnKind;
	allowNumericOperators?: boolean;
	statusValues?: string[];
}

export function renderFilterViewControls(view: TableView, container: Element): void {
	view.globalQuickFilterController.cleanup();

	view.filterViewBar = new FilterViewBar({
		container,
		renderQuickFilter: (searchContainer) => view.globalQuickFilterController.render(searchContainer),
		callbacks: {
			onCreate: () => {
				void view.filterViewController.promptCreateFilterView();
			},
			onActivate: (viewId) => {
				view.filterViewController.activateFilterView(viewId);
			},
			onContextMenu: (filterView, event) => {
				view.filterViewController.openFilterViewMenu(filterView, event);
			},
			onReorder: (draggedId, targetId) => {
				view.filterViewController.reorderFilterViews(draggedId, targetId);
			},
			onOpenTagGroupMenu: (button) => {
				view.tagGroupController?.openTagGroupMenu(button);
			},
			onOpenTableCreation: (button) => {
				view.tableCreationController.openCreationModal(button);
			},
			onOpenColumnSettings: (button) => {
				view.columnInteractionController.openColumnSettingsMenu(button);
			},
			onAdjustColumnWidths: () => {
				const adapter = view.gridAdapter;
				if (adapter && typeof adapter.fillColumnsToMinimumWidth === 'function') {
					adapter.fillColumnsToMinimumWidth();
				}
			},
			onOpenBackupRestore: () => {
				void openBackupRestoreModal(view);
			},
			onOpenHelp: () => {
				const plugin = getPluginContext();
				if (!plugin) {
					return;
				}
				void plugin.openHelpDocument();
			}
		}
	});
	updateFilterViewBarTagGroupState(view);
	view.filterViewBar.render(view.filterViewState);
}

export function reapplyGlobalQuickFilter(view: TableView): void {
	view.globalQuickFilterController.reapply();
}

export function syncFilterViewState(view: TableView): void {
	view.filterViewState = view.filterStateStore.getState();
}

export function getAvailableColumns(view: TableView): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	const exclude = new Set<string>(['#', ROW_ID_FIELD, '__tlb_status', '__tlb_index']);

	const pushColumn = (value: string | undefined | null) => {
		if (!value) {
			return;
		}
		if (exclude.has(value)) {
			return;
		}
		if (value.startsWith('ag-Grid')) {
			return;
		}
		if (seen.has(value)) {
			return;
		}
		seen.add(value);
		result.push(value);
	};

	if (view.schema?.columnNames) {
		for (const column of view.schema.columnNames) {
			pushColumn(column);
		}
	} else {
		const columnState = view.gridAdapter?.getColumnState?.();
		if (columnState) {
			for (const state of columnState) {
				pushColumn(state.colId ?? undefined);
			}
		}
	}

	for (const hidden of view.hiddenSortableFields) {
		pushColumn(hidden);
	}

	return result;
}

export function getFilterColumnOptions(view: TableView): FilterColumnOption[] {
	const columnNames = getAvailableColumns(view);
	if (columnNames.length === 0) {
		return [];
	}
	const rows = view.filterOrchestrator?.getAllRows?.() ?? view.dataStore.extractRowData();
	return columnNames.map((name) => createColumnOption(view, name, rows));
}

export function persistFilterViews(view: TableView): Promise<void> | void {
	if (!view.file) {
		return;
	}
	view.persistenceService.scheduleSave();
	return view.filterStateStore.persist();
}

export function persistTagGroups(view: TableView): Promise<void> | void {
	if (!view.file) {
		return;
	}
	view.tagGroupController?.syncWithAvailableViews();
	view.persistenceService.scheduleSave();
	syncTagGroupState(view);
	return view.tagGroupStore.persist();
}

export function syncTagGroupState(view: TableView): void {
	view.tagGroupState = view.tagGroupStore.getState();
}

export function updateFilterViewBarTagGroupState(view: TableView): void {
	if (!view.filterViewBar) {
		return;
	}
	view.tagGroupController?.syncWithAvailableViews();
	syncTagGroupState(view);
	view.filterViewBar.setTagGroupState(buildTagGroupRenderState(view));
}

function createColumnOption(view: TableView, column: string, rows: RowData[]): FilterColumnOption {
	const normalized = column.trim().toLowerCase();
	if (normalized === 'status') {
		return {
			name: column,
			kind: 'status',
			allowNumericOperators: false,
			statusValues: collectStatusValues(rows)
		};
	}

	const displayType = view.dataStore.getColumnDisplayType(column);
	if (displayType === 'date') {
		return {
			name: column,
			kind: 'date',
			allowNumericOperators: true
		};
	}

	if (displayType === 'time') {
		return {
			name: column,
			kind: 'time',
			allowNumericOperators: true
		};
	}

	return {
		name: column,
		kind: 'text',
		allowNumericOperators: true
	};
}

function collectStatusValues(rows: RowData[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];

	for (const baseline of STATUS_BASELINE_VALUES) {
		const key = baseline.trim().toLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			result.push(baseline);
		}
	}

	for (const row of rows) {
		const raw = row['status'];
		if (typeof raw !== 'string') {
			continue;
		}
		const trimmed = raw.trim();
		if (trimmed.length === 0) {
			continue;
		}
		const key = trimmed.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(trimmed);
	}

	return result;
}

function buildTagGroupRenderState(view: TableView): FilterViewBarTagGroupState {
	const state = view.tagGroupStore.getState();
	const activeGroup = view.tagGroupStore.getActiveGroup();
	return {
		activeGroupId: state.activeGroupId,
		activeGroupName: activeGroup ? activeGroup.name : null,
		visibleViewIds: view.tagGroupStore.getVisibleViewIds(),
		hasGroups: state.groups.length > 0
	};
}


