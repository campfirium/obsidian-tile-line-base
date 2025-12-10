import type { TableView } from '../../TableView';
import { GalleryFilterBar } from './GalleryFilterBar';
import type { FilterViewBarTagGroupState } from '../filter/FilterViewBar';
import { getAvailableColumns, getFilterColumnOptions } from '../TableViewFilterPresenter';

export function renderGalleryFilterControls(
	view: TableView,
	container: Element,
	options?: { onOpenSettings?: (button: HTMLElement, event: MouseEvent) => void }
): void {
	if (!view.galleryQuickFilterController) {
		return;
	}

	view.galleryFilterBar = new GalleryFilterBar({
		container,
		renderQuickFilter: (searchContainer) => view.galleryQuickFilterController?.render(searchContainer),
		callbacks: {
			onCreate: () => {
				void view.galleryFilterViewController.promptCreateFilterView();
			},
			onActivate: (viewId) => {
				view.galleryFilterViewController.activateFilterView(viewId);
			},
			onContextMenu: (filterView, event) => {
				view.galleryFilterViewController.openFilterViewMenu(filterView, event);
			},
				onReorder: (draggedId, targetId) => {
					view.galleryFilterViewController.reorderFilterViews(draggedId, targetId);
				},
				onOpenTagGroupMenu: (button) => {
					view.galleryTagGroupController?.openTagGroupMenu(button);
				},
				onOpenSettings: options?.onOpenSettings,
				onDefaultViewMenu: (button, event) => {
					view.galleryFilterViewController.openDefaultViewMenu(button, event);
				},
				onEditDefaultView: () => {
					void view.galleryFilterViewController.editDefaultView();
				}
			}
		});

	updateGalleryFilterViewBarTagGroupState(view);
	view.galleryFilterBar.render(view.galleryFilterViewState);
}

export function syncGalleryFilterViewState(view: TableView): void {
	view.galleryFilterViewState = view.galleryFilterStateStore.getState();
}

export function persistGalleryFilterViews(view: TableView): Promise<void> | void {
	if (!view.file) {
		return;
	}
	view.markUserMutation('gallery-filter-view-change');
	view.persistenceService.scheduleSave();
	return view.galleryFilterStateStore.persist();
}

export function persistGalleryTagGroups(view: TableView): Promise<void> | void {
	if (!view.file) {
		return;
	}

	view.galleryTagGroupController?.syncWithAvailableViews();
	view.markUserMutation('gallery-tag-group-change');
	view.persistenceService.scheduleSave();
	syncGalleryTagGroupState(view);
	return view.galleryTagGroupStore.persist();
}

export function syncGalleryTagGroupState(view: TableView): void {
	view.galleryTagGroupState = view.galleryTagGroupStore.getState();
}

export function updateGalleryFilterViewBarTagGroupState(view: TableView): void {
	if (!view.galleryFilterBar) {
		return;
	}
	view.galleryTagGroupController?.syncWithAvailableViews();
	syncGalleryTagGroupState(view);
	view.galleryFilterBar.setTagGroupState(buildGalleryTagGroupRenderState(view));
}

export function getGalleryAvailableColumns(view: TableView): string[] {
	return getAvailableColumns(view);
}

export function getGalleryFilterColumnOptions(view: TableView) {
	return getFilterColumnOptions(view);
}

function buildGalleryTagGroupRenderState(view: TableView): FilterViewBarTagGroupState {
	const state = view.galleryTagGroupStore.getState();
	const activeGroup = view.galleryTagGroupStore.getActiveGroup();
	return {
		activeGroupId: state.activeGroupId,
		activeGroupName: activeGroup ? activeGroup.name : null,
		visibleViewIds: view.galleryTagGroupStore.getVisibleViewIds(),
		hasGroups: state.groups.length > 0
	};
}
