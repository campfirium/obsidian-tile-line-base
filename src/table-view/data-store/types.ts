export interface FormulaOptions {
	rowLimit: number;
	errorValue: string;
	tooltipPrefix: string;
}

export interface ExtractRowOptions {
	onFormulaLimitExceeded?: (limit: number) => void;
}
