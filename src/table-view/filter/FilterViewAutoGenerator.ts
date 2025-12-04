import { t } from '../../i18n';
import type { FilterViewDefinition } from '../../types/filterView';
import type { FilterStateStore } from './FilterStateStore';
import { getStatusDisplayLabel } from './statusDefaults';

interface AutoGenerateOptions {
	stateStore: FilterStateStore;
	field: string;
	values: string[];
	generateId: () => string;
}

interface AutoGenerateResult {
	resolved: FilterViewDefinition[];
	stateChanged: boolean;
}

export function ensureFilterViewsForFieldValues(options: AutoGenerateOptions): AutoGenerateResult {
	const trimmedField = options.field.trim();
	if (!trimmedField) {
		return { resolved: [], stateChanged: false };
	}

	const uniqueValues: string[] = [];
	const seen = new Set<string>();
	for (const raw of options.values) {
		const trimmed = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
		if (!trimmed || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		uniqueValues.push(trimmed);
	}
	if (uniqueValues.length === 0) {
		return { resolved: [], stateChanged: false };
	}

	let stateChanged = false;
	options.stateStore.updateState((state) => {
		const usedNames = new Set(
			state.views
				.map((view) => (typeof view.name === 'string' ? view.name.trim() : ''))
				.filter((name) => name.length > 0)
		);
		for (const value of uniqueValues) {
			const existing = state.views.find((view) => matchesFieldEqualsFilter(view, trimmedField, value));
			if (existing) {
				const expectedName = computeExpectedAutoName(trimmedField, value);
				if (expectedName) {
					const currentName = typeof existing.name === 'string' ? existing.name.trim() : '';
					if (
						currentName !== expectedName &&
						(!currentName || currentName.toLowerCase() === expectedName.toLowerCase()) &&
						!state.views.some((other) => other.id !== existing.id && (other.name ?? '').trim() === expectedName)
					) {
						if (currentName) {
							usedNames.delete(currentName);
						}
						existing.name = expectedName;
						usedNames.add(expectedName.trim());
						stateChanged = true;
					}
				}
				continue;
			}
			const name = composeAutoViewName(trimmedField, value, usedNames);
			const definition: FilterViewDefinition = {
				id: options.generateId(),
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
				quickFilter: null,
				icon: null
			};
			state.views.push(definition);
			usedNames.add(definition.name.trim());
			stateChanged = true;
		}
	});

	const currentState = options.stateStore.getState();
	const resolved: FilterViewDefinition[] = [];
	for (const value of uniqueValues) {
		const match = currentState.views.find((view) => matchesFieldEqualsFilter(view, trimmedField, value));
		if (match) {
			resolved.push(match);
		}
	}

	return { resolved, stateChanged };
}

function matchesFieldEqualsFilter(view: FilterViewDefinition, field: string, value: string): boolean {
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

function composeAutoViewName(field: string, value: string, usedNames: Set<string>): string {
	let baseName = formatFieldValueForLabel(field, value).trim();
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

function formatFieldValueForLabel(field: string, value: string): string {
	const normalizedField = field.trim().toLowerCase();
	if (normalizedField === 'status') {
		return getStatusDisplayLabel(value);
	}
	return value;
}

function computeExpectedAutoName(field: string, value: string): string | null {
	const normalizedField = field.trim().toLowerCase();
	if (normalizedField === 'status') {
		const label = getStatusDisplayLabel(value).trim();
		return label.length > 0 ? label : null;
	}
	return null;
}
