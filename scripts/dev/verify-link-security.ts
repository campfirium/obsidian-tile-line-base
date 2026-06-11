/**
 * Focused verification for cell link protocol classification.
 *
 * Usage:
 *   npm run verify:link-security
 */

import { classifyLinkTarget, isSafeExternalLinkTarget, parseCellLinkSegments } from '../../src/utils/linkDetection';
import type { DetectedCellLinkType } from '../../src/types/cellLinks';

type TestRunner = () => void;

interface TestCase {
	name: string;
	run: TestRunner;
}

class AssertionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AssertionError';
	}
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new AssertionError(message);
	}
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
	assert(
		Object.is(actual, expected),
		`${message}\nExpected: ${String(expected)}\nActual:   ${String(actual)}`
	);
}

function extractLinkTypes(rawValue: string): DetectedCellLinkType[] {
	return parseCellLinkSegments(rawValue)
		.filter((segment) => segment.kind === 'link')
		.map((segment) => segment.link.type);
}

const tests: TestCase[] = [
	{
		name: 'allows only explicit safe external protocols',
		run: () => {
			for (const target of ['https://example.com', 'http://example.com', 'mailto:user@example.com', 'tel:+123456789']) {
				assertEqual(classifyLinkTarget(target), 'external', `${target} should be external`);
				assert(isSafeExternalLinkTarget(target), `${target} should be safe for external open`);
			}
		}
	},
	{
		name: 'blocks unsafe protocol handlers',
		run: () => {
			for (const target of ['file:///etc/passwd', 'vscode://file/test', 'shell://open', 'javascript:alert(1)']) {
				assertEqual(classifyLinkTarget(target), 'blocked', `${target} should be blocked`);
				assert(!isSafeExternalLinkTarget(target), `${target} should not be safe for external open`);
			}
		}
	},
	{
		name: 'keeps obsidian protocol on the internal path',
		run: () => {
			assertEqual(classifyLinkTarget('obsidian://open?vault=demo&file=Note'), 'internal', 'obsidian protocol should be internal');
			assertEqual(extractLinkTypes('[Open](obsidian://open?vault=demo&file=Note)').join(','), 'internal', 'markdown obsidian link should parse as internal');
		}
	},
	{
		name: 'parses grid and kanban cell links with shared policy',
		run: () => {
			assertEqual(extractLinkTypes('[Safe](https://example.com)').join(','), 'external', 'safe markdown link should be external');
			assertEqual(extractLinkTypes('[Unsafe](vscode://file/test)').join(','), 'blocked', 'unsafe markdown link should be blocked');
			assertEqual(extractLinkTypes('Visit https://example.com').join(','), 'external', 'bare https URL should be external');
			assertEqual(extractLinkTypes('[[Internal Note]]').join(','), 'internal', 'wiki link should be internal');
		}
	}
];

let failed = 0;

for (const test of tests) {
	try {
		test.run();
		console.log(`[PASS] ${test.name}`);
	} catch (error) {
		failed += 1;
		console.error(`[FAIL] ${test.name}`);
		console.error(error instanceof Error ? error.stack ?? error.message : String(error));
	}
}

if (failed > 0) {
	process.exitCode = 1;
	console.error(`\n${failed}/${tests.length} link security checks failed`);
} else {
	console.log(`\nAll ${tests.length} link security checks passed`);
}
