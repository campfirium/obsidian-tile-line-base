import type { KanbanCardContentConfig } from '../types/kanban';

export function cloneKanbanCardContentConfig(
	source: KanbanCardContentConfig | null | undefined
): KanbanCardContentConfig | null {
	if (!source) {
		return null;
	}
	const normalize = (value: string | null | undefined): string =>
		typeof value === 'string'
			? value.replace(/\r\n?/g, '\n').replace(/\{\{\s*/g, '{').replace(/\s*\}\}/g, '}')
			: '';
	const normalized = {
		titleTemplate: normalize(source.titleTemplate),
		bodyTemplate: normalize(source.bodyTemplate),
		tagsTemplate: normalize(source.tagsTemplate),
		showBody: typeof source.showBody === 'boolean' ? source.showBody : true,
		tagsBelowBody: typeof source.tagsBelowBody === 'boolean' ? source.tagsBelowBody : false
	};
	const isEmpty =
		normalized.titleTemplate.length === 0 &&
		normalized.bodyTemplate.length === 0 &&
		normalized.tagsTemplate.length === 0 &&
		normalized.showBody === true &&
		normalized.tagsBelowBody === false;
	return isEmpty ? null : normalized;
}
