import { setIcon } from 'obsidian';
import type { FilterViewDefinition, FileFilterViewState } from '../../../types/filterView';
import type { TagGroupDefinition } from '../../../types/tagGroup';
import { t } from '../../../i18n';

interface TagGroupMenuRenderOptions {
	doc: Document;
	group: TagGroupDefinition;
	defaultGroupId: string;
	filterState: FileFilterViewState;
	isActiveGroup: boolean;
	activeViewId: string | null;
	displayName: string;
}

export interface TagGroupMenuRenderResult {
	content: DocumentFragment;
	renameButton: HTMLButtonElement;
	deleteButton: HTMLButtonElement | null;
}

export function renderTagGroupMenuItem(options: TagGroupMenuRenderOptions): TagGroupMenuRenderResult {
	const { doc, group, defaultGroupId, filterState, isActiveGroup, activeViewId, displayName } = options;

	const fragment = doc.createDocumentFragment();
	const container = doc.createElement('div');
	container.className = 'tlb-tag-group-menu-item';

	const headerEl = doc.createElement('div');
	headerEl.className = 'tlb-tag-group-menu-item__header';
	container.appendChild(headerEl);

	const titleEl = doc.createElement('div');
	titleEl.className = 'tlb-tag-group-menu-item__name';
	titleEl.textContent = displayName;
	headerEl.appendChild(titleEl);

	const actionsEl = doc.createElement('div');
	actionsEl.className = 'tlb-tag-group-menu-item__actions';
	headerEl.appendChild(actionsEl);

	const renameButton = createMenuActionButton(doc, 'pencil', 'tlb-tag-group-menu-item__action--rename', t('tagGroups.menuRename'));
	actionsEl.appendChild(renameButton);

	let deleteButton: HTMLButtonElement | null = null;
	if (group.id !== defaultGroupId) {
		deleteButton = createMenuActionButton(doc, 'trash', 'tlb-tag-group-menu-item__action--delete', t('tagGroups.menuDelete'));
		actionsEl.appendChild(deleteButton);
	}

	const tagsEl = doc.createElement('div');
	tagsEl.className = 'tlb-tag-group-menu-item__tags';
	container.appendChild(tagsEl);

	const highlightAll =
		(group.id === defaultGroupId && activeViewId === null) || (isActiveGroup && activeViewId === null);
	appendTag(doc, tagsEl, t('filterViewBar.allTabLabel'), highlightAll);

	const entries = collectGroupEntries(group, filterState, activeViewId);
	for (const entry of entries) {
		appendTag(doc, tagsEl, entry.label, entry.active);
	}

	fragment.appendChild(container);
	return { content: fragment, renameButton, deleteButton };
}

function collectGroupEntries(
	group: TagGroupDefinition,
	filterState: FileFilterViewState,
	activeViewId: string | null
): Array<{ label: string; active: boolean }> {
	const entries: Array<{ label: string; active: boolean }> = [];
	const desiredOrder = Array.isArray(group.viewIds) ? group.viewIds : [];
	const viewMap = new Map<string, FilterViewDefinition>();
	for (const view of filterState.views) {
		if (!view || typeof view.id !== 'string') {
			continue;
		}
		viewMap.set(view.id.trim(), view);
	}
	for (const id of desiredOrder) {
		const trimmed = typeof id === 'string' ? id.trim() : '';
		if (!trimmed) {
			continue;
		}
		const view = viewMap.get(trimmed);
		if (!view) {
			continue;
		}
		const label = getFilterViewLabel(view) ?? trimmed;
		entries.push({ label, active: view.id === activeViewId });
	}
	return entries;
}

function getFilterViewLabel(view: FilterViewDefinition): string | null {
	const name = typeof view.name === 'string' ? view.name.trim() : '';
	if (name.length > 0) {
		return name;
	}
	const id = typeof view.id === 'string' ? view.id.trim() : '';
	return id.length > 0 ? id : null;
}

function appendTag(doc: Document, container: HTMLElement, label: string, highlight: boolean): void {
	const tagEl = doc.createElement('span');
	tagEl.className = 'tlb-tag-group-menu-item__tag';
	if (highlight) {
		tagEl.classList.add('is-active');
	}
	tagEl.textContent = label;
	container.appendChild(tagEl);
}

function createMenuActionButton(
	doc: Document,
	icon: string,
	modifierClass: string,
	ariaLabel: string
): HTMLButtonElement {
	const button = doc.createElement('button');
	button.type = 'button';
	button.className = `tlb-tag-group-menu-item__action ${modifierClass}`;
	button.setAttribute('aria-label', ariaLabel);
	const iconEl = doc.createElement('span');
	iconEl.className = 'tlb-tag-group-menu-item__icon';
	setIcon(iconEl, icon);
	button.appendChild(iconEl);
	return button;
}
