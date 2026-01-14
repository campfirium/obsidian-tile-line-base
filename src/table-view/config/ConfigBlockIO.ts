const CONFIG_CALLOUT_PATTERN = /^\s*>\s*\[!tlb-config]/im;
const CONFIG_COMMENT_PATTERN = /<!--\s*tlb\.config\s*[:\uFF1A]\s*(\{[\s\S]*?})\s*-->/i;
const CALLOUT_STRIP_PATTERN =
	/(^|\n)\s*>[^\n]*\[!tlb-config][^\n]*(?:<!--\s*tlb\.config\s*[:\uFF1A]\s*\{[\s\S]*?-->)?(?=\n|$)/gi;
const COMMENT_STRIP_PATTERN = /(^|\n)\s*<!--\s*tlb\.config\s*[:\uFF1A]\s*\{[\s\S]*?-->\s*/gi;

export interface ConfigCalloutMeta {
	fileId: string;
	version: number;
}

export interface ConfigCalloutPayload {
	meta: ConfigCalloutMeta | null;
	data: Record<string, unknown> | null;
}

export function buildConfigCalloutBlock(payload: unknown, meta?: ConfigCalloutMeta | null): string {
	const sanitized = sanitizePayload(payload);
	const resolvedMeta = meta ?? {
		fileId: generateConfigBlockId(),
		version: Date.now()
	};
	const json = JSON.stringify({ meta: resolvedMeta, data: sanitized });
	return `> [!tlb-config] - TLB config block <!-- tlb.config: ${json} -->`;
}

export function readConfigCallout(content: string): ConfigCalloutPayload | null {
	if (!CONFIG_CALLOUT_PATTERN.test(content)) {
		return null;
	}
	const match = content.match(CONFIG_COMMENT_PATTERN);
	if (!match) {
		return null;
	}
	try {
		const parsed = JSON.parse(match[1]);
		if (!isRecord(parsed)) {
			return null;
		}
		const meta = parseMeta(parsed.meta);
		const candidate = 'data' in parsed ? parsed.data : parsed;
		const data = isRecord(candidate) ? candidate : null;
		return { meta, data };
	} catch {
		return null;
	}
}

export function stripExistingConfigBlock(content: string): string {
	let cleaned = content.replace(CALLOUT_STRIP_PATTERN, '\n');
	cleaned = cleaned.replace(COMMENT_STRIP_PATTERN, '\n');
	return cleaned.replace(/\n{3,}/g, '\n\n');
}

function parseMeta(value: unknown): ConfigCalloutMeta | null {
	if (!isRecord(value)) {
		return null;
	}
	const fileId = typeof value.fileId === 'string' ? value.fileId : '';
	const version = typeof value.version === 'number' ? value.version : Number.NaN;
	if (!fileId || Number.isNaN(version)) {
		return null;
	}
	return { fileId, version };
}

function sanitizePayload(payload: unknown): Record<string, unknown> {
	if (!payload || typeof payload !== 'object') {
		return {};
	}
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
		if (value === undefined) {
			continue;
		}
		result[key] = value;
	}
	return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function generateConfigBlockId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID().split('-')[0];
	}
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
