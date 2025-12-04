export interface TagGroupDefinition {
	id: string;
	name: string;
	viewIds: string[];
}

export interface FileTagGroupMetadata {
	defaultSeeded?: boolean;
}

export interface FileTagGroupState {
	activeGroupId: string | null;
	groups: TagGroupDefinition[];
	metadata?: FileTagGroupMetadata;
}

export const DEFAULT_TAG_GROUP_STATE: FileTagGroupState = {
	activeGroupId: null,
	groups: [],
	metadata: {}
};
