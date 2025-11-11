import type { FileFilterViewState } from './filterView';
import type { FileTagGroupState } from './tagGroup';

export interface TlbConfigBlock {
	filterViews?: FileFilterViewState;
	tagGroups?: FileTagGroupState;
	columnWidths?: Record<string, number>;
	columnConfigs?: string[];
	copyTemplate?: string | null;
	viewPreference?: 'markdown' | 'table' | 'kanban';
	[key: string]: unknown;
}

export interface ConfigCacheEntry {
	filePath: string;
	version: number;
	config: TlbConfigBlock;
}
