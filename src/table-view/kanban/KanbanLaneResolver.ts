import type { FilterViewDefinition } from '../../types/filterView';
import type { TableView } from '../../TableView';

export interface KanbanLaneSource {
	id: string;
	name: string;
	icon: string | null;
	filterRule: FilterViewDefinition['filterRule'] | null;
	sortRules: FilterViewDefinition['sortRules'];
	quickFilter: string | null;
}

export function resolveKanbanLaneSources(view: TableView): KanbanLaneSource[] {
	const filterState = view.filterViewState;
	const tagGroup = view.tagGroupStore.getActiveGroup();
	if (!filterState || !tagGroup) {
		return [];
	}

	const views = Array.isArray(filterState.views) ? filterState.views : [];
	if (views.length === 0) {
		return [];
	}

	const viewMap = new Map<string, FilterViewDefinition>();
	for (const definition of views) {
		if (!definition || typeof definition.id !== 'string') {
			continue;
		}
		const trimmedId = definition.id.trim();
		if (trimmedId.length === 0 || viewMap.has(trimmedId)) {
			continue;
		}
		viewMap.set(trimmedId, definition);
	}

	const sources: KanbanLaneSource[] = [];
	const seen = new Set<string>();
	for (const rawId of tagGroup.viewIds ?? []) {
		if (typeof rawId !== 'string') {
			continue;
		}
		const trimmedId = rawId.trim();
		if (trimmedId.length === 0 || seen.has(trimmedId)) {
			continue;
		}
		const target = viewMap.get(trimmedId);
		if (!target) {
			continue;
		}
		seen.add(trimmedId);

		const resolvedName =
			typeof target.name === 'string' && target.name.trim().length > 0
				? target.name.trim()
				: trimmedId;

		sources.push({
			id: trimmedId,
			name: resolvedName,
			icon: target.icon ?? null,
			filterRule: target.filterRule ?? null,
			sortRules: Array.isArray(target.sortRules) ? target.sortRules : [],
			quickFilter: target.quickFilter ?? null
		});
	}

	return sources;
}

export function hasKanbanLaneSources(view: TableView): boolean {
	return resolveKanbanLaneSources(view).length > 0;
}
