import type { TableView } from '../TableView';
import { FilterViewBar, type FilterViewBarTagGroupState } from './filter/FilterViewBar';
import { ROW_ID_FIELD } from '../grid/GridAdapter';

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
