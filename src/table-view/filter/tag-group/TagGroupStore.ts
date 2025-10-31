import { getPluginContext } from '../../../pluginContext';
import type { FileFilterViewState, FilterViewDefinition } from '../../../types/filterView';
import type { FileTagGroupState, TagGroupDefinition } from '../../../types/tagGroup';

export const DEFAULT_TAG_GROUP_ID = '__tlb_tag_group_default__';
export const STATUS_TAG_GROUP_ID = '__tlb_tag_group_status__';
const PROTECTED_GROUP_IDS = new Set<string>([DEFAULT_TAG_GROUP_ID, STATUS_TAG_GROUP_ID]);

export class TagGroupStore {
	private state: FileTagGroupState = this.createEmptyState();
	private filePath: string | null;
	private fallbackDefaultName = 'Default';
	private fallbackStatusName = 'Status';

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

	setStatusGroupLabel(label: string): void {
		if (label.trim().length === 0) {
			return;
		}
		this.fallbackStatusName = label;
		const group = this.getStatusGroup();
		if (group && (!group.name || group.name.trim().length === 0 || group.name === STATUS_TAG_GROUP_ID)) {
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

	applyStatusGroup(viewIds: string[], label: string): void {
		const normalizedLabel = this.resolveGroupName(label, this.fallbackStatusName);
		const uniqueIds = Array.from(
			new Set(
				viewIds
					.map((id) => (typeof id === 'string' ? id.trim() : ''))
					.filter((id): id is string => id.length > 0)
			)
		);

		this.updateState((state) => {
			let group = state.groups.find((entry) => entry.id === STATUS_TAG_GROUP_ID);
			if (!group) {
				group = {
					id: STATUS_TAG_GROUP_ID,
					name: normalizedLabel,
					viewIds: uniqueIds
				};
				const defaultIndex = state.groups.findIndex((entry) => entry.id === DEFAULT_TAG_GROUP_ID);
				const insertIndex = defaultIndex === -1 ? 0 : defaultIndex + 1;
				state.groups.splice(insertIndex, 0, group);
			} else {
				if (!group.name || group.name.trim().length === 0 || group.name === STATUS_TAG_GROUP_ID) {
					group.name = normalizedLabel;
				}
				group.viewIds = uniqueIds;
			}
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
				if (PROTECTED_GROUP_IDS.has(group.id)) {
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

	removeGroup(groupId: string): void {
		if (!groupId || PROTECTED_GROUP_IDS.has(groupId)) {
			return;
		}
		this.updateState((state) => {
			state.groups = state.groups.filter((group) => group.id !== groupId);
			if (state.activeGroupId === groupId) {
				state.activeGroupId = DEFAULT_TAG_GROUP_ID;
			}
		});
	}

	getVisibleViewIds(): Set<string> | null {
		const active = this.getActiveGroup();
		if (!active) {
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
			defaultGroup.name = this.resolveGroupName(defaultGroup.name, defaultGroupName);

			this.ensureStatusGroup(state, this.fallbackStatusName);

			const assignedIds = new Set<string>();
			const normalizedGroups: TagGroupDefinition[] = [];
			for (const group of state.groups) {
				if (group.id === DEFAULT_TAG_GROUP_ID) {
					continue;
				}
				const nextIds = group.viewIds.filter((id) => idSet.has(id));
				for (const viewId of nextIds) {
					assignedIds.add(viewId);
				}
				normalizedGroups.push({
					id: group.id,
					name: this.resolveGroupName(group.name, group.id),
					viewIds: nextIds
				});
			}

			defaultGroup.viewIds = orderedIds.filter((id) => !assignedIds.has(id));

			state.groups = this.normalizeGroupOrder([defaultGroup, ...normalizedGroups]);

			if (!state.activeGroupId || !state.groups.some((group) => group.id === state.activeGroupId)) {
				state.activeGroupId = DEFAULT_TAG_GROUP_ID;
			}
		});
	}

	private normalizeGroupOrder(groups: TagGroupDefinition[]): TagGroupDefinition[] {
		const defaultGroup = groups.find((group) => group.id === DEFAULT_TAG_GROUP_ID);
		const statusGroup = groups.find((group) => group.id === STATUS_TAG_GROUP_ID);
		const others = groups.filter((group) => group.id !== DEFAULT_TAG_GROUP_ID && group.id !== STATUS_TAG_GROUP_ID);
		const ordered: TagGroupDefinition[] = [];
		if (defaultGroup) {
			ordered.push(defaultGroup);
		}
		if (statusGroup) {
			ordered.push(statusGroup);
		}
		ordered.push(...others);
		return ordered;
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

	private ensureStatusGroup(state: FileTagGroupState, name: string): TagGroupDefinition {
		let group = state.groups.find((entry) => entry.id === STATUS_TAG_GROUP_ID);
		if (!group) {
			group = {
				id: STATUS_TAG_GROUP_ID,
				name: this.resolveGroupName(name, this.fallbackStatusName),
				viewIds: []
			};
			const defaultIndex = state.groups.findIndex((entry) => entry.id === DEFAULT_TAG_GROUP_ID);
			const insertIndex = defaultIndex === -1 ? 0 : defaultIndex + 1;
			state.groups.splice(insertIndex, 0, group);
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
		this.ensureStatusGroup(this.state, this.fallbackStatusName);
		return group;
	}

	private getStatusGroup(): TagGroupDefinition | null {
		return this.state.groups.find((group) => group.id === STATUS_TAG_GROUP_ID) ?? null;
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

		this.injectSystemGroups(groups);

		const activeGroupId = groups.some((group) => group.id === source?.activeGroupId)
			? source?.activeGroupId ?? DEFAULT_TAG_GROUP_ID
			: DEFAULT_TAG_GROUP_ID;

		return {
			activeGroupId,
			groups: this.normalizeGroupOrder(groups)
		};
	}

	private injectSystemGroups(groups: TagGroupDefinition[]): void {
		const hasDefault = groups.some((group) => group.id === DEFAULT_TAG_GROUP_ID);
		if (!hasDefault) {
			const defaultGroup: TagGroupDefinition = {
				id: DEFAULT_TAG_GROUP_ID,
				name: this.fallbackDefaultName,
				viewIds: []
			};
			groups.unshift(defaultGroup);
		}

		const hasStatus = groups.some((group) => group.id === STATUS_TAG_GROUP_ID);
		if (!hasStatus) {
			const statusGroup: TagGroupDefinition = {
				id: STATUS_TAG_GROUP_ID,
				name: this.fallbackStatusName,
				viewIds: []
			};
			const defaultIndex = groups.findIndex((group) => group.id === DEFAULT_TAG_GROUP_ID);
			const insertIndex = defaultIndex === -1 ? 0 : defaultIndex + 1;
			groups.splice(insertIndex, 0, statusGroup);
		}
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

		let resolvedName: string;
		if (name.length > 0) {
			resolvedName = name;
		} else if (id === DEFAULT_TAG_GROUP_ID) {
			resolvedName = this.fallbackDefaultName;
		} else if (id === STATUS_TAG_GROUP_ID) {
			resolvedName = this.fallbackStatusName;
		} else {
			resolvedName = id;
		}

		return {
			id,
			name: resolvedName,
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
				},
				{
					id: STATUS_TAG_GROUP_ID,
					name: this.fallbackStatusName,
					viewIds: []
				}
			]
		};
	}

}
