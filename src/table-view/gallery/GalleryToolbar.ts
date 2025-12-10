import { setIcon } from 'obsidian';
import { t } from '../../i18n';

export interface GalleryToolbarView {
	id: string;
	name: string;
}

interface GalleryToolbarOptions {
	container: Element;
	views: GalleryToolbarView[];
	activeViewId: string | null;
	renderQuickFilter: (container: HTMLElement) => void;
	onSelectView: (viewId: string) => void | Promise<void>;
	onCreateView: () => void | Promise<void>;
	onOpenViewMenu: (viewId: string, event: MouseEvent) => void | Promise<void>;
	onOpenSettings: (button: HTMLButtonElement, event: MouseEvent) => void;
	onEditView?: (viewId: string) => void | Promise<void>;
	onOpenTagGroupMenu?: (button: HTMLButtonElement) => void | Promise<void>;
}

interface ListenerEntry {
	id: string;
	button: HTMLButtonElement;
	clickHandler: (event: MouseEvent) => void;
	contextHandler: (event: MouseEvent) => void;
	doubleClickHandler: (event: MouseEvent) => void;
}

export class GalleryToolbar {
	private readonly rootEl: HTMLElement;
	private readonly tabsEl: HTMLElement;
	private readonly viewListEl: HTMLElement;
	private readonly searchEl: HTMLElement;
	private readonly actionsEl: HTMLElement;
	private readonly tagGroupButtonEl: HTMLButtonElement;
	private readonly addButtonEl: HTMLButtonElement;
	private readonly settingsButtonEl: HTMLButtonElement;
	private readonly addClickHandler: (event: MouseEvent) => void;
	private readonly tagGroupClickHandler: (event: MouseEvent) => void;
	private readonly settingsClickHandler: (event: MouseEvent) => void;
	private readonly viewListeners: ListenerEntry[] = [];
	private views: GalleryToolbarView[] = [];
	private activeViewId: string | null;

	constructor(private readonly options: GalleryToolbarOptions) {
		this.activeViewId = options.activeViewId ?? null;
		this.rootEl = options.container.createDiv({ cls: 'tlb-filter-view-bar tlb-gallery-toolbar' });
		this.tabsEl = this.rootEl.createDiv({ cls: 'tlb-filter-view-tabs' });
		this.viewListEl = this.tabsEl.createDiv({ cls: 'tlb-gallery-toolbar__views' });

		this.tagGroupButtonEl = this.tabsEl.createEl('button', {
			cls: 'tlb-filter-view-button tlb-filter-view-button--tag-groups'
		});
		const tagGroupLabel = t('filterViewBar.tagGroupButtonLabel');
		this.tagGroupButtonEl.setAttribute('type', 'button');
		this.tagGroupButtonEl.setAttribute('aria-label', tagGroupLabel);
		this.tagGroupButtonEl.setAttribute('title', tagGroupLabel);
		setIcon(this.tagGroupButtonEl, 'layers-2');
		this.tagGroupClickHandler = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			if (this.options.onOpenTagGroupMenu) {
				void this.options.onOpenTagGroupMenu(this.tagGroupButtonEl);
			}
		};
		this.tagGroupButtonEl.addEventListener('click', this.tagGroupClickHandler);

		const addLabel = t('galleryView.toolbar.addGalleryButtonAriaLabel');
		this.addButtonEl = this.tabsEl.createEl('button', {
			cls: 'tlb-filter-view-button tlb-filter-view-button--add',
			text: '+'
		});
		this.addButtonEl.setAttribute('type', 'button');
		this.addButtonEl.setAttribute('aria-label', addLabel);
		this.addButtonEl.setAttribute('title', addLabel);
		this.addClickHandler = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			void this.options.onCreateView();
		};
		this.addButtonEl.addEventListener('click', this.addClickHandler);

		this.searchEl = this.rootEl.createDiv({ cls: 'tlb-filter-view-search' });
		this.options.renderQuickFilter(this.searchEl);
		if (!this.searchEl.hasChildNodes()) {
			this.searchEl.addClass('tlb-filter-view-search--hidden');
		}

		this.actionsEl = this.rootEl.createDiv({ cls: 'tlb-filter-view-actions' });
		this.settingsButtonEl = this.actionsEl.createEl('button', {
			cls: 'tlb-filter-view-button tlb-filter-view-button--settings'
		});
		this.settingsButtonEl.setAttribute('type', 'button');
		const settingsLabel = t('galleryView.toolbar.settingsMenuAriaLabel');
		this.settingsButtonEl.setAttribute('aria-label', settingsLabel);
		this.settingsButtonEl.setAttribute('title', settingsLabel);
		setIcon(this.settingsButtonEl, 'settings');
		this.settingsClickHandler = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			this.options.onOpenSettings(this.settingsButtonEl, event);
		};
		this.settingsButtonEl.addEventListener('click', this.settingsClickHandler);

		this.updateState(options.views, options.activeViewId ?? null);
	}

	updateState(views: GalleryToolbarView[], activeViewId: string | null): void {
		this.views = views.map((entry) => ({ id: entry.id, name: entry.name }));
		this.activeViewId = activeViewId ?? (this.views[0]?.id ?? null);
		this.renderViewButtons();
	}

	destroy(): void {
		for (const entry of this.viewListeners) {
			entry.button.removeEventListener('click', entry.clickHandler);
			entry.button.removeEventListener('contextmenu', entry.contextHandler);
			entry.button.removeEventListener('dblclick', entry.doubleClickHandler);
		}
		this.tagGroupButtonEl.removeEventListener('click', this.tagGroupClickHandler);
		this.viewListeners.length = 0;
		this.addButtonEl.removeEventListener('click', this.addClickHandler);
		this.settingsButtonEl.removeEventListener('click', this.settingsClickHandler);
		this.rootEl.remove();
	}

	setActiveView(viewId: string | null): void {
		this.activeViewId = viewId ?? null;
		for (const entry of this.viewListeners) {
			if (this.activeViewId && entry.id === this.activeViewId) {
				entry.button.classList.add('is-active');
			} else {
				entry.button.classList.remove('is-active');
			}
		}
	}

	private renderViewButtons(): void {
		this.viewListEl.empty();
		for (const entry of this.viewListeners) {
			entry.button.removeEventListener('click', entry.clickHandler);
			entry.button.removeEventListener('contextmenu', entry.contextHandler);
			entry.button.removeEventListener('dblclick', entry.doubleClickHandler);
		}
		this.viewListeners.length = 0;

		for (const view of this.views) {
			const button = this.viewListEl.createEl('button', {
				cls: 'tlb-filter-view-button',
				attr: { 'data-gallery-id': view.id }
			});
			button.setAttribute('type', 'button');
			const label = this.resolveLabel(view.name);
			button.textContent = label;
			button.setAttribute('title', label);
			button.setAttribute('aria-label', label);

			if (this.isActive(view.id)) {
				button.classList.add('is-active');
			}

			const clickHandler = (event: MouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
				this.setActiveView(view.id);
				void this.options.onSelectView(view.id);
			};

			const contextHandler = (event: MouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
				void this.options.onOpenViewMenu(view.id, event);
			};

			const doubleClickHandler = (event: MouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
				if (this.options.onEditView) {
					void this.options.onEditView(view.id);
				} else {
					void this.options.onOpenViewMenu(view.id, event);
				}
			};

			button.addEventListener('click', clickHandler);
			button.addEventListener('contextmenu', contextHandler);
			button.addEventListener('dblclick', doubleClickHandler);

			this.viewListeners.push({
				id: view.id,
				button,
				clickHandler,
				contextHandler,
				doubleClickHandler
			});
		}

		if (this.activeViewId === null && this.viewListeners.length > 0) {
			this.setActiveView(this.viewListeners[0].id);
		}
	}

	private resolveLabel(name: string): string {
		const trimmed = typeof name === 'string' ? name.trim() : '';
		return trimmed.length > 0 ? trimmed : t('galleryView.toolbar.unnamedGalleryLabel');
	}

	private isActive(viewId: string): boolean {
		return this.activeViewId !== null && viewId === this.activeViewId;
	}
}
