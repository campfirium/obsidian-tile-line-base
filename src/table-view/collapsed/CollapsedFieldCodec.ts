export interface CollapsedFieldEntry {
	name: string;
	value: string;
	isSystem?: boolean;
}

const COLLAPSED_SUMMARY_LABEL = 'Collapsed fields';
const COLLAPSED_CALLOUT_TYPE = '[!tlb-collapsed]';
export const COLLAPSED_COMMENT_KEY = 'tlb.collapsed';

const COLLAPSED_LINE_PATTERN = /^collapsed\s*[:\uFF1A]\s*(.*)$/i;
const ENTRY_PATTERN = /([^\s:]+)[:\uFF1A]{2}/g;
const CALLOUT_HEADER_PATTERN = /^\s*>\s*\[!tlb-collapsed]/i;
const COMMENT_PATTERN = new RegExp(`^<!--\\s*${COLLAPSED_COMMENT_KEY.replace(/\./g, '\\.')}\\s*[:\\uFF1A]\\s*(\\{[\\s\\S]*?})\\s*-->$`, 'i');

export const SYSTEM_COLLAPSED_FIELD_SET = new Set(['statusChanged']);

export function isCollapsedDataLine(line: string): boolean {
	return COLLAPSED_LINE_PATTERN.test(line.trim());
}

export function parseCollapsedDataLine(line: string): CollapsedFieldEntry[] {
	const trimmed = line.trim();
	const match = trimmed.match(COLLAPSED_LINE_PATTERN);
	if (!match) {
		return [];
	}
	return parseCollapsedBody(match[1] ?? '');
}

export function parseCollapsedCommentSource(source: string): CollapsedFieldEntry[] {
	const match = source.trim().match(COMMENT_PATTERN);
	if (!match) {
		return [];
	}
	return parseCollapsedPayload(match[1]);
}

export function isCollapsedCalloutStart(line: string): boolean {
	return CALLOUT_HEADER_PATTERN.test(line.trim());
}

export function parseCollapsedCallout(
	lines: string[],
	startIndex: number
): { entries: CollapsedFieldEntry[]; endIndex: number } | null {
	const currentLine = lines[startIndex];
	if (!currentLine || !isCollapsedCalloutStart(currentLine)) {
		return null;
	}
	const inlineCommentIndex = currentLine.indexOf('<!--');
	if (inlineCommentIndex >= 0) {
		const inlineSource = currentLine.slice(inlineCommentIndex).trim();
		const inlineEntries = parseCollapsedCommentSource(inlineSource);
		if (inlineEntries.length > 0) {
			return { entries: inlineEntries, endIndex: startIndex };
		}
	}
	const next = lines[startIndex + 1]?.trim() ?? '';
	const entries = parseCollapsedCommentSource(next);
	if (entries.length === 0) {
		return null;
	}
	return { entries, endIndex: startIndex + 1 };
}

export function mergeCollapsedEntries(target: { data: Record<string, string>; collapsedFields?: CollapsedFieldEntry[] }, entries: CollapsedFieldEntry[]): void {
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
}

export function buildCollapsedCallout(entries: CollapsedFieldEntry[]): string[] {
	if (!entries || entries.length === 0) {
		return [];
	}
	const payloadObj: Record<string, unknown> = {};
	for (const entry of entries) {
		payloadObj[entry.name] = entry.value;
	}
	const payload = JSON.stringify(payloadObj);
	return [
		`> ${COLLAPSED_CALLOUT_TYPE}- ${COLLAPSED_SUMMARY_LABEL}`,
		`<!-- ${COLLAPSED_COMMENT_KEY}: ${payload} -->`
	];
}

function parseCollapsedBody(body: string): CollapsedFieldEntry[] {
	const entries: CollapsedFieldEntry[] = [];
	const matches: Array<{ name: string; index: number; valueStart: number }> = [];
	let match: RegExpExecArray | null;
	while ((match = ENTRY_PATTERN.exec(body)) !== null) {
		matches.push({ name: match[1], index: match.index, valueStart: match.index + match[0].length });
	}
	for (let i = 0; i < matches.length; i++) {
		const current = matches[i];
		const end = i + 1 < matches.length ? matches[i + 1].index : body.length;
		const raw = body.slice(current.valueStart, end).trim();
		entries.push({
			name: current.name,
			value: decodeCollapsedValue(raw),
			isSystem: SYSTEM_COLLAPSED_FIELD_SET.has(current.name)
		});
	}
	return entries;
}

function parseCollapsedPayload(raw: string): CollapsedFieldEntry[] {
	try {
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object') {
			return [];
		}

		if ((parsed as any).fields && Array.isArray((parsed as any).fields)) {
			const legacyFields = (parsed as any).fields as Array<Record<string, unknown>>;
			const results: CollapsedFieldEntry[] = [];
			for (const field of legacyFields) {
				const name = typeof field.name === 'string' ? field.name : '';
				if (!name) {
					continue;
				}
				const value = normalizeValue(field.value);
				const isSystem = field.isSystem === true || SYSTEM_COLLAPSED_FIELD_SET.has(name);
				results.push({
					name,
					value,
					isSystem
				});
			}
			return results;
		}

		const fields: CollapsedFieldEntry[] = [];
		for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (!name || name === 'version') {
				continue;
			}
			fields.push({
				name,
				value: normalizeValue(value),
				isSystem: SYSTEM_COLLAPSED_FIELD_SET.has(name)
			});
		}
		return fields;
	} catch {
		return [];
	}
}

function normalizeValue(value: unknown): string {
	if (value === null || value === undefined) {
		return '';
	}
	if (typeof value === 'string') {
		return value;
	}
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function decodeCollapsedValue(value: string): string {
	return value.replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
}

