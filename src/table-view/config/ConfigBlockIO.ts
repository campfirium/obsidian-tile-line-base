export const CONFIG_CALLOUT_TYPE = '[!tlb-config]';
const CONFIG_COMMENT_KEY = 'tlb.config';
const CONFIG_CALLOUT_HEADER_PATTERN = /^\s*>\s*\[!tlb-config]/im;
const CONFIG_COMMENT_PATTERN = /<!--\s*tlb\.config\s*[:\uFF1A]\s*(\{[\s\S]*?})\s*-->/i;

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
	return `> ${CONFIG_CALLOUT_TYPE}- TLB config block <!-- ${CONFIG_COMMENT_KEY}: ${json} -->`;
}

export function stripExistingConfigBlock(content: string): string {
	const calloutPattern =
		/(^|\n)\s*>[^\n]*\[!tlb-config][^\n]*(?:<!--\s*tlb\.config\s*[:\uFF1A]\s*\{[\s\S]*?-->)?(?=\n|$)/gi;
	const commentOnlyPattern = /(^|\n)\s*<!--\s*tlb\.config\s*[:\uFF1A]\s*\{[\s\S]*?-->\s*/gi;

	let cleaned = content.replace(calloutPattern, '\n');
	cleaned = cleaned.replace(commentOnlyPattern, '\n');

	return collapseBlankLines(cleaned);
}

export function readConfigCallout(content: string): ConfigCalloutPayload | null {
	if (!CONFIG_CALLOUT_HEADER_PATTERN.test(content)) {
		return null;
	}
	const match = content.match(CONFIG_COMMENT_PATTERN);
	if (!match) {
		return null;
	}
	try {
		const parsed = JSON.parse(match[1]);
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

function collapseBlankLines(source: string): string {
	return source.replace(/\n{3,}/g, '\n\n');
}
