import { App, Menu, Notice } from 'obsidian';
import type { FilterViewDefinition, FileFilterViewState } from '../../../types/filterView';
import type { TagGroupDefinition } from '../../../types/tagGroup';
import { t } from '../../../i18n';
import { openFilterViewNameModal } from '../FilterViewModals';
import type { TagGroupStore } from './TagGroupStore';

interface TagGroupControllerOptions {
	app: App;
	store: TagGroupStore;
	getFilterViewState: () => FileFilterViewState;
	activateFilterView: (viewId: string | null) => void;
	renderBar: () => void;
	persist: () => Promise<void> | void;
}

export class TagGroupController {
	private readonly app: App;
	private readonly store: TagGroupStore;
	private readonly getFilterViewState: () => FileFilterViewState;
	private readonly activateFilterView: (viewId: string | null) => void;
	private readonly renderBar: () => void;
	private readonly persist: () => Promise<void> | void;
	private readonly defaultGroupId: string;

	constructor(options: TagGroupControllerOptions) {
		this.app = options.app;
		this.store = options.store;
		this.getFilterViewState = options.getFilterViewState;
		this.activateFilterView = options.activateFilterView;
		this.renderBar = options.renderBar;
		this.persist = options.persist;
		this.defaultGroupId = this.store.getDefaultGroupId();
	}

	syncWithAvailableViews(): void {
		this.store.syncWithFilterViews(this.getFilterViewState(), t('tagGroups.defaultGroupName'));
	}

	openTagGroupMenu(anchorEl: HTMLElement): void {
		this.syncWithAvailableViews();
		const filterState = this.getFilterViewState();
		const state = this.store.getState();
		const menu = new Menu();
		const doc = anchorEl.ownerDocument ?? document;

		for (const group of state.groups) {
			menu.addItem((menuItem) => {
				const isActive = group.id === state.activeGroupId || (!state.activeGroupId && group.id === this.defaultGroupId);
				menuItem.setChecked(isActive);
				menuItem.setIcon(group.id === this.defaultGroupId ? 'layers' : 'bookmark');
				menuItem.setTitle(this.buildGroupMenuContent(group, filterState));
				menuItem.onClick(() => {
					this.activateGroup(group);
				});

				const rowEl = (menuItem as unknown as { dom?: HTMLElement }).dom;
				if (rowEl) {
					rowEl.addEventListener('contextmenu', (event: MouseEvent) => {
						event.preventDefault();
						event.stopPropagation();
						menu.hide();
						void this.promptRenameGroup(group);
					});
					rowEl.classList.add('tlb-tag-group-menu-row');
					rowEl.classList.toggle('is-active', isActive);
				}
			});
		}

		menu.addSeparator();
		menu.addItem((item) => {
			item
				.setTitle(t('tagGroups.menuCreate'))
				.setIcon('plus-circle')
				.onClick(() => {
					this.createGroup({ activate: false, showNotice: true });
				});
		});

		const rect = anchorEl.getBoundingClientRect();
		menu.showAtPosition(
			{
				x: rect.left,
				y: rect.bottom
			},
			doc
		);
	}

	private buildGroupMenuContent(group: TagGroupDefinition, filterState: FileFilterViewState): DocumentFragment {
		const fragment = document.createDocumentFragment();
		const container = document.createElement('div');
		container.className = 'tlb-tag-group-menu-item';

		const titleEl = document.createElement('div');
		titleEl.className = 'tlb-tag-group-menu-item__name';
		titleEl.textContent = this.getGroupDisplayName(group);
		container.appendChild(titleEl);

		const tagsEl = document.createElement('div');
		tagsEl.className = 'tlb-tag-group-menu-item__tags';
		container.appendChild(tagsEl);

		this.appendTag(tagsEl, t('filterViewBar.allTabLabel'));

		const viewNames = this.getGroupViewNames(group, filterState);
		if (viewNames.length === 0) {
			const emptyEl = document.createElement('span');
			emptyEl.className = 'tlb-tag-group-menu-item__empty';
			emptyEl.textContent = t('tagGroups.emptyGroupLabel');
			tagsEl.appendChild(emptyEl);
		} else {
			for (const name of viewNames) {
				this.appendTag(tagsEl, name);
			}
		}

		fragment.appendChild(container);
		return fragment;
	}

	private appendTag(container: HTMLElement, label: string): void {
		const tagEl = document.createElement('span');
		tagEl.className = 'tlb-tag-group-menu-item__tag';
		tagEl.textContent = label;
		container.appendChild(tagEl);
	}

	private getGroupDisplayName(group: TagGroupDefinition): string {
		if (group.id === this.defaultGroupId) {
			const name = group.name?.trim();
			return name && name.length > 0 ? name : t('tagGroups.defaultGroupName');
		}
		return this.getGroupFallbackName(group);
	}

	private getGroupViewNames(group: TagGroupDefinition, filterState: FileFilterViewState): string[] {
		const result: string[] = [];
		const matchedIds = new Set<string>();

		if (group.id === this.defaultGroupId) {
			for (const view of filterState.views) {
				const label = this.getFilterViewLabel(view);
				if (label) {
					result.push(label);
				}
			}
			return result;
		}

		const desiredOrder = Array.isArray(group.viewIds) ? group.viewIds : [];
		const lookup = new Map<string, string>();
		for (const view of filterState.views) {
			if (!view || typeof view.id !== 'string') {
				continue;
			}
			const id = view.id.trim();
			if (!id) {
				continue;
			}
			const label = this.getFilterViewLabel(view);
			if (label) {
				lookup.set(id, label);
			}
		}

		for (const id of desiredOrder) {
			const trimmed = typeof id === 'string' ? id.trim() : '';
			if (!trimmed || matchedIds.has(trimmed)) {
				continue;
			}
			const label = lookup.get(trimmed) ?? trimmed;
			result.push(label);
			matchedIds.add(trimmed);
		}

		return result;
	}

	private getFilterViewLabel(view: FilterViewDefinition): string | null {
		const name = typeof view.name === 'string' ? view.name.trim() : '';
		if (name.length > 0) {
			return name;
		}
		const id = typeof view.id === 'string' ? view.id.trim() : '';
		return id.length > 0 ? id : null;
	}

	openAddToGroupMenu(view: FilterViewDefinition, event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();

		this.syncWithAvailableViews();
		const menu = new Menu();
		const state = this.store.getState();
		const groups = state.groups.filter((group) => group.id !== this.defaultGroupId);

		if (groups.length === 0) {
			menu.addItem((item) => {
				item
					.setTitle(t('tagGroups.menuCreateAndAdd'))
					.setIcon('plus-circle')
					.onClick(() => {
						const group = this.createGroup({ activate: false, showNotice: false });
						if (group) {
							this.addViewToGroup(group, view);
						}
					});
			});
		} else {
			for (const group of groups) {
				menu.addItem((item) => {
					const hasView = group.viewIds.includes(view.id);
					item
						.setTitle(group.name || this.getGroupFallbackName(group))
						.setIcon(hasView ? 'check' : 'bookmark-plus')
						.setDisabled(hasView)
						.onClick(() => {
							this.addViewToGroup(group, view);
						});
				});
			}

			menu.addSeparator();
			menu.addItem((item) => {
				item
					.setTitle(t('tagGroups.menuCreateAndAdd'))
					.setIcon('plus-circle')
					.onClick(() => {
						const group = this.createGroup({ activate: false, showNotice: false });
						if (group) {
							this.addViewToGroup(group, view);
						}
					});
			});
		}

		menu.showAtPosition({ x: event.pageX, y: event.pageY });
	}

	handleFilterViewRemoval(viewId: string): void {
		this.store.removeViewFromGroups(viewId);
		this.syncWithAvailableViews();
		this.normalizeActiveGroupAfterChange();
		void this.persistAndRender();
	}

	private activateGroup(group: TagGroupDefinition): void {
		this.store.setActiveGroup(group.id);
		this.ensureVisibleFilterSelection();
		void this.persistAndRender();
	}

	private async promptRenameGroup(group: TagGroupDefinition): Promise<void> {
		const modalResult = await this.openRenameModal(group);
		if (!modalResult) {
			return;
		}

		this.store.updateState((state) => {
			const target = state.groups.find((entry) => entry.id === group.id);
			if (target) {
				target.name = modalResult;
			}
		});
		await this.persistAndRender();
	}

	private async openRenameModal(group: TagGroupDefinition): Promise<string | null> {
		return openFilterViewNameModal(this.app, {
			title: t('tagGroups.renameModalTitle'),
			placeholder: t('tagGroups.renamePlaceholder'),
			defaultValue: group.name || this.getGroupFallbackName(group)
		});
	}

	private createGroup(options: { activate: boolean; showNotice: boolean }): TagGroupDefinition | null {
		const name = this.getNewGroupName();
		let groupId: string | null = null;
		const candidate: TagGroupDefinition = {
			id: this.generateGroupId(),
			name,
			viewIds: []
		};
		this.store.updateState((state) => {
			state.groups.push(candidate);
			if (options.activate) {
				state.activeGroupId = candidate.id;
			}
			groupId = candidate.id;
		});

		if (!groupId) {
			return null;
		}
		const ensuredGroup = this.store.getState().groups.find((entry) => entry.id === groupId) ?? candidate;
		if (options.activate) {
			this.ensureVisibleFilterSelection();
		}
		if (options.showNotice) {
			const displayName = ensuredGroup.name || this.getGroupFallbackName(ensuredGroup);
			new Notice(t('tagGroups.createSuccess', { name: displayName }));
		}

		void this.persistAndRender();
		return ensuredGroup;
	}

	private addViewToGroup(group: TagGroupDefinition, view: FilterViewDefinition): void {
		this.store.updateState((state) => {
			const target = state.groups.find((entry) => entry.id === group.id);
			if (!target) {
				return;
			}
			if (!target.viewIds.includes(view.id)) {
				target.viewIds.push(view.id);
			}
		});
		const displayName = group.name || this.getGroupFallbackName(group);
		new Notice(t('tagGroups.addViewSuccess', { view: view.name, group: displayName }));
		void this.persistAndRender();
	}

	private ensureVisibleFilterSelection(): void {
		const visible = this.store.getVisibleViewIds();
		if (!visible) {
			return;
		}
		const state = this.getFilterViewState();
		const activeId = state.activeViewId;
		if (activeId && visible.has(activeId)) {
			return;
		}
		const fallback = state.views.find((view) => visible.has(view.id));
		this.activateFilterView(fallback ? fallback.id : null);
	}

	private normalizeActiveGroupAfterChange(): void {
		const activeGroup = this.store.getActiveGroup();
		if (!activeGroup) {
			this.store.setActiveGroup(this.defaultGroupId);
			return;
		}
		if (activeGroup.id === this.defaultGroupId) {
			return;
		}
		if (activeGroup.viewIds.length === 0) {
			this.activateFilterView(null);
		}
	}

	private async persistAndRender(): Promise<void> {
		this.syncWithAvailableViews();
		await this.persist();
		this.renderBar();
	}

	private getNewGroupName(): string {
		const existingNames = new Set(
			this.store.getState().groups.map((group) => group.name.trim().toLowerCase())
		);
		let index = 1;
		while (existingNames.has(this.composeDefaultName(index).trim().toLowerCase())) {
			index += 1;
		}
		return this.composeDefaultName(index);
	}

	private composeDefaultName(index: number): string {
		return t('tagGroups.defaultName', { index: String(index) });
	}

	private getGroupFallbackName(group: TagGroupDefinition): string {
		return group.name && group.name.trim().length > 0 ? group.name : t('tagGroups.unnamedGroup');
	}

	private generateGroupId(): string {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
		return `tg-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
	}
}
