import type { FilterCondition, FilterOperator, FilterRule, SortRule } from '../../types/filterView';
import type { RowData } from '../../grid/GridAdapter';
import { tryParseDate, tryParseNumber, tryParseTime } from './FilterValueParsers';

type NormalizedSortValue = {
	type: 'empty' | 'number' | 'date' | 'time' | 'string';
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
		const cellRaw = row[condition.column];
		const cellText = cellRaw == null ? '' : String(cellRaw);
		const compareText = condition.value == null ? '' : String(condition.value);
		const operator = condition.operator as FilterOperator;

		switch (operator) {
			case 'equals':
				return this.evaluateEquality(cellText, compareText);
			case 'notEquals':
				return !this.evaluateEquality(cellText, compareText);
			case 'contains': {
				const cellNormalized = this.normalizeText(cellText);
				const compareNormalized = this.normalizeText(compareText);
				if (compareNormalized.length === 0) {
					return true;
				}
				return cellNormalized.includes(compareNormalized);
			}
			case 'notContains': {
				const cellNormalized = this.normalizeText(cellText);
				const compareNormalized = this.normalizeText(compareText);
				if (compareNormalized.length === 0) {
					return false;
				}
				return !cellNormalized.includes(compareNormalized);
			}
			case 'startsWith': {
				const cellNormalized = this.normalizeText(cellText);
				const compareNormalized = this.normalizeText(compareText);
				return cellNormalized.startsWith(compareNormalized);
			}
			case 'endsWith': {
				const cellNormalized = this.normalizeText(cellText);
				const compareNormalized = this.normalizeText(compareText);
				return cellNormalized.endsWith(compareNormalized);
			}
			case 'isEmpty':
				return cellText.trim().length === 0;
			case 'isNotEmpty':
				return cellText.trim().length > 0;
			case 'greaterThan':
				return this.evaluateComparison(cellText, compareText, (comparison) => comparison > 0);
			case 'lessThan':
				return this.evaluateComparison(cellText, compareText, (comparison) => comparison < 0);
			case 'greaterOrEqual':
				return this.evaluateComparison(cellText, compareText, (comparison) => comparison >= 0);
			case 'lessOrEqual':
				return this.evaluateComparison(cellText, compareText, (comparison) => comparison <= 0);
			default:
				return false;
		}
	}

	private static evaluateEquality(cell: string, target: string): boolean {
		const numericComparison = this.compareNumbers(cell, target);
		if (numericComparison !== null) {
			return numericComparison === 0;
		}
		const timeComparison = this.compareTimes(cell, target);
		if (timeComparison !== null) {
			return timeComparison === 0;
		}
		const dateComparison = this.compareDates(cell, target);
		if (dateComparison !== null) {
			return dateComparison === 0;
		}
		return this.normalizeText(cell) === this.normalizeText(target);
	}

	private static evaluateComparison(
		cell: string,
		target: string,
		predicate: (comparisonResult: number) => boolean
	): boolean {
		const numericComparison = this.compareNumbers(cell, target);
		if (numericComparison !== null) {
			return predicate(numericComparison);
		}
		const timeComparison = this.compareTimes(cell, target);
		if (timeComparison !== null) {
			return predicate(timeComparison);
		}
		const dateComparison = this.compareDates(cell, target);
		if (dateComparison !== null) {
			return predicate(dateComparison);
		}
		return false;
	}

	private static compareNumbers(left: string, right: string): number | null {
		const leftNumber = tryParseNumber(left);
		const rightNumber = tryParseNumber(right);
		if (leftNumber === null || rightNumber === null) {
			return null;
		}
		if (leftNumber === rightNumber) {
			return 0;
		}
		return leftNumber > rightNumber ? 1 : -1;
	}

	private static compareDates(left: string, right: string): number | null {
		const leftDate = tryParseDate(left);
		const rightDate = tryParseDate(right);
		if (leftDate === null || rightDate === null) {
			return null;
		}
		if (leftDate === rightDate) {
			return 0;
		}
		return leftDate > rightDate ? 1 : -1;
	}

	private static compareTimes(left: string, right: string): number | null {
		const leftTime = tryParseTime(left);
		const rightTime = tryParseTime(right);
		if (leftTime === null || rightTime === null) {
			return null;
		}
		if (leftTime === rightTime) {
			return 0;
		}
		return leftTime > rightTime ? 1 : -1;
	}

	private static normalizeText(value: string): string {
		return value.trim().toLowerCase();
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
		if (
			normalizedA.type === 'number' ||
			normalizedA.type === 'date' ||
			normalizedA.type === 'time'
		) {
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
		const text = String(value);
		const parsed = parseFloat(text);
		if (!Number.isNaN(parsed) && String(parsed) === text.trim()) {
			return { type: 'number', value: parsed, rank: 2 };
		}
		const asTime = tryParseTime(text);
		if (asTime !== null) {
			return { type: 'time', value: asTime, rank: 3 };
		}
		const asDate = tryParseDate(text);
		if (asDate !== null) {
			return { type: 'date', value: asDate, rank: 3 };
		}
		return { type: 'string', value: text, rank: 1 };
	}
}
