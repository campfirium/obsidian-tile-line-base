import type { KanbanCardContentConfig } from '../../types/kanban';
import { buildDefaultContentSettings } from './KanbanCardContent';

const LINE_BREAK_NORMALIZER = /\r\n?/g;
const PLACEHOLDER_OPEN_TRIM = /\{\{\s*/g;
const PLACEHOLDER_CLOSE_TRIM = /\s*\}\}/g;

const normalizeTemplate = (value: string | null | undefined): string =>
	typeof value === 'string'
		? value.replace(LINE_BREAK_NORMALIZER, '\n').replace(PLACEHOLDER_OPEN_TRIM, '{').replace(PLACEHOLDER_CLOSE_TRIM, '}')
		: '';

export function cloneKanbanContentConfig(config: KanbanCardContentConfig | null | undefined): KanbanCardContentConfig {
	return {
		titleTemplate: normalizeTemplate(config?.titleTemplate),
		bodyTemplate: normalizeTemplate(config?.bodyTemplate),
		tagsTemplate: normalizeTemplate(config?.tagsTemplate),
		showBody: typeof config?.showBody === 'boolean' ? config.showBody : true,
		tagsBelowBody: typeof config?.tagsBelowBody === 'boolean' ? config.tagsBelowBody : false
	};
}

export function resolveInitialKanbanContentConfig(
	raw: KanbanCardContentConfig | null | undefined,
	availableFields: string[],
	laneField: string | null
): KanbanCardContentConfig {
	const defaults = buildDefaultContentSettings({
		availableFields,
		laneField
	});
	if (!raw) {
		return { ...defaults };
}
	const sanitized = cloneKanbanContentConfig(raw);
	return {
		titleTemplate: sanitized.titleTemplate || defaults.titleTemplate,
		bodyTemplate: sanitized.bodyTemplate || defaults.bodyTemplate,
		tagsTemplate: sanitized.tagsTemplate || defaults.tagsTemplate,
		showBody: sanitized.showBody,
		tagsBelowBody: sanitized.tagsBelowBody
	};
}

export function areKanbanContentConfigsEqual(
	a: KanbanCardContentConfig | null | undefined,
	b: KanbanCardContentConfig | null | undefined
): boolean {
	const first = cloneKanbanContentConfig(a);
	const second = cloneKanbanContentConfig(b);
	return (
		first.titleTemplate === second.titleTemplate &&
		first.bodyTemplate === second.bodyTemplate &&
		first.tagsTemplate === second.tagsTemplate &&
		first.showBody === second.showBody &&
		first.tagsBelowBody === second.tagsBelowBody
	);
}

export function isKanbanContentConfigEffectivelyEmpty(
	config: KanbanCardContentConfig | null | undefined
): boolean {
	const normalized = cloneKanbanContentConfig(config);
	return (
		normalized.titleTemplate.length === 0 &&
		normalized.bodyTemplate.length === 0 &&
		normalized.tagsTemplate.length === 0 &&
		normalized.showBody === true &&
		normalized.tagsBelowBody === false
	);
}
