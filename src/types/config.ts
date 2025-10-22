import type { FileFilterViewState } from './filterView';

export interface TlbConfigBlock {
	filterViews?: FileFilterViewState;
	columnWidths?: Record<string, number>;
	viewPreference?: 'markdown' | 'table';
	[key: string]: unknown;
}

export interface ConfigCacheEntry {
	filePath: string;
	version: number;
	config: TlbConfigBlock;
}
