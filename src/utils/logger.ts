const GLOBAL_FLAG_KEY = 'TILE_LINE_BASE_DEBUG';
const STORAGE_FLAG_KEY = 'tileLineBaseDebug';

let cachedDebugState: boolean | null = null;

function readDebugFlag(): boolean {
	try {
		const globalObj = typeof globalThis !== 'undefined' ? (globalThis as Record<string, any>) : {};
		if (typeof globalObj[GLOBAL_FLAG_KEY] === 'boolean') {
			const current = globalObj[GLOBAL_FLAG_KEY];
			if (cachedDebugState !== current) {
				cachedDebugState = current;
			}
			return current;
		}

		const storage = globalObj?.localStorage;
		if (storage && typeof storage.getItem === 'function') {
			const value = storage.getItem(STORAGE_FLAG_KEY);
			if (value != null) {
				const current = value === '1' || value.toLowerCase() === 'true';
				if (cachedDebugState !== current) {
					cachedDebugState = current;
				}
				return current;
			}
		}
	} catch (error) {
		// ignore storage/security errors and fall back to cached state
	}

	if (cachedDebugState != null) {
		return cachedDebugState;
	}

	cachedDebugState = false;
	return cachedDebugState;
}

export function isDebugEnabled(): boolean {
	return readDebugFlag();
}

export function setDebugEnabled(enabled: boolean): void {
	try {
		const globalObj = typeof globalThis !== 'undefined' ? (globalThis as Record<string, any>) : {};
		globalObj[GLOBAL_FLAG_KEY] = enabled;
		const storage = globalObj?.localStorage;
		storage?.setItem?.(STORAGE_FLAG_KEY, enabled ? '1' : '0');
	} catch {
		// ignore failures
	}

	cachedDebugState = enabled;
}

export function debugLog(...args: unknown[]): void {
	if (!isDebugEnabled()) return;
	console.log('[TileLineBase]', ...args);
}

export function debugWarn(...args: unknown[]): void {
	if (!isDebugEnabled()) return;
	console.warn('[TileLineBase]', ...args);
}

export function debugInfo(...args: unknown[]): void {
	if (!isDebugEnabled()) return;
	console.info('[TileLineBase]', ...args);
}

export function debugGroup(label: string, callback: () => void): void {
	if (!isDebugEnabled()) return;
	console.group(label);
	try {
		callback();
	} finally {
		console.groupEnd();
	}
}
