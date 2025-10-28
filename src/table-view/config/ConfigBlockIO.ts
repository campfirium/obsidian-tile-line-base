export const CONFIG_CALLOUT_TYPE = '[!tlb-config]';
const CONFIG_COMMENT_KEY = 'tlb.config';
const CONFIG_CALLOUT_HEADER_PATTERN = /^>\s*\[!tlb-config]/i;
// Accept both ASCII and full-width colons to tolerate locale-specific edits.
const CONFIG_COMMENT_PATTERN = /^<!--\s*tlb\.config[:\uFF1A]\s*(\{[\s\S]*})\s*-->$/i;
const CONFIG_COMMENT_PREFIX_PATTERN = /^<!--\s*tlb\.config/i;
const CONFIG_COMMENT_CONTINUATION_CHARS = new Set(['{', '}', '[', ']', '"', '\'', ',']);

export interface ConfigCalloutMeta {
	fileId: string;
	version: number;
}

export interface ConfigCalloutPayload {
	meta: ConfigCalloutMeta | null;
	data: Record<string, any> | null;
}

export function buildConfigCalloutBlock(
	fileId: string,
	version: number,
	payload: Record<string, unknown>
): string {
	const sanitized = sanitizePayload(payload);
	const json = JSON.stringify({ meta: { fileId, version }, data: sanitized });
	return `> ${CONFIG_CALLOUT_TYPE}- TLB config block\n<!-- ${CONFIG_COMMENT_KEY}: ${json} -->`;
}

export function stripExistingConfigBlock(content: string): string {
	const lines = content.split(/\r?\n/);
	const output: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		if (CONFIG_CALLOUT_HEADER_PATTERN.test(trimmed)) {
			const nextTrimmed = lines[i + 1]?.trim() ?? '';
			if (CONFIG_COMMENT_PREFIX_PATTERN.test(nextTrimmed)) {
				i += skipConfigComment(lines, i + 1);
			}
			continue;
		}
		if (CONFIG_COMMENT_PREFIX_PATTERN.test(trimmed)) {
			i += skipConfigComment(lines, i);
			continue;
		}
		output.push(line);
	}
	return collapseExtraBlankLines(output.join('\n'));
}

function skipConfigComment(lines: string[], startIndex: number): number {
	let offset = 0;
	const startLine = lines[startIndex] ?? '';
	const trimmedStart = startLine.trim();
	if (CONFIG_COMMENT_PATTERN.test(trimmedStart) || trimmedStart.includes('-->')) {
		return offset;
	}
	while (startIndex + offset + 1 < lines.length) {
		const nextIndex = startIndex + offset + 1;
		const nextLine = lines[nextIndex];
		const nextTrimmed = nextLine.trim();
		if (CONFIG_CALLOUT_HEADER_PATTERN.test(nextTrimmed)) {
			break;
		}
		if (!nextTrimmed) {
			offset += 1;
			continue;
		}
		if (CONFIG_COMMENT_PATTERN.test(nextTrimmed) || nextTrimmed.includes('-->')) {
			offset += 1;
			break;
		}
		const firstChar = nextTrimmed.charAt(0);
		if (
			CONFIG_COMMENT_PREFIX_PATTERN.test(nextTrimmed) ||
			(firstChar && CONFIG_COMMENT_CONTINUATION_CHARS.has(firstChar))
		) {
			offset += 1;
			continue;
		}
		break;
	}
	return offset;
}

export function readConfigCallout(content: string): ConfigCalloutPayload | null {
	const commentMatch = content.match(CONFIG_COMMENT_PATTERN);
	if (!commentMatch) {
		return null;
	}
	try {
		const parsed = JSON.parse(commentMatch[1]);
		if (!parsed || typeof parsed !== 'object') {
			return null;
		}
		const meta = parseMeta((parsed as any).meta);
		const dataCandidate = (parsed as any).data ?? parsed;
		const data = isRecord(dataCandidate) ? dataCandidate : null;
		return { meta, data };
	} catch {
		return null;
	}
}


function parseMeta(value: unknown): ConfigCalloutMeta | null {
	if (!value || typeof value !== 'object') {
		return null;
	}
	const fileId = typeof (value as any).fileId === 'string' ? (value as any).fileId : '';
	const version = typeof (value as any).version === 'number' ? (value as any).version : Number.NaN;
	if (!fileId || Number.isNaN(version)) {
		return null;
	}
	return { fileId, version };
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(payload)) {
		if (value === undefined) {
			continue;
		}
		result[key] = value;
	}
	return result;
}

function isRecord(value: unknown): value is Record<string, any> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function collapseExtraBlankLines(source: string): string {
	return source.replace(/\n{3,}/g, '\n\n');
}


