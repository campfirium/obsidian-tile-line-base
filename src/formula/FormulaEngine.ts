import { t } from '../i18n';

export type Operator = '+' | '-' | '*' | '/';

interface NumberToken {
	type: 'number';
	value: number;
}

interface FieldToken {
	type: 'field';
	value: string;
}

interface StringToken {
	type: 'string';
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

type Token = NumberToken | FieldToken | StringToken | OperatorToken | LeftParenToken | RightParenToken;

type RpnToken = NumberToken | FieldToken | StringToken | OperatorToken;

export interface CompiledFormula {
	original: string;
	rpn: RpnToken[];
	dependencies: string[];
}

export interface FormulaEvaluationResult {
	value: string;
	error: string | null;
	kind: 'number' | 'string';
	numericValue?: number;
}

const OPERATOR_PRECEDENCE: Record<Operator, number> = {
	'+': 1,
	'-': 1,
	'*': 2,
	'/': 2
};

const ERROR_KEYS = {
	unexpectedChar: 'formula.errors.unexpectedChar',
	unexpectedCharWithValue: 'formula.errors.unexpectedCharWithValue',
	unmatchedBrace: 'formula.errors.unmatchedBrace',
	emptyField: 'formula.errors.emptyField',
	unmatchedParen: 'formula.errors.unmatchedParen',
	stackUnderflow: 'formula.errors.stackUnderflow',
	divideByZero: 'formula.errors.divideByZero',
	nonFiniteResult: 'formula.errors.nonFiniteResult',
	emptyFormula: 'formula.errors.emptyFormula',
	numericOutOfRange: 'formula.errors.numericOutOfRange',
	unaryNotSupported: 'formula.errors.unaryNotSupported',
	unterminatedString: 'formula.errors.unterminatedString'
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
		throw new FormulaCompilationError(t(ERROR_KEYS.emptyFormula));
	}
	const tokens = tokenize(normalized);
	const { rpn, dependencies } = toReversePolish(tokens);
	return {
		original: rawFormula,
		rpn,
		dependencies: Array.from(dependencies)
	};
}

export function evaluateFormula(
	compiled: CompiledFormula,
	context: Record<string, unknown>,
	resolveField?: (fieldName: string) => unknown
): FormulaEvaluationResult {
	if (compiled.rpn.length === 1) {
		const soleToken = compiled.rpn[0];
		if (soleToken.type === 'field') {
			const raw = resolveField ? resolveField(soleToken.value) : context[soleToken.value];
			if (raw === null || raw === undefined) {
				return { value: '', error: null, kind: 'string' };
			}
			return { value: String(raw), error: null, kind: 'string' };
		}
		if (soleToken.type === 'number') {
			return {
				value: formatResult(soleToken.value),
				error: null,
				kind: 'number',
				numericValue: soleToken.value
			};
		}
		if (soleToken.type === 'string') {
			return { value: soleToken.value, error: null, kind: 'string' };
		}
	}

	try {
		const result = evaluateRpn(compiled.rpn, context, resolveField);
		if (result.kind === 'number') {
			if (!Number.isFinite(result.value)) {
				return {
					value: '#ERR',
					error: t(ERROR_KEYS.nonFiniteResult),
					kind: 'string'
				};
			}
			return {
				value: formatResult(result.value),
				error: null,
				kind: 'number',
				numericValue: result.value
			};
		}
		return { value: result.value, error: null, kind: 'string' };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { value: '#ERR', error: message, kind: 'string' };
	}
}

function normalizeFormula(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.startsWith('=')) {
		return trimmed.slice(1).trim().replace(/[\u201C\u201D]/g, '"');
	}
	return trimmed.replace(/[\u201C\u201D]/g, '"');
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
				throw new FormulaCompilationError(t(ERROR_KEYS.unmatchedBrace));
			}
			const fieldName = expression.slice(index + 1, closing).trim();
			if (!fieldName) {
				throw new FormulaCompilationError(t(ERROR_KEYS.emptyField));
			}
			tokens.push({ type: 'field', value: fieldName });
			index = closing + 1;
			continue;
		}

		if (char === '"') {
			const { literal, position } = readStringLiteral(expression, index + 1);
			tokens.push({ type: 'string', value: literal });
			index = position;
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
				throw new FormulaCompilationError(t(ERROR_KEYS.unexpectedChar));
			}
			const numberLiteral = expression.slice(start, index);
			const value = Number(numberLiteral);
			if (!Number.isFinite(value)) {
				throw new FormulaCompilationError(t(ERROR_KEYS.numericOutOfRange));
			}
			tokens.push({ type: 'number', value });
			continue;
		}

		throw new FormulaCompilationError(t(ERROR_KEYS.unexpectedCharWithValue, { char }));
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
			case 'string':
				output.push(token);
				previousKind = token.type;
				break;
			case 'operator': {
				if (isUnary(previousKind)) {
					if (token.value === '+' || token.value === '-') {
						output.push({ type: 'number', value: 0 });
					} else {
						throw new FormulaCompilationError(t(ERROR_KEYS.unaryNotSupported));
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
					const op = operatorStack.pop();
					if (!op) {
						break;
					}
					if (op.type === 'leftParen') {
						foundLeft = true;
						break;
					}
					output.push(op);
				}
				if (!foundLeft) {
					throw new FormulaCompilationError(t(ERROR_KEYS.unmatchedParen));
				}
				previousKind = token.type;
				break;
			}
		}
	}

	while (operatorStack.length > 0) {
		const op = operatorStack.pop();
		if (!op) {
			continue;
		}
		if (op.type === 'leftParen') {
			throw new FormulaCompilationError(t(ERROR_KEYS.unmatchedParen));
		}
		output.push(op);
	}

	return { rpn: output, dependencies };
}

function evaluateRpn(
	tokens: RpnToken[],
	context: Record<string, unknown>,
	resolveField?: (fieldName: string) => unknown
): FormulaResultValue {
	const stack: FormulaStackValue[] = [];

	for (const token of tokens) {
		switch (token.type) {
			case 'number':
				stack.push({ kind: 'number', value: token.value });
				break;
			case 'field': {
				const raw = resolveField ? resolveField(token.value) : context[token.value];
				stack.push({ kind: 'field', raw });
				break;
			}
			case 'string':
				stack.push({ kind: 'string', value: token.value });
				break;
			case 'operator': {
				if (stack.length < 2) {
					throw new FormulaEvaluationError(t(ERROR_KEYS.stackUnderflow));
				}
				const right = stack.pop();
				const left = stack.pop();
				if (!right || !left) {
					throw new FormulaEvaluationError(t(ERROR_KEYS.stackUnderflow));
				}
				switch (token.value) {
					case '+': {
						if (shouldConcatenate(left, right)) {
							const concatenated = toStringValue(left) + toStringValue(right);
							stack.push({ kind: 'string', value: concatenated });
						} else {
							const result = toNumberValue(left) + toNumberValue(right);
							stack.push({ kind: 'number', value: result });
						}
						break;
					}
					case '-':
						stack.push({ kind: 'number', value: toNumberValue(left) - toNumberValue(right) });
						break;
					case '*':
						stack.push({ kind: 'number', value: toNumberValue(left) * toNumberValue(right) });
						break;
					case '/': {
						const divisor = toNumberValue(right);
						if (Math.abs(divisor) < Number.EPSILON) {
							throw new FormulaEvaluationError(t(ERROR_KEYS.divideByZero));
						}
						stack.push({ kind: 'number', value: toNumberValue(left) / divisor });
						break;
					}
					default:
						throw new FormulaEvaluationError(t(ERROR_KEYS.unexpectedChar));
				}
				break;
			}
		}
	}

	if (stack.length !== 1) {
		throw new FormulaEvaluationError(t(ERROR_KEYS.stackUnderflow));
	}

	const [result] = stack;
	if (result.kind === 'field') {
		return { kind: 'string', value: toStringValue(result) };
	}
	return result;
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

function readStringLiteral(source: string, start: number): { literal: string; position: number } {
	let index = start;
	let literal = '';
	while (index < source.length) {
		const char = source[index];
		if (char === '"') {
			return { literal, position: index + 1 };
		}
		if (char === '\\') {
			const next = source[index + 1];
			if (next === undefined) {
				break;
			}

			switch (next) {
				case '"':
					literal += '"';
					break;
				case '\\':
					literal += '\\';
					break;
				case 'n':
					literal += '\n';
					break;
				case 't':
					literal += '\t';
					break;
				case 'r':
					literal += '\r';
					break;
				default:
					literal += next;
					break;
			}
			index += 2;
			continue;
		}
		literal += char;
		index++;
	}
	throw new FormulaCompilationError(t(ERROR_KEYS.unterminatedString));
}

type FormulaStackValue =
	| { kind: 'number'; value: number }
	| { kind: 'string'; value: string }
	| { kind: 'field'; raw: unknown };

type FormulaResultValue = { kind: 'number'; value: number } | { kind: 'string'; value: string };
function shouldConcatenate(left: FormulaStackValue, right: FormulaStackValue): boolean {
	return left.kind === 'string' || right.kind === 'string';
}

function toNumberValue(value: FormulaStackValue): number {
	switch (value.kind) {
		case 'number':
			return value.value;
		case 'string':
			return coerceNumber(value.value);
		case 'field':
			return coerceNumber(value.raw);
		default:
			return 0;
	}
}

function toStringValue(value: FormulaStackValue): string {
	switch (value.kind) {
		case 'string':
			return value.value;
		case 'number':
			return formatResult(value.value);
		case 'field': {
			const raw = value.raw;
			if (raw === null || raw === undefined) {
				return '';
			}
			if (typeof raw === 'number') {
				return formatResult(raw);
			}
			return String(raw);
		}
		default:
			return '';
	}
}
