import type { App, Workspace, WorkspaceLeaf, WorkspaceWindow } from 'obsidian';
import { getLogger } from '../utils/logger';

const logger = getLogger('plugin:window-context');

export interface WindowContext {
	readonly window: Window;
	readonly app: App;
	workspaceWindow?: WorkspaceWindow;
}

export class WindowContextManager {
	private readonly contexts = new Map<Window, WindowContext>();
	private readonly windowIds = new WeakMap<Window, string>();
	private readonly app: App;

	constructor(app: App) {
		this.app = app;
	}

	registerWindow(win: Window, workspaceWindow?: WorkspaceWindow): WindowContext | null {
		const existing = this.contexts.get(win);
		if (existing) {
			existing.workspaceWindow = workspaceWindow ?? existing.workspaceWindow;
			logger.debug('registerWindow: reuse existing', {
				window: this.describeWindow(win)
			});
			return existing;
		}

		const winApp = (win as Window & { app?: App }).app;
		const resolvedApp = winApp ?? this.app;
		if (!resolvedApp) {
			logger.warn('registerWindow: app not found', this.describeWindow(win));
			return null;
		}

		const context: WindowContext = { window: win, app: resolvedApp, workspaceWindow };
		this.contexts.set(win, context);

		logger.debug('registerWindow: new context', {
			window: this.describeWindow(win),
			total: this.contexts.size
		});
		return context;
	}

	unregisterWindow(win: Window): boolean {
		const removed = this.contexts.delete(win);
		if (removed) {
			logger.debug('unregisterWindow', {
				window: this.describeWindow(win)
			});
		}
		return removed;
	}

	captureExistingWindows(): void {
		const seen = new Set<Window>();
		this.app.workspace.iterateAllLeaves((leaf) => {
			const win = this.getLeafWindow(leaf);
			if (win && !seen.has(win)) {
				seen.add(win);
				this.registerWindow(win);
			}
		});
	}

	getWindowContext(win: Window | null | undefined): WindowContext | null {
		if (!win) {
			return null;
		}
		return this.contexts.get(win) ?? null;
	}

	getLeafWindow(leaf: WorkspaceLeaf | null | undefined): Window | null {
		return leaf?.view?.containerEl?.ownerDocument?.defaultView ?? null;
	}

	getWorkspaceForLeaf(leaf: WorkspaceLeaf | null | undefined): Workspace | null {
		const win = this.getLeafWindow(leaf);
		return this.getWindowContext(win)?.app.workspace ?? null;
	}

	forEachWindowContext(callback: (context: WindowContext) => void): void {
		for (const context of this.contexts.values()) {
			callback(context);
		}
	}

	hasWindow(win: Window | null | undefined): boolean {
		return !!win && this.contexts.has(win);
	}

	getWindowId(win: Window): string {
		let id = this.windowIds.get(win);
		if (!id) {
			id = `win-${Math.random().toString(36).slice(2, 8)}`;
			this.windowIds.set(win, id);
		}
		return id;
	}

	describeWindow(win: Window | null | undefined): Record<string, unknown> | null {
		if (!win) {
			return null;
		}

		let href: string | undefined;
		try {
			href = win.location?.href;
		} catch {
			href = undefined;
		}

		return {
			id: this.getWindowId(win),
			href,
			isMain: win === window,
			managed: this.contexts.has(win)
		};
	}
}
