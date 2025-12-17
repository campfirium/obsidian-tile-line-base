export interface MultilineFieldEncoding {
	inlineValue: string;
	fence: string | null;
	contentLines: string[] | null;
}

const TILDE_FENCE_PATTERN = /^~{3,}$/;

function normalizeLineBreaks(value: string): string {
	return value.replace(/\r\n?/g, '\n');
}

function stripCarriageReturn(line: string): string {
	return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function resolveTildeFence(contentLines: string[]): string {
	for (let length = 3; length < 100; length++) {
		const fence = '~'.repeat(length);
		const conflicts = contentLines.some((line) => line === fence);
		if (!conflicts) {
			return fence;
		}
	}
	return '~~~';
}

export function encodeFieldValue(value: string): MultilineFieldEncoding {
	const normalized = normalizeLineBreaks(value ?? '');
	if (!normalized.includes('\n')) {
		return { inlineValue: normalized, fence: null, contentLines: null };
	}
	const contentLines = normalized.split('\n');
	const fence = resolveTildeFence(contentLines);
	return { inlineValue: '', fence, contentLines };
}

export function isTildeFenceMarker(value: string): boolean {
	return TILDE_FENCE_PATTERN.test(stripCarriageReturn(value));
}

export function consumeTildeFencedBlock(
	lines: string[],
	startIndex: number,
	fence: string
): { endIndex: number; value: string } | null {
	const buffer: string[] = [];
	for (let i = startIndex + 1; i < lines.length; i++) {
		const rawLine = lines[i] ?? '';
		const line = stripCarriageReturn(rawLine);
		if (line === fence) {
			return { endIndex: i, value: buffer.join('\n') };
		}
		buffer.push(line);
	}
	return null;
}
