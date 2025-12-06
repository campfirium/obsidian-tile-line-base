import type { RowData } from '../../grid/GridAdapter';
import type {
	KanbanCardContentConfig,
	KanbanRuntimeCardContent,
	KanbanSortDirection
} from '../../types/kanban';
import type { FilterRule } from '../../types/filterView';
import { toRuntimeContent } from './KanbanCardContent';
import { buildExpectedLaneNames } from './expectedLaneNames';
import { buildKanbanBoardState, type KanbanBoardState } from './KanbanDataBuilder';

export interface KanbanViewStateParams {
	rows: RowData[];
	laneField: string;
	sortField: string | null;
	sortDirection: KanbanSortDirection;
	fallbackLane: string;
	primaryField: string | null;
	contentConfig: KanbanCardContentConfig | null;
	displayFields: string[];
	quickFilter: string;
	resolveRowIndex: (row: RowData) => number | null;
	lanePresets: string[];
	laneOrder: string[];
	filterRule: FilterRule | null;
}

export function resolveAvailableFields(displayFields: string[], laneField: string): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	for (const field of displayFields) {
		if (typeof field !== 'string') {
			continue;
		}
		const trimmed = field.trim();
		if (!trimmed || trimmed === '#' || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		result.push(trimmed);
	}
	const normalizedLane = laneField.trim();
	if (normalizedLane && !seen.has(normalizedLane)) {
		seen.add(normalizedLane);
		result.push(normalizedLane);
	}
	return result;
}

export function buildKanbanViewState(params: KanbanViewStateParams): {
	boardState: KanbanBoardState;
	cardContent: KanbanRuntimeCardContent;
} {
	const availableFields = resolveAvailableFields(params.displayFields, params.laneField);
	const cardContent = toRuntimeContent(params.contentConfig, {
		availableFields,
		laneField: params.laneField
	});
	const expectedLaneNames = buildExpectedLaneNames({
		laneField: params.laneField,
		filterRule: params.filterRule,
		lanePresets: params.lanePresets,
		laneOrder: params.laneOrder
	});
	const boardState = buildKanbanBoardState({
		rows: params.rows,
		laneField: params.laneField,
		sortField: params.sortField,
		sortDirection: params.sortDirection,
		fallbackLane: params.fallbackLane,
		primaryField: params.primaryField,
		content: cardContent,
		displayFields: availableFields,
		quickFilter: params.quickFilter,
		resolveRowIndex: params.resolveRowIndex,
		expectedLaneNames
	});
	return { boardState, cardContent };
}
