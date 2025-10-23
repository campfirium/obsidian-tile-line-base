// 过滤运算符
export type FilterOperator =
	| 'equals'        // 等于
	| 'notEquals'     // 不等于
	| 'contains'      // 包含
	| 'notContains'   // 不包含
	| 'startsWith'    // 开头是
	| 'endsWith'      // 结尾是
	| 'isEmpty'       // 为空
	| 'isNotEmpty'    // 不为空
	| 'greaterThan'   // 大于
	| 'lessThan'      // 小于
	| 'greaterOrEqual'// 大于等于
	| 'lessOrEqual';  // 小于等于

// 单个过滤条件
export interface FilterCondition {
	column: string;           // 列名
	operator: FilterOperator; // 运算符
	value?: string;           // 过滤值(某些运算符不需要值,如 isEmpty)
}

// 过滤规则(支持 AND/OR 组合)
export interface FilterRule {
	conditions: FilterCondition[];  // 条件列表
	combineMode: 'AND' | 'OR';     // 组合方式
}

export interface SortRule {
	column: string;
	direction: 'asc' | 'desc';
}

export interface FilterViewDefinition {
	id: string;
	name: string;
	filterRule: FilterRule | null;  // 改用自定义过滤规则
	sortRules: SortRule[];
	columnState?: any[] | null;
	quickFilter?: string | null;
}

export interface FileFilterViewState {
	views: FilterViewDefinition[];
	activeViewId: string | null;
}
