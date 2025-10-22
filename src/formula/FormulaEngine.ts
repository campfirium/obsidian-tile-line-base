export type Operator = '+' | '-' | '*' | '/';

interface NumberToken {
	type: 'number';
	value: number;
}

interface FieldToken {
	type: 'field';
	value: string;
}

interface OperatorToken {
	type: 'operator';
	value: Operator;
}

interface LeftParenToken {
	type: 'leftParen';
}

interface RightParenToken {
	type: 'rightParen';
}

type Token = NumberToken | FieldToken | OperatorToken | LeftParenToken | RightParenToken;

type RpnToken = NumberToken | FieldToken | OperatorToken;

export interface CompiledFormula {
	original: string;
	rpn: RpnToken[];
	dependencies: string[];
}

export interface FormulaEvaluationResult {
	value: string;
	error: string | null;
}

const OPERATOR_PRECEDENCE: Record<Operator, number> = {
	'+': 1,
	'-': 1,
	'*': 2,
	'/': 2
};

const FORMULA_ERROR_MESSAGES = {
	UNEXPECTED_CHAR: '存在无法识别的字符',
	UNMATCHED_BRACE: '花括号未闭合',
	EMPTY_FIELD: '字段名不能为空',
	UNMATCHED_PAREN: '括号不匹配',
	STACK_UNDERFLOW: '运算栈不平衡',
	DIVIDE_BY_ZERO: '除数为 0',
	NON_FINITE_RESULT: '结果不是有限数值'
} as const;

export class FormulaCompilationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FormulaCompilationError';
	}
}

export class FormulaEvaluationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FormulaEvaluationError';
	}
}

export function compileFormula(rawFormula: string): CompiledFormula {
	const normalized = normalizeFormula(rawFormula);
	if (!normalized) {
		throw new FormulaCompilationError('公式为空');
	}
	const tokens = tokenize(normalized);
	const { rpn, dependencies } = toReversePolish(tokens);
	return {
		original: rawFormula,
		rpn,
		dependencies: Array.from(dependencies)
	};
}

export function evaluateFormula(compiled: CompiledFormula, context: Record<string, unknown>): FormulaEvaluationResult {
	if (compiled.rpn.length === 1) {
		const soleToken = compiled.rpn[0];
		if (soleToken.type === 'field') {
			const raw = context[soleToken.value];
			if (raw === null || raw === undefined) {
				return { value: '', error: null };
			}
			return { value: String(raw), error: null };
		}
		if (soleToken.type === 'number') {
			return { value: formatResult(soleToken.value), error: null };
		}
	}

	try {
		const result = evaluateRpn(compiled.rpn, context);
		if (!Number.isFinite(result)) {
			return { value: '#ERR', error: FORMULA_ERROR_MESSAGES.NON_FINITE_RESULT };
		}
		return { value: formatResult(result), error: null };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { value: '#ERR', error: message };
	}
}

function normalizeFormula(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.startsWith('=')) {
		return trimmed.slice(1).trim();
	}
	return trimmed;
}

function tokenize(expression: string): Token[] {
	const tokens: Token[] = [];
	let index = 0;
	const length = expression.length;

	while (index < length) {
		const char = expression[index];

		if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
			index++;
			continue;
		}

		if (char === '{') {
			const closing = expression.indexOf('}', index + 1);
			if (closing === -1) {
				throw new FormulaCompilationError(FORMULA_ERROR_MESSAGES.UNMATCHED_BRACE);
			}
			const fieldName = expression.slice(index + 1, closing).trim();
			if (!fieldName) {
				throw new FormulaCompilationError(FORMULA_ERROR_MESSAGES.EMPTY_FIELD);
			}
			tokens.push({ type: 'field', value: fieldName });
			index = closing + 1;
			continue;
		}

		if (isOperatorChar(char)) {
			tokens.push({ type: 'operator', value: char as Operator });
			index++;
			continue;
		}

		if (char === '(') {
			tokens.push({ type: 'leftParen' });
			index++;
			continue;
		}
		if (char === ')') {
			tokens.push({ type: 'rightParen' });
			index++;
			continue;
		}

		if (isDigitOrDot(char)) {
			const start = index;
			let seenDot = char === '.';
			let seenDigit = char !== '.';
			index++;
			while (index < length) {
				const next = expression[index];
				if (next === '.') {
					if (seenDot) {
						break;
					}
					seenDot = true;
					index++;
					continue;
				}
				if (!isDigit(next)) {
					break;
				}
				seenDigit = true;
				index++;
			}
			if (!seenDigit) {
				throw new FormulaCompilationError(FORMULA_ERROR_MESSAGES.UNEXPECTED_CHAR);
			}
			const numberLiteral = expression.slice(start, index);
			const value = Number(numberLiteral);
			if (!Number.isFinite(value)) {
				throw new FormulaCompilationError('数值超出范围');
			}
			tokens.push({ type: 'number', value });
			continue;
		}

		throw new FormulaCompilationError(`${FORMULA_ERROR_MESSAGES.UNEXPECTED_CHAR}：“${char}”`);
	}

	return tokens;
}

function toReversePolish(tokens: Token[]): { rpn: RpnToken[]; dependencies: Set<string> } {
	const output: RpnToken[] = [];
	const operatorStack: Array<OperatorToken | LeftParenToken> = [];
	const dependencies = new Set<string>();
	let previousKind: Token['type'] | null = null;

	for (const token of tokens) {
		switch (token.type) {
			case 'number':
				output.push(token);
				previousKind = token.type;
				break;
			case 'field':
				output.push(token);
				dependencies.add(token.value);
				previousKind = token.type;
				break;
			case 'operator': {
				if (isUnary(previousKind)) {
					if (token.value === '+' || token.value === '-') {
						output.push({ type: 'number', value: 0 });
					} else {
						throw new FormulaCompilationError('暂不支持一元运算符');
					}
				}
				while (operatorStack.length > 0) {
					const top = operatorStack[operatorStack.length - 1];
					if (top.type === 'leftParen') {
						break;
					}
					if (OPERATOR_PRECEDENCE[top.value] >= OPERATOR_PRECEDENCE[token.value]) {
						const popped = operatorStack.pop() as OperatorToken;
						output.push(popped);
						continue;
					}
					break;
				}
				operatorStack.push(token);
				previousKind = token.type;
				break;
			}
			case 'leftParen':
				operatorStack.push({ type: 'leftParen' });
				previousKind = token.type;
				break;
			case 'rightParen': {
				let foundLeft = false;
				while (operatorStack.length > 0) {
					const op = operatorStack.pop()!;
					if (op.type === 'leftParen') {
						foundLeft = true;
						break;
					}
					output.push(op);
				}
				if (!foundLeft) {
					throw new FormulaCompilationError(FORMULA_ERROR_MESSAGES.UNMATCHED_PAREN);
				}
				previousKind = token.type;
				break;
			}
		}
	}

	while (operatorStack.length > 0) {
		const op = operatorStack.pop()!;
		if (op.type === 'leftParen') {
			throw new FormulaCompilationError(FORMULA_ERROR_MESSAGES.UNMATCHED_PAREN);
		}
		output.push(op);
	}

	return { rpn: output, dependencies };
}

function evaluateRpn(tokens: RpnToken[], context: Record<string, unknown>): number {
	const stack: number[] = [];

	for (const token of tokens) {
		switch (token.type) {
			case 'number':
				stack.push(token.value);
				break;
			case 'field': {
				const raw = context[token.value];
				const numeric = coerceNumber(raw);
				stack.push(numeric);
				break;
			}
			case 'operator': {
				if (stack.length < 2) {
					throw new FormulaEvaluationError(FORMULA_ERROR_MESSAGES.STACK_UNDERFLOW);
				}
				const right = stack.pop()!;
				const left = stack.pop()!;
				let result: number;
				switch (token.value) {
					case '+':
						result = left + right;
						break;
					case '-':
						result = left - right;
						break;
					case '*':
						result = left * right;
						break;
					case '/':
						if (Math.abs(right) < Number.EPSILON) {
							throw new FormulaEvaluationError(FORMULA_ERROR_MESSAGES.DIVIDE_BY_ZERO);
						}
						result = left / right;
						break;
					default:
						throw new FormulaEvaluationError(`${FORMULA_ERROR_MESSAGES.UNEXPECTED_CHAR}`);
				}
				stack.push(result);
				break;
			}
		}
	}

	if (stack.length !== 1) {
		throw new FormulaEvaluationError(FORMULA_ERROR_MESSAGES.STACK_UNDERFLOW);
	}

	return stack[0];
}

function coerceNumber(value: unknown): number {
	if (value === null || value === undefined) {
		return 0;
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : 0;
	}
	const str = String(value).trim();
	if (str.length === 0) {
		return 0;
	}
	const numeric = Number(str);
	return Number.isFinite(numeric) ? numeric : 0;
}

function formatResult(value: number): string {
	if (Number.isInteger(value)) {
		return value.toString();
	}
	const fixed = value.toFixed(6);
	return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function isOperatorChar(char: string): boolean {
	return char === '+' || char === '-' || char === '*' || char === '/';
}

function isDigit(char: string): boolean {
	return char >= '0' && char <= '9';
}

function isDigitOrDot(char: string): boolean {
	return isDigit(char) || char === '.';
}

function isUnary(previous: Token['type'] | null): boolean {
	return !previous || previous === 'operator' || previous === 'leftParen';
}
