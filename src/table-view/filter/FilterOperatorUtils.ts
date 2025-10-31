import type { FilterOperator } from '../../types/filterView';
import type { FilterColumnOption } from '../TableViewFilterPresenter';
import type { TranslationKey } from '../../i18n';

const TEXT_OPERATORS: FilterOperator[] = ['equals', 'notEquals', 'contains', 'notContains', 'startsWith', 'endsWith', 'isEmpty', 'isNotEmpty'];
const NUMERIC_ONLY_OPERATORS: FilterOperator[] = ['greaterThan', 'greaterOrEqual', 'lessThan', 'lessOrEqual'];
const DATE_OPERATORS: FilterOperator[] = ['equals', 'notEquals', 'greaterThan', 'greaterOrEqual', 'lessThan', 'lessOrEqual', 'isEmpty', 'isNotEmpty'];
const STATUS_OPERATORS: FilterOperator[] = ['equals', 'notEquals', 'isEmpty', 'isNotEmpty'];

const FILTER_OPERATOR_LABELS: Record<FilterOperator, TranslationKey> = {
	equals: 'filterViewModals.operators.equals',
	notEquals: 'filterViewModals.operators.notEquals',
	contains: 'filterViewModals.operators.contains',
	notContains: 'filterViewModals.operators.notContains',
	startsWith: 'filterViewModals.operators.startsWith',
	endsWith: 'filterViewModals.operators.endsWith',
	isEmpty: 'filterViewModals.operators.isEmpty',
	isNotEmpty: 'filterViewModals.operators.isNotEmpty',
	greaterThan: 'filterViewModals.operators.greaterThan',
	lessThan: 'filterViewModals.operators.lessThan',
	greaterOrEqual: 'filterViewModals.operators.greaterOrEqual',
	lessOrEqual: 'filterViewModals.operators.lessOrEqual'
};

const DATE_OPERATOR_LABELS: Partial<Record<FilterOperator, TranslationKey>> = {
	equals: 'filterViewModals.dateOperators.equals',
	notEquals: 'filterViewModals.dateOperators.notEquals',
	greaterThan: 'filterViewModals.dateOperators.greaterThan',
	greaterOrEqual: 'filterViewModals.dateOperators.greaterOrEqual',
	lessThan: 'filterViewModals.dateOperators.lessThan',
	lessOrEqual: 'filterViewModals.dateOperators.lessOrEqual',
	isEmpty: 'filterViewModals.dateOperators.isEmpty',
	isNotEmpty: 'filterViewModals.dateOperators.isNotEmpty'
};

export const VALUELESS_OPERATORS = new Set<FilterOperator>(['isEmpty', 'isNotEmpty']);

export function getOperatorsForOption(option: FilterColumnOption): FilterOperator[] {
	if (option.kind === 'status') {
		return [...STATUS_OPERATORS];
	}
	if (option.kind === 'date') {
		return [...DATE_OPERATORS];
	}
	const result: FilterOperator[] = [...TEXT_OPERATORS];
	if (option.allowNumericOperators) {
		for (const operator of NUMERIC_ONLY_OPERATORS) {
			if (!result.includes(operator)) {
				result.push(operator);
			}
		}
	}
	return result;
}

export function getOperatorLabelKey(option: FilterColumnOption, operator: FilterOperator): TranslationKey | undefined {
	if (option.kind === 'date') {
		const dateKey = DATE_OPERATOR_LABELS[operator];
		if (dateKey) {
			return dateKey;
		}
	}
	return FILTER_OPERATOR_LABELS[operator];
}
