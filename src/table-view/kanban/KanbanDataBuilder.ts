import { ROW_ID_FIELD, type RowData } from '../../grid/GridAdapter';

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
	laneField: string;
	sortField: string | null;
	fallbackLane: string;
	primaryField: string | null;
	displayFields: string[];
	quickFilter: string;
	resolveRowIndex: (row: RowData) => number | null;
}

export function buildKanbanBoardState(params: BuildKanbanBoardStateParams): KanbanBoardState {
	const {
		rows,
		laneField,
		sortField,
		fallbackLane,
		primaryField,
		displayFields,
		quickFilter,
		resolveRowIndex
	} = params;

	const normalizedQuickFilter = quickFilter.trim().toLowerCase();
	const hasQuickFilter = normalizedQuickFilter.length > 0;
	const laneMap = new Map<string, KanbanLane>();
	const laneNameToId = new Map<string, string>();
	const usedLaneIds = new Set<string>();
	let totalCards = 0;

	for (const row of rows) {
		const rowIndex = resolveRowIndex(row);
		if (rowIndex == null || rowIndex < 0) {
			continue;
		}

		if (hasQuickFilter && !matchesQuickFilter(row, displayFields, laneField, normalizedQuickFilter)) {
			continue;
		}

		const laneName = normalizeString(row[laneField]) || fallbackLane;
		const laneId = resolveLaneId(laneName, laneNameToId, usedLaneIds, laneMap.size);

		let lane = laneMap.get(laneId);
		if (!lane) {
			lane = {
				id: laneId,
				name: laneName,
				cards: []
			};
			laneMap.set(laneId, lane);
		}

		const sortRaw = sortField ? normalizeString(row[sortField]) : '';
		const numericSort = sortRaw.length > 0 ? Number(sortRaw) : Number.NaN;
		const sortOrder = Number.isFinite(numericSort) ? numericSort : lane.cards.length + 1;
		const title = primaryField ? normalizeString(row[primaryField]) : '';
		const fields = buildCardFields(row, displayFields, laneField, sortField, primaryField);

		lane.cards.push({
			id: buildCardId(row, rowIndex),
			rowIndex,
			title,
			sortOrder,
			fields,
			rawLane: laneName,
			row
		});
		totalCards += 1;
	}

	const lanes: KanbanLane[] = [];
	for (const lane of laneMap.values()) {
		lane.cards.sort((a, b) => {
			if (a.sortOrder === b.sortOrder) {
				return a.rowIndex - b.rowIndex;
			}
			return a.sortOrder - b.sortOrder;
		});
		lanes.push(lane);
	}

	return {
		lanes,
		totalCards
	};
}

function matchesQuickFilter(
	row: RowData,
	displayFields: string[],
	laneField: string,
	needle: string
): boolean {
	if (needle.length === 0) {
		return true;
	}
	const searchFields = new Set<string>([...displayFields, laneField]);
	for (const field of searchFields) {
		const value = normalizeString(row[field]);
		if (value && value.includes(needle)) {
			return true;
		}
	}
	const rowIdValue = normalizeString(row[ROW_ID_FIELD]);
	return rowIdValue.includes(needle);
}

function buildCardFields(
	row: RowData,
	displayFields: string[],
	laneField: string,
	sortField: string | null,
	primaryField: string | null
): KanbanCardField[] {
	const fields: KanbanCardField[] = [];
	for (const field of displayFields) {
		if (
			field === laneField ||
			(sortField && field === sortField) ||
			field === ROW_ID_FIELD ||
			field === '#' ||
			(primaryField && field === primaryField)
		) {
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

function resolveLaneId(
	name: string,
	existing: Map<string, string>,
	used: Set<string>,
	index: number
): string {
	const normalized = slugify(name);
	if (!existing.has(name)) {
		let candidate = normalized || `lane-${index}`;
		let counter = 1;
		while (used.has(candidate)) {
			candidate = `${candidate}-${counter++}`;
		}
		existing.set(name, candidate);
		used.add(candidate);
		return candidate;
	}
	const resolved = existing.get(name);
	if (resolved) {
		return resolved;
	}
	let fallback = normalized || `lane-${index}`;
	let counter = 1;
	while (used.has(fallback)) {
		fallback = `${fallback}-${counter++}`;
	}
	existing.set(name, fallback);
	used.add(fallback);
	return fallback;
}

function slugify(value: string): string {
	const normalized = normalizeString(value).replace(/[^a-z0-9]+/g, '-');
	const trimmed = normalized.replace(/^-+|-+$/g, '');
	return trimmed.toLowerCase();
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

function buildCardId(row: RowData, rowIndex: number): string {
	const explicit = normalizeString(row[ROW_ID_FIELD]);
	if (explicit.length > 0) {
		return explicit;
	}
	return String(rowIndex);
}
