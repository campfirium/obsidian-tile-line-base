import { ViewportResizeReason, DebugLogger } from '../types';
import { getLogger } from '../../../utils/logger';

const logger = getLogger('grid:viewport');

type ActivityHandler = (reason: ViewportResizeReason) => void;

export class ViewportManager {
	private cleanup: (() => void) | null = null;
	private readonly listeners: Array<(reason: ViewportResizeReason) => void> = [];
	private readonly debug: DebugLogger;
	private readonly resizeDebounceMs = 160;

	constructor(debug: DebugLogger) {
		this.debug = debug;
	}

	bind(container: HTMLElement, activity: ActivityHandler): void {
		this.debug('viewport:bind');
		this.unbind();

		const ownerWin = container.ownerDocument?.defaultView ?? window;
		let resizeHandle: number | null = null;
		let lastKnownWidth = container.clientWidth ?? 0;
		let lastKnownHeight = container.clientHeight ?? 0;

		const emit = (reason: ViewportResizeReason) => {
			activity(reason);
			this.notify(reason);
		};
		const runResize = () => {
			const width = container.clientWidth ?? 0;
			const height = container.clientHeight ?? 0;
			if (Math.abs(width - lastKnownWidth) < 0.5 && Math.abs(height - lastKnownHeight) < 0.5) {
				return;
			}
			lastKnownWidth = width;
			lastKnownHeight = height;
			emit('resize');
		};
		const scheduleResize = () => {
			if (!ownerWin) {
				runResize();
				return;
			}
			if (resizeHandle !== null) {
				ownerWin.clearTimeout(resizeHandle);
			}
			resizeHandle = ownerWin.setTimeout(() => {
				resizeHandle = null;
				runResize();
			}, this.resizeDebounceMs);
		};
		const onActivity = (reason: ViewportResizeReason) => {
			if (reason === 'resize') {
				scheduleResize();
				return;
			}
			emit(reason);
		};

		const onScroll = () => onActivity('scroll');
		const onWheel = () => onActivity('scroll');
		const onResize = () => onActivity('resize');

		const viewports = Array.from(
			container.querySelectorAll<HTMLElement>(
				'.ag-center-cols-viewport, .ag-pinned-left-cols-viewport, .ag-pinned-right-cols-viewport, .ag-body-viewport'
			)
		);
		if (!viewports.includes(container)) {
			viewports.push(container);
		}

		const removers: Array<() => void> = [];
		const attach = (
			el: EventTarget,
			type: string,
			handler: EventListenerOrEventListenerObject,
			options?: boolean
		) => {
			el.addEventListener(type, handler, options);
			removers.push(() => el.removeEventListener(type, handler, options));
		};

		for (const viewport of viewports) {
			attach(viewport, 'scroll', onScroll, false);
			attach(viewport, 'wheel', onWheel, true);
		}
		attach(ownerWin, 'resize', onResize, false);
		const ResizeObserverCtor = ownerWin?.ResizeObserver ?? window.ResizeObserver;
		if (typeof ResizeObserverCtor === 'function') {
			const observer = new ResizeObserverCtor(() => {
				scheduleResize();
			});
			observer.observe(container);
			removers.push(() => observer.disconnect());
		}
		removers.push(() => {
			if (resizeHandle !== null && ownerWin) {
				ownerWin.clearTimeout(resizeHandle);
				resizeHandle = null;
			}
		});

		this.cleanup = () => {
			for (const remove of removers) {
				remove();
			}
		};
	}

	onViewportResize(callback: (reason: ViewportResizeReason) => void): () => void {
		this.listeners.push(callback);
		return () => {
			const index = this.listeners.indexOf(callback);
			if (index >= 0) {
				this.listeners.splice(index, 1);
			}
		};
	}

	unbind(): void {
		if (this.cleanup) {
			this.cleanup();
			this.cleanup = null;
		}
	}

	clearListeners(): void {
		this.listeners.length = 0;
	}

	private notify(reason: ViewportResizeReason): void {
		if (this.listeners.length === 0) {
			return;
		}
		const listeners = [...this.listeners];
		for (const callback of listeners) {
			try {
				callback(reason);
			} catch (error) {
				logger.error('[AgGridInteraction] viewport resize callback failed', error);
			}
		}
	}
}
