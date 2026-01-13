export interface ChangeSummary {
	preview: string | null;
	primaryValue: string | null;
}

export function computeChangeSummary(previousContent: string, content: string, limit: number): ChangeSummary {
	if (previousContent === content) {
		return { preview: '', primaryValue: null };
	}
	const change = findChangeLine(previousContent, content);
	if (change.lineIndex < 0) {
		return { preview: '', primaryValue: null };
	}
	const preview = normalizeInlineText(change.line);
	const clipped = preview.length > limit ? preview.slice(0, limit) : preview;
	const primaryValue = extractPrimaryValue(content, change.lineIndex);
	return {
		preview: clipped || '',
		primaryValue
	};
}

function findChangeLine(previousContent: string, content: string): { lineIndex: number; line: string } {
	const previousLines = previousContent.split(/\r?\n/);
	const lines = content.split(/\r?\n/);
	const max = Math.max(previousLines.length, lines.length);
	for (let index = 0; index < max; index++) {
		const currentLine = (lines[index] ?? '').trim();
		const previousLine = (previousLines[index] ?? '').trim();
		if (currentLine === previousLine) {
			continue;
		}
		if (!currentLine || isSkippablePreviewLine(currentLine)) {
			continue;
		}
		return { lineIndex: index, line: currentLine };
	}
	return { lineIndex: -1, line: '' };
}

function isSkippablePreviewLine(line: string): boolean {
	return line.startsWith('#')
		|| line.startsWith('```')
		|| line.startsWith('---')
		|| line.startsWith('|')
		|| line.startsWith('>')
		|| line.startsWith('<!--');
}

function extractPrimaryValue(content: string, lineIndex: number): string | null {
	const lines = content.split(/\r?\n/);
	let lastHeading = '';
	for (let index = 0; index <= lineIndex && index < lines.length; index++) {
		const trimmed = lines[index]?.trim() ?? '';
		if (/^##(?!#)\s+/.test(trimmed)) {
			lastHeading = trimmed.replace(/^##\s*/, '');
		}
	}
	if (!lastHeading) {
		return null;
	}
	const colonIndex = resolveColonIndex(lastHeading);
	if (colonIndex <= 0) {
		return lastHeading.trim() || null;
	}
	const value = lastHeading.slice(colonIndex + 1).trim();
	return value.length > 0 ? value : null;
}

function resolveColonIndex(text: string): number {
	const asciiIndex = text.indexOf(':');
	const fullWidthIndex = text.indexOf('\uFF1A');
	if (asciiIndex == -1) {
		return fullWidthIndex;
	}
	if (fullWidthIndex == -1) {
		return asciiIndex;
	}
	return Math.min(asciiIndex, fullWidthIndex);
}

function normalizeInlineText(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}
