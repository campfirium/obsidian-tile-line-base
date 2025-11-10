import type { SortableEvent } from 'sortablejs';
import type { TableView } from '../../TableView';
import { prepareLaneUpdates, type RowUpdate } from './KanbanLaneMutation';

interface HandleCardDragParams {
	event: SortableEvent;
	dragAvailable: boolean;
	fallbackLaneName: string;
	onInvalidDrop: () => void;
	applyUpdates: (updates: Map<number, RowUpdate>, focusRowIndex: number) => void;
}

export function handleCardDragEnd(params: HandleCardDragParams): void {
	const { event, dragAvailable, fallbackLaneName, onInvalidDrop, applyUpdates } = params;
	if (!dragAvailable) {
		return;
	}
	const itemEl = event.item as HTMLElement | null;
	const targetEl = event.to as HTMLElement | null;
	if (!itemEl || !targetEl) {
		onInvalidDrop();
		return;
	}
	const rowIndex = parseInt(itemEl.dataset.rowIndex ?? '', 10);
	if (!Number.isInteger(rowIndex)) {
		onInvalidDrop();
		return;
	}
	const targetLaneName = targetEl.dataset.laneName ?? fallbackLaneName;
	itemEl.dataset.laneName = targetLaneName;

	const updates = new Map<number, RowUpdate>();
	const processed = new Set<HTMLElement>();
	const lanesToProcess: HTMLElement[] = [targetEl];
	const fromEl = event.from as HTMLElement | null;
	if (fromEl && fromEl !== targetEl) {
		lanesToProcess.push(fromEl);
	}

	for (const laneEl of lanesToProcess) {
		if (!laneEl || processed.has(laneEl)) {
			continue;
		}
		processed.add(laneEl);
		const laneName = laneEl.dataset.laneName ?? fallbackLaneName;
		const cardEls = Array.from(laneEl.querySelectorAll<HTMLElement>('.tlb-kanban-card'));
		cardEls.forEach((cardEl) => {
			const blockIndex = parseInt(cardEl.dataset.rowIndex ?? '', 10);
			if (!Number.isInteger(blockIndex)) {
				return;
			}
			const record = updates.get(blockIndex) ?? {};
			if (laneEl === targetEl && blockIndex === rowIndex) {
				record.lane = laneName;
			}
			updates.set(blockIndex, record);
		});
	}

	applyUpdates(updates, rowIndex);
}

interface ApplyLaneUpdatesParams {
	view: TableView;
	laneField: string;
	updates: Map<number, RowUpdate>;
	focusRowIndex: number;
	renderBoard: () => void;
	setApplyingMutation: (value: boolean) => void;
}

export function applyLaneUpdates(params: ApplyLaneUpdatesParams): void {
	const { targets, normalized } = prepareLaneUpdates(params.view, params.laneField, params.updates);
	if (targets.length === 0) {
		params.renderBoard();
		return;
	}

	params.setApplyingMutation(true);
	const recorded = params.view.historyManager.captureCellChanges(
		targets,
		() => {
			for (const [rowIndex, change] of normalized.entries()) {
				const block = params.view.blocks[rowIndex];
				if (!block) {
					continue;
				}
				block.data[params.laneField] = change.lane;
				if (typeof change.statusTimestamp === 'string') {
					block.data['statusChanged'] = change.statusTimestamp;
				}
			}
		},
		() => ({
			undo: { rowIndex: params.focusRowIndex, field: params.laneField },
			redo: { rowIndex: params.focusRowIndex, field: params.laneField }
		})
	);
	params.setApplyingMutation(false);

	if (!recorded) {
		params.renderBoard();
		return;
	}

	params.view.filterOrchestrator?.refresh();
	params.view.persistenceService?.scheduleSave();
}
