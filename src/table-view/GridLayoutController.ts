import type { App, EventRef } from 'obsidian';
import { getLogger } from '../utils/logger';

const logger = getLogger('table-view:grid-layout');
import { GridController } from './GridController';

type ResizeSource =
	| 'initial'
	| 'ResizeObserver'
	| 'window resize'
	| 'visualViewport resize'
	| 'workspace resize'
	| 'size polling'
	| 'manual';

export class GridLayoutController {
	private container: HTMLElement | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private resizeTimeout: ReturnType<typeof setTimeout> | null = null;
	private sizeCheckInterval: ReturnType<typeof setInterval> | null = null;
	private windowResizeHandler: (() => void) | null = null;
	private visualViewportResizeHandler: (() => void) | null = null;
	private visualViewportTarget: VisualViewport | null = null;
	private workspaceResizeRef: EventRef | null = null;
	private pendingSizeUpdateHandle: number | null = null;
	private lastContainerWidth = 0;
	private lastContainerHeight = 0;

	constructor(private readonly app: App, private readonly gridController: GridController) {}

	attach(container: HTMLElement): void {
		if (this.container === container) {
			this.refresh();
			return;
		}

		this.detach();
		this.container = container;
		container.classList.add('tlb-grid-layout');
		container.classList.remove('tlb-grid-layout--explicit-height');
		container.style.removeProperty('--tlb-grid-layout-height');
		this.updateContainerSize();
		this.installObservers(container);
		this.scheduleColumnResize('initial');
	}

	detach(): void {
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}

		const activeContainer = this.container;
		if (activeContainer && this.windowResizeHandler) {
			const ownerWindow = activeContainer.ownerDocument.defaultView;
			if (ownerWindow) {
				ownerWindow.removeEventListener('resize', this.windowResizeHandler);
			}
		}
		this.windowResizeHandler = null;

		if (this.visualViewportTarget && this.visualViewportResizeHandler) {
			this.visualViewportTarget.removeEventListener('resize', this.visualViewportResizeHandler);
		}
		this.visualViewportTarget = null;
		this.visualViewportResizeHandler = null;

		if (this.workspaceResizeRef) {
			this.app.workspace.offref(this.workspaceResizeRef);
			this.workspaceResizeRef = null;
		}

		if (this.sizeCheckInterval) {
			clearInterval(this.sizeCheckInterval);
			this.sizeCheckInterval = null;
		}

		if (this.resizeTimeout) {
			clearTimeout(this.resizeTimeout);
			this.resizeTimeout = null;
		}

		if (this.pendingSizeUpdateHandle !== null && typeof cancelAnimationFrame === 'function') {
			cancelAnimationFrame(this.pendingSizeUpdateHandle);
		}
		this.pendingSizeUpdateHandle = null;

		if (this.container) {
			this.container.classList.remove('tlb-grid-layout', 'tlb-grid-layout--explicit-height');
			this.container.style.removeProperty('--tlb-grid-layout-height');
		}

		this.lastContainerWidth = 0;
		this.lastContainerHeight = 0;
		this.container = null;
	}

	refresh(): void {
		if (!this.container) {
			return;
		}
		this.updateContainerSize();
		this.scheduleColumnResize('manual');
	}

	private installObservers(container: HTMLElement): void {
		this.resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				if (entry.target === container) {
					this.updateContainerSize();
					this.scheduleColumnResize('ResizeObserver');
				}
			}
		});
		this.resizeObserver.observe(container);

		this.windowResizeHandler = () => {
			this.updateContainerSize();
			this.scheduleColumnResize('window resize');
		};

		const ownerWindow = container.ownerDocument.defaultView;
		if (ownerWindow) {
			ownerWindow.addEventListener('resize', this.windowResizeHandler);

			if ('visualViewport' in ownerWindow && ownerWindow.visualViewport) {
				this.visualViewportTarget = ownerWindow.visualViewport;
				this.visualViewportResizeHandler = () => {
					this.updateContainerSize();
					this.scheduleColumnResize('visualViewport resize');
				};
				this.visualViewportTarget.addEventListener('resize', this.visualViewportResizeHandler);
			}
		} else {
			logger.error('[TileLineBase] Failed to acquire owner window for grid layout controller');
		}

		this.workspaceResizeRef = this.app.workspace.on('resize', () => {
			this.updateContainerSize();
			this.scheduleColumnResize('workspace resize');
		});

		this.startSizePolling(container);
	}

	private startSizePolling(container: HTMLElement): void {
		if (this.sizeCheckInterval) {
			clearInterval(this.sizeCheckInterval);
		}

		this.lastContainerWidth = container.offsetWidth;
		this.lastContainerHeight = container.offsetHeight;

		this.sizeCheckInterval = setInterval(() => {
			if (!container.isConnected) {
				return;
			}

			const currentWidth = container.offsetWidth;
			const currentHeight = container.offsetHeight;

			if (currentWidth !== this.lastContainerWidth || currentHeight !== this.lastContainerHeight) {
				this.lastContainerWidth = currentWidth;
				this.lastContainerHeight = currentHeight;
				this.updateContainerSize();
				this.scheduleColumnResize('size polling');
			}
		}, 400);
	}

	private updateContainerSize(): void {
		const container = this.container;
		if (!container) {
			return;
		}

		if (this.pendingSizeUpdateHandle !== null && typeof cancelAnimationFrame === 'function') {
			cancelAnimationFrame(this.pendingSizeUpdateHandle);
			this.pendingSizeUpdateHandle = null;
		}

		this.pendingSizeUpdateHandle =
			typeof requestAnimationFrame === 'function'
				? requestAnimationFrame(() => this.applyContainerSize(container))
				: null;

		if (this.pendingSizeUpdateHandle === null) {
			this.applyContainerSize(container);
		}
	}

	private applyContainerSize(container: HTMLElement): void {
		const layoutHost = container.closest('.tlb-table-view-content') ?? container.parentElement;
		const layoutHostElement = layoutHost instanceof HTMLElement ? layoutHost : null;

		let targetHeight = 0;
		if (layoutHostElement) {
			const parentRect = layoutHostElement.getBoundingClientRect();
			const containerRect = container.getBoundingClientRect();
			const parentHeight =
				parentRect.height || layoutHostElement.clientHeight || layoutHostElement.offsetHeight;
			if (parentHeight > 0) {
				const offsetTop = containerRect.top - parentRect.top;
				const available = parentHeight - offsetTop;
				targetHeight = available > 0 ? available : parentHeight;
			} else {
				targetHeight = parentHeight;
			}
		}

		if (targetHeight > 0) {
			container.style.setProperty('--tlb-grid-layout-height', targetHeight + 'px');
			container.classList.add('tlb-grid-layout--explicit-height');
		} else {
			container.style.removeProperty('--tlb-grid-layout-height');
			container.classList.remove('tlb-grid-layout--explicit-height');
		}

		this.pendingSizeUpdateHandle = null;
	}


	private scheduleColumnResize(source: ResizeSource): void {
		if (this.resizeTimeout) {
			clearTimeout(this.resizeTimeout);
		}

		this.resizeTimeout = setTimeout(() => {
			this.gridController.markLayoutDirty();
			this.gridController.resizeColumns();

			if (
				source === 'window resize' ||
				source === 'visualViewport resize' ||
				source === 'workspace resize'
			) {
				setTimeout(() => {
					this.gridController.resizeColumns();
				}, 200);

				setTimeout(() => {
					this.gridController.resizeColumns();
				}, 500);
			}

			this.resizeTimeout = null;
		}, 150);
	}
}
