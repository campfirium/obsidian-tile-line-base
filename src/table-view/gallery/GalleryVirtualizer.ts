export interface VirtualWindow {
	start: number;
	end: number;
	columns: number;
	rowGap: number;
	paddingTop: number;
	paddingBottom: number;
}

interface VirtualWindowParams {
	cardWidth: number;
	cardHeight: number;
	totalItems: number;
	grid: HTMLElement;
}

interface GalleryVirtualizerOptions {
	container: HTMLElement;
	overscan?: number;
	onViewportChange: () => void;
}

export class GalleryVirtualizer {
	private readonly container: HTMLElement;
	private readonly overscan: number;
	private readonly onViewportChange: () => void;
	private scrollContainer: HTMLElement;
	private resizeObserver: ResizeObserver | null = null;
	private lastWindow: VirtualWindow | null = null;

	constructor(options: GalleryVirtualizerOptions) {
		this.container = options.container;
		this.onViewportChange = options.onViewportChange;
		this.overscan = Math.max(0, options.overscan ?? 2);
		this.scrollContainer = this.findScrollContainer();
		this.attachObservers();
	}

	computeWindow(params: VirtualWindowParams): VirtualWindow {
		const rowGap = this.measureRowGap(params.grid, params.cardWidth);
		const columns = Math.max(
			1,
			Math.floor((this.measureGridWidth(params.grid, params.cardWidth) + rowGap) / (params.cardWidth + rowGap))
		);
		const totalItems = Math.max(0, params.totalItems);
		const totalRows = Math.max(1, Math.ceil(totalItems / columns));
		const scrollTarget = this.scrollContainer ?? params.grid;
		const viewportHeight =
			scrollTarget?.clientHeight ||
			this.container.clientHeight ||
			this.container.parentElement?.clientHeight ||
			window.innerHeight ||
			params.cardHeight;
		const safeRowHeight = Math.max(1, params.cardHeight + rowGap);
		const estimatedVisibleRows = Math.ceil(Math.max(viewportHeight, safeRowHeight) / safeRowHeight);
		const startRow = Math.max(0, Math.floor((scrollTarget?.scrollTop ?? 0) / safeRowHeight) - this.overscan);
		const endRow = Math.min(
			totalRows,
			Math.max(startRow + estimatedVisibleRows + this.overscan * 2, startRow + 1)
		);
		const startIndex = Math.min(totalItems, startRow * columns);
		let endIndex = Math.min(totalItems, endRow * columns);
		if (endIndex <= startIndex) {
			endIndex = Math.min(totalItems, startIndex + columns);
		}
		const renderRows = Math.max(1, Math.ceil(Math.max(0, endIndex - startIndex) / columns));
		const totalHeight = totalRows * safeRowHeight - rowGap;
		const beforeHeight = startRow * safeRowHeight;
		const renderHeight = renderRows * safeRowHeight - rowGap;
		const paddingTop = Math.max(0, beforeHeight);
		const paddingBottom = Math.max(0, totalHeight - beforeHeight - renderHeight);
		return {
			start: startIndex,
			end: endIndex,
			columns,
			rowGap,
			paddingTop,
			paddingBottom
		};
	}

	hasWindowChanged(next: VirtualWindow): boolean {
		const prev = this.lastWindow;
		if (!prev) {
			return true;
		}
		return (
			prev.start !== next.start ||
			prev.end !== next.end ||
			prev.columns !== next.columns ||
			Math.abs(prev.rowGap - next.rowGap) > 0.5 ||
			Math.abs(prev.paddingTop - next.paddingTop) > 0.5 ||
			Math.abs(prev.paddingBottom - next.paddingBottom) > 0.5
		);
	}

	commitWindow(next: VirtualWindow): void {
		this.lastWindow = next;
	}

	resetWindow(): void {
		this.lastWindow = null;
	}

	detach(): void {
		this.scrollContainer?.removeEventListener('scroll', this.onViewportChange);
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
	}

	private attachObservers(): void {
		this.scrollContainer?.addEventListener('scroll', this.onViewportChange, { passive: true });
		if (typeof ResizeObserver === 'undefined') {
			return;
		}
		this.resizeObserver = new ResizeObserver(() => {
			this.onViewportChange();
		});
		const resizeTarget = this.scrollContainer ?? this.container;
		this.resizeObserver.observe(resizeTarget);
	}

	private findScrollContainer(): HTMLElement {
		const target = this.container.closest('.tlb-table-view-content');
		return target instanceof HTMLElement ? target : this.container;
	}

	private measureRowGap(grid: HTMLElement, cardWidth: number): number {
		const computedGap = grid.ownerDocument.defaultView?.getComputedStyle(grid)?.rowGap ?? '';
		const parsed = Number.parseFloat(computedGap);
		if (Number.isFinite(parsed) && parsed > 0) {
			return parsed;
		}
		const fallback = Math.round(cardWidth * 0.05);
		return Math.max(4, fallback);
	}

	private measureGridWidth(grid: HTMLElement, cardWidth: number): number {
		const gridWidth = grid.clientWidth || this.container.clientWidth || this.container.parentElement?.clientWidth || 0;
		if (gridWidth > 0) {
			return gridWidth;
		}
		const fallback = Math.max(1, Math.round(cardWidth * 1.5));
		return window.innerWidth || fallback;
	}
}
