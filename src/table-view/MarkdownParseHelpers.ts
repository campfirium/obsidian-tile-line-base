export type InvalidSectionReason = 'missingColon' | 'invalidField';

export function resolveColonIndex(text: string): number {
	const asciiIndex = text.indexOf(':');
	const fullWidthIndex = text.indexOf('\uFF1A');
	if (asciiIndex === -1) {
		return fullWidthIndex;
	}
	if (fullWidthIndex === -1) {
		return asciiIndex;
	}
	return Math.min(asciiIndex, fullWidthIndex);
}

export function isRuntimeConfigBlock(content: string, blockStartIndex: number, blockContent: string): boolean {
	const preceding = content.slice(0, blockStartIndex).replace(/\r/g, '');
	let headingLine = '';
	const lastHeadingStart = preceding.lastIndexOf('\n## ');
	if (lastHeadingStart >= 0) {
		const headingStart = lastHeadingStart + 1;
		const headingEnd = preceding.indexOf('\n', headingStart);
		headingLine = preceding.slice(headingStart, headingEnd === -1 ? preceding.length : headingEnd).trim();
	} else if (preceding.startsWith('## ')) {
		const firstLineEnd = preceding.indexOf('\n');
		headingLine = (firstLineEnd === -1 ? preceding : preceding.slice(0, firstLineEnd)).trim();
	}
	const runtimeHeadingPattern = /^##\s+tlb\s+[A-Za-z0-9-]{4,}\s+\d+$/;
	if (headingLine && runtimeHeadingPattern.test(headingLine)) {
		return true;
	}
	const firstContentLine = blockContent
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0 && !line.startsWith('#'));
	if (!firstContentLine) {
		return false;
	}
	const runtimeKeyPattern = /^(filterViews|columnWidths|viewPreference|__meta__)\b/i;
	return runtimeKeyPattern.test(firstContentLine);
}

export function buildInvalidSection(
	lines: string[],
	headingIndex: number,
	reason: InvalidSectionReason
): {
	startLine: number;
	endLine: number;
	text: string;
	heading: string;
	reason: InvalidSectionReason;
} {
	let endIndex = headingIndex;
	let probeInCodeBlock = false;
	for (let i = headingIndex + 1; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (trimmed.startsWith('```')) {
			probeInCodeBlock = !probeInCodeBlock;
		}
		if (!probeInCodeBlock && /^##(?!#)/.test(trimmed)) {
			break;
		}
		endIndex = i;
	}
	return {
		startLine: headingIndex,
		endLine: endIndex,
		text: lines.slice(headingIndex, endIndex + 1).join('\n'),
		heading: lines[headingIndex] ?? '',
		reason
	};
}
