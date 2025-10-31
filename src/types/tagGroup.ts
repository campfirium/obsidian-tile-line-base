export interface TagGroupDefinition {
	id: string;
	name: string;
	viewIds: string[];
}

export interface FileTagGroupState {
	activeGroupId: string | null;
	groups: TagGroupDefinition[];
}

export const DEFAULT_TAG_GROUP_STATE: FileTagGroupState = {
	activeGroupId: null,
	groups: []
};
