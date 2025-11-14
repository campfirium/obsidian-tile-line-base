const MAX_LANE_ROWS = 2;
const MIN_LANE_COUNT_FOR_MULTIROW = 4;

interface KanbanLaneWrapControllerOptions {
	wrapper: HTMLElement;
	board: HTMLElement;
	enabled?: boolean;
}

export class KanbanLaneWrapController {
	private resizeObserver: ResizeObserver | null = null;
	private laneWidthPx: number | null = null;
	private gapPx = 0;
	private laneCount = 0;
	private destroyed = false;
	private enabled: boolean;

	constructor(private readonly options: KanbanLaneWrapControllerOptions) {
		this.enabled = options.enabled !== false;
		if (typeof ResizeObserver !== 'undefined') {
			this.resizeObserver = new ResizeObserver(() => {
				this.applyLayout();
			});
			this.resizeObserver.observe(this.options.wrapper);
		}
	}

	public updateLaneMetrics(): void {
		if (!this.enabled) {
			return;
		}
		const board = this.options.board;
		if (!board.isConnected) {
			this.resetLayout();
			return;
		}
		const lanes = board.querySelectorAll<HTMLElement>('.tlb-kanban-lane');
		this.laneCount = lanes.length;
		if (this.laneCount === 0) {
			this.laneWidthPx = null;
			this.applyLayout();
			return;
		}
		const firstLane = lanes[0];
		const laneRect = firstLane.getBoundingClientRect();
		this.laneWidthPx = laneRect.width;
		const computed = getComputedStyle(board);
		const gapValue =
			computed.getPropertyValue('column-gap') || computed.getPropertyValue('gap') || '0';
		const parsedGap = Number.parseFloat(gapValue);
		this.gapPx = Number.isFinite(parsedGap) ? parsedGap : 0;
		this.applyLayout();
	}

	public destroy(): void {
		this.destroyed = true;
		this.resizeObserver?.disconnect();
		this.resetLayout();
	}

	public setEnabled(enabled: boolean): void {
		if (this.enabled === enabled) {
			return;
		}
		this.enabled = enabled;
		if (!enabled) {
			this.resetLayout();
			return;
		}
		this.applyLayout();
	}

	private applyLayout(): void {
		if (this.destroyed) {
			return;
		}
		if (!this.enabled) {
			this.resetLayout();
			return;
		}
		const board = this.options.board;
		if (!this.laneWidthPx || this.laneCount === 0) {
			this.resetLayout();
			return;
		}
		const targetRows = this.computeRows();
		if (targetRows <= 1) {
			this.resetLayout();
			return;
		}
		const columns = Math.max(1, Math.ceil(this.laneCount / targetRows));
		const maxWidth =
			columns * this.laneWidthPx + Math.max(0, columns - 1) * this.gapPx;
		board.style.setProperty('--tlb-kanban-board-max-width', `${Math.round(maxWidth)}px`);
		board.classList.add('tlb-kanban-board--wrapped');
	}

	private computeRows(): number {
		if (this.laneCount < MIN_LANE_COUNT_FOR_MULTIROW) {
			return 1;
		}
		return MAX_LANE_ROWS;
	}

	private resetLayout(): void {
		const board = this.options.board;
		board.style.removeProperty('--tlb-kanban-board-max-width');
		board.classList.remove('tlb-kanban-board--wrapped');
	}
}
