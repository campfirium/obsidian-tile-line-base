import { TFile, WorkspaceLeaf } from "obsidian";
import { around } from "monkey-around";
import { getLogger } from "../utils/logger";

const NAVIGATOR_STACK_HINT = "notebook-navigator";
const logger = getLogger("compat:navigator");
const LOG_THROTTLE_MS = 500;
let lastLoggedAt = 0;

interface NavigatorCompatOptions {
	getCurrentFile: () => TFile | null;
	getViewType: () => string;
}

export function attachNavigatorCompatibility(
	leaf: WorkspaceLeaf,
	options: NavigatorCompatOptions
): () => void {
	const dispose = around(leaf, {
		openFile(next) {
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
