import type { TableView } from '../../TableView';
import { FilterViewController } from '../filter/FilterViewController';
import { TagGroupController } from '../filter/tag-group/TagGroupController';
import { getGalleryAvailableColumns, getGalleryFilterColumnOptions, persistGalleryFilterViews, persistGalleryTagGroups, syncGalleryFilterViewState, updateGalleryFilterViewBarTagGroupState } from './galleryFilterPresenter';

export function initializeGalleryFilters(view: TableView): void {
	view.galleryFilterViewController = new FilterViewController({
		app: view.app,
		stateStore: view.galleryFilterStateStore,
		getAvailableColumns: () => getGalleryAvailableColumns(view),
		getFilterColumnOptions: () => getGalleryFilterColumnOptions(view),
		persist: () => persistGalleryFilterViews(view),
		applyActiveFilterView: () => view.galleryFilterOrchestrator.applyActiveView(),
		syncState: () => syncGalleryFilterViewState(view),
		renderBar: () => {
			if (view.galleryFilterBar) {
				updateGalleryFilterViewBarTagGroupState(view);
				view.galleryFilterBar.render(view.galleryFilterViewState);
			}
		},
		tagGroupSupport: {
			onFilterViewRemoved: (viewId) => {
				view.galleryTagGroupController?.handleFilterViewRemoval(viewId);
			},
			onFilterViewCreated: (filterView) => {
				view.galleryTagGroupController?.handleFilterViewCreated(filterView);
			},
			onShowAddToGroupMenu: (filterView, evt) => {
				view.galleryTagGroupController?.openAddToGroupMenu(filterView, evt);
			},
			onFilterViewsUpdated: () => {
				view.galleryTagGroupController?.syncWithAvailableViews();
			}
		}
	});

	view.galleryTagGroupController = new TagGroupController({
		app: view.app,
		store: view.galleryTagGroupStore,
		getFilterViewState: () => view.galleryFilterViewState,
		getAvailableColumns: () => getGalleryAvailableColumns(view),
		getUniqueFieldValues: (field, limit) => collectUniqueFieldValues(view, field, limit),
		ensureFilterViewsForFieldValues: (field, values) => view.galleryFilterViewController.ensureFilterViewsForFieldValues(field, values),
		activateFilterView: (viewId) => view.galleryFilterViewController.activateFilterView(viewId),
		renderBar: () => {
			if (view.galleryFilterBar) {
				updateGalleryFilterViewBarTagGroupState(view);
				view.galleryFilterBar.render(view.galleryFilterViewState);
			}
		},
		persist: () => persistGalleryTagGroups(view),
		isStatusBaselineSeeded: () => view.galleryFilterStateStore.isStatusBaselineSeeded(),
		markStatusBaselineSeeded: () => view.galleryFilterStateStore.markStatusBaselineSeeded(),
		cloneFilterView: (filterView, options) => view.galleryFilterViewController.cloneFilterView(filterView.id, options)
	});
}

function collectUniqueFieldValues(view: TableView, field: string, limit: number): string[] {
	const rows = view.dataStore.extractRowData();
	const seen = new Set<string>();
	const result: string[] = [];
	for (const row of rows) {
		const raw = row[field];
		if (raw == null) {
			continue;
		}
		const value = typeof raw === 'string' ? raw : String(raw);
		const trimmed = value.trim();
		if (!trimmed || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		result.push(trimmed);
		if (Number.isFinite(limit) && limit > 0 && result.length >= limit) {
			break;
		}
	}
	return result;
}
