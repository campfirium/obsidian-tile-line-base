import type { TableView } from '../TableView';
import type { ColumnConfig } from './MarkdownBlockParser';

export function deserializeColumnConfigs(view: TableView, raw: unknown): ColumnConfig[] | null {
	if (!Array.isArray(raw)) {
		return null;
	}
	const result: ColumnConfig[] = [];
	for (const entry of raw) {
		if (typeof entry !== 'string' || entry.trim().length === 0) {
			continue;
		}
		const config = view.markdownParser.parseColumnDefinition(entry);
		if (config) {
			result.push(config);
		}
	}
	return result.length > 0 ? result : null;
}

export function mergeColumnConfigs(
	headerConfigs: ColumnConfig[] | null,
	persistedConfigs: ColumnConfig[] | null
): ColumnConfig[] | null {
	const baseList = headerConfigs ? headerConfigs.map((config) => ({ ...config })) : [];
	const overrideList = persistedConfigs ? persistedConfigs.map((config) => ({ ...config })) : [];
	if (baseList.length === 0 && overrideList.length === 0) {
		return null;
	}
	if (baseList.length === 0) {
		return overrideList;
	}
	const overrideMap = new Map<string, ColumnConfig>();
	for (const config of overrideList) {
		overrideMap.set(config.name, config);
	}
	const merged: ColumnConfig[] = [];
	for (const base of baseList) {
		const override = overrideMap.get(base.name);
		if (override) {
			merged.push({ ...base, ...override });
			overrideMap.delete(base.name);
		} else {
			merged.push(base);
		}
	}
	for (const remaining of overrideMap.values()) {
		merged.push(remaining);
	}
	return merged;
}
