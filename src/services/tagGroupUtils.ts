import type { FileTagGroupMetadata } from '../types/tagGroup';

export function cloneTagGroupMetadata(source: FileTagGroupMetadata | null | undefined): FileTagGroupMetadata {
	if (!source) {
		return {};
	}
	const metadata: FileTagGroupMetadata = {};
	if (source.defaultSeeded) {
		metadata.defaultSeeded = true;
	}
	return metadata;
}
