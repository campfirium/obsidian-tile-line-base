import { ViewportResizeReason, DebugLogger } from '../types';

type ActivityHandler = (reason: ViewportResizeReason) => void;

export class ViewportManager {
	private cleanup: (() => void) | null = null;
	private readonly listeners: Array<(reason: ViewportResizeReason) => void> = [];
	private readonly debug: DebugLogger;

	constructor(debug: DebugLogger) {
		this.debug = debug;
	}

	bind(container: HTMLElement, activity: ActivityHandler): void {
		this.debug('viewport:bind');
		this.unbind();

		const onActivity = (reason: ViewportResizeReason) => {
			activity(reason);
			this.notify(reason);
		};

		const onScroll = () => onActivity('scroll');
		const onWheel = () => onActivity('scroll');
		const ownerWin = container.ownerDocument?.defaultView ?? window;
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
				console.error('[AgGridInteraction] viewport resize callback failed', error);
			}
		}
	}
}
