import { Menu } from 'obsidian';
import type { RowData } from '../../grid/GridAdapter';
import type { FilterRule, FilterViewDefinition } from '../../types/filterView';
import type { TagGroupDefinition } from '../../types/tagGroup';

export interface GalleryCardFieldOption {
	value: string;
	label: string;
}

export interface GalleryCardFieldContext {
	field: string;
	options: GalleryCardFieldOption[];
}

export function resolveGalleryCardFieldContext(options: {
	activeGroup: TagGroupDefinition | null;
	filterViews: FilterViewDefinition[];
}): GalleryCardFieldContext | null {
	const group = options.activeGroup;
	if (!group || !Array.isArray(group.viewIds) || group.viewIds.length === 0) {
		return null;
	}

	const viewIdSet = new Set(group.viewIds);
	const dedupedValues = new Set<string>();
	const resolvedOptions: GalleryCardFieldOption[] = [];
	let field: string | null = null;

	for (const view of options.filterViews) {
		if (!viewIdSet.has(view.id)) {
			continue;
		}
		const condition = extractSingleEqualsCondition(view.filterRule);
		if (!condition) {
			continue;
		}
		if (field && condition.column.toLowerCase() !== field.toLowerCase()) {
			return null;
		}
		field = field ?? condition.column;

		const dedupKey = condition.value.toLowerCase();
		if (dedupedValues.has(dedupKey)) {
			continue;
		}
		dedupedValues.add(dedupKey);

		const label =
			typeof view.name === 'string' && view.name.trim().length > 0 ? view.name.trim() : condition.value;
		resolvedOptions.push({
			value: condition.value,
			label
		});
	}

	if (!field || resolvedOptions.length < 2) {
		return null;
	}

	return {
		field,
		options: resolvedOptions
	};
}

export function normalizeGalleryCardFieldValue(field: string, value: unknown): string {
	const normalizedField = typeof field === 'string' ? field.trim().toLowerCase() : '';
	const normalizedValue = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
	if (!normalizedValue) {
		return '';
	}
	if (normalizedField === 'status') {
		return normalizedValue.toLowerCase().replace(/[\s_/-]+/g, '');
	}
	return normalizedValue.toLowerCase();
}

export function openGalleryCardFieldMenu(options: {
	row: RowData;
	context: GalleryCardFieldContext | null;
	event: MouseEvent;
	onApply: (value: string) => void | Promise<void>;
}): void {
	const { row, context, event, onApply } = options;
	if (!context || !context.field || !Array.isArray(context.options) || context.options.length === 0) {
		return;
	}

	const menu = new Menu();
	const rawCurrent = row[context.field];
	const currentValue = typeof rawCurrent === 'string' ? rawCurrent.trim() : String(rawCurrent ?? '').trim();
	const currentKey = normalizeGalleryCardFieldValue(context.field, currentValue);
	let added = false;

	for (const option of context.options) {
		const value = typeof option.value === 'string' ? option.value.trim() : String(option.value ?? '').trim();
		if (!value) {
			continue;
		}
		const label =
			typeof option.label === 'string' && option.label.trim().length > 0 ? option.label.trim() : value;
		const normalizedValue = normalizeGalleryCardFieldValue(context.field, value);
		const isActive = normalizedValue === currentKey;

		menu.addItem((item) => {
			item.setTitle(label);
			if (isActive) {
				item.setChecked(true);
				item.setDisabled(true);
			}
			item.onClick(() => {
				if (isActive) {
					return;
				}
				void onApply(value);
			});
		});
		added = true;
	}

	if (!added) {
		return;
	}

	event.preventDefault();
	event.stopPropagation();
	menu.showAtMouseEvent(event);
}

function extractSingleEqualsCondition(rule: FilterRule | null): { column: string; value: string } | null {
	if (!rule || rule.combineMode !== 'AND') {
		return null;
	}
	const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
	if (conditions.length !== 1) {
		return null;
	}
	const condition = conditions[0];
	if (condition.operator !== 'equals') {
		return null;
	}
	const column = typeof condition.column === 'string' ? condition.column.trim() : '';
	const value =
		typeof condition.value === 'string'
			? condition.value.trim()
			: String(condition.value ?? '').trim();
	if (!column || !value) {
		return null;
	}
	return { column, value };
}
