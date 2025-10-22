import type { FilterCondition, FilterOperator, FilterRule, SortRule } from '../../types/filterView';
import type { RowData } from '../../grid/GridAdapter';

type NormalizedSortValue = {
	type: 'empty' | 'number' | 'date' | 'string';
	value: number | string;
	rank: number;
};

export class FilterDataProcessor {
	static applyFilterRule(rows: RowData[], rule: FilterRule): RowData[] {
		return rows.filter((row) => this.matchesFilterRule(row, rule));
	}

	static sortRowData(rows: RowData[], sortRules: SortRule[]): RowData[] {
		if (!Array.isArray(rows)) {
			return [];
		}
		const effectiveRules = (sortRules ?? []).filter((rule) =>
			rule && typeof rule.column === 'string' && rule.column.trim().length > 0
		);
		if (effectiveRules.length === 0) {
			return [...rows];
		}
		const sorted = [...rows];
		sorted.sort((a, b) => this.compareRowsForSort(a, b, effectiveRules));
		return sorted;
	}

	private static matchesFilterRule(row: RowData, rule: FilterRule): boolean {
		const results = rule.conditions.map((condition) => this.evaluateCondition(row, condition));
		return rule.combineMode === 'AND'
			? results.every((result) => result)
			: results.some((result) => result);
	}

	private static evaluateCondition(row: RowData, condition: FilterCondition): boolean {
		const cellValue = row[condition.column];
		const cellStr = cellValue == null ? '' : String(cellValue).toLowerCase();
		const compareStr = (condition.value ?? '').toLowerCase();
		const operator = condition.operator as FilterOperator;

		switch (operator) {
			case 'equals':
				return cellStr === compareStr;
			case 'notEquals':
				return cellStr !== compareStr;
			case 'contains':
				return cellStr.includes(compareStr);
			case 'notContains':
				return !cellStr.includes(compareStr);
			case 'startsWith':
				return cellStr.startsWith(compareStr);
			case 'endsWith':
				return cellStr.endsWith(compareStr);
			case 'isEmpty':
				return cellStr === '';
			case 'isNotEmpty':
				return cellStr !== '';
			case 'greaterThan':
				return parseFloat(cellStr) > parseFloat(compareStr);
			case 'lessThan':
				return parseFloat(cellStr) < parseFloat(compareStr);
			case 'greaterOrEqual':
				return parseFloat(cellStr) >= parseFloat(compareStr);
			case 'lessOrEqual':
				return parseFloat(cellStr) <= parseFloat(compareStr);
			default:
				return false;
		}
	}

	private static compareRowsForSort(a: RowData, b: RowData, sortRules: SortRule[]): number {
		for (const rule of sortRules) {
			const comparison = this.compareValuesForSort(a[rule.column], b[rule.column]);
			if (comparison !== 0) {
				return rule.direction === 'desc' ? -comparison : comparison;
			}
		}
		return 0;
	}

	private static compareValuesForSort(aValue: unknown, bValue: unknown): number {
		const normalizedA = this.normalizeSortValue(aValue);
		const normalizedB = this.normalizeSortValue(bValue);
		if (normalizedA.rank !== normalizedB.rank) {
			return normalizedA.rank - normalizedB.rank;
		}
		if (normalizedA.type === 'number' || normalizedA.type === 'date') {
			return (normalizedA.value as number) - (normalizedB.value as number);
		}
		if (normalizedA.type === 'string') {
			return (normalizedA.value as string).localeCompare(normalizedB.value as string);
		}
		return 0;
	}

	private static normalizeSortValue(value: unknown): NormalizedSortValue {
		if (value == null) {
			return { type: 'empty', value: 0, rank: 0 };
		}
		if (value instanceof Date) {
			return { type: 'date', value: value.getTime(), rank: 3 };
		}
		if (typeof value === 'number') {
			if (Number.isNaN(value)) {
				return { type: 'empty', value: 0, rank: 0 };
			}
			return { type: 'number', value, rank: 2 };
		}
		const parsed = parseFloat(String(value));
		if (!Number.isNaN(parsed) && String(parsed) === String(value).trim()) {
			return { type: 'number', value: parsed, rank: 2 };
		}
		return { type: 'string', value: String(value), rank: 1 };
	}
}
