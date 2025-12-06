import type { SortableEvent } from 'sortablejs';

type SortableStatic = typeof import('sortablejs');
type SortableInstance = ReturnType<SortableStatic['create']>;

interface KanbanLaneReorderControllerOptions {
	getSortableClass: () => SortableStatic | null;
	isDragAvailable: () => boolean;
	disableCardDrag: (disabled: boolean) => void;
	onLaneOrderChange: (order: string[]) => void;
}

export class KanbanLaneReorderController {
	private laneSortable: SortableInstance | null = null;
	private boardEl: HTMLElement | null = null;

	constructor(private readonly options: KanbanLaneReorderControllerOptions) {}

	attach(boardEl: HTMLElement | null): void {
		this.boardEl = boardEl;
		if (!boardEl || !this.options.isDragAvailable()) {
			this.destroy();
			return;
		}
		const sortableClass = this.options.getSortableClass();
		if (!sortableClass) {
			this.destroy();
			return;
		}
		const laneCount = boardEl.querySelectorAll('.tlb-kanban-lane').length;
		if (laneCount <= 1) {
			this.destroy();
			return;
		}
		this.destroy();
		this.laneSortable = sortableClass.create(boardEl, {
			animation: 160,
			ghostClass: 'tlb-kanban-lane--ghost',
			dragClass: 'tlb-kanban-lane--dragging',
			draggable: '.tlb-kanban-lane',
			handle: '.tlb-kanban-lane__handle',
			direction: 'horizontal',
			fallbackOnBody: true,
			forceFallback: true,
			swapThreshold: 0.4,
			onStart: () => {
				this.options.disableCardDrag(true);
			},
			onEnd: (event: SortableEvent) => {
				this.options.disableCardDrag(false);
				this.handleLaneDragEnd(event);
			}
		});
	}

	private handleLaneDragEnd(event: SortableEvent): void {
		const container = (event.to as HTMLElement | null) ?? this.boardEl;
		if (!container) {
			return;
		}
		const order: string[] = [];
		const seen = new Set<string>();
		const laneNodes = Array.from(container.querySelectorAll<HTMLElement>('.tlb-kanban-lane'));
		for (const laneEl of laneNodes) {
			const label = (laneEl.dataset.laneName ?? '').trim();
			if (!label) {
				continue;
			}
			const normalized = label.toLowerCase();
			if (seen.has(normalized)) {
				continue;
			}
			seen.add(normalized);
			order.push(label);
		}
		if (order.length === 0) {
			return;
		}
		this.options.onLaneOrderChange(order);
	}

	destroy(): void {
		if (!this.laneSortable) {
			return;
		}
		try {
			this.laneSortable.destroy();
		} catch {
			// noop
		}
		this.laneSortable = null;
	}
}
