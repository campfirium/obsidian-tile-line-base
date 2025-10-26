import { setIcon } from 'obsidian';
import { t } from '../../../i18n';

interface TagGroupMenuRenderOptions {
	doc: Document;
	displayName: string;
	tagLabels: string[];
	allowDelete: boolean;
}

export interface TagGroupMenuRenderResult {
	content: DocumentFragment;
	renameButton: HTMLButtonElement;
	deleteButton: HTMLButtonElement | null;
}

export function renderTagGroupMenuItem(options: TagGroupMenuRenderOptions): TagGroupMenuRenderResult {
	const { doc, displayName, tagLabels, allowDelete } = options;

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

	const renameButton = doc.createElement('button');
	renameButton.type = 'button';
	renameButton.className = 'tlb-tag-group-menu-item__action tlb-tag-group-menu-item__action--rename';
	renameButton.setAttribute('aria-label', t('tagGroups.menuRename'));
	setIcon(renameButton, 'pencil');
	actionsEl.appendChild(renameButton);

	let deleteButton: HTMLButtonElement | null = null;
	if (allowDelete) {
		deleteButton = doc.createElement('button');
		deleteButton.type = 'button';
		deleteButton.className = 'tlb-tag-group-menu-item__action tlb-tag-group-menu-item__action--delete';
		deleteButton.setAttribute('aria-label', t('tagGroups.menuDelete'));
		setIcon(deleteButton, 'trash');
		actionsEl.appendChild(deleteButton);
	}

	const tagsEl = doc.createElement('div');
	tagsEl.className = 'tlb-tag-group-menu-item__tags';
	container.appendChild(tagsEl);

	appendTag(doc, tagsEl, t('filterViewBar.allTabLabel'));
	for (const label of tagLabels) {
		appendTag(doc, tagsEl, label);
	}

	fragment.appendChild(container);
	return { content: fragment, renameButton, deleteButton };
}

function appendTag(doc: Document, container: HTMLElement, label: string): void {
	const tagEl = doc.createElement('span');
	tagEl.className = 'tlb-tag-group-menu-item__tag';
	tagEl.textContent = label;
	container.appendChild(tagEl);
}
