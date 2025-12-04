import { App, TFile, WorkspaceLeaf } from 'obsidian';
import { TABLE_VIEW_TYPE } from '../TableView';
import { getLogger, getLoggingConfig, type LogLevelName } from '../utils/logger';
import type { WindowContextManager } from './WindowContextManager';

const NAVIGATOR_STACK_HINT = 'notebook-navigator';
const NAVIGATOR_LOG_SCOPE = 'plugin:navigator-compat';

const LOG_RANK: Record<LogLevelName, number> = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
	trace: 4
};

export class NavigatorCompatibilityPatcher {
	private readonly app: App;
	private readonly windowContextManager: WindowContextManager;
	private readonly logger = getLogger(NAVIGATOR_LOG_SCOPE);
	private originalOpenFile: WorkspaceLeaf['openFile'] | null = null;
	private applied = false;

	constructor(app: App, windowContextManager: WindowContextManager) {
		this.app = app;
		this.windowContextManager = windowContextManager;
	}

	enable(): void {
		if (this.applied) {
			return;
		}
		const proto = WorkspaceLeaf.prototype;
		if (typeof proto.openFile !== 'function') {
			this.logger.warn('navigator-compat: WorkspaceLeaf.openFile not available; skipping patch');
			return;
		}
		// eslint-disable-next-line @typescript-eslint/unbound-method
		const originalOpenFile = proto.openFile;
		this.originalOpenFile = originalOpenFile;
		const callOriginal = (leaf: WorkspaceLeaf, file: TFile | null, ...rest: unknown[]) =>
			originalOpenFile.apply(leaf, [file, ...rest] as Parameters<WorkspaceLeaf['openFile']>);
		const logger = this.logger;
		const manager = this.windowContextManager;
		this.logger.debug('navigator-compat: patching WorkspaceLeaf.openFile', { workspaceReady: !!this.app.workspace });

		// Use function syntax to preserve the leaf's `this` binding.
		(proto as WorkspaceLeaf).openFile = function patchedOpenFile(
			file: TFile | null,
			...rest: unknown[]
		): ReturnType<WorkspaceLeaf['openFile']> {
			const leaf = this as WorkspaceLeaf;
			const view = leaf.view;
			const viewType = typeof view?.getViewType === 'function' ? view.getViewType() : '';
			if (!isTileLineBaseViewType(viewType)) {
				return callOriginal(leaf, file, ...rest);
			}

			const targetPath = file instanceof TFile ? file.path : null;
			const currentPath = resolveViewFilePath(view);
			if (!targetPath || !currentPath || targetPath !== currentPath) {
				return callOriginal(leaf, file, ...rest);
			}

			const stack = new Error().stack ?? '';
			const fromNavigator = stack.includes(NAVIGATOR_STACK_HINT);
			if (!fromNavigator) {
				return callOriginal(leaf, file, ...rest);
			}

			const leafWindow = manager.getLeafWindow(leaf);
			logger.debug('navigator-compat: blocked navigator openFile', {
				file: targetPath,
				viewType,
				window: manager.describeWindow(leafWindow)
			});
			if (isDebugEnabledForNavigator()) {
				logger.info('[TLB] Intercepted Navigator openFile call', { file: targetPath, viewType });
			}
			return Promise.resolve(leaf) as unknown as ReturnType<WorkspaceLeaf['openFile']>;
		};

		this.applied = true;
		this.logger.debug('navigator-compat: WorkspaceLeaf.openFile patched');
	}

	disable(): void {
		if (!this.applied) {
			return;
		}
		const proto = WorkspaceLeaf.prototype;
		if (this.originalOpenFile && typeof this.originalOpenFile === 'function') {
			(proto as WorkspaceLeaf).openFile = this.originalOpenFile;
		}
		this.originalOpenFile = null;
		this.applied = false;
		this.logger.debug('navigator-compat: WorkspaceLeaf.openFile restored');
	}

	dispose(): void {
		this.disable();
	}
}

function isTileLineBaseViewType(viewType: string | undefined): boolean {
	if (typeof viewType !== 'string' || viewType.trim().length === 0) {
		return false;
	}
	if (viewType === TABLE_VIEW_TYPE) {
		return true;
	}
	return viewType.startsWith('tile-line-base-');
}

function resolveViewFilePath(view: unknown): string | null {
	if (!view || typeof view !== 'object') {
		return null;
	}
	const file = (view as { file?: TFile | null }).file;
	if (file instanceof TFile) {
		return file.path;
	}
	const state = typeof (view as any)?.getState === 'function' ? (view as any).getState() : null;
	const pathLike = state && typeof state.filePath === 'string' ? state.filePath.trim() : '';
	return pathLike.length > 0 ? pathLike : null;
}

function isDebugEnabledForNavigator(): boolean {
	const config = getLoggingConfig();
	const scopeLevel = config.scopeLevels[NAVIGATOR_LOG_SCOPE] ?? config.globalLevel;
	return LOG_RANK.debug <= LOG_RANK[scopeLevel];
}
