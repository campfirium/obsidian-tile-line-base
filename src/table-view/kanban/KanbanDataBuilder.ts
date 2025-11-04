import { ROW_ID_FIELD, type RowData } from '../../grid/GridAdapter';
import type { KanbanRuntimeCardContent, KanbanSortDirection } from '../../types/kanban';
import { renderTitle, renderBody, renderTags } from './KanbanCardContent';

export interface KanbanCard {
	id: string;
	rowIndex: number;
	title: string;
	body: string;
	tags: string[];
	sortOrder: number;
	sortValue: number | null;
	sortText: string | null;
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
	sortDirection: KanbanSortDirection;
	fallbackLane: string;
	primaryField: string | null;
	content: KanbanRuntimeCardContent;
	quickFilter: string;
	resolveRowIndex: (row: RowData) => number | null;
}

export function buildKanbanBoardState(params: BuildKanbanBoardStateParams): KanbanBoardState {
	const {
		rows,
		laneField,
		sortField,
		sortDirection,
		fallbackLane,
		primaryField,
		content,
		quickFilter,
		resolveRowIndex
	} = params;

	const normalizedQuickFilter = quickFilter.trim().toLowerCase();
	const hasQuickFilter = normalizedQuickFilter.length > 0;
	const laneMap = new Map<string, KanbanLane>();
	const directionMultiplier = sortDirection === 'desc' ? -1 : 1;
	const laneNameToId = new Map<string, string>();
	const usedLaneIds = new Set<string>();
	let totalCards = 0;

	for (const row of rows) {
		const rowIndex = resolveRowIndex(row);
		if (rowIndex == null || rowIndex < 0) {
			continue;
		}

		const laneName = normalizeString(row[laneField]) || fallbackLane;

		const title = renderTitle(content.titleTemplate, row, primaryField);
		const body = renderBody(content.bodyTemplate, row);
		const tags = renderTags(content.tagsTemplate, row);

		if (hasQuickFilter && !matchesQuickFilter(row, { title, body, tags }, {
			laneField,
			primaryField,
			content,
			needle: normalizedQuickFilter
		})) {
			continue;
		}

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
		const sortMeta = parseSortMetadata(sortRaw);
		const sortOrder = sortMeta.numeric ?? lane.cards.length + 1;

		lane.cards.push({
			id: buildCardId(row, rowIndex),
			rowIndex,
			title,
			body,
			tags,
			sortOrder,
			sortValue: sortMeta.numeric,
			sortText: sortMeta.text,
			rawLane: laneName,
			row
		});
		totalCards += 1;
	}

	const lanes: KanbanLane[] = [];
	for (const lane of laneMap.values()) {
		lane.cards.sort((a, b) => {
			if (a.sortValue != null && b.sortValue != null && a.sortValue !== b.sortValue) {
				return a.sortValue < b.sortValue ? -1 * directionMultiplier : 1 * directionMultiplier;
			}
			if (a.sortValue != null && b.sortValue == null) {
				return -1;
			}
			if (a.sortValue == null && b.sortValue != null) {
				return 1;
			}
			if (a.sortText && b.sortText) {
				const cmp = a.sortText.localeCompare(b.sortText);
				if (cmp !== 0) {
					return cmp * directionMultiplier;
				}
			} else if (a.sortText && !b.sortText) {
				return -1;
			} else if (!a.sortText && b.sortText) {
				return 1;
			}
			if (a.sortOrder !== b.sortOrder) {
				return (a.sortOrder - b.sortOrder) * directionMultiplier;
			}
			return a.rowIndex - b.rowIndex;
		});
		lanes.push(lane);
	}

	return {
		lanes,
		totalCards
	};
}

interface CardTextSegments {
	title: string;
	body: string;
	tags: string[];
}

function matchesQuickFilter(
	row: RowData,
	segments: CardTextSegments,
	options: { laneField: string; primaryField: string | null; content: KanbanRuntimeCardContent; needle: string }
): boolean {
	const { laneField, primaryField, content, needle } = options;
	if (!needle) {
		return true;
	}
	if (segments.title.toLowerCase().includes(needle)) {
		return true;
	}
	if (segments.body.toLowerCase().includes(needle)) {
		return true;
	}
	for (const tag of segments.tags) {
		if (tag.toLowerCase().includes(needle)) {
			return true;
		}
	}
	const searchFields = new Set<string>([...content.referencedFields, laneField]);
	if (primaryField) {
		searchFields.add(primaryField);
	}
	for (const field of searchFields) {
		const value = normalizeString(row[field]);
		if (value && value.toLowerCase().includes(needle)) {
			return true;
		}
	}
	const rowIdValue = normalizeString(row[ROW_ID_FIELD]);
	return rowIdValue.toLowerCase().includes(needle);
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

function parseSortMetadata(raw: string): { numeric: number | null; text: string | null } {
	if (!raw) {
		return { numeric: null, text: null };
	}
	const numeric = Number(raw);
	if (Number.isFinite(numeric)) {
		return { numeric, text: null };
	}
	const timestamp = Date.parse(raw);
	if (Number.isFinite(timestamp)) {
		return { numeric: timestamp, text: null };
	}
	return { numeric: null, text: raw.toLowerCase() };
}

function buildCardId(row: RowData, rowIndex: number): string {
	const explicit = normalizeString(row[ROW_ID_FIELD]);
	if (explicit.length > 0) {
		return explicit;
	}
	return String(rowIndex);
}
