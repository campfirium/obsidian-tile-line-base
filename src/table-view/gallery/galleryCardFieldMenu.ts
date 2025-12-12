import type { FilterRule, FilterViewDefinition } from '../../types/filterView';
import type { TagGroupDefinition } from '../../types/tagGroup';

export interface GalleryCardFieldOption {
	value: string;
	label: string;
}

export interface GalleryCardFieldContext {
	field: string;
	options: GalleryCardFieldOption[];
}

export function resolveGalleryCardFieldContext(options: {
	activeGroup: TagGroupDefinition | null;
	filterViews: FilterViewDefinition[];
}): GalleryCardFieldContext | null {
	const group = options.activeGroup;
	if (!group || !Array.isArray(group.viewIds) || group.viewIds.length === 0) {
		return null;
	}

	const viewIdSet = new Set(group.viewIds);
	const dedupedValues = new Set<string>();
	const resolvedOptions: GalleryCardFieldOption[] = [];
	let field: string | null = null;

	for (const view of options.filterViews) {
		if (!viewIdSet.has(view.id)) {
			continue;
		}
		const condition = extractSingleEqualsCondition(view.filterRule);
		if (!condition) {
			continue;
		}
		if (field && condition.column.toLowerCase() !== field.toLowerCase()) {
			return null;
		}
		field = field ?? condition.column;

		const dedupKey = condition.value.toLowerCase();
		if (dedupedValues.has(dedupKey)) {
			continue;
		}
		dedupedValues.add(dedupKey);

		const label =
			typeof view.name === 'string' && view.name.trim().length > 0 ? view.name.trim() : condition.value;
		resolvedOptions.push({
			value: condition.value,
			label
		});
	}

	if (!field || resolvedOptions.length < 2) {
		return null;
	}

	return {
		field,
		options: resolvedOptions
	};
}

function extractSingleEqualsCondition(rule: FilterRule | null): { column: string; value: string } | null {
	if (!rule || rule.combineMode !== 'AND') {
		return null;
	}
	const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
	if (conditions.length !== 1) {
		return null;
	}
	const condition = conditions[0];
	if (condition.operator !== 'equals') {
		return null;
	}
	const column = typeof condition.column === 'string' ? condition.column.trim() : '';
	const value =
		typeof condition.value === 'string'
			? condition.value.trim()
			: String(condition.value ?? '').trim();
	if (!column || !value) {
		return null;
	}
	return { column, value };
}
