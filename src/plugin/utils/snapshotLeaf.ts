import type { WorkspaceLeaf } from 'obsidian';
import type { WindowContextManager } from '../WindowContextManager';

export function snapshotLeaf(
	manager: WindowContextManager,
	leaf: WorkspaceLeaf | null | undefined
): Record<string, unknown> | null {
	if (!leaf) {
		return null;
	}

	let type: string | undefined;
	try {
		type = leaf.getViewState().type;
	} catch {
		type = undefined;
	}

	const leafWindow = manager.getLeafWindow(leaf);
	const leafWithId = leaf as WorkspaceLeaf & { id?: string };
	return {
		id: leafWithId.id ?? undefined,
		type,
		window: manager.describeWindow(leafWindow)
	};
}
