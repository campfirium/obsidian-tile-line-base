import type { FilterViewDefinition, FileFilterViewState } from '../../../types/filterView';
import { STATUS_BASELINE_VALUES, getStatusDisplayLabel } from '../statusDefaults';

interface StatusBaselineContext {
	filterState: FileFilterViewState;
	getAvailableColumns: () => string[];
	ensureFilterViewsForFieldValues: (field: string, values: string[]) => FilterViewDefinition[];
	getFilterViewState: () => FileFilterViewState;
	isStatusBaselineSeeded: () => boolean;
	markStatusBaselineSeeded: () => void;
}

export function ensureStatusBaseline(context: StatusBaselineContext): FileFilterViewState {
	const baselineField = 'status';
	const baselineValues = Array.from(STATUS_BASELINE_VALUES);
	if (!hasColumn(context.getAvailableColumns(), baselineField)) {
		return context.filterState;
	}

	const needsSeed = baselineValues.some((value) => !hasViewForFieldValue(context.filterState, baselineField, value));
	const needsNormalize = baselineValues.some((value) =>
		requiresViewNameNormalization(context.filterState, baselineField, value)
	);
	if (!needsSeed && !needsNormalize) {
		if (!context.isStatusBaselineSeeded()) {
			context.markStatusBaselineSeeded();
		}
		return context.filterState;
	}

	context.ensureFilterViewsForFieldValues(baselineField, baselineValues);
	context.markStatusBaselineSeeded();
	return context.getFilterViewState();
}

function hasColumn(columns: string[], field: string): boolean {
	const normalized = field.trim().toLowerCase();
	if (!normalized) {
		return false;
	}
	return columns.some((column) => column.trim().toLowerCase() === normalized);
}

function hasViewForFieldValue(state: FileFilterViewState, field: string, value: string): boolean {
	return findViewForFieldValue(state, field, value) !== null;
}

function requiresViewNameNormalization(state: FileFilterViewState, field: string, value: string): boolean {
	const view = findViewForFieldValue(state, field, value);
	if (!view) {
		return false;
	}
	const expected = getExpectedViewName(field, value);
	if (!expected) {
		return false;
	}
	const current = typeof view.name === 'string' ? view.name.trim() : '';
	if (!current) {
		return !hasNameConflict(state, view.id, expected);
	}
	if (current === expected) {
		return false;
	}
	if (current.toLowerCase() === expected.toLowerCase()) {
		return !hasNameConflict(state, view.id, expected);
	}
	return false;
}

function findViewForFieldValue(
	state: FileFilterViewState,
	field: string,
	value: string
): FilterViewDefinition | null {
	for (const view of state.views) {
		if (matchesFieldEqualsFilter(view, field, value)) {
			return view;
		}
	}
	return null;
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
	const normalizedField = field.trim().toLowerCase();
	const column = typeof condition.column === 'string' ? condition.column.trim().toLowerCase() : '';
	if (column !== normalizedField) {
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

function getExpectedViewName(field: string, value: string): string | null {
	if (field.trim().toLowerCase() === 'status') {
		const label = getStatusDisplayLabel(value);
		return label && label.trim().length > 0 ? label.trim() : null;
	}
	return null;
}

function hasNameConflict(state: FileFilterViewState, viewId: string, candidateName: string): boolean {
	const target = candidateName.trim();
	if (!target) {
		return false;
	}
	return state.views.some((view) => view.id !== viewId && (view.name ?? '').trim() === target);
}
