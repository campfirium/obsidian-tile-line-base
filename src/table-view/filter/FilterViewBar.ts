import type { App } from 'obsidian';
import type { FileFilterViewState, FilterViewDefinition } from '../../types/filterView';

export interface FilterViewBarCallbacks {
	onCreate(): void;
	onActivate(viewId: string | null): void;
	onContextMenu(view: FilterViewDefinition, event: MouseEvent): void;
	onReorder(draggedId: string, targetId: string): void;
}

interface FilterViewBarOptions {
	app: App;
	container: Element;
	renderQuickFilter: (container: HTMLElement) => void;
	callbacks: FilterViewBarCallbacks;
}

export class FilterViewBar {
	private readonly rootEl: HTMLElement;
	private readonly tabsEl: HTMLElement;
	private readonly actionsEl: HTMLElement;
	private readonly addButtonEl: HTMLButtonElement;
	private readonly searchEl: HTMLElement;
	private readonly addClickHandler: () => void;

	constructor(private readonly options: FilterViewBarOptions) {
		this.rootEl = options.container.createDiv({ cls: 'tlb-filter-view-bar' });
		this.tabsEl = this.rootEl.createDiv({ cls: 'tlb-filter-view-tabs' });
		this.actionsEl = this.rootEl.createDiv({ cls: 'tlb-filter-view-actions' });
		this.addButtonEl = this.actionsEl.createEl('button', {
			cls: 'tlb-filter-view-button tlb-filter-view-button--add',
			text: '+'
		});
		this.addClickHandler = () => {
			this.options.callbacks.onCreate();
		};
		this.addButtonEl.addEventListener('click', this.addClickHandler);

		this.searchEl = this.rootEl.createDiv({ cls: 'tlb-filter-view-search' });
		this.options.renderQuickFilter(this.searchEl);
	}

	render(state: FileFilterViewState): void {
		this.clearElement(this.tabsEl);

		const defaultButton = this.tabsEl.createEl('button', {
			cls: 'tlb-filter-view-button',
			text: '全部'
		});
		defaultButton.addEventListener('click', () => {
			this.options.callbacks.onActivate(null);
		});
		if (!state.activeViewId) {
			defaultButton.classList.add('is-active');
		}

		for (let index = 0; index < state.views.length; index++) {
			const view = state.views[index];
			const button = this.tabsEl.createEl('button', {
				cls: 'tlb-filter-view-button',
				text: view.name
			});
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

			button.addEventListener('dragend', () => {
				button.classList.remove('is-dragging');
			});

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

			button.addEventListener('click', () => {
				this.options.callbacks.onActivate(view.id);
			});

			button.addEventListener('contextmenu', (event) => {
				this.options.callbacks.onContextMenu(view, event);
			});
		}
	}

	destroy(): void {
		this.addButtonEl.removeEventListener('click', this.addClickHandler);
		this.rootEl.remove();
	}

	private clearElement(element: HTMLElement): void {
		while (element.firstChild) {
			element.removeChild(element.firstChild);
		}
	}
}
