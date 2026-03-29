import { normalizePath, type DataAdapter } from 'obsidian';
import type TileLineBasePlugin from '../main';

const LOG_FILE_NAME = 'row-drag-debug.log';

interface DragDebugContext {
	adapter: DataAdapter;
	filePath: string;
	queue: Promise<void>;
}

let activeContext: DragDebugContext | null = null;

export async function initializeDragDebugLog(plugin: TileLineBasePlugin): Promise<void> {
	const adapter = plugin.app.vault.adapter;
	const filePath = normalizePath(`${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}/${LOG_FILE_NAME}`);
	activeContext = {
		adapter,
		filePath,
		queue: Promise.resolve()
	};
	await adapter.write(filePath, '');
}

export function appendDragDebugLog(event: string, payload: Record<string, unknown>): void {
	if (!activeContext) {
		return;
	}
	const line = `${new Date().toISOString()} ${event} ${safeStringify(payload)}\n`;
	activeContext.queue = activeContext.queue
		.then(async () => {
			if (!activeContext) {
				return;
			}
			let previous = '';
			try {
				previous = await activeContext.adapter.read(activeContext.filePath);
			} catch {
				previous = '';
			}
			await activeContext.adapter.write(activeContext.filePath, `${previous}${line}`);
		})
		.catch(() => undefined);
}

function safeStringify(payload: Record<string, unknown>): string {
	try {
		return JSON.stringify(payload);
	} catch {
		return '{"error":"drag-debug-stringify-failed"}';
	}
}
