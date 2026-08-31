/**
 * Quick verification harness for CSV export formula injection escaping.
 *
 * Usage:
 *   npm run verify:csv-security
 */

// Stub Obsidian runtime dependencies for scripts executed outside Obsidian.
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
const Module = require('module');
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
const originalLoad = Module._load;

Object.defineProperty(globalThis, 'window', {
	value: globalThis,
	writable: true,
	configurable: true
});

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
Module._load = function mockObsidan(request: string, parent: unknown, isMain: boolean) {
	if (request === 'obsidian') {
		return {
			Notice: class Notice {}
		};
	}
	// eslint-disable-next-line @typescript-eslint/no-unsafe-return
	return originalLoad.call(this, request, parent, isMain);
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const csvModule = require('../../src/table-view/TableCsvController') as typeof import('../../src/table-view/TableCsvController');
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
Module._load = originalLoad;

const { escapeCsvFormulaValue } = csvModule;

interface TestCase {
	name: string;
	input: string;
	expected: string;
}

class AssertionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AssertionError';
	}
}

function assertEqual(actual: string, expected: string, message: string): void {
	if (actual !== expected) {
		throw new AssertionError(`${message}\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`);
	}
}

const dangerousCases: TestCase[] = [
	{ name: 'equals formula', input: '=SUM(A1:A2)', expected: "'=SUM(A1:A2)" },
	{ name: 'plus formula', input: '+cmd', expected: "'+cmd" },
	{ name: 'minus formula', input: '-10+20', expected: "'-10+20" },
	{ name: 'at formula', input: '@SUM(A1)', expected: "'@SUM(A1)" },
	{ name: 'space before formula', input: ' =SUM(A1:A2)', expected: "' =SUM(A1:A2)" },
	{ name: 'tab before formula', input: '\t=SUM(A1:A2)', expected: "'\t=SUM(A1:A2)" },
	{ name: 'cr before formula', input: '\r=SUM(A1:A2)', expected: "'\r=SUM(A1:A2)" },
	{ name: 'lf before formula', input: '\n=SUM(A1:A2)', expected: "'\n=SUM(A1:A2)" },
	{ name: 'mixed whitespace before formula', input: ' \t\r\n@SUM(A1)', expected: "' \t\r\n@SUM(A1)" }
];

const safeCases: TestCase[] = [
	{ name: 'plain text', input: 'Status update', expected: 'Status update' },
	{ name: 'embedded equals', input: 'Total = 12', expected: 'Total = 12' },
	{ name: 'quoted text marker', input: "'=SUM(A1:A2)", expected: "'=SUM(A1:A2)" },
	{ name: 'empty string', input: '', expected: '' }
];

for (const testCase of [...dangerousCases, ...safeCases]) {
	assertEqual(
		escapeCsvFormulaValue(testCase.input),
		testCase.expected,
		`CSV formula escaping failed for ${testCase.name}`
	);
}

console.info(`CSV security verification passed (${dangerousCases.length + safeCases.length} cases).`);
