import { FilterDataProcessor } from '../filter/FilterDataProcessor';
import { ROW_ID_FIELD, type RowData } from '../../grid/GridAdapter';
import type { KanbanLaneSource } from './KanbanLaneResolver';

export interface KanbanCardField {
	name: string;
	value: string;
}

export interface KanbanCard {
	id: string;
	rowIndex: number;
	title: string;
	sortOrder: number;
	fields: KanbanCardField[];
	rawLane: string;
	row: RowData;
}

export interface KanbanLane {
	id: string;
	name: string;
	cards: KanbanCard[];
}

export interface KanbanBoardState {
	lanes: KanbanLane[];
	totalCards: number;
}

interface BuildKanbanBoardStateParams {
	rows: RowData[];
	lanes: KanbanLaneSource[];
	primaryField: string | null;
	displayFields: string[];
	quickFilter: string;
	resolveRowIndex: (row: RowData) => number | null;
}

export function buildKanbanBoardState(params: BuildKanbanBoardStateParams): KanbanBoardState {
	const { rows, lanes: laneSources, primaryField, displayFields, quickFilter, resolveRowIndex } = params;

	const normalizedQuickFilter = normalizeText(quickFilter);
	const resultLanes: KanbanLane[] = [];
	let totalCards = 0;

	for (const laneSource of laneSources) {
		const laneRows = filterRowsForLane(rows, laneSource);
		const filteredRows = applyQuickFilters(
			laneRows,
			displayFields,
			normalizedQuickFilter,
			normalizeText(laneSource.quickFilter ?? '')
		);
		const sortedRows = FilterDataProcessor.sortRowData(filteredRows, laneSource.sortRules ?? []);

		const cards: KanbanCard[] = [];
		sortedRows.forEach((row, index) => {
			const rowIndex = resolveRowIndex(row);
			if (rowIndex == null || rowIndex < 0) {
				return;
			}

			cards.push({
				id: buildCardId(row, rowIndex),
				rowIndex,
				title: primaryField ? normalizeString(row[primaryField]) : '',
				sortOrder: index + 1,
				fields: buildCardFields(row, displayFields, primaryField),
				rawLane: laneSource.name,
				row
			});
		});

		totalCards += cards.length;
		resultLanes.push({
			id: laneSource.id,
			name: laneSource.name,
			cards
		});
	}

	return {
		lanes: resultLanes,
		totalCards
	};
}

function filterRowsForLane(rows: RowData[], lane: KanbanLaneSource): RowData[] {
	if (!lane.filterRule) {
		return [...rows];
	}
	return FilterDataProcessor.applyFilterRule(rows, lane.filterRule);
}

function applyQuickFilters(
	rows: RowData[],
	displayFields: string[],
	globalQuickFilter: string,
	laneQuickFilter: string
): RowData[] {
	if (!globalQuickFilter && !laneQuickFilter) {
		return [...rows];
	}
	return rows.filter((row) => {
		if (globalQuickFilter && !matchesQuickFilter(row, displayFields, globalQuickFilter)) {
			return false;
		}
		if (laneQuickFilter && !matchesQuickFilter(row, displayFields, laneQuickFilter)) {
			return false;
		}
		return true;
	});
}

function matchesQuickFilter(row: RowData, displayFields: string[], needle: string): boolean {
	if (!needle) {
		return true;
	}
	const searchFields = new Set<string>(displayFields);
	for (const field of searchFields) {
		const value = normalizeString(row[field]);
		if (value && value.toLowerCase().includes(needle)) {
			return true;
		}
	}
	const rowIdValue = normalizeString(row[ROW_ID_FIELD]);
	return rowIdValue.toLowerCase().includes(needle);
}

function buildCardFields(
	row: RowData,
	displayFields: string[],
	primaryField: string | null
): KanbanCardField[] {
	const fields: KanbanCardField[] = [];
	for (const field of displayFields) {
		if (!field || field === ROW_ID_FIELD || field === '#' || (primaryField && field === primaryField)) {
			continue;
		}
		const value = normalizeString(row[field]);
		if (value.length === 0) {
			continue;
		}
		fields.push({ name: field, value });
	}
	return fields;
}

function normalizeString(input: unknown): string {
	if (typeof input === 'string') {
		return input.trim();
	}
	if (input == null) {
		return '';
	}
	return String(input).trim();
}

function normalizeText(value: string): string {
	return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function buildCardId(row: RowData, rowIndex: number): string {
	const explicit = normalizeString(row[ROW_ID_FIELD]);
	if (explicit.length > 0) {
		return explicit;
	}
	return String(rowIndex);
}
