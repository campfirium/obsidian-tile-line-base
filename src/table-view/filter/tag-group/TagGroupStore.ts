import { getPluginContext } from '../../../pluginContext';
import type { FileFilterViewState, FilterViewDefinition } from '../../../types/filterView';
import type { FileTagGroupState, TagGroupDefinition } from '../../../types/tagGroup';

export const DEFAULT_TAG_GROUP_ID = '__tlb_tag_group_default__';

export class TagGroupStore {
	private state: FileTagGroupState = this.createEmptyState();
	private filePath: string | null;
	private fallbackDefaultName = 'Default';

	constructor(filePath: string | null) {
		this.filePath = filePath;
	}

	setFilePath(filePath: string | null): void {
		this.filePath = filePath;
	}

	setDefaultGroupLabel(label: string): void {
		if (label.trim().length === 0) {
			return;
		}
		this.fallbackDefaultName = label;
		const group = this.getDefaultGroup();
		if (group && (!group.name || group.name.trim().length === 0 || group.name === DEFAULT_TAG_GROUP_ID)) {
			group.name = label;
		}
	}

	getDefaultGroupId(): string {
		return DEFAULT_TAG_GROUP_ID;
	}

	getState(): FileTagGroupState {
		return this.state;
	}

	setState(next: FileTagGroupState | null | undefined): void {
		this.state = this.cloneState(next);
	}

	loadFromSettings(): FileTagGroupState {
		const plugin = getPluginContext();
		if (!plugin || !this.filePath || typeof plugin.getTagGroupsForFile !== 'function') {
			this.resetState();
			return this.state;
		}

		const stored = plugin.getTagGroupsForFile(this.filePath);
		this.state = this.cloneState(stored);
		return this.state;
	}

	async persist(): Promise<void> {
		if (!this.filePath) {
			return;
		}
		const plugin = getPluginContext();
		if (!plugin || typeof plugin.saveTagGroupsForFile !== 'function') {
			return;
		}
		await plugin.saveTagGroupsForFile(this.filePath, this.state);
	}

	updateState(updater: (state: FileTagGroupState) => void): void {
		updater(this.state);
		this.state = this.cloneState(this.state);
	}

	setActiveGroup(groupId: string | null): void {
		this.updateState((state) => {
			state.activeGroupId = groupId;
		});
	}

	getActiveGroup(): TagGroupDefinition | null {
		const id = this.state.activeGroupId;
		if (!id) {
			return this.getDefaultGroup();
		}
		return this.state.groups.find((group) => group.id === id) ?? this.getDefaultGroup();
	}

	removeViewFromGroups(viewId: string): boolean {
		let changed = false;
		this.updateState((state) => {
			for (const group of state.groups) {
				if (group.id === DEFAULT_TAG_GROUP_ID) {
					continue;
				}
				const before = group.viewIds.length;
				group.viewIds = group.viewIds.filter((id) => id !== viewId);
				if (group.viewIds.length !== before) {
					changed = true;
				}
			}
		});
		return changed;
	}

	getVisibleViewIds(): Set<string> | null {
		const active = this.getActiveGroup();
		if (!active || active.id === DEFAULT_TAG_GROUP_ID) {
			return null;
		}
		return new Set<string>(active.viewIds);
	}

	syncWithFilterViews(filterState: FileFilterViewState, defaultGroupName: string): void {
		this.setDefaultGroupLabel(defaultGroupName);
		const views = Array.isArray(filterState.views) ? filterState.views : [];
		const orderedIds = this.collectViewIds(views);
		const idSet = new Set<string>(orderedIds);

		this.updateState((state) => {
			const defaultGroup = this.ensureDefaultGroup(state, defaultGroupName);
			defaultGroup.viewIds = [...orderedIds];
			defaultGroup.name = this.resolveGroupName(defaultGroup.name, defaultGroupName);

			const filteredGroups: TagGroupDefinition[] = [];
			for (const group of state.groups) {
				if (group.id === DEFAULT_TAG_GROUP_ID) {
					filteredGroups.push(defaultGroup);
					continue;
				}
				const nextIds = group.viewIds.filter((id) => idSet.has(id));
				filteredGroups.push({
					id: group.id,
					name: this.resolveGroupName(group.name, group.id),
					viewIds: nextIds
				});
			}

			state.groups = this.normalizeGroupOrder(filteredGroups);

			if (!state.activeGroupId || !state.groups.some((group) => group.id === state.activeGroupId)) {
				state.activeGroupId = DEFAULT_TAG_GROUP_ID;
			}
		});
	}

	private normalizeGroupOrder(groups: TagGroupDefinition[]): TagGroupDefinition[] {
		const defaultGroup = groups.find((group) => group.id === DEFAULT_TAG_GROUP_ID);
		const others = groups.filter((group) => group.id !== DEFAULT_TAG_GROUP_ID);
		return defaultGroup ? [defaultGroup, ...others] : others;
	}

	private resolveGroupName(name: string | undefined, fallback: string): string {
		const trimmed = (name ?? '').trim();
		if (trimmed.length > 0) {
			return trimmed;
		}
		const fallbackTrimmed = fallback.trim();
		return fallbackTrimmed.length > 0 ? fallbackTrimmed : this.fallbackDefaultName;
	}

	private collectViewIds(views: FilterViewDefinition[]): string[] {
		const ids: string[] = [];
		const seen = new Set<string>();
		for (const view of views) {
			if (typeof view?.id === 'string' && view.id.trim().length > 0) {
				const trimmed = view.id.trim();
				if (seen.has(trimmed)) {
					continue;
				}
				seen.add(trimmed);
				ids.push(trimmed);
			}
		}
		return ids;
	}

	private ensureDefaultGroup(state: FileTagGroupState, name: string): TagGroupDefinition {
		let group = state.groups.find((entry) => entry.id === DEFAULT_TAG_GROUP_ID);
		if (!group) {
			group = {
				id: DEFAULT_TAG_GROUP_ID,
				name: this.resolveGroupName(name, this.fallbackDefaultName),
				viewIds: []
			};
			state.groups.unshift(group);
		}
		return group;
	}

	getDefaultGroup(): TagGroupDefinition {
		const existing = this.state.groups.find((group) => group.id === DEFAULT_TAG_GROUP_ID);
		if (existing) {
			return existing;
		}
		const group: TagGroupDefinition = {
			id: DEFAULT_TAG_GROUP_ID,
			name: this.fallbackDefaultName,
			viewIds: []
		};
		this.state.groups.unshift(group);
		this.state.activeGroupId = DEFAULT_TAG_GROUP_ID;
		return group;
	}

	private cloneState(source: FileTagGroupState | null | undefined): FileTagGroupState {
		const groups: TagGroupDefinition[] = [];
		const seenGroupIds = new Set<string>();

		if (source?.groups) {
			for (const candidate of source.groups) {
				const cloned = this.cloneGroup(candidate);
				if (!cloned || seenGroupIds.has(cloned.id)) {
					continue;
				}
				seenGroupIds.add(cloned.id);
				groups.push(cloned);
			}
		}

		const defaultGroup = groups.find((group) => group.id === DEFAULT_TAG_GROUP_ID);
		if (!defaultGroup) {
			groups.unshift({
				id: DEFAULT_TAG_GROUP_ID,
				name: this.fallbackDefaultName,
				viewIds: []
			});
		}

		const activeGroupId = groups.some((group) => group.id === source?.activeGroupId)
			? source?.activeGroupId ?? DEFAULT_TAG_GROUP_ID
			: DEFAULT_TAG_GROUP_ID;

		return {
			activeGroupId,
			groups: this.normalizeGroupOrder(groups)
		};
	}

	private cloneGroup(source: TagGroupDefinition | null | undefined): TagGroupDefinition | null {
		if (!source) {
			return null;
		}
		const id = typeof source.id === 'string' ? source.id.trim() : '';
		if (!id) {
			return null;
		}
		const name = typeof source.name === 'string' ? source.name.trim() : '';
		const viewIds: string[] = [];
		const seenViewIds = new Set<string>();

		if (Array.isArray(source.viewIds)) {
			for (const raw of source.viewIds) {
				if (typeof raw !== 'string') {
					continue;
				}
				const trimmed = raw.trim();
				if (!trimmed || seenViewIds.has(trimmed)) {
					continue;
				}
				seenViewIds.add(trimmed);
				viewIds.push(trimmed);
			}
		}

		return {
			id,
			name: name.length > 0 ? name : id,
			viewIds
		};
	}

	resetState(): void {
		this.state = this.createEmptyState();
	}

	private createEmptyState(): FileTagGroupState {
		return {
			activeGroupId: DEFAULT_TAG_GROUP_ID,
			groups: [
				{
					id: DEFAULT_TAG_GROUP_ID,
					name: this.fallbackDefaultName,
					viewIds: []
				}
			]
		};
	}
}
