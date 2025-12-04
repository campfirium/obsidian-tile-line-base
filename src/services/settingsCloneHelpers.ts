import type { FileTagGroupState, TagGroupDefinition } from '../types/tagGroup';
import { cloneTagGroupMetadata } from './tagGroupUtils';
import type { KanbanBoardState } from '../types/kanban';
import {
	DEFAULT_KANBAN_FONT_SCALE,
	DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT,
	DEFAULT_KANBAN_SORT_DIRECTION,
	sanitizeKanbanFontScale,
	sanitizeKanbanInitialVisibleCount
} from '../types/kanban';
import { sanitizeLanePresets, sanitizeLaneOrdering } from '../table-view/kanban/lanePresetUtils';
import { cloneKanbanCardContentConfig } from './kanbanBoardSerialization';

export function cloneTagGroupState(source: FileTagGroupState | null): FileTagGroupState {
	if (!source) {
		return { activeGroupId: null, groups: [], metadata: {} };
	}
	const seenIds = new Set<string>();
	const groups: TagGroupDefinition[] = [];

	for (const entry of source.groups ?? []) {
		if (!entry) {
			continue;
		}
		const id = typeof entry.id === 'string' ? entry.id.trim() : '';
		if (!id || seenIds.has(id)) {
			continue;
		}
		const name = typeof entry.name === 'string' ? entry.name.trim() : '';
		const rawViewIds = Array.isArray(entry.viewIds) ? entry.viewIds : [];
		const viewIds: string[] = [];
		const seenViewIds = new Set<string>();
		for (const raw of rawViewIds) {
			if (typeof raw !== 'string') {
				continue;
			}
			const trimmed = raw.trim();
			if (!trimmed || seenViewIds.has(trimmed)) {
				continue;
			}
			seenViewIds.add(trimmed);
			viewIds.push(trimmed);
		}
		groups.push({
			id,
			name: name.length > 0 ? name : id,
			viewIds
		});
		seenIds.add(id);
	}

	const activeGroupId = groups.some((group) => group.id === source.activeGroupId) ? source.activeGroupId : null;
	const metadata = cloneTagGroupMetadata(source.metadata);

	return {
		activeGroupId,
		groups,
		metadata
	};
}

export function cloneKanbanBoardState(
	source: KanbanBoardState | null | undefined,
	deepClone: <T>(value: T) => T
): KanbanBoardState {
	const boards: KanbanBoardState['boards'] = [];
	const seenIds = new Set<string>();
	if (source?.boards) {
		for (const raw of source.boards) {
			if (!raw || typeof raw.id !== 'string') {
				continue;
			}
			const id = raw.id.trim();
			if (!id || seenIds.has(id)) {
				continue;
			}
			const rawName = typeof raw.name === 'string' ? raw.name.trim() : '';
			const icon = sanitizeIconId(raw.icon);
			const laneField = typeof raw.laneField === 'string' ? raw.laneField.trim() : '';
			const filterRule = raw.filterRule ? deepClone(raw.filterRule) : null;
			const initialVisibleCount = sanitizeKanbanInitialVisibleCount(
				raw.initialVisibleCount ?? DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT,
				DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT
			);
			const content = cloneKanbanCardContentConfig(raw.content ?? null);
			const rawSortField = typeof raw.sortField === 'string' ? raw.sortField.trim() : '';
			const sortField = rawSortField.length > 0 ? rawSortField : null;
			const sortDirection =
				raw.sortDirection === 'desc' ? 'desc' : DEFAULT_KANBAN_SORT_DIRECTION;
			const lanePresets = sanitizeLanePresets(raw.lanePresets);
			const laneOrder = sanitizeLaneOrdering(raw.laneOrderOverrides);
			boards.push({
				id,
				name: rawName.length > 0 ? rawName : id,
				icon,
				laneField: laneField.length > 0 ? laneField : '',
				lanePresets,
				laneOrderOverrides: laneOrder.length > 0 ? laneOrder : null,
				fontScale: sanitizeKanbanFontScale(raw.fontScale ?? DEFAULT_KANBAN_FONT_SCALE),
				filterRule,
				initialVisibleCount,
				content,
				sortField,
				sortDirection
			});
			seenIds.add(id);
		}
	}
	let activeBoardId: string | null =
		typeof source?.activeBoardId === 'string' ? source.activeBoardId.trim() : null;
	if (!activeBoardId || !seenIds.has(activeBoardId)) {
		activeBoardId = boards[0]?.id ?? null;
	}
	return {
		boards,
		activeBoardId
	};
}

function sanitizeIconId(icon: unknown): string | null {
	if (typeof icon !== 'string') {
		return null;
	}
	const trimmed = icon.trim();
	return trimmed.length > 0 ? trimmed : null;
}
