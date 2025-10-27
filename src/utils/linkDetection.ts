import type { DetectedCellLink } from '../types/cellLinks';

const INTERNAL_LINK_PATTERN = /\[\[([^[\]]+)\]\]/;
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/;
const EXTERNAL_URL_PATTERN = /\bhttps?:\/\/[^\s<>"')]+/i;

export function detectPrimaryCellLink(rawValue: unknown): DetectedCellLink | null {
	if (typeof rawValue !== 'string') {
		return null;
	}

	const value = rawValue.trim();
	if (value.length === 0) {
		return null;
	}

	const internalMatch = INTERNAL_LINK_PATTERN.exec(value);
	if (internalMatch) {
		const inner = internalMatch[1].trim();
		if (!inner) {
			return null;
		}
		const [target, alias] = inner.split('|', 2).map((segment) => segment.trim());
		if (!target) {
			return null;
		}
		return {
			type: 'internal',
			target,
			displayText: alias && alias.length > 0 ? alias : target,
			sourceText: value
		};
	}

	const markdownMatch = MARKDOWN_LINK_PATTERN.exec(value);
	if (markdownMatch) {
		const target = markdownMatch[2].trim();
		if (!target) {
			return null;
		}
		const displayText = markdownMatch[1].trim() || target;
		return {
			type: classifyLinkTarget(target),
			target,
			displayText,
			sourceText: value
		};
	}

	const urlMatch = EXTERNAL_URL_PATTERN.exec(value);
	if (urlMatch) {
		const target = urlMatch[0];
		return {
			type: 'external',
			target,
			displayText: target,
			sourceText: value
		};
	}

	return null;
}

function classifyLinkTarget(target: string): DetectedCellLink['type'] {
	if (/^obsidian:\/\//i.test(target)) {
		return 'internal';
	}
	if (/^https?:\/\//i.test(target)) {
		return 'external';
	}
	if (target.startsWith('[[') || target.startsWith('#')) {
		return 'internal';
	}
	if (/^[\w\-./]+(?:#.+)?$/.test(target)) {
		return 'internal';
	}
	if (target.includes('://')) {
		return 'external';
	}
	if (/^[\w\-\s]+$/.test(target)) {
		return 'internal';
	}
	return 'external';
}
