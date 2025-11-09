import type { TableView } from '../../TableView';
import { getCurrentLocalDateTime } from '../../utils/datetime';

export interface RowUpdate {
	lane?: string;
}

export interface NormalizedRowUpdate {
	lane: string;
	statusTimestamp?: string;
}

interface PreparedLaneUpdates {
	targets: Array<{ index: number; fields: string[] }>;
	normalized: Map<number, NormalizedRowUpdate>;
}

export function prepareLaneUpdates(
	view: TableView,
	laneField: string,
	updates: Map<number, RowUpdate>
): PreparedLaneUpdates {
	const targets: Array<{ index: number; fields: string[] }> = [];
	const normalized = new Map<number, NormalizedRowUpdate>();
	const shouldTrackStatusTimestamp = isStatusLaneField(laneField);

	for (const [rowIndex, change] of updates.entries()) {
		if (typeof change.lane !== 'string') {
			continue;
		}
		const nextLane = change.lane.trim();
		if (!nextLane) {
			continue;
		}
		const block = view.blocks[rowIndex];
		if (!block) {
			continue;
		}
		const rawLane = block.data?.[laneField];
		const currentLane =
			typeof rawLane === 'string' ? rawLane.trim() : rawLane == null ? '' : String(rawLane).trim();
		if (currentLane === nextLane) {
			continue;
		}

		const normalizedChange: NormalizedRowUpdate = { lane: nextLane };
		const fields = [laneField];
		if (shouldTrackStatusTimestamp) {
			normalizedChange.statusTimestamp = getCurrentLocalDateTime();
			fields.push('statusChanged');
		}

		normalized.set(rowIndex, normalizedChange);
		targets.push({ index: rowIndex, fields });
	}

	return { targets, normalized };
}

function isStatusLaneField(field: string): boolean {
	return field.trim().toLowerCase() === 'status';
}
