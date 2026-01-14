import type { RowData } from '../../grid/GridAdapter';
import { formatUnknownValue } from '../../utils/valueFormat';
import {
	DEFAULT_KANBAN_CARD_CONTENT,
	type KanbanCardContentConfig,
	type KanbanRuntimeCardContent
} from '../../types/kanban';

const PLACEHOLDER_PATTERN = /\{\s*([^{}]+?)\s*\}/g;
const TAG_SPLIT_PATTERN = /[,，;；、]+/; // Only split on delimiter characters to allow spaces inside tag names.

export function buildDefaultContentSettings(options: {
	availableFields: string[];
	laneField: string | null;
}): KanbanCardContentConfig {
	const fields = sanitizeFields(options.availableFields);
	const laneField = options.laneField?.trim() ?? null;

	const nonLaneFields = laneField ? fields.filter((field) => field !== laneField) : fields.slice();
	const titleField = nonLaneFields[0] ?? fields[0] ?? '';
	const bodyFields = nonLaneFields.filter((field) => field !== titleField);
	const tagFields = collectLikelyTagFields(nonLaneFields);

	return {
		titleTemplate: titleField ? wrapPlaceholder(titleField) : DEFAULT_KANBAN_CARD_CONTENT.titleTemplate,
		bodyTemplate: bodyFields.length > 0
			? bodyFields.map((field) => wrapPlaceholder(field)).join(' ')
			: DEFAULT_KANBAN_CARD_CONTENT.bodyTemplate,
		tagsTemplate: tagFields.length > 0
			? tagFields.map((field) => wrapPlaceholder(field)).join(', ')
			: DEFAULT_KANBAN_CARD_CONTENT.tagsTemplate,
		showBody: true,
		tagsBelowBody: DEFAULT_KANBAN_CARD_CONTENT.tagsBelowBody
	};
}

export function toRuntimeContent(
	raw: KanbanCardContentConfig | null | undefined,
	options: {
		availableFields: string[];
		laneField: string | null;
	}
): KanbanRuntimeCardContent {
	const defaults = buildDefaultContentSettings(options);
	const normalize = (value: string): string => value.replace(/\r\n/g, '\n');
	const normalizedTitle = sanitizeTemplate(raw?.titleTemplate);
	const normalizedBody = sanitizeTemplate(raw?.bodyTemplate);
	const normalizedTags = sanitizeTemplate(raw?.tagsTemplate);

	const titleTemplate = normalizedTitle.length > 0 ? normalize(normalizedTitle) : defaults.titleTemplate;
	const bodyTemplate = normalizedBody.length > 0 ? normalize(normalizedBody) : defaults.bodyTemplate;
	const tagsTemplate = normalizedTags.length > 0 ? normalize(normalizedTags) : defaults.tagsTemplate;
	const showBody = typeof raw?.showBody === 'boolean' ? raw.showBody : defaults.showBody;
	const tagsBelowBody =
		typeof raw?.tagsBelowBody === 'boolean' ? raw.tagsBelowBody : defaults.tagsBelowBody;

	const referencedFields = new Set<string>();
	for (const template of [titleTemplate, bodyTemplate, tagsTemplate]) {
		for (const field of extractTemplateFields(template)) {
			referencedFields.add(field);
		}
	}
	if (typeof options.laneField === 'string' && options.laneField.trim().length > 0) {
		referencedFields.add(options.laneField.trim());
	}

	return {
		titleTemplate,
		bodyTemplate,
		tagsTemplate,
		showBody,
		tagsBelowBody,
		referencedFields: Array.from(referencedFields)
	};
}

export function renderTitle(template: string, row: RowData, fallbackField: string | null): string {
	const rendered = renderTemplate(template, row);
	if (rendered.trim().length > 0) {
		return rendered;
	}
	if (fallbackField) {
		return normalizeValue(row[fallbackField]);
	}
	return '';
}

export function renderBody(template: string, row: RowData): string {
	return renderTemplate(template, row);
}

export function renderTags(template: string, row: RowData): string[] {
	const rendered = renderTemplate(template, row);
	if (rendered.trim().length === 0) {
		return [];
	}
	return rendered
		.split(TAG_SPLIT_PATTERN)
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
}

export function extractTemplateFields(template: string): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	normalizeTemplatePlaceholders(template).replace(PLACEHOLDER_PATTERN, (_match, group) => {
		const name = String(group ?? '')
			.trim()
			.replace(/\r\n/g, '\n');
		if (!name || seen.has(name)) {
			return '';
		}
		seen.add(name);
		result.push(name);
		return '';
	});
	return result;
}

export function renderTemplate(template: string, row: RowData): string {
	if (typeof template !== 'string' || template.length === 0) {
		return '';
	}
	const normalized = normalizeTemplatePlaceholders(template);
	return normalized.replace(PLACEHOLDER_PATTERN, (_match, group) => {
		const fieldName = String(group ?? '').trim();
		if (!fieldName) {
			return '';
		}
		return normalizeValue(row[fieldName]);
	});
}

export function wrapPlaceholder(field: string): string {
	return `{${field}}`;
}

function sanitizeFields(fields: string[]): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	for (const field of fields) {
		if (typeof field !== 'string') {
			continue;
		}
		const trimmed = field.trim();
		if (!trimmed || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		result.push(trimmed);
	}
	return result;
}

function collectLikelyTagFields(fields: string[]): string[] {
	const tagPattern = /(tag|标签|label|分类|category)/i;
	return fields.filter((field) => tagPattern.test(field));
}

function sanitizeTemplate(value: unknown): string {
	if (typeof value !== 'string') {
		return '';
	}
	return normalizeTemplatePlaceholders(value.replace(/\r\n/g, '\n'));
}

function normalizeValue(input: unknown): string {
	if (typeof input === 'string') {
		return input.trim();
	}
	if (input == null) {
		return '';
	}
	return formatUnknownValue(input).trim();
}

function normalizeTemplatePlaceholders(value: string): string {
	return value.replace(/\{\{\s*/g, '{').replace(/\s*\}\}/g, '}');
}
