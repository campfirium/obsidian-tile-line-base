/**
 * Quick verification harness for AgGridLifecycleManager behaviours.
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/dev/verify-lifecycle-manager.ts
 */

import type { GridApi, GridOptions, ModelUpdatedEvent, RowDataUpdatedEvent } from 'ag-grid-community';
import { AgGridLifecycleManager } from '../../src/grid/lifecycle/AgGridLifecycleManager';

type TestRunner = () => void | Promise<void>;

interface TestCase {
	name: string;
	run: TestRunner;
}

interface TestResult {
	name: string;
	status: 'passed' | 'failed';
	durationMs: number;
	error?: Error;
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

interface FakeLogSink {
	errors: unknown[];
	warnings: unknown[];
}

function createFakeLogger(): { logger: Pick<typeof console, 'error' | 'warn'>; sink: FakeLogSink } {
	const sink: FakeLogSink = { errors: [], warnings: [] };
	return {
		sink,
		logger: {
			error: (...args: unknown[]) => sink.errors.push(args),
			warn: (...args: unknown[]) => sink.warnings.push(args)
		}
	};
}

function createLifecycleHarness() {
	const fakeColumnApi = {};
	let destroyCalls = 0;
	const fakeGridApi = {
		destroy: () => {
			destroyCalls += 1;
		}
	} as unknown as GridApi;

	let lastOptions: GridOptions | null = null;
	const createGridStub = (_container: HTMLElement, options: GridOptions) => {
		lastOptions = options;
		if (typeof options.onGridReady === 'function') {
			options.onGridReady({
				api: fakeGridApi,
				columnApi: fakeColumnApi
			} as unknown as Parameters<NonNullable<GridOptions['onGridReady']>>[0]);
		}
		return fakeGridApi;
	};

	const fakeLogger = createFakeLogger();
	const manager = new AgGridLifecycleManager({
		createGrid: createGridStub,
		logger: fakeLogger.logger
	});

	return {
		manager,
		createGridStub,
		getLastOptions: () => lastOptions,
		getDestroyCalls: () => destroyCalls,
		fakeGridApi,
		fakeColumnApi,
		fakeLogger: fakeLogger.sink
	};
}

const tests: TestCase[] = [
	{
		name: 'runWhenReady queue flushes after mount',
		run: () => {
			const { manager } = createLifecycleHarness();
			let readyCount = 0;
			manager.runWhenReady(() => {
				readyCount += 1;
			});

			manager.mountGrid({} as HTMLElement, [], [], {});

			assertEqual(readyCount, 1, 'Expected queued ready callback to run once after mount');
		}
	},
	{
		name: 'withGridApi and withColumnApi resolve immediately when ready',
		run: () => {
			const { manager, fakeGridApi, fakeColumnApi } = createLifecycleHarness();
			manager.mountGrid({} as HTMLElement, [], [], {});

			let gridApiMatched = false;
			manager.withGridApi((gridApi) => {
				gridApiMatched = gridApi === fakeGridApi;
			});
			assert(gridApiMatched, 'Expected withGridApi to receive mounted GridApi');

			let columnApiMatched = false;
			manager.withColumnApi((columnApi) => {
				columnApiMatched = columnApi === fakeColumnApi;
			});
			assert(columnApiMatched, 'Expected withColumnApi to receive mounted ColumnApi');
		}
	},
	{
		name: 'attach handlers receive container and cleanup invoked on destroy',
		run: () => {
			const { manager, getDestroyCalls } = createLifecycleHarness();
			const container = { id: 'container' } as unknown as HTMLElement;
			let attachedContainer: HTMLElement | null = null;
			let cleanupCalls = 0;

			manager.onAttach((context) => {
				attachedContainer = context.container;
				return () => {
					cleanupCalls += 1;
				};
			});

			manager.mountGrid(container, [], [], {});
			assert(attachedContainer === container, 'Expected attach handler to receive container');
			assertEqual(cleanupCalls, 0, 'Cleanup should not run before destroy');

			manager.destroy();
			assertEqual(cleanupCalls, 1, 'Expected cleanup to run once on destroy');
			assertEqual(getDestroyCalls(), 1, 'GridApi.destroy should be invoked during destroy');
		}
	},
	{
		name: 'model updated handlers run when events fire',
		run: () => {
			const { manager, getLastOptions } = (() => {
				const harness = createLifecycleHarness();
				harness.manager.mountGrid({} as HTMLElement, [], [], {});
				return harness;
			})();

			let updates = 0;
			manager.onModelUpdated(() => {
				updates += 1;
			});

			const options = getLastOptions();
			assert(options, 'Expected createGrid options to be captured');

			options?.onModelUpdated?.({} as ModelUpdatedEvent);
			options?.onRowDataUpdated?.({} as RowDataUpdatedEvent);

			assertEqual(updates, 2, 'Expected model updated handlers to run for both events');
		}
	},
	{
		name: 'destroy resets ready queue without logging warnings',
		run: () => {
			const { manager, fakeLogger } = createLifecycleHarness();
			manager.mountGrid({} as HTMLElement, [], [], {});

			let invokedAfterDestroy = false;
			manager.runWhenReady(() => {
				invokedAfterDestroy = true;
			});

			manager.destroy();
			invokedAfterDestroy = false;
			manager.runWhenReady(() => {
				invokedAfterDestroy = true;
			});

			assert(!invokedAfterDestroy, 'runWhenReady should not fire after destroy with no mount');
			assert(fakeLogger.warnings.length === 0, 'Expected no warnings during destroy');
			assert(fakeLogger.errors.length === 0, 'Expected no errors during destroy');
		}
	}
];

async function runAll(): Promise<void> {
	const results: TestResult[] = [];

	for (const test of tests) {
		const started = Date.now();
		try {
			await test.run();
			const finished = Date.now();
			results.push({
				name: test.name,
				status: 'passed',
				durationMs: finished - started
			});
		} catch (error) {
			const finished = Date.now();
			results.push({
				name: test.name,
				status: 'failed',
				durationMs: finished - started,
				error: error instanceof Error ? error : new Error(String(error))
			});
		}
	}

	const failed = results.filter((result) => result.status === 'failed');

	results.forEach((result) => {
		if (result.status === 'passed') {
			console.log(`[PASS] ${result.name} (${result.durationMs}ms)`);
		} else {
			console.error(`[FAIL] ${result.name} (${result.durationMs}ms)`);
			if (result.error) {
				console.error(result.error.stack ?? result.error.message);
			}
		}
	});

	if (failed.length > 0) {
		process.exitCode = 1;
		console.error(`\n${failed.length}/${results.length} checks failed`);
		return;
	}

	console.log(`\nAll ${results.length} lifecycle checks passed`);
}

runAll().catch((error) => {
	console.error('Fatal error while running lifecycle verification');
	console.error(error);
	process.exitCode = 1;
});
