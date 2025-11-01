import { App, Menu, Notice } from 'obsidian';
import type { FilterViewDefinition, FilterRule, SortRule } from '../../types/filterView';
import { FilterViewEditorModal, openFilterViewNameModal, type FilterViewEditorResult } from './FilterViewModals';
import { FilterStateStore } from './FilterStateStore';
import { t } from '../../i18n';
import type { FilterColumnOption } from '../TableViewFilterPresenter';
import {
	sanitizeIconId,
	openDefaultViewMenu as showDefaultViewMenu,
	promptEditDefaultView,
	resetDefaultViewPreferences as clearDefaultViewPreferences
} from './DefaultViewPreferences';
import { ensureFilterViewsForFieldValues as autoEnsureFilterViews } from './FilterViewAutoGenerator';

interface FilterViewControllerOptions {
	app: App;
	stateStore: FilterStateStore;
	getAvailableColumns: () => string[];
	getFilterColumnOptions?: () => FilterColumnOption[];
	persist: () => Promise<void> | void;
	applyActiveFilterView: () => void;
	syncState: () => void;
	renderBar: () => void;
	tagGroupSupport?: {
		onFilterViewRemoved: (viewId: string) => void;
		onShowAddToGroupMenu: (view: FilterViewDefinition, event: MouseEvent) => void;
		onFilterViewsUpdated?: () => void;
		onFilterViewCreated?: (view: FilterViewDefinition) => void;
	};
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
	private readonly getFilterColumnOptions?: () => FilterColumnOption[];
	private readonly persist: () => Promise<void> | void;
	private readonly applyActiveFilterView: () => void;
	private readonly syncState: () => void;
	private readonly renderBar: () => void;
	private readonly tagGroupSupport?: {
		onFilterViewRemoved: (viewId: string) => void;
		onShowAddToGroupMenu: (view: FilterViewDefinition, event: MouseEvent) => void;
		onFilterViewsUpdated?: () => void;
		onFilterViewCreated?: (view: FilterViewDefinition) => void;
	};

	constructor(options: FilterViewControllerOptions) {
		this.app = options.app;
		this.stateStore = options.stateStore;
		this.getAvailableColumns = options.getAvailableColumns;
		this.getFilterColumnOptions = options.getFilterColumnOptions;
		this.persist = options.persist;
		this.applyActiveFilterView = options.applyActiveFilterView;
		this.syncState = options.syncState;
		this.renderBar = options.renderBar;
		this.tagGroupSupport = options.tagGroupSupport;
	}

	private resolveColumnOptions(): FilterColumnOption[] {
		if (this.getFilterColumnOptions) {
			try {
				const options = this.getFilterColumnOptions();
				if (Array.isArray(options) && options.length > 0) {
					return options;
				}
			} catch {
				// ignore and fall back to legacy columns
			}
		}
		return this.getAvailableColumns().map((name) => {
			const normalized = name.trim().toLowerCase();
			if (normalized === 'status') {
				return {
					name,
					kind: 'status' as const,
					allowNumericOperators: false
				};
			}
			return {
				name,
				kind: 'text' as const,
				allowNumericOperators: true
			};
		});
	}

	async promptCreateFilterView(): Promise<void> {
		const columnOptions = this.resolveColumnOptions();
		if (columnOptions.length === 0) {
			new Notice(t('filterViewController.noColumns'));
			return;
		}

		await new Promise<void>((resolve) => {
			const modal = new FilterViewEditorModal(this.app, {
				title: t('filterViewController.createModalTitle'),
				columns: columnOptions,
				onSubmit: (result) => {
					this.saveFilterView(result);
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
				void this.duplicateFilterView(view.id);
			});
		});

		menu.addSeparator();

		menu.addItem((item) => {
			item.setTitle(t('filterViewController.menuDelete')).setIcon('trash').onClick(() => {
				this.deleteFilterView(view.id);
			});
		});

		if (this.tagGroupSupport) {
			menu.addItem((item) => {
				item
					.setTitle(t('tagGroups.menuAddFilterView'))
					.setIcon('bookmark-plus')
					.onClick((evt) => {
						const triggerEvent = evt instanceof MouseEvent ? evt : event;
						if (this.tagGroupSupport) {
							this.tagGroupSupport.onShowAddToGroupMenu(view, triggerEvent);
						}
					});
			});
		}

		menu.showAtPosition({ x: event.pageX, y: event.pageY });
	}

	async updateFilterView(viewId: string): Promise<void> {
		const current = this.stateStore.getState().views.find((view) => view.id === viewId);
		if (!current) {
			return;
		}

		const columnOptions = this.resolveColumnOptions();
		if (columnOptions.length === 0) {
			return;
		}

		await new Promise<void>((resolve) => {
			const modal = new FilterViewEditorModal(this.app, {
				title: t('filterViewController.editModalTitle', { name: current.name }),
				columns: columnOptions,
				initialName: current.name,
				initialIcon: current.icon ?? null,
				initialRule: current.filterRule,
				initialSortRules: current.sortRules,
				onSubmit: (result) => {
					this.stateStore.updateState((state) => {
						const target = state.views.find((view) => view.id === viewId);
						if (!target) {
							return;
						}
						target.name = result.name;
						target.filterRule = result.filterRule;
						target.sortRules = this.stateStore.sanitizeSortRules(result.sortRules);
						target.icon = sanitizeIconId(result.icon);
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

	async duplicateFilterView(viewId: string): Promise<void> {
		const sourceView = this.stateStore.getState().views.find((view) => view.id === viewId);
		if (!sourceView) {
			return;
		}

		const columnOptions = this.resolveColumnOptions();
		if (columnOptions.length === 0) {
			new Notice(t('filterViewController.noColumns'));
			return;
		}

		const initialRule: FilterRule | null = sourceView.filterRule
			? {
				conditions: sourceView.filterRule.conditions.map((condition) => ({ ...condition })),
				combineMode: sourceView.filterRule.combineMode
			}
			: null;
		const initialSortRules: SortRule[] = Array.isArray(sourceView.sortRules)
			? sourceView.sortRules.map((rule) => ({ column: rule.column, direction: rule.direction === 'desc' ? 'desc' : 'asc' }))
			: [];
		const duplicatedName = `${sourceView.name} ${t('filterViewController.duplicateNameSuffix')}`.trim();
		const sourceColumnState = this.stateStore.cloneColumnState(sourceView.columnState);
		const sourceQuickFilter = sourceView.quickFilter ?? null;

		await new Promise<void>((resolve) => {
			const modal = new FilterViewEditorModal(this.app, {
				title: t('filterViewController.duplicateModalTitle', { name: sourceView.name }),
				columns: columnOptions,
				initialName: duplicatedName,
				initialIcon: sourceView.icon ?? null,
				initialRule,
				initialSortRules,
				onSubmit: (result) => {
					let inserted = false;
					const sanitizedSortRules: SortRule[] = this.stateStore.sanitizeSortRules(result.sortRules);
					const clonedRule: FilterRule | null = result.filterRule
						? {
							combineMode: result.filterRule.combineMode,
							conditions: result.filterRule.conditions.map((condition) => ({ ...condition }))
						}
						: null;
					if (!clonedRule) {
						resolve();
						return;
					}

					this.stateStore.updateState((state) => {
						const sourceIndex = state.views.findIndex((view) => view.id === viewId);
						if (sourceIndex === -1) {
							return;
						}
						const duplicatedView: FilterViewDefinition = {
							id: this.generateFilterViewId(),
							name: result.name,
							filterRule: clonedRule,
							sortRules: sanitizedSortRules,
							columnState: sourceColumnState,
							quickFilter: sourceQuickFilter,
						icon: sanitizeIconId(result.icon)
						};
						state.views.splice(sourceIndex + 1, 0, duplicatedView);
						state.activeViewId = duplicatedView.id;
						inserted = true;
					});

					if (inserted) {
						this.runStateEffects({ persist: true, apply: true });
						new Notice(t('filterViewController.duplicateNotice', { name: result.name }));
					}
					resolve();
				},
				onCancel: () => resolve()
			});
			modal.open();
		});
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
		if (this.tagGroupSupport) {
			this.tagGroupSupport.onFilterViewRemoved(viewId);
		}
		this.runStateEffects({ persist: true, apply: true });
	}

	private saveFilterView(result: FilterViewEditorResult): void {
		if (!result.filterRule) {
			return;
		}
		const sanitizedSortRules = this.stateStore.sanitizeSortRules(result.sortRules);
		const newView: FilterViewDefinition = {
			id: this.generateFilterViewId(),
			name: result.name,
			filterRule: result.filterRule,
			sortRules: sanitizedSortRules,
			columnState: null,
			quickFilter: null,
			icon: sanitizeIconId(result.icon)
		};
		this.stateStore.updateState((state) => {
			state.views.push(newView);
			state.activeViewId = newView.id;
		});
		this.tagGroupSupport?.onFilterViewCreated?.(newView);
		this.runStateEffects({ persist: true, apply: true });
	}

	openDefaultViewMenu(anchor: HTMLElement, event?: MouseEvent): void {
		showDefaultViewMenu({
			app: this.app,
			stateStore: this.stateStore,
			anchor,
			event,
			onEdit: async () => {
				await this.editDefaultView();
			},
			onReset: async () => {
				if (clearDefaultViewPreferences(this.stateStore)) {
					this.runStateEffects({ persist: true, apply: false });
				}
			}
		});
	}

	async editDefaultView(): Promise<void> {
		const changed = await promptEditDefaultView(this.app, this.stateStore);
		if (changed) {
			this.runStateEffects({ persist: true, apply: false });
		}
	}

	private runStateEffects(options: StateChangeOptions): void {
		this.syncState();
		this.tagGroupSupport?.onFilterViewsUpdated?.();
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

	ensureFilterViewsForFieldValues(field: string, values: string[]): FilterViewDefinition[] {
		const { resolved, stateChanged } = autoEnsureFilterViews({
			stateStore: this.stateStore,
			field,
			values,
			generateId: () => this.generateFilterViewId()
		});
		this.runStateEffects({ persist: stateChanged, apply: false });
		return resolved;
	}

	private generateFilterViewId(): string {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
		return `fv-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
	}
}
