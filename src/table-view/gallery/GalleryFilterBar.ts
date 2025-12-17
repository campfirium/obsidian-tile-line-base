import { setIcon } from 'obsidian';
import type { FileFilterViewState, FilterViewDefinition } from '../../types/filterView';
import { t } from '../../i18n';
import type { FilterViewBarTagGroupState } from '../filter/FilterViewBar';

const DEFAULT_FILTER_VIEW_ICON = 'layout-grid';
interface GalleryFilterBarCallbacks {
	onCreate(): void;
	onActivate(viewId: string | null): void;
	onContextMenu(view: FilterViewDefinition, event: MouseEvent): void;
	onReorder(draggedId: string, targetId: string): void;
	onOpenTagGroupMenu(button: HTMLElement): void;
	onOpenSettings?: (button: HTMLElement, event: MouseEvent) => void;
	onDefaultViewMenu?: (button: HTMLElement, event?: MouseEvent) => void;
	onEditDefaultView?: () => void;
}

interface GalleryFilterBarOptions {
	container: Element;
	renderQuickFilter: (container: HTMLElement) => void;
	callbacks: GalleryFilterBarCallbacks;
}

export class GalleryFilterBar {
	private readonly rootEl: HTMLElement;
	private readonly tabsEl: HTMLElement;
	private readonly tagGroupButtonEl: HTMLButtonElement;
	private readonly tagGroupLabelEl: HTMLSpanElement;
	private readonly addButtonEl: HTMLButtonElement;
	private readonly actionsEl: HTMLElement;
	private readonly settingsButtonEl: HTMLButtonElement;
	private readonly searchEl: HTMLElement;
	private readonly tagGroupClickHandler: (event: MouseEvent) => void;
	private readonly addClickHandler: () => void;
	private readonly settingsClickHandler: (event: MouseEvent) => void;
	private tagGroupState: FilterViewBarTagGroupState = {
		activeGroupId: null,
		activeGroupName: null,
		visibleViewIds: null,
		hasGroups: false
	};

	constructor(private readonly options: GalleryFilterBarOptions) {
		this.rootEl = options.container.createDiv({ cls: 'tlb-filter-view-bar tlb-gallery-filter-bar' });
		this.tabsEl = this.rootEl.createDiv({ cls: 'tlb-filter-view-tabs' });
		this.tagGroupButtonEl = this.tabsEl.createEl('button', {
			cls: 'tlb-filter-view-button tlb-filter-view-button--tag-groups'
		});
		const iconEl = this.tagGroupButtonEl.createSpan({ cls: 'tlb-filter-view-button__icon' });
		setIcon(iconEl, 'layers-2');
		this.tagGroupLabelEl = this.tagGroupButtonEl.createSpan({ cls: 'tlb-filter-view-button__label' });
		this.tagGroupLabelEl.textContent = t('filterViewBar.tagGroupButtonLabel');
		this.tagGroupClickHandler = (event: MouseEvent) => {
			event.preventDefault();
			this.options.callbacks.onOpenTagGroupMenu(this.tagGroupButtonEl);
		};
		this.tagGroupButtonEl.addEventListener('click', this.tagGroupClickHandler);

		this.searchEl = this.rootEl.createDiv({ cls: 'tlb-filter-view-search' });
		this.options.renderQuickFilter(this.searchEl);
		this.actionsEl = this.rootEl.createDiv({ cls: 'tlb-filter-view-actions' });
		this.settingsButtonEl = this.actionsEl.createEl('button', {
			cls: 'tlb-filter-view-button tlb-filter-view-button--settings'
		});
		const settingsLabel = t('filterViewBar.settingsMenuAriaLabel');
		this.settingsButtonEl.setAttribute('aria-label', settingsLabel);
		this.settingsButtonEl.setAttribute('title', settingsLabel);
		this.settingsClickHandler = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			this.options.callbacks.onOpenSettings?.(this.settingsButtonEl, event);
		};
		setIcon(this.settingsButtonEl, 'settings');
		this.settingsButtonEl.addEventListener('click', this.settingsClickHandler);

		const addButtonLabel = t('filterViewBar.addButtonAriaLabel');
		this.addButtonEl = this.tabsEl.createEl('button', {
			cls: 'tlb-filter-view-button tlb-filter-view-button--add',
			text: '+'
		});
		this.addButtonEl.setAttribute('aria-label', addButtonLabel);
		this.addButtonEl.setAttribute('title', addButtonLabel);
		this.addClickHandler = () => {
			this.options.callbacks.onCreate();
		};
		this.addButtonEl.addEventListener('click', this.addClickHandler);
	}

	render(state: FileFilterViewState): void {
		this.clearElement(this.tabsEl);
		this.tabsEl.append(this.tagGroupButtonEl);
		this.updateTagGroupButton();

		const defaultButton = this.tabsEl.createEl('button', {
			cls: 'tlb-filter-view-button'
		});
		defaultButton.setAttribute('data-default-view', 'true');
		this.applyButtonContent(defaultButton, this.getDefaultViewName(state), this.getDefaultViewIcon(state));
		if (!state.activeViewId) {
			defaultButton.classList.add('is-active');
		}

		defaultButton.addEventListener('click', () => this.options.callbacks.onActivate(null));
		defaultButton.addEventListener('contextmenu', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.options.callbacks.onDefaultViewMenu?.(defaultButton, event);
		});
		defaultButton.addEventListener('dblclick', (event) => {
			event.preventDefault();
			this.options.callbacks.onEditDefaultView?.();
		});

		for (let index = 0; index < state.views.length; index++) {
			const view = state.views[index];
			if (this.tagGroupState.visibleViewIds && !this.tagGroupState.visibleViewIds.has(view.id)) {
				continue;
			}
			const button = this.tabsEl.createEl('button', { cls: 'tlb-filter-view-button' });
			this.setFilterButtonContent(button, view);
			if (view.id === state.activeViewId) {
				button.classList.add('is-active');
			}
			button.draggable = true;
			button.setAttribute('data-view-id', view.id);
			button.setAttribute('data-view-index', String(index));

			button.addEventListener('dragstart', (event) => {
				button.classList.add('is-dragging');
				if (event.dataTransfer) {
					event.dataTransfer.effectAllowed = 'move';
					event.dataTransfer.setData('text/plain', view.id);
				}
			});
			button.addEventListener('dragend', () => button.classList.remove('is-dragging'));
			button.addEventListener('dragover', (event) => {
				event.preventDefault();
				if (event.dataTransfer) {
					event.dataTransfer.dropEffect = 'move';
				}
			});
			button.addEventListener('drop', (event) => {
				event.preventDefault();
				const draggedId = event.dataTransfer?.getData('text/plain');
				if (draggedId && draggedId !== view.id) {
					this.options.callbacks.onReorder(draggedId, view.id);
				}
			});
			button.addEventListener('click', () => this.options.callbacks.onActivate(view.id));
			button.addEventListener('contextmenu', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.options.callbacks.onContextMenu(view, event);
			});
		}

		this.tabsEl.append(this.addButtonEl);
	}

	setTagGroupState(state: FilterViewBarTagGroupState): void {
		this.tagGroupState = {
			activeGroupId: state.activeGroupId,
			activeGroupName: state.activeGroupName,
			visibleViewIds: state.visibleViewIds ? new Set(state.visibleViewIds) : null,
			hasGroups: state.hasGroups
		};
		this.updateTagGroupButton();
	}

	destroy(): void {
		this.tagGroupButtonEl.removeEventListener('click', this.tagGroupClickHandler);
		this.addButtonEl.removeEventListener('click', this.addClickHandler);
		this.settingsButtonEl.removeEventListener('click', this.settingsClickHandler);
		this.rootEl.remove();
	}

	private clearElement(element: HTMLElement): void {
		while (element.firstChild) {
			element.removeChild(element.firstChild);
		}
	}

	private setFilterButtonContent(button: HTMLButtonElement, view: FilterViewDefinition): void {
		const name = typeof view.name === 'string' ? view.name : '';
		const iconId = typeof view.icon === 'string' && view.icon.trim().length > 0 ? view.icon.trim() : null;
		this.applyButtonContent(button, name, iconId ?? DEFAULT_FILTER_VIEW_ICON);
	}

	private applyButtonContent(button: HTMLButtonElement, name: string, iconId?: string | null): void {
		this.clearElement(button);
		const iconEl = button.createSpan({ cls: 'tlb-filter-view-button__icon' });
		setIcon(iconEl, iconId ?? DEFAULT_FILTER_VIEW_ICON);
		const label = button.createSpan({ cls: 'tlb-filter-view-button__label' });
		label.textContent = name || t('filterViewBar.unnamedViewLabel');
	}

	private updateTagGroupButton(): void {
		const label =
			this.tagGroupState.activeGroupName && this.tagGroupState.activeGroupName.trim().length > 0
				? this.tagGroupState.activeGroupName
				: t('filterViewBar.tagGroupButtonLabel');
		this.tagGroupLabelEl.textContent = label;
		this.tagGroupButtonEl.classList.remove('is-active');
	}

	private getDefaultViewName(state: FileFilterViewState): string {
		const name = state?.metadata?.defaultView?.name ?? '';
		return name && name.trim().length > 0 ? name : t('filterViewBar.allTabLabel');
	}

	private getDefaultViewIcon(state: FileFilterViewState): string {
		const iconId = typeof state?.metadata?.defaultView?.icon === 'string' ? state.metadata.defaultView.icon.trim() : '';
		return iconId.length > 0 ? iconId : DEFAULT_FILTER_VIEW_ICON;
	}
}
