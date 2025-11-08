import type { FilterRule } from '../../types/filterView';
import { STATUS_BASELINE_VALUES, getStatusDisplayLabel } from '../filter/statusDefaults';

interface StatusLaneOptions {
	laneField: string;
	filterRule: FilterRule | null;
}

interface StatusFilterPreferences {
	allowed: Set<string> | null;
	excluded: Set<string>;
	allowedOriginalValues: string[];
}

export function resolveExpectedStatusLanes(options: StatusLaneOptions): string[] | null {
	if (!isStatusLaneField(options.laneField)) {
		return null;
	}
	const filterPrefs = extractStatusFilterPreferences(options.filterRule, options.laneField);
	const candidates: string[] = [];
	const seen = new Set<string>();
	const pushCandidate = (value: string | null | undefined) => {
		const label = typeof value === 'string' ? value.trim() : '';
		if (!label) {
			return;
		}
		const key = normalizeStatusKey(label);
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		candidates.push(label);
	};
	for (const baseline of STATUS_BASELINE_VALUES) {
		pushCandidate(getStatusDisplayLabel(baseline) ?? baseline);
	}
	for (const allowed of filterPrefs.allowedOriginalValues) {
		pushCandidate(allowed);
	}
	const filtered = candidates.filter((candidate) => {
		const key = normalizeStatusKey(candidate);
		if (!key) {
			return false;
		}
		if (filterPrefs.excluded.has(key)) {
			return false;
		}
		if (filterPrefs.allowed && !filterPrefs.allowed.has(key)) {
			return false;
		}
		return true;
	});
	if (filtered.length > 0) {
		return filtered;
	}
	if (filterPrefs.allowed && filterPrefs.allowed.size > 0) {
		const fallback: string[] = [];
		for (const value of filterPrefs.allowedOriginalValues) {
			const label = value.trim();
			if (!label) {
				continue;
			}
			const normalized = normalizeStatusKey(label);
			if (normalized && !fallback.some((entry) => normalizeStatusKey(entry) === normalized)) {
				fallback.push(label);
			}
		}
		if (fallback.length > 0) {
			return fallback;
		}
	}
	return candidates.filter((candidate) => !filterPrefs.excluded.has(normalizeStatusKey(candidate)));
}

function extractStatusFilterPreferences(rule: FilterRule | null, laneField: string): StatusFilterPreferences {
	if (!rule || !Array.isArray(rule.conditions) || rule.conditions.length === 0) {
		return { allowed: null, excluded: new Set(), allowedOriginalValues: [] };
	}
	const laneKey = normalizeStatusKey(laneField);
	if (!laneKey) {
		return { allowed: null, excluded: new Set(), allowedOriginalValues: [] };
	}
	const combineMode = rule.combineMode === 'OR' ? 'OR' : 'AND';
	const allowedOriginalValues: string[] = [];
	const allowedNormalized = new Set<string>();
	const excludedNormalized = new Set<string>();
	let hasNonLaneCondition = false;
	for (const condition of rule.conditions) {
		const columnKey =
			typeof condition.column === 'string' ? normalizeStatusKey(condition.column) : '';
		if (columnKey !== laneKey) {
			if (combineMode === 'OR') {
				hasNonLaneCondition = true;
			}
			continue;
		}
		const rawValue =
			typeof condition.value === 'string' ? condition.value.trim() : String(condition.value ?? '').trim();
		if (!rawValue) {
			continue;
		}
		const normalizedValue = normalizeStatusKey(rawValue);
		if (!normalizedValue) {
			continue;
		}
		if (condition.operator === 'equals') {
			allowedOriginalValues.push(rawValue);
			allowedNormalized.add(normalizedValue);
		} else if (condition.operator === 'notEquals' && combineMode === 'AND') {
			excludedNormalized.add(normalizedValue);
		}
	}
	let allowed: Set<string> | null = null;
	if (allowedNormalized.size > 0) {
		if (combineMode === 'AND') {
			allowed = allowedNormalized;
		} else if (!hasNonLaneCondition) {
			allowed = allowedNormalized;
		}
	}
	return {
		allowed,
		excluded: excludedNormalized,
		allowedOriginalValues
	};
}

export function isStatusLaneField(laneField: string): boolean {
	return normalizeStatusKey(laneField) === 'status';
}

function normalizeStatusKey(value: string): string {
	return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
