import type { H2Block } from '../MarkdownBlockParser';

export interface CollapsedFieldEntry {
	name: string;
	value: string;
	isSystem?: boolean;
}

export interface CollapsedFieldPayload {
	version: number;
	fields: CollapsedFieldEntry[];
}

export const COLLAPSED_SUMMARY_LABEL = 'Collapsed fields';
export const COLLAPSED_LINE_KEY = 'collapsed';

const COLLAPSED_LINE_PATTERN = /^collapsed\s*[:：]\s*(.*)$/i;
const ENTRY_PATTERN = /(\S+?)::/g;
const LEGACY_BLOCK_START = /^```(?:tlb-collapsed|tilelinebase-collapsed)\s*$/i;
const LEGACY_LABEL_PATTERN = /^(?:\u6298\u53E0\u5B57\u6BB5|collapsed\s+fields?)\s*[:：]?\s*(.+)?$/i;
const COLLAPSED_COMMENT_PATTERN = /%%\s*tlb-collapsed\s+({.*?})\s*%%/i;
const COLLAPSED_HTML_COMMENT_PATTERN = /^<!--\s*tlb\.collapsed[:\uFF1A]\s*(\{[\s\S]*})\s*-->$/i;
const COLLAPSED_CALLOUT_HEADER_PATTERN = /^>\s*\[!(?:tlb[-\s]?collapsed|tilelinebase-collapsed)\b[^\]]*\](?:[+-])?.*$/i;
const CALLOUT_LINE_PREFIX = /^>\s?/;
const CALLOUT_BULLET_PREFIX = /^(?:[-*+]\s+|\d+\.\s+)/;

export const SYSTEM_COLLAPSED_FIELD_SET = new Set(['statusChanged']);

export type CollapsedFieldSource = 'callout' | 'dataLine' | 'legacy';

export function isCollapsedDataLine(line: string): boolean {
	return COLLAPSED_LINE_PATTERN.test(line.trim());
}

export function parseCollapsedDataLine(line: string): CollapsedFieldEntry[] {
	const trimmed = line.trim();
	const match = trimmed.match(COLLAPSED_LINE_PATTERN);
	if (!match) {
		return [];
	}
	const body = match[1] ?? '';
	return parseCollapsedBody(body);
}

export function parseLegacySummaryLine(line: string): CollapsedFieldEntry[] {
	const trimmed = line.trim();
	const { payload } = splitLegacySummaryLine(trimmed);
	return payload?.fields ?? [];
}

export function isCollapsedCalloutStart(line: string): boolean {
	return COLLAPSED_CALLOUT_HEADER_PATTERN.test(line.trim());
}

export function parseCollapsedCallout(
	lines: string[],
	startIndex: number
): { entries: CollapsedFieldEntry[]; endIndex: number } | null {
	const entries: CollapsedFieldEntry[] = [];
	let endIndex = startIndex;
	for (let i = startIndex + 1; i < lines.length; i++) {
		const raw = lines[i];
		const trimmed = raw.trim();
		if (trimmed.length === 0) {
			endIndex = i;
			break;
		}
		if (!trimmed.startsWith('>')) {
			break;
		}
		if (isCollapsedCalloutStart(trimmed)) {
			break;
		}
		endIndex = i;
		const content = normalizeCalloutContent(raw);
		if (!content) {
			continue;
		}
		if (isCollapsedDataLine(content)) {
			entries.push(...parseCollapsedDataLine(content));
			continue;
		}
		const legacyEntries = parseLegacySummaryLine(content);
		if (legacyEntries.length > 0) {
			entries.push(...legacyEntries);
			continue;
		}
		const single = parseCalloutEntry(content);
		if (single) {
			entries.push(single);
		}
	}
	if (entries.length === 0) {
		return null;
	}
	return { entries, endIndex };
}

function parseCollapsedBody(body: string): CollapsedFieldEntry[] {
	const entries: CollapsedFieldEntry[] = [];
	const matches: Array<{ name: string; index: number; valueStart: number }> = [];
	let match: RegExpExecArray | null;
	while ((match = ENTRY_PATTERN.exec(body)) !== null) {
		const name = match[1];
		const valueStart = match.index + match[0].length;
		matches.push({ name, index: match.index, valueStart });
	}
	for (let i = 0; i < matches.length; i++) {
		const current = matches[i];
		const nextIndex = i + 1 < matches.length ? matches[i + 1].index : body.length;
		const raw = body.slice(current.valueStart, nextIndex).trim();
		const value = decodeCollapsedValue(raw);
		entries.push({
			name: current.name,
			value,
			isSystem: SYSTEM_COLLAPSED_FIELD_SET.has(current.name)
		});
	}
	return entries;
}

export function mergeCollapsedEntries(
	target: H2Block & { collapsedFieldSource?: CollapsedFieldSource },
	entries: CollapsedFieldEntry[],
	source?: CollapsedFieldSource
): void {
	if (!entries || entries.length === 0) {
		return;
	}
	const unique = new Map<string, CollapsedFieldEntry>();
	for (const entry of entries) {
		const normalized: CollapsedFieldEntry = {
			name: entry.name,
			value: entry.value,
			isSystem: entry.isSystem ?? SYSTEM_COLLAPSED_FIELD_SET.has(entry.name)
		};
		unique.set(normalized.name, normalized);
		target.data[normalized.name] = normalized.value;
	}
	target.collapsedFields = Array.from(unique.values());
	if (source === 'callout') {
		target.collapsedFieldSource = 'callout';
	} else if (!target.collapsedFieldSource && source) {
		target.collapsedFieldSource = source;
	}
}

export function buildCollapsedDataLine(entries: CollapsedFieldEntry[]): string | null {
	if (!entries || entries.length === 0) {
		return null;
	}
	const parts: string[] = [];
	for (const entry of entries) {
		const encoded = encodeCollapsedValue(entry.value);
		parts.push(`${entry.name}::${encoded}`);
	}
	return `${COLLAPSED_LINE_KEY}: ${parts.join(' ')}`;
}

export function buildCollapsedSummary(entries: CollapsedFieldEntry[]): string {
	const userEntries = entries.filter((entry) => !entry.isSystem);
	if (userEntries.length === 0) {
		return COLLAPSED_SUMMARY_LABEL;
	}
	const first = userEntries[0];
	const preview = formatPreviewValue(first.value);
	let summary = `${COLLAPSED_SUMMARY_LABEL}: {${first.name}::${preview}}`;
	if (userEntries.length > 1) {
		summary += ', ...';
	}
	return summary;
}

export function parseLegacyBlock(lines: string[], startIndex: number): { entries: CollapsedFieldEntry[]; endIndex: number } | null {
	const entries: CollapsedFieldEntry[] = [];
	for (let i = startIndex + 1; i < lines.length; i++) {
		const current = lines[i];
		if (/^```/.test(current)) {
			return { entries, endIndex: i };
		}
		const parts = current.split('::');
		if (parts.length >= 2) {
			const name = parts.shift()?.trim() ?? '';
			const value = parts.join('::').trim();
			if (name) {
				entries.push({
					name,
					value: decodeCollapsedValue(value),
					isSystem: SYSTEM_COLLAPSED_FIELD_SET.has(name)
				});
			}
		}
	}
	return null;
}

export function isLegacyBlockStart(line: string): boolean {
	return LEGACY_BLOCK_START.test(line.trim());
}

export function parseLegacyLabel(line: string): string | null {
	const match = line.match(LEGACY_LABEL_PATTERN);
	if (!match) {
		return null;
	}
	const captured = match[1];
	return typeof captured === 'string' ? captured.trim() : '';
}

export function splitLegacySummaryLine(line: string): { visible: string; payload: CollapsedFieldPayload | null } {
	const trimmed = line.trimEnd();
	const match = trimmed.match(COLLAPSED_COMMENT_PATTERN);
	if (!match) {
		return { visible: trimmed, payload: null };
	}
	const comment = match[1];
	const payload = comment ? extractCollapsedPayload(comment) : null;
	const visible = trimmed.replace(COLLAPSED_COMMENT_PATTERN, '').trimEnd();
	return { visible, payload };
}

export function extractCollapsedPayload(commentSource: string): CollapsedFieldPayload | null {
	try {
		const parsed = JSON.parse(commentSource) as CollapsedFieldPayload;
		if (!parsed || typeof parsed !== 'object') {
			return null;
		}
		if (typeof parsed.version !== 'number' || !Array.isArray(parsed.fields)) {
			return null;
		}
		const fields: CollapsedFieldEntry[] = [];
		for (const field of parsed.fields) {
			if (!field || typeof field !== 'object') {
				continue;
			}
			const name = typeof field.name === 'string' ? field.name : '';
			if (!name) {
				continue;
			}
			const value = typeof field.value === 'string' ? field.value : '';
			const isSystem = field.isSystem === true || SYSTEM_COLLAPSED_FIELD_SET.has(name);
			fields.push({ name, value, isSystem });
		}
		return {
			version: parsed.version,
			fields
		};
	} catch {
		return null;
	}
}

export function parseCollapsedCommentSource(line: string): CollapsedFieldEntry[] {
	const match = line.trim().match(COLLAPSED_HTML_COMMENT_PATTERN);
	if (!match) {
		return [];
	}
	try {
		const parsed = JSON.parse(match[1] ?? '') as Record<string, unknown>;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return [];
		}
		const entries: CollapsedFieldEntry[] = [];
		for (const [key, rawValue] of Object.entries(parsed)) {
			const name = key.trim();
			if (!name) {
				continue;
			}
			if (rawValue === undefined || rawValue === null) {
				continue;
			}
			const value =
				typeof rawValue === 'string'
					? rawValue
					: typeof rawValue === 'number' || typeof rawValue === 'boolean'
					? String(rawValue)
					: '';
			if (!value) {
				continue;
			}
			entries.push({
				name,
				value,
				isSystem: SYSTEM_COLLAPSED_FIELD_SET.has(name)
			});
		}
		return entries;
	} catch {
		return [];
	}
}

export function encodeCollapsedValue(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

export function decodeCollapsedValue(value: string): string {
	return value.replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
}

export function buildCollapsedCallout(entries: CollapsedFieldEntry[]): string[] {
	if (!entries || entries.length === 0) {
		return [];
	}
	const summary = buildCollapsedSummary(entries);
	const lines = [`> [!tlb-collapsed] ${summary}`];
	for (const entry of entries) {
		lines.push(`> ${entry.name}::${entry.value}`);
	}
	return lines;
}

function formatPreviewValue(value: string): string {
	const normalized = value.replace(/\s+/g, ' ').trim();
	if (normalized.length <= 40) {
		return normalized;
	}
	return `${normalized.slice(0, 37)}...`;
}

function normalizeCalloutContent(line: string): string {
	let content = line.replace(CALLOUT_LINE_PREFIX, '').trim();
	while (content.startsWith('>')) {
		content = content.slice(1).trim();
	}
	content = content.replace(CALLOUT_BULLET_PREFIX, '').trim();
	return content;
}

function parseCalloutEntry(content: string): CollapsedFieldEntry | null {
	const separatorIndex = content.indexOf('::');
	if (separatorIndex <= 0) {
		return null;
	}
	const name = content.slice(0, separatorIndex).trim();
	if (!name) {
		return null;
	}
	const value = content.slice(separatorIndex + 2).trim();
	return {
		name,
		value,
		isSystem: SYSTEM_COLLAPSED_FIELD_SET.has(name)
	};
}
