import { t } from '../../i18n';
import type { TableView } from '../../TableView';
import {
	DEFAULT_KANBAN_SORT_DIRECTION,
	type KanbanBoardDefinition,
	type KanbanSortDirection
} from '../../types/kanban';
import { KanbanBoardStore } from './KanbanBoardStore';
import { isStatusLaneField } from './statusLaneHelpers';
import { STATUS_BASELINE_VALUES, getStatusDisplayLabel } from '../filter/statusDefaults';

interface CreateDefaultStatusBoardOptions {
	view: TableView;
	store: KanbanBoardStore;
	laneFieldCandidates: string[];
}

export async function createDefaultStatusBoard(
	options: CreateDefaultStatusBoardOptions
): Promise<KanbanBoardDefinition | null> {
	const { view, store, laneFieldCandidates } = options;
	const laneField = resolveStatusLaneField(view.schema?.columnNames ?? null, laneFieldCandidates);
	if (!laneField) {
		return null;
	}

	const lanePresets = buildDefaultStatusLanePresets();
	if (lanePresets.length === 0) {
		return null;
	}

	const sortDirection: KanbanSortDirection =
		view.kanbanSortDirection === 'desc' ? 'desc' : DEFAULT_KANBAN_SORT_DIRECTION;
	const board = store.createBoard({
		name: t('kanbanView.defaultBoard.name'),
		icon: 'layout-kanban',
		laneField,
		lanePresets,
		laneOrderOverrides: lanePresets,
		laneWidth: view.kanbanLaneWidth,
		fontScale: view.kanbanFontScale,
		filterRule: null,
		initialVisibleCount: view.kanbanInitialVisibleCount,
		content: view.kanbanCardContentConfig,
		sortField: laneField,
		sortDirection,
		setActive: true
	});
	await store.persist();
	return board;
}

function resolveStatusLaneField(
	columns: string[] | null | undefined,
	candidates: string[]
): string | null {
	const seek = (values: Iterable<string>): string | null => {
		for (const column of values) {
			if (isStatusLaneField(column)) {
				return column;
			}
		}
		return null;
	};

	if (Array.isArray(columns)) {
		const matched = seek(columns);
		if (matched) {
			return matched;
		}
	}

	const candidate = seek(candidates ?? []);
	if (candidate) {
		return candidate;
	}

	return null;
}

function buildDefaultStatusLanePresets(): string[] {
	const presets: string[] = [];
	const seen = new Set<string>();
	for (const baseline of STATUS_BASELINE_VALUES) {
		const label = getStatusDisplayLabel(baseline).trim();
		if (!label) {
			continue;
		}
		const normalized = label.toLowerCase();
		if (seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		presets.push(label);
	}
	return presets;
}
