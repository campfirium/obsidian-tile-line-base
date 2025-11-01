import { Menu, setIcon } from 'obsidian';
import type { FileFilterViewState, FilterViewDefinition } from '../../types/filterView';
import { t } from '../../i18n';
import { getStatusIcon, normalizeStatus, type TaskStatus } from '../../renderers/StatusCellRenderer';

export interface FilterViewBarCallbacks {
	onCreate(): void;
	onActivate(viewId: string | null): void;
	onContextMenu(view: FilterViewDefinition, event: MouseEvent): void;
	onReorder(draggedId: string, targetId: string): void;
	onOpenTagGroupMenu(button: HTMLElement): void;
	onOpenTableCreation(button: HTMLElement): void;
	onOpenColumnSettings(button: HTMLElement): void;
	onOpenBackupRestore(button: HTMLElement): void;
	onAdjustColumnWidths(): void;
	onOpenHelp(): void;
}

interface FilterViewBarOptions {
	container: Element;
	renderQuickFilter: (container: HTMLElement) => void;
	callbacks: FilterViewBarCallbacks;
}

export class FilterViewBar {
	private readonly rootEl: HTMLElement;
	private readonly tabsEl: HTMLElement;
	private readonly tagGroupButtonEl: HTMLButtonElement;
	private readonly tagGroupIconEl: HTMLElement;
	private readonly tagGroupLabelEl: HTMLSpanElement;
	private readonly tagGroupClickHandler: (event: MouseEvent) => void;
	private readonly actionsEl: HTMLElement;
	private readonly addButtonEl: HTMLButtonElement;
	private readonly settingsButtonEl: HTMLButtonElement;
	private readonly searchEl: HTMLElement;
	private readonly addClickHandler: () => void;
	private readonly settingsMenuClickHandler: (event: MouseEvent) => void;
	private readonly adjustWidthsHandler: () => void;
	private tagGroupState: FilterViewBarTagGroupState = {
		activeGroupId: null,
		activeGroupName: null,
		visibleViewIds: null,
		hasGroups: false
	};

	constructor(private readonly options: FilterViewBarOptions) {
		this.rootEl = options.container.createDiv({ cls: 'tlb-filter-view-bar' });
		this.tabsEl = this.rootEl.createDiv({ cls: 'tlb-filter-view-tabs' });
		this.tagGroupButtonEl = this.tabsEl.createEl('button', {
			cls: 'tlb-filter-view-button tlb-filter-view-button--tag-groups',
		});
		this.tagGroupIconEl = this.tagGroupButtonEl.createSpan({ cls: 'tlb-filter-view-button__icon' });
		setIcon(this.tagGroupIconEl, 'layers-2');
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

		const settingsButtonLabel = t('filterViewBar.settingsMenuAriaLabel');
		this.settingsButtonEl = this.actionsEl.createEl('button', {
			cls: 'tlb-filter-view-button tlb-filter-view-button--settings'
		});
		this.settingsButtonEl.setAttribute('aria-label', settingsButtonLabel);
		this.settingsButtonEl.setAttribute('title', settingsButtonLabel);
		setIcon(this.settingsButtonEl, 'settings');
		this.settingsMenuClickHandler = (event: MouseEvent) => {
			event.preventDefault();
			this.openSettingsMenu();
		};
		this.settingsButtonEl.addEventListener('click', this.settingsMenuClickHandler);

		this.adjustWidthsHandler = () => {
			this.options.callbacks.onAdjustColumnWidths();
		};
	}

	render(state: FileFilterViewState): void {
		this.clearElement(this.tabsEl);
		this.tabsEl.append(this.tagGroupButtonEl);
		this.updateTagGroupButton();

		const defaultLabel = t('filterViewBar.allTabLabel');
		const defaultButton = this.tabsEl.createEl('button', {
			cls: 'tlb-filter-view-button',
			text: defaultLabel
		});
		defaultButton.setAttribute('title', defaultLabel);
		defaultButton.setAttribute('aria-label', defaultLabel);
		defaultButton.addEventListener('click', () => {
			this.options.callbacks.onActivate(null);
		});
		if (!state.activeViewId) {
			defaultButton.classList.add('is-active');
		}

		for (let index = 0; index < state.views.length; index++) {
			const view = state.views[index];
			if (this.tagGroupState.visibleViewIds && !this.tagGroupState.visibleViewIds.has(view.id)) {
				continue;
			}
			const button = this.tabsEl.createEl('button', {
				cls: 'tlb-filter-view-button'
			});
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

		this.tabsEl.append(this.addButtonEl);
	}

	destroy(): void {
		this.tagGroupButtonEl.removeEventListener('click', this.tagGroupClickHandler);
		this.addButtonEl.removeEventListener('click', this.addClickHandler);
		this.settingsButtonEl.removeEventListener('click', this.settingsMenuClickHandler);
		this.rootEl.remove();
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

	private clearElement(element: HTMLElement): void {
		while (element.firstChild) {
			element.removeChild(element.firstChild);
		}
	}

	private setFilterButtonContent(button: HTMLButtonElement, view: FilterViewDefinition): void {
		const name = typeof view.name === 'string' ? view.name : '';
		const status = this.getStatusFromFilterView(view);
		button.textContent = '';
		button.title = name;
		button.setAttribute('aria-label', name);
		button.classList.toggle('tlb-filter-view-button--status', !!status);
		if (!status) {
			button.classList.remove('tlb-filter-view-button--status');
			button.textContent = name;
			return;
		}

		const iconEl = button.createSpan({ cls: 'tlb-filter-view-button__icon' });
		setIcon(iconEl, getStatusIcon(status));

		const labelEl = button.createSpan({ cls: 'tlb-filter-view-button__label' });
		labelEl.textContent = name;
	}

	private openSettingsMenu(): void {
		const menu = new Menu();
		menu.addItem((item) => {
			item
				.setTitle(t('tableCreation.menuLabel'))
				.setIcon('table')
				.onClick(() => {
					this.options.callbacks.onOpenTableCreation(this.settingsButtonEl);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('filterViewBar.settingsMenuAutoWidthLabel'))
				.setIcon('maximize-2')
				.onClick(() => {
					this.adjustWidthsHandler();
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('filterViewBar.settingsMenuColumnLabel'))
				.setIcon('layout-grid')
				.onClick(() => {
					this.options.callbacks.onOpenColumnSettings(this.settingsButtonEl);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('backup.menuLabel'))
				.setIcon('history')
				.onClick(() => {
					this.options.callbacks.onOpenBackupRestore(this.settingsButtonEl);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t('filterViewBar.settingsMenuHelpLabel'))
				.setIcon('info')
				.onClick(() => {
					this.options.callbacks.onOpenHelp();
				});
		});

		const rect = this.settingsButtonEl.getBoundingClientRect();
		const ownerDoc = this.settingsButtonEl.ownerDocument;
		const win = ownerDoc?.defaultView ?? window;
		menu.showAtPosition({
			x: rect.left + win.scrollX,
			y: rect.bottom + win.scrollY
		});
	}

	private getStatusFromFilterView(view: FilterViewDefinition): TaskStatus | null {
		if (!view?.filterRule || view.filterRule.combineMode !== 'AND') {
			return null;
		}
		const conditions = Array.isArray(view.filterRule.conditions) ? view.filterRule.conditions : [];
		if (conditions.length !== 1) {
			return null;
		}
		const condition = conditions[0];
		if (!condition || condition.column !== 'status' || condition.operator !== 'equals') {
			return null;
		}
		const rawValue = condition.value;
		if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
			return null;
		}
		return normalizeStatus(rawValue);
	}

	private updateTagGroupButton(): void {
		const fallbackLabel = t('filterViewBar.tagGroupButtonLabel');
		const activeName = this.tagGroupState.activeGroupName?.trim() ?? '';
		const buttonLabel = activeName.length > 0 ? activeName : fallbackLabel;
		const tooltip = t('tagGroups.menuTooltip');

		this.tagGroupLabelEl.textContent = buttonLabel;
		this.tagGroupButtonEl.setAttribute('title', tooltip);
		this.tagGroupButtonEl.setAttribute('aria-label', t('tagGroups.buttonAriaLabel', { name: buttonLabel }));
	}
}

export interface FilterViewBarTagGroupState {
	activeGroupId: string | null;
	activeGroupName: string | null;
	visibleViewIds: Set<string> | null;
	hasGroups: boolean;
}


