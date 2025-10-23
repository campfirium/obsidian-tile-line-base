import { App, Menu, Notice } from 'obsidian';
import type { FilterViewDefinition, FilterRule, SortRule } from '../../types/filterView';
import { FilterViewEditorModal, openFilterViewNameModal } from './FilterViewModals';
import { FilterStateStore } from './FilterStateStore';
import { t } from '../../i18n';

interface FilterViewControllerOptions {
	app: App;
	stateStore: FilterStateStore;
	getAvailableColumns: () => string[];
	persist: () => Promise<void> | void;
	applyActiveFilterView: () => void;
	syncState: () => void;
	renderBar: () => void;
}

interface StateChangeOptions {
	persist?: boolean;
	apply?: boolean;
	render?: boolean;
}

export class FilterViewController {
	private readonly app: App;
	private readonly stateStore: FilterStateStore;
	private readonly getAvailableColumns: () => string[];
	private readonly persist: () => Promise<void> | void;
	private readonly applyActiveFilterView: () => void;
	private readonly syncState: () => void;
	private readonly renderBar: () => void;

	constructor(options: FilterViewControllerOptions) {
		this.app = options.app;
		this.stateStore = options.stateStore;
		this.getAvailableColumns = options.getAvailableColumns;
		this.persist = options.persist;
		this.applyActiveFilterView = options.applyActiveFilterView;
		this.syncState = options.syncState;
		this.renderBar = options.renderBar;
	}

	async promptCreateFilterView(): Promise<void> {
		const columns = this.getAvailableColumns();
		if (columns.length === 0) {
			new Notice(t('filterViewController.noColumns'));
			return;
		}

		await new Promise<void>((resolve) => {
			const modal = new FilterViewEditorModal(this.app, {
				title: t('filterViewController.createModalTitle'),
				columns,
				onSubmit: (name, rule, sortRules) => {
					this.saveFilterView(name, rule, sortRules);
					resolve();
				},
				onCancel: () => resolve()
			});
			modal.open();
		});
	}

	activateFilterView(viewId: string | null): void {
		this.stateStore.updateState((state) => {
			state.activeViewId = viewId;
		});
		this.runStateEffects({ persist: true, apply: true });
	}

	reorderFilterViews(draggedId: string, targetId: string): void {
		let moved = false;
		this.stateStore.updateState((state) => {
			const draggedIndex = state.views.findIndex((view) => view.id === draggedId);
			const targetIndex = state.views.findIndex((view) => view.id === targetId);
			if (draggedIndex === -1 || targetIndex === -1) {
				return;
			}
			const [draggedView] = state.views.splice(draggedIndex, 1);
			state.views.splice(targetIndex, 0, draggedView);
			moved = true;
		});
		if (!moved) {
			return;
		}
		this.runStateEffects({ persist: true, apply: false });
	}

	openFilterViewMenu(view: FilterViewDefinition, event: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle(t('filterViewController.menuEdit')).setIcon('pencil').onClick(() => {
				void this.updateFilterView(view.id);
			});
		});

		menu.addItem((item) => {
			item.setTitle(t('filterViewController.menuDuplicate')).setIcon('copy').onClick(() => {
				this.duplicateFilterView(view.id);
			});
		});

		menu.addSeparator();

		menu.addItem((item) => {
			item.setTitle(t('filterViewController.menuDelete')).setIcon('trash').onClick(() => {
				this.deleteFilterView(view.id);
			});
		});

		menu.showAtPosition({ x: event.pageX, y: event.pageY });
	}

	async updateFilterView(viewId: string): Promise<void> {
		const current = this.stateStore.getState().views.find((view) => view.id === viewId);
		if (!current) {
			return;
		}

		const columns = this.getAvailableColumns();
		if (columns.length === 0) {
			return;
		}

		await new Promise<void>((resolve) => {
			const modal = new FilterViewEditorModal(this.app, {
				title: t('filterViewController.editModalTitle', { name: current.name }),
				columns,
				initialName: current.name,
				initialRule: current.filterRule,
				initialSortRules: current.sortRules,
				onSubmit: (name, rule, sortRules) => {
					this.stateStore.updateState((state) => {
						const target = state.views.find((view) => view.id === viewId);
						if (!target) {
							return;
						}
						target.name = name;
						target.filterRule = rule;
						target.sortRules = this.stateStore.sanitizeSortRules(sortRules);
					});
					this.runStateEffects({ persist: true, apply: true });
					resolve();
				},
				onCancel: () => resolve()
			});
			modal.open();
		});
	}

	async renameFilterView(viewId: string): Promise<void> {
		const current = this.stateStore.getState().views.find((view) => view.id === viewId);
		if (!current) {
			return;
		}
		const name = await openFilterViewNameModal(this.app, {
			title: t('filterViewController.renameModalTitle'),
			placeholder: t('filterViewController.renamePlaceholder'),
			defaultValue: current.name
		});
		if (!name || name.trim() === current.name) {
			return;
		}
		this.stateStore.updateState((state) => {
			const target = state.views.find((view) => view.id === viewId);
			if (!target) {
				return;
			}
			target.name = name.trim();
		});
		this.runStateEffects({ persist: true, apply: false });
	}

	duplicateFilterView(viewId: string): void {
		const sourceView = this.stateStore.getState().views.find((view) => view.id === viewId);
		if (!sourceView) {
			return;
		}
		const duplicatedName = `${sourceView.name} ${t('filterViewController.duplicateNameSuffix')}`.trim();

		const duplicatedView: FilterViewDefinition = {
			id: this.generateFilterViewId(),
			name: duplicatedName,
			filterRule: sourceView.filterRule
				? {
					conditions: sourceView.filterRule.conditions.map((condition) => ({ ...condition })),
					combineMode: sourceView.filterRule.combineMode
				}
				: null,
			sortRules: this.stateStore.sanitizeSortRules(sourceView.sortRules),
			columnState: this.stateStore.cloneColumnState(sourceView.columnState),
			quickFilter: sourceView.quickFilter
		};

		let inserted = false;
		this.stateStore.updateState((state) => {
			const sourceIndex = state.views.findIndex((view) => view.id === viewId);
			if (sourceIndex === -1) {
				return;
			}
			state.views.splice(sourceIndex + 1, 0, duplicatedView);
			state.activeViewId = duplicatedView.id;
			inserted = true;
		});
		if (!inserted) {
			return;
		}

		this.runStateEffects({ persist: true, apply: true });
		new Notice(t('filterViewController.duplicateNotice', { name: duplicatedView.name }));
	}

	deleteFilterView(viewId: string): void {
		let removed = false;
		this.stateStore.updateState((state) => {
			const index = state.views.findIndex((view) => view.id === viewId);
			if (index === -1) {
				return;
			}
			state.views.splice(index, 1);
			if (state.activeViewId === viewId) {
				state.activeViewId = null;
			}
			removed = true;
		});
		if (!removed) {
			return;
		}
		this.runStateEffects({ persist: true, apply: true });
	}

	private saveFilterView(name: string, rule: FilterRule, sortRules: SortRule[]): void {
		this.stateStore.updateState((state) => {
			const newView: FilterViewDefinition = {
				id: this.generateFilterViewId(),
				name,
				filterRule: rule,
				sortRules: this.stateStore.sanitizeSortRules(sortRules),
				columnState: null,
				quickFilter: null
			};
			state.views.push(newView);
			state.activeViewId = newView.id;
		});
		this.runStateEffects({ persist: true, apply: true });
	}

	private runStateEffects(options: StateChangeOptions): void {
		this.syncState();
		if (options.render !== false) {
			this.renderBar();
		}
		if (options.persist) {
			void this.persist();
		}
		if (options.apply) {
			this.applyActiveFilterView();
		}
	}

	private generateFilterViewId(): string {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
		return `fv-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
	}
}
