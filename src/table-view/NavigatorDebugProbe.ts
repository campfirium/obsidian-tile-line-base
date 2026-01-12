import { App, TFile, WorkspaceLeaf } from "obsidian";
import { around } from "monkey-around";
import { getLogger } from "../utils/logger";

const NAVIGATOR_PLUGIN_ID = "notebook-navigator";
const NAVIGATOR_STACK_HINT = "notebook-navigator";
const logger = getLogger("compat:navigator");
const LOG_THROTTLE_MS = 500;
let lastLoggedAt = 0;
const FOCUS_SYNC_THROTTLE_MS = 250;
let lastFocusSyncAt = 0;
let lastFocusSyncPath: string | null = null;

interface NavigatorCompatOptions {
	getCurrentFile: () => TFile | null;
	getViewType: () => string;
}

export function attachNavigatorCompatibility(
	leaf: WorkspaceLeaf,
	options: NavigatorCompatOptions
): () => void {
	const dispose = around(leaf, {
		openFile(next: WorkspaceLeaf["openFile"]) {
			return function patchedOpenFile(
				file: TFile | null,
				...rest: unknown[]
			): ReturnType<WorkspaceLeaf["openFile"]> {
				const targetPath = file instanceof TFile ? file.path : null;
				const currentPath = options.getCurrentFile()?.path ?? null;
				const stack = new Error().stack ?? "";
				const fromNavigator = stack.includes(NAVIGATOR_STACK_HINT);
				const isSameFile = targetPath && currentPath && targetPath === currentPath;
				if (fromNavigator && isSameFile) {
					const now = Date.now();
					if (now - lastLoggedAt > LOG_THROTTLE_MS) {
						lastLoggedAt = now;
						const stackSnippet = stack
							.split("\n")
							.slice(0, 6)
							.map((line) => line.trim())
							.join(" | ");
						logger.info("Blocked Notebook Navigator same-file reopen", {
							file: targetPath,
							viewType: options.getViewType(),
							stack: stackSnippet
						});
					}
					return Promise.resolve(leaf) as unknown as ReturnType<WorkspaceLeaf["openFile"]>;
				}
				return next.call(this, file, ...rest);
			};
		}
	});

	return dispose;
}

export function notifyNavigatorFocus(app: App, file: TFile): void {
	const pluginManager = (app as any)?.plugins;
	if (!pluginManager?.enabledPlugins?.has?.(NAVIGATOR_PLUGIN_ID)) {
		return;
	}
	const navigatorPlugin = pluginManager?.plugins?.[NAVIGATOR_PLUGIN_ID];
	if (!navigatorPlugin) {
		return;
	}

	const now = Date.now();
	if (lastFocusSyncPath === file.path && now - lastFocusSyncAt < FOCUS_SYNC_THROTTLE_MS) {
		return;
	}
	lastFocusSyncAt = now;
	lastFocusSyncPath = file.path;

	const apiNavigation = (navigatorPlugin as any)?.api?.navigation;
	if (apiNavigation && typeof apiNavigation.reveal === "function") {
		try {
			void apiNavigation.reveal(file);
			return;
		} catch (error) {
			logger.debug("navigator-compat: failed to notify via api.navigation.reveal", { error });
		}
	}

	const revealActual = (navigatorPlugin as any)?.revealFileInActualFolder;
	if (typeof revealActual === "function") {
		try {
			void revealActual.call(navigatorPlugin, file);
			return;
		} catch (error) {
			logger.debug("navigator-compat: failed to notify via revealFileInActualFolder", { error });
		}
	}

	const revealNearest = (navigatorPlugin as any)?.revealFileInNearestFolder;
	if (typeof revealNearest === "function") {
		try {
			void revealNearest.call(navigatorPlugin, file);
			return;
		} catch (error) {
			logger.debug("navigator-compat: failed to notify via revealFileInNearestFolder", { error });
		}
	}

	revealInNavigatorLeaves(app, file);
}

function revealInNavigatorLeaves(app: App, file: TFile): boolean {
	let revealed = false;
	const leaves = app.workspace.getLeavesOfType("notebook-navigator");
	for (const leaf of leaves) {
		const view = leaf.view as any;
		const reveal =
			typeof view?.navigateToFile === "function"
				? view.navigateToFile
				: typeof view?.revealFileInActualFolder === "function"
					? view.revealFileInActualFolder
					: typeof view?.revealFileInNearestFolder === "function"
						? view.revealFileInNearestFolder
						: null;
		if (!reveal) {
			continue;
		}
		try {
			reveal.call(view, file);
			revealed = true;
		} catch (error) {
			logger.debug("navigator-compat: failed to reveal file in navigator view", { error });
		}
	}
	return revealed;
}
