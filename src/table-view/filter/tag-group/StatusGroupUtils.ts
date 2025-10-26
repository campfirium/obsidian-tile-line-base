import type { FilterViewDefinition, FileFilterViewState } from '../../../types/filterView';
import { ALL_TASK_STATUSES, normalizeStatus, type TaskStatus } from '../../../renderers/StatusCellRenderer';

export function collectStatusGroupViewIds(filterState: FileFilterViewState): string[] {
	const statusMap = new Map<TaskStatus, string>();
	const views = Array.isArray(filterState.views) ? filterState.views : [];
	for (const view of views) {
		const status = extractStatusFilterValue(view);
		if (!status) {
			continue;
		}
		const id = typeof view.id === 'string' ? view.id.trim() : '';
		if (!id || statusMap.has(status)) {
			continue;
		}
		statusMap.set(status, id);
	}

	const result: string[] = [];
	for (const status of ALL_TASK_STATUSES) {
		const id = statusMap.get(status);
		if (id) {
			result.push(id);
		}
	}
	return result;
}

export function extractStatusFilterValue(view: FilterViewDefinition): TaskStatus | null {
	if (!view?.filterRule || view.filterRule.combineMode !== 'AND') {
		return null;
	}
	const conditions = Array.isArray(view.filterRule.conditions) ? view.filterRule.conditions : [];
	if (conditions.length !== 1) {
		return null;
	}
	const condition = conditions[0];
	if (!condition || condition.column !== 'status' || condition.operator !== 'equals') {
		return null;
	}
	const rawValue = condition.value;
	if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
		return null;
	}
	return normalizeStatus(rawValue);
}
