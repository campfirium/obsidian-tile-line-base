import type { CellRenderableSegment, DetectedCellLink } from '../types/cellLinks';

const LINK_TOKEN_PATTERN = /\[\[([^[\]]+)\]\]|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s<>"')]+)/gi;

export function detectPrimaryCellLink(rawValue: unknown): DetectedCellLink | null {
	const segments = parseCellLinkSegments(rawValue);
	for (const segment of segments) {
		if (segment.kind === 'link') {
			return segment.link;
		}
	}
	return null;
}

export function parseCellLinkSegments(rawValue: unknown): CellRenderableSegment[] {
	if (typeof rawValue !== 'string') {
		if (rawValue == null) {
			return [{ kind: 'text', text: '' }];
		}
		if (typeof rawValue === 'number' || typeof rawValue === 'boolean' || typeof rawValue === 'bigint') {
			return [{ kind: 'text', text: rawValue.toString() }];
		}
		return [{ kind: 'text', text: '' }];
	}

	const value = rawValue;
	if (value.length === 0) {
		return [{ kind: 'text', text: '' }];
	}

	const segments: CellRenderableSegment[] = [];
	let cursor = 0;
	let match: RegExpExecArray | null;

	LINK_TOKEN_PATTERN.lastIndex = 0;
	while ((match = LINK_TOKEN_PATTERN.exec(value)) !== null) {
		const matchedText = match[0] ?? '';
		if (!matchedText) {
			continue;
		}

		const start = match.index;
		if (start > cursor) {
			segments.push({ kind: 'text', text: value.slice(cursor, start) });
		}

		const wikiInner = match[1];
		const markdownText = match[2];
		const markdownTarget = match[3];
		const bareUrl = match[4];

		if (wikiInner != null) {
			const inner = wikiInner.trim();
			if (inner.length === 0) {
				segments.push({ kind: 'text', text: matchedText });
			} else {
				const [target, alias] = inner.split('|', 2).map((segment) => segment.trim());
				if (target.length === 0) {
					segments.push({ kind: 'text', text: matchedText });
				} else {
					const displayText = alias && alias.length > 0 ? alias : target;
					segments.push({
						kind: 'link',
						text: displayText,
						link: {
							type: 'internal',
							target,
							displayText,
							sourceText: matchedText
						}
					});
				}
			}
		} else if (markdownTarget != null) {
			const target = markdownTarget.trim();
			if (target.length === 0) {
				segments.push({ kind: 'text', text: matchedText });
			} else {
				const displayText = (markdownText ?? '').trim() || target;
				segments.push({
					kind: 'link',
					text: displayText,
					link: {
						type: classifyLinkTarget(target),
						target,
						displayText,
						sourceText: matchedText
					}
				});
			}
		} else if (bareUrl != null) {
			const target = bareUrl.trim();
			if (target.length === 0) {
				segments.push({ kind: 'text', text: matchedText });
			} else {
				segments.push({
					kind: 'link',
					text: target,
					link: {
						type: 'external',
						target,
						displayText: target,
						sourceText: matchedText
					}
				});
			}
		} else {
			segments.push({ kind: 'text', text: matchedText });
		}

		cursor = start + matchedText.length;
	}

	if (cursor < value.length) {
		segments.push({ kind: 'text', text: value.slice(cursor) });
	}

	return segments.length > 0 ? segments : [{ kind: 'text', text: value }];
}

function classifyLinkTarget(target: string): DetectedCellLink['type'] {
	if (/^obsidian:\/\//i.test(target)) {
		return 'internal';
	}
	if (/^(https?:\/\/|mailto:|tel:)/i.test(target)) {
		return 'external';
	}
	if (/^[a-z][a-z\d+\-.]*:\/\//i.test(target)) {
		return 'external';
	}
	if (/^[a-z][a-z\d+\-.]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) {
		return 'external';
	}
	if (target.startsWith('[[') || target.startsWith('#')) {
		return 'internal';
	}
	return 'internal';
}
