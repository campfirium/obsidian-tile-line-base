import { App, Menu, Notice } from 'obsidian';
import type { FilterViewDefinition, FilterRule, SortRule } from '../../types/filterView';
import { FilterViewEditorModal, openFilterViewNameModal } from './FilterViewModals';
import { FilterStateStore } from './FilterStateStore';
import { t } from '../../i18n';
import { getStatusDisplayLabel } from './statusDefaults';
import type { FilterColumnOption } from '../TableViewFilterPresenter';

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
				initialRule,
				initialSortRules,
				onSubmit: (name, rule, sortRules) => {
					let inserted = false;
					const sanitizedSortRules: SortRule[] = this.stateStore.sanitizeSortRules(sortRules);
					const clonedRule: FilterRule = {
						combineMode: rule.combineMode,
						conditions: rule.conditions.map((condition) => ({ ...condition }))
					};

					this.stateStore.updateState((state) => {
						const sourceIndex = state.views.findIndex((view) => view.id === viewId);
						if (sourceIndex === -1) {
							return;
						}
						const duplicatedView: FilterViewDefinition = {
							id: this.generateFilterViewId(),
							name,
							filterRule: clonedRule,
							sortRules: sanitizedSortRules,
							columnState: sourceColumnState,
							quickFilter: sourceQuickFilter
						};
						state.views.splice(sourceIndex + 1, 0, duplicatedView);
						state.activeViewId = duplicatedView.id;
						inserted = true;
					});

					if (inserted) {
						this.runStateEffects({ persist: true, apply: true });
						new Notice(t('filterViewController.duplicateNotice', { name }));
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
		const trimmedField = field.trim();
		if (!trimmedField) {
			return [];
		}
		const uniqueValues: string[] = [];
		const seen = new Set<string>();
		for (const raw of values) {
			const trimmed = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
			if (!trimmed || seen.has(trimmed)) {
				continue;
			}
			seen.add(trimmed);
			uniqueValues.push(trimmed);
		}
		if (uniqueValues.length === 0) {
			return [];
		}

		const createdIds: string[] = [];
		let stateChanged = false;
		this.stateStore.updateState((state) => {
			const usedNames = new Set(
				state.views
					.map((view) => (typeof view.name === 'string' ? view.name.trim() : ''))
					.filter((name) => name.length > 0)
			);
			for (const value of uniqueValues) {
				const existing = state.views.find((view) => this.matchesFieldEqualsFilter(view, trimmedField, value));
				if (existing) {
					const expectedName = this.computeExpectedAutoName(trimmedField, value);
					if (expectedName) {
						const currentName = typeof existing.name === 'string' ? existing.name.trim() : '';
						if (
							currentName !== expectedName &&
							(!currentName || currentName.toLowerCase() === expectedName.toLowerCase()) &&
							!state.views.some(
								(other) => other.id !== existing.id && (other.name ?? '').trim() === expectedName
							)
						) {
							if (currentName) {
								usedNames.delete(currentName);
							}
							existing.name = expectedName;
							usedNames.add(expectedName.trim());
							stateChanged = true;
						}
					}
					createdIds.push(existing.id);
					continue;
				}
				const name = this.composeAutoViewName(trimmedField, value, usedNames);
				const definition: FilterViewDefinition = {
					id: this.generateFilterViewId(),
					name,
					filterRule: {
						combineMode: 'AND',
						conditions: [
							{
								column: trimmedField,
								operator: 'equals',
								value
							}
						]
					},
					sortRules: [],
					columnState: null,
					quickFilter: null
				};
				state.views.push(definition);
				createdIds.push(definition.id);
				usedNames.add(definition.name.trim());
				stateChanged = true;
			}
		});

		this.runStateEffects({ persist: stateChanged, apply: false });

		const currentState = this.stateStore.getState();
		const resolved: FilterViewDefinition[] = [];
		for (const value of uniqueValues) {
			const match = currentState.views.find((view) => this.matchesFieldEqualsFilter(view, trimmedField, value));
			if (match) {
				resolved.push(match);
			}
		}
		return resolved;
	}

	private matchesFieldEqualsFilter(view: FilterViewDefinition, field: string, value: string): boolean {
		if (!view.filterRule || view.filterRule.combineMode !== 'AND') {
			return false;
		}
		const conditions = Array.isArray(view.filterRule.conditions) ? view.filterRule.conditions : [];
		if (conditions.length !== 1) {
			return false;
		}
		const condition = conditions[0];
		const column = typeof condition.column === 'string' ? condition.column.trim().toLowerCase() : '';
		if (column !== field.trim().toLowerCase()) {
			return false;
		}
		if (condition.operator !== 'equals') {
			return false;
		}
		const ruleValue =
			typeof condition.value === 'string'
				? condition.value.trim()
				: String(condition.value ?? '').trim();
		if (!ruleValue) {
			return false;
		}
		return ruleValue.toLowerCase() === value.trim().toLowerCase();
	}

	private composeAutoViewName(field: string, value: string, usedNames: Set<string>): string {
		let baseName = this.formatFieldValueForLabel(field, value).trim();
		if (!baseName) {
			baseName = t('tagGroups.emptyValueName', { field });
		}
		if (!baseName || baseName.trim().length === 0) {
			baseName = field;
		}
		let candidate = baseName;
		let index = 2;
		while (usedNames.has(candidate.trim())) {
			candidate = `${baseName} (${index})`;
			index += 1;
		}
		return candidate;
	}

	private formatFieldValueForLabel(field: string, value: string): string {
		const normalizedField = field.trim().toLowerCase();
		if (normalizedField === 'status') {
			return getStatusDisplayLabel(value);
		}
		return value;
	}

	private computeExpectedAutoName(field: string, value: string): string | null {
		const normalizedField = field.trim().toLowerCase();
		if (normalizedField === 'status') {
			const label = getStatusDisplayLabel(value).trim();
			return label.length > 0 ? label : null;
		}
		return null;
	}

	private generateFilterViewId(): string {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
		return `fv-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
	}
}
