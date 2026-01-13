import { TFile } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import type { TableView } from "../TableView";
import { getLogger } from "../utils/logger";
import { getPluginContext } from "../pluginContext";

type RefreshSource = "external" | "table-operation" | "metadata";

export interface RefreshRequest {
	source: RefreshSource;
	structural?: boolean;
	reason?: string;
	immediate?: boolean;
}

export interface SelfMutationOptions {
	structural?: boolean;
}

interface ViewSnapshot {
	focused: { rowIndex: number; field: string } | null;
	selected: number[] | null;
}

function normalisePath(path: string): string {
	return path.toLowerCase();
}

function mergeContext(base: RefreshRequest | null, incoming: RefreshRequest): RefreshRequest {
	if (!base) {
		return { ...incoming };
	}
	return {
		source: incoming.source,
		structural: Boolean(base.structural || incoming.structural),
		reason: incoming.reason ?? base.reason,
		immediate: Boolean(base.immediate || incoming.immediate)
	};
}

export class TableRefreshCoordinator {
	private static readonly logger = getLogger("table-view:refresh-coordinator");
	private static initialized = false;
	private static coordinators = new Set<TableRefreshCoordinator>();
	private static coordinatorsByPath = new Map<string, Set<TableRefreshCoordinator>>();
	private static activeLeaf: WorkspaceLeaf | null = null;

	static ensureInitialized(app: App): void {
		if (this.initialized) {
			return;
		}
		const plugin = getPluginContext();
		if (!plugin) {
			this.logger.warn("Plugin context unavailable; refresh coordination disabled");
			return;
		}
		const vaultRef = app.vault.on("modify", (abstractFile) => {
			if (!(abstractFile instanceof TFile)) {
				return;
			}
			TableRefreshCoordinator.handleVaultModify(abstractFile);
		});
		const leafRef = app.workspace.on("active-leaf-change", (leaf) => {
			TableRefreshCoordinator.handleActiveLeafChange(leaf ?? null);
		});
		plugin.registerEvent(vaultRef);
		plugin.registerEvent(leafRef);
		this.activeLeaf = app.workspace.getMostRecentLeaf?.() ?? null;
		this.initialized = true;
	}

	static requestRefreshForPath(path: string, context: RefreshRequest): void {
		const key = normalisePath(path);
		const targets = this.coordinatorsByPath.get(key);
		if (!targets || targets.size === 0) {
			return;
		}
		for (const coordinator of targets) {
			coordinator.requestRefresh(context);
		}
	}

	private static handleVaultModify(file: TFile): void {
		const key = normalisePath(file.path);
		const targets = this.coordinatorsByPath.get(key);
		if (!targets || targets.size === 0) {
			return;
		}
		for (const coordinator of targets) {
			coordinator.handleVaultModify(file);
		}
	}

	private static handleActiveLeafChange(leaf: WorkspaceLeaf | null): void {
		this.activeLeaf = leaf;
		for (const coordinator of this.coordinators) {
			coordinator.handleLeafActivation(leaf);
		}
	}

	private readonly logger = getLogger("table-view:refresh");
	private trackedPathKey: string | null = null;
	private mutationBudget = 0;
	private isActive = false;
	private pendingContext: RefreshRequest | null = null;
	private inactiveContext: RefreshRequest | null = null;
	private dirtyWhileInactive = false;
	private refreshTimer: number | null = null;
	private disposed = false;
	private deferredExternalRefresh: RefreshRequest | null = null;

	constructor(private readonly view: TableView) {
		TableRefreshCoordinator.ensureInitialized(view.app);
		TableRefreshCoordinator.coordinators.add(this);
		this.isActive = TableRefreshCoordinator.activeLeaf
			? TableRefreshCoordinator.activeLeaf === this.view.leaf
			: this.view.leaf === (this.view.app.workspace.getMostRecentLeaf?.() ?? null);
	}

	setTrackedFile(file: TFile | null): void {
		const nextKey = file ? normalisePath(file.path) : null;
		if (this.trackedPathKey === nextKey) {
			return;
		}
		this.deferredExternalRefresh = null;
		if (this.trackedPathKey) {
			const currentSet = TableRefreshCoordinator.coordinatorsByPath.get(this.trackedPathKey);
			if (currentSet) {
				currentSet.delete(this);
				if (currentSet.size === 0) {
					TableRefreshCoordinator.coordinatorsByPath.delete(this.trackedPathKey);
				}
			}
		}
		this.trackedPathKey = nextKey;
		if (nextKey) {
			let set = TableRefreshCoordinator.coordinatorsByPath.get(nextKey);
			if (!set) {
				set = new Set<TableRefreshCoordinator>();
				TableRefreshCoordinator.coordinatorsByPath.set(nextKey, set);
			}
			set.add(this);
		}
		this.mutationBudget = 0;
	}

	markSelfMutation(file: TFile, _options?: SelfMutationOptions): void {
		const key = file ? normalisePath(file.path) : null;
		if (!key || key !== this.trackedPathKey) {
			return;
		}
		this.mutationBudget += 1;
	}

	requestRefresh(context: RefreshRequest): void {
		if (!this.trackedPathKey) {
			return;
		}
		if (!this.isActive) {
			this.dirtyWhileInactive = true;
			this.inactiveContext = mergeContext(this.inactiveContext, context);
			this.logger.debug("Deferring refresh; view inactive", {
				file: this.view.file?.path ?? null,
				reason: this.inactiveContext.reason ?? context.reason ?? null
			});
			return;
		}
		this.pendingContext = mergeContext(this.pendingContext, context);
		if (this.pendingContext.immediate) {
			this.flushPendingRefresh();
		} else {
			this.scheduleRefresh();
		}
	}

	hasSiblingForTrackedFile(): boolean {
		if (!this.trackedPathKey) {
			return false;
		}
		const set = TableRefreshCoordinator.coordinatorsByPath.get(this.trackedPathKey);
		if (!set) {
			return false;
		}
		return set.size > 1;
	}

	handleVaultModify(file: TFile): void {
		if (!this.trackedPathKey || normalisePath(file.path) !== this.trackedPathKey) {
			return;
		}
		if (this.mutationBudget > 0) {
			this.mutationBudget -= 1;
			this.logger.trace("Skipping refresh due to self mutation", { file: file.path, budget: this.mutationBudget });
			return;
		}
		if (this.view.persistenceService?.hasPendingSave?.()) {
			// Avoid blowing away in-memory edits if another view modifies the file first.
			this.logger.warn("Deferring refresh due to pending save", { file: file.path });
			this.deferredExternalRefresh = mergeContext(this.deferredExternalRefresh, {
				source: "external",
				structural: true,
				reason: "vault-modify",
				immediate: true
			});
			return;
		}
		this.requestRefresh({
			source: "external",
			structural: true,
			reason: "vault-modify",
			immediate: false
		});
	}

	handleLeafActivation(activeLeaf: WorkspaceLeaf | null): void {
		const nowActive = activeLeaf === this.view.leaf;
		if (nowActive === this.isActive) {
			return;
		}
		this.isActive = nowActive;
		if (!nowActive) {
			this.view.gridAdapter?.hideTooltips?.();
			this.view.kanbanController?.hideTooltips?.();
			return;
		}
		if (!this.dirtyWhileInactive) {
			return;
		}
		const context = this.inactiveContext ?? {
			source: "external",
			structural: true,
			reason: "activate-refresh",
			immediate: true
		};
		this.inactiveContext = null;
		this.dirtyWhileInactive = false;
		this.pendingContext = mergeContext(this.pendingContext, { ...context, immediate: true });
		this.flushPendingRefresh();
	}

	captureViewSnapshot(): ViewSnapshot | null {
		const adapter = this.view.gridAdapter;
		if (!adapter) {
			return null;
		}
		const focused = adapter.getFocusedCell?.() ?? null;
		let selected: number[] | null = null;
		try {
			selected = adapter.getSelectedRows();
		} catch {
			selected = null;
		}
		return { focused, selected };
	}

	async finalizeRender(snapshot: ViewSnapshot | null): Promise<void> {
		this.pendingContext = null;
		this.inactiveContext = null;
		this.dirtyWhileInactive = false;
		this.mutationBudget = 0;
		if (!snapshot) {
			return;
		}
		const adapter = this.view.gridAdapter;
		if (!adapter) {
			return;
		}
		if (Array.isArray(snapshot.selected) && snapshot.selected.length > 0 && typeof adapter.selectRow === "function") {
			for (const rowIndex of snapshot.selected) {
				adapter.selectRow(rowIndex, { ensureVisible: false });
			}
		}
		if (snapshot.focused && typeof this.view.focusManager?.focusRow === "function") {
			this.view.focusManager.focusRow(snapshot.focused.rowIndex, snapshot.focused.field ?? null);
		}
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		TableRefreshCoordinator.coordinators.delete(this);
		if (this.trackedPathKey) {
			const set = TableRefreshCoordinator.coordinatorsByPath.get(this.trackedPathKey);
			if (set) {
				set.delete(this);
				if (set.size === 0) {
					TableRefreshCoordinator.coordinatorsByPath.delete(this.trackedPathKey);
				}
			}
		}
		if (this.refreshTimer) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.pendingContext = null;
		this.inactiveContext = null;
		this.dirtyWhileInactive = false;
		this.mutationBudget = 0;
		this.deferredExternalRefresh = null;
	}

	private scheduleRefresh(): void {
		if (!this.pendingContext) {
			return;
		}
		if (this.refreshTimer) {
			window.clearTimeout(this.refreshTimer);
		}
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.flushPendingRefresh();
		}, 250);
	}

	handleSaveSettled(): void {
		if (this.disposed) {
			this.deferredExternalRefresh = null;
			return;
		}
		if (!this.deferredExternalRefresh) {
			return;
		}
		const context = this.deferredExternalRefresh;
		this.deferredExternalRefresh = null;
		this.requestRefresh({ ...context, immediate: true });
	}

	private flushPendingRefresh(): void {
		if (!this.pendingContext) {
			return;
		}
		const context = this.pendingContext;
		this.pendingContext = null;
		this.logger.debug("Executing refresh", {
			file: this.view.file?.path ?? null,
			reason: context.reason ?? null,
			structural: context.structural ?? false
		});
		void (async () => {
			try {
				await this.view.render();
			} catch (error) {
				this.logger.error("Failed to refresh table view", error);
			}
		})();
	}
}
