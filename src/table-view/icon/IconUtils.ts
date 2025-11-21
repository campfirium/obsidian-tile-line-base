import type { App } from 'obsidian';
import { FALLBACK_LUCIDE_ICON_IDS } from '../filter/IconCatalog';

export function sanitizeIconId(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function normalizeIconQuery(value: string): string {
	return value.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export function getFuzzyMatchScore(value: string, query: string): number | null {
	if (!query) {
		return 0;
	}
	let score = 0;
	let searchIndex = 0;
	for (const char of query) {
		const foundIndex = value.indexOf(char, searchIndex);
		if (foundIndex === -1) {
			return null;
		}
		score += foundIndex - searchIndex;
		searchIndex = foundIndex + 1;
	}
	score += Math.max(0, value.length - searchIndex);
	return score;
}

export function collectLucideIconIds(app: App): string[] {
	const iconIds = new Set<string>();
	try {
		const manager = (app as unknown as { dom?: { appIconManager?: unknown } })?.dom?.appIconManager as {
			getIconIds?: () => string[] | undefined;
			icons?: Record<string, unknown>;
		} | undefined;
		const pushIds = (ids: Iterable<string> | undefined) => {
			if (!ids) {
				return;
			}
			for (const id of ids) {
				if (typeof id === 'string') {
					const trimmed = id.trim();
					if (trimmed) {
						iconIds.add(trimmed);
					}
				}
			}
		};
		if (manager) {
			const managerIds = manager.getIconIds?.();
			pushIds(managerIds);
			if (!managerIds && manager.icons) {
				pushIds(Object.keys(manager.icons));
			}
		}
		const appWindow = window as unknown as {
			app?: { dom?: { appIconManager?: { getIconIds?: () => string[]; icons?: Record<string, unknown> } } };
			getIconIds?: () => string[];
		};
		const globalManager = appWindow?.app?.dom?.appIconManager;
		if (globalManager && globalManager !== manager) {
			pushIds(globalManager.getIconIds?.());
			if (globalManager.icons) {
				pushIds(Object.keys(globalManager.icons));
			}
		}
		if (typeof appWindow.getIconIds === 'function') {
			pushIds(appWindow.getIconIds());
		}
	} catch {
		// ignore
	}

	if (iconIds.size === 0) {
		FALLBACK_LUCIDE_ICON_IDS.forEach((id) => iconIds.add(id));
	}
	return Array.from(iconIds).sort();
}

export function resolveCanonicalIconId(value: string | null, icons: string[]): string | null {
	if (!value) {
		return null;
	}
	const normalized = normalizeIconQuery(value);
	if (!normalized) {
		return null;
	}
	for (const iconId of icons) {
		if (normalizeIconQuery(iconId) === normalized) {
			return iconId;
		}
	}
	return null;
}
