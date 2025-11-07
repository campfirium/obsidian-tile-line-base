import type { KanbanHeightMode } from '../../types/kanban';
import {
	KANBAN_VIEWPORT_MIN_HEIGHT_PX,
	KANBAN_VIEWPORT_PADDING_PX,
	isViewportHeightMode
} from './kanbanHeight';

interface KanbanViewportManagerOptions {
	container: HTMLElement;
}

export class KanbanViewportManager {
	private viewportWindow: Window | null = null;
	private viewportFrameId: number | null = null;
	private readonly resizeHandler: () => void;

	constructor(private readonly options: KanbanViewportManagerOptions) {
		this.resizeHandler = () => this.scheduleMeasurement();
	}

	apply(mode: KanbanHeightMode): void {
		const container = this.options.container;
		if (isViewportHeightMode(mode)) {
			container.classList.add('tlb-kanban-wrapper--viewport');
			this.refresh(mode);
			return;
		}
		container.classList.remove('tlb-kanban-wrapper--viewport');
		this.resetStyles();
		this.detachListeners();
	}

	refresh(mode: KanbanHeightMode): void {
		if (!isViewportHeightMode(mode)) {
			this.cancelMeasurement();
			return;
		}
		this.scheduleMeasurement();
	}

	dispose(): void {
		this.detachListeners();
		this.cancelMeasurement();
		this.resetStyles();
		this.options.container.classList.remove('tlb-kanban-wrapper--viewport');
	}

	private scheduleMeasurement(): void {
		const container = this.options.container;
		const ownerDoc = container.ownerDocument;
		const win = ownerDoc?.defaultView ?? null;
		if (!win || !container.isConnected) {
			return;
		}
		if (this.viewportWindow && this.viewportWindow !== win) {
			this.detachListeners();
		}
		if (!this.viewportWindow) {
			this.viewportWindow = win;
			win.addEventListener('resize', this.resizeHandler, { passive: true });
		}
		this.cancelMeasurement();
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		container.style.overflowY = 'auto';
		container.style.minHeight = `${KANBAN_VIEWPORT_MIN_HEIGHT_PX}px`;
		this.viewportFrameId = win.requestAnimationFrame(() => {
			this.viewportFrameId = null;
			this.applyViewportHeight(win);
		});
	}

	private applyViewportHeight(win: Window): void {
		const container = this.options.container;
		if (!container.isConnected) {
			return;
		}
		const rect = container.getBoundingClientRect();
		const available = win.innerHeight - rect.top - KANBAN_VIEWPORT_PADDING_PX;
		const clamped = Math.max(available, KANBAN_VIEWPORT_MIN_HEIGHT_PX);
		container.style.maxHeight = `${clamped}px`;
	}

	private cancelMeasurement(): void {
		if (this.viewportWindow && this.viewportFrameId !== null) {
			this.viewportWindow.cancelAnimationFrame(this.viewportFrameId);
		}
		this.viewportFrameId = null;
	}

	private detachListeners(): void {
		if (this.viewportWindow) {
			this.viewportWindow.removeEventListener('resize', this.resizeHandler);
		}
		this.viewportWindow = null;
	}

	private resetStyles(): void {
		const container = this.options.container;
		container.style.removeProperty('max-height');
		container.style.removeProperty('min-height');
		container.style.removeProperty('overflow-y');
	}
}
