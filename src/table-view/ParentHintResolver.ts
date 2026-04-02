import type { H2Block } from './MarkdownBlockParser';
import {
	ENTRY_ID_FIELD,
	PARENT_ENTRY_ID_FIELD
} from './entryFields';

const TEMP_PARENT_FIELD = 'TLBparent';

interface ParentCandidate {
	entryId: string;
	primaryValue: string;
}

export function resolveTemporaryParentHints(blocks: H2Block[]): boolean {
	if (blocks.length === 0) {
		return false;
	}

	const primaryField = Object.keys(blocks[0]?.data ?? {})[0] ?? '';
	let changed = false;
	const candidates: ParentCandidate[] = blocks.map((block) => ({
		entryId: String(block.data[ENTRY_ID_FIELD] ?? '').trim(),
		primaryValue: String(block.data[primaryField] ?? '')
	}));
	const hasTempHint = blocks.map((block) => String(block.data[TEMP_PARENT_FIELD] ?? '').trim().length > 0);

	const isParentCandidate = (block: H2Block, index: number, targetValue: string): boolean => {
		if (hasTempHint[index]) {
			return false;
		}
		if (String(block.data[PARENT_ENTRY_ID_FIELD] ?? '').trim().length > 0) {
			return false;
		}
		return candidates[index]?.primaryValue === targetValue;
	};

	for (let index = 0; index < blocks.length; index++) {
		const block = blocks[index];
		const targetValue = String(block.data[TEMP_PARENT_FIELD] ?? '').trim();
		if (targetValue.length === 0) {
			if (Object.prototype.hasOwnProperty.call(block.data, TEMP_PARENT_FIELD)) {
				delete block.data[TEMP_PARENT_FIELD];
				changed = true;
			}
			continue;
		}

		let resolvedParentEntryId = '';
		for (let cursor = index - 1; cursor >= 0; cursor--) {
			if (isParentCandidate(blocks[cursor], cursor, targetValue)) {
				resolvedParentEntryId = candidates[cursor]?.entryId ?? '';
				break;
			}
		}
		if (!resolvedParentEntryId) {
			for (let cursor = index + 1; cursor < blocks.length; cursor++) {
				if (isParentCandidate(blocks[cursor], cursor, targetValue)) {
					resolvedParentEntryId = candidates[cursor]?.entryId ?? '';
					break;
				}
			}
		}

		if (String(block.data[PARENT_ENTRY_ID_FIELD] ?? '').trim() !== resolvedParentEntryId) {
			block.data[PARENT_ENTRY_ID_FIELD] = resolvedParentEntryId;
			changed = true;
		}

		delete block.data[TEMP_PARENT_FIELD];
		changed = true;
	}

	return changed;
}
