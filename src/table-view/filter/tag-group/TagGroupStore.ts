import { getPluginContext } from '../../../pluginContext';
import type { FileFilterViewState, FilterViewDefinition } from '../../../types/filterView';
import type { FileTagGroupMetadata, FileTagGroupState, TagGroupDefinition } from '../../../types/tagGroup';
import { STATUS_BASELINE_VALUES } from '../statusDefaults';

export const DEFAULT_TAG_GROUP_ID = '__tlb_tag_group_default__';
export const STATUS_TAG_GROUP_ID = '__tlb_tag_group_status__';
const PROTECTED_GROUP_IDS = new Set<string>([DEFAULT_TAG_GROUP_ID]);

type TagGroupScope = 'table' | 'gallery';

export class TagGroupStore {
	private state: FileTagGroupState = this.createEmptyState();
	private filePath: string | null;
	private fallbackDefaultName = 'Default';
	private readonly scope: TagGroupScope;

	constructor(filePath: string | null, scope: TagGroupScope = 'table') {
		this.filePath = filePath;
		this.scope = scope;
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

	loadFromSettings = (): FileTagGroupState => {
		const plugin = getPluginContext();
		if (!plugin || !this.filePath) {
			this.resetState();
			return this.state;
		}

		const stored = this.scope === 'gallery'
			? (typeof (plugin as any).getGalleryTagGroupsForFile === 'function'
				? (plugin as any).getGalleryTagGroupsForFile(this.filePath)
				: null)
			: (typeof plugin.getTagGroupsForFile === 'function'
				? plugin.getTagGroupsForFile(this.filePath)
				: null);
		if (!stored) {
			this.resetState();
			return this.state;
		}

		this.state = this.cloneState(stored);
		return this.state;
	};

	persist = async (): Promise<void> => {
		if (!this.filePath) {
			return;
		}
		const plugin = getPluginContext();
		if (!plugin) {
			return;
		}
		if (this.scope === 'gallery') {
			const saver = (plugin as any).saveGalleryTagGroupsForFile;
			if (typeof saver !== 'function') {
				return;
			}
			await saver.call(plugin, this.filePath, this.state);
			return;
		}
		if (typeof plugin.saveTagGroupsForFile !== 'function') {
			return;
		}
		await plugin.saveTagGroupsForFile(this.filePath, this.state);
	};

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
		const idSet = new Set<string>(this.collectViewIds(views));

		this.updateState((state) => {
			const metadata = this.ensureMetadata(state);
			const defaultGroup = this.ensureDefaultGroup(state, defaultGroupName);
			defaultGroup.name = this.resolveGroupName(defaultGroup.name, defaultGroupName);

			const normalizedGroups: TagGroupDefinition[] = [];
			for (const group of [...state.groups]) {
				if (group.id === DEFAULT_TAG_GROUP_ID || group.id === STATUS_TAG_GROUP_ID) {
					continue;
				}
				const sanitizedIds = this.normalizeViewIds(group.viewIds, idSet);
				normalizedGroups.push({
					id: group.id,
					name: this.resolveGroupName(group.name, group.id),
					viewIds: sanitizedIds
				});
			}

			let defaultIds = this.normalizeViewIds(defaultGroup.viewIds, idSet);
			if (!metadata.defaultSeeded && defaultIds.length > 0) {
				metadata.defaultSeeded = true;
			}
			if (!metadata.defaultSeeded) {
				defaultIds = this.seedDefaultGroupViewIds(defaultIds, filterState, idSet, metadata);
			}

			defaultGroup.viewIds = defaultIds;

			state.groups = this.normalizeGroupOrder([defaultGroup, ...normalizedGroups]);

			if (!state.activeGroupId || !state.groups.some((group) => group.id === state.activeGroupId)) {
				state.activeGroupId = DEFAULT_TAG_GROUP_ID;
			}
		});
	}

	private normalizeGroupOrder(groups: TagGroupDefinition[]): TagGroupDefinition[] {
		const defaultGroup = groups.find((group) => group.id === DEFAULT_TAG_GROUP_ID);
		const others = groups.filter((group) => group.id !== DEFAULT_TAG_GROUP_ID && group.id !== STATUS_TAG_GROUP_ID);
		const ordered: TagGroupDefinition[] = [];
		if (defaultGroup) {
			ordered.push(defaultGroup);
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

	private normalizeViewIds(source: string[] | null | undefined, validIds: Set<string>): string[] {
		const normalized: string[] = [];
		const seen = new Set<string>();
		if (!Array.isArray(source)) {
			return normalized;
		}
		for (const raw of source) {
			if (typeof raw !== 'string') {
				continue;
			}
			const trimmed = raw.trim();
			if (!trimmed || seen.has(trimmed) || !validIds.has(trimmed)) {
				continue;
			}
			seen.add(trimmed);
			normalized.push(trimmed);
		}
		return normalized;
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
		this.ensureMetadata(this.state);
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

		this.injectSystemGroups(groups);

		const activeGroupId = groups.some((group) => group.id === source?.activeGroupId)
			? source?.activeGroupId ?? DEFAULT_TAG_GROUP_ID
			: DEFAULT_TAG_GROUP_ID;

		const metadata = this.cloneMetadata(source?.metadata);

		return {
			activeGroupId,
			groups: this.normalizeGroupOrder(groups),
			metadata
		};
	}

	private cloneMetadata(source: FileTagGroupMetadata | null | undefined): FileTagGroupMetadata {
		const metadata: FileTagGroupMetadata = {};
		if (source?.defaultSeeded) {
			metadata.defaultSeeded = true;
		}
		return metadata;
	}

	private ensureMetadata(state: FileTagGroupState): FileTagGroupMetadata {
		if (!state.metadata) {
			state.metadata = {};
		}
		return state.metadata;
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

	}

	private cloneGroup(source: TagGroupDefinition | null | undefined): TagGroupDefinition | null {
		if (!source) {
			return null;
		}
		const id = typeof source.id === 'string' ? source.id.trim() : '';
		if (!id) {
			return null;
		}
		if (id === STATUS_TAG_GROUP_ID) {
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
				}
			],
			metadata: {}
		};
	}

	private seedDefaultGroupViewIds(
		current: string[],
		filterState: FileFilterViewState,
		idSet: Set<string>,
		metadata: FileTagGroupMetadata
	): string[] {
		const baselineIds = this.collectStatusBaselineViewIds(filterState, idSet);
		if (baselineIds.length === 0) {
			return current;
		}
		const seen = new Set<string>();
		const seeded: string[] = [];
		for (const id of baselineIds) {
			if (!seen.has(id) && idSet.has(id)) {
				seen.add(id);
				seeded.push(id);
			}
		}
		for (const id of current) {
			if (!seen.has(id) && idSet.has(id)) {
				seen.add(id);
				seeded.push(id);
			}
		}
		if (seeded.length > 0) {
			metadata.defaultSeeded = true;
		}
		return seeded;
	}

	private collectStatusBaselineViewIds(filterState: FileFilterViewState, idSet: Set<string>): string[] {
		const result: string[] = [];
		const seen = new Set<string>();
		const views = Array.isArray(filterState.views) ? filterState.views : [];
		for (const value of STATUS_BASELINE_VALUES) {
			const match = views.find((view) => this.matchesFieldEqualsFilter(view, 'status', value));
			const id = match && typeof match.id === 'string' ? match.id.trim() : '';
			if (!id || seen.has(id) || !idSet.has(id)) {
				continue;
			}
			seen.add(id);
			result.push(id);
		}
		return result;
	}

	private matchesFieldEqualsFilter(view: FilterViewDefinition, field: string, value: string): boolean {
		if (!view?.filterRule || view.filterRule.combineMode !== 'AND') {
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
		const rawValue =
			typeof condition.value === 'string'
				? condition.value.trim().toLowerCase()
				: String(condition.value ?? '').trim().toLowerCase();
		if (!rawValue) {
			return false;
		}
		return rawValue === value.trim().toLowerCase();
	}

}
