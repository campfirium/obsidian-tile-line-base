import type { FilterRule } from '../../types/filterView';
import { resolveExpectedStatusLanes } from './statusLaneHelpers';

interface BuildExpectedLaneNamesOptions {
	laneField: string;
	filterRule: FilterRule | null;
	lanePresets: string[];
}

export function buildExpectedLaneNames(options: BuildExpectedLaneNamesOptions): string[] | null {
	const result: string[] = [];
	const seen = new Set<string>();
	const push = (value: string | null | undefined) => {
		const label = typeof value === 'string' ? value.trim() : '';
		if (!label) {
			return;
		}
		const normalized = label.toLowerCase();
		if (seen.has(normalized)) {
			return;
		}
		seen.add(normalized);
		result.push(label);
	};

	const statusLanes = resolveExpectedStatusLanes({
		laneField: options.laneField,
		filterRule: options.filterRule
	});

	if (Array.isArray(statusLanes)) {
		statusLanes.forEach(push);
	}

	for (const preset of options.lanePresets) {
		push(preset);
	}

	return result.length > 0 ? result : null;
}
