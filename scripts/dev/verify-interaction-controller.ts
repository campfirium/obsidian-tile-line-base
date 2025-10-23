/**
 * Verification harness for AgGridInteractionController behaviour.
 *
 * Usage:
 *   TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}' npx ts-node scripts/dev/verify-interaction-controller.ts
 */

import type { CellKeyDownEvent, GridApi } from 'ag-grid-community';
import { ROW_ID_FIELD, RowData } from '../../src/grid/GridAdapter';
import {
	AgGridInteractionController,
	GridInteractionContext
} from '../../src/grid/interactions/AgGridInteractionController';

type AsyncTestRunner = () => void | Promise<void>;

interface TestCase {
	name: string;
	run: AsyncTestRunner;
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

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

class FakeColumn {
	constructor(private readonly id: string, private readonly field: string = id) {}

	getColId(): string {
		return this.id;
	}

	getColDef(): { field: string } {
		return { field: this.field };
	}
}

class FakeGridApi {
	rowCount = 0;
	displayedColumns: FakeColumn[] = [
		new FakeColumn('#', '#'),
		new FakeColumn('title', 'title'),
		new FakeColumn('status', 'status')
	];
	focusedCell: { rowIndex: number; column: FakeColumn } | null = null;
	editingCells: Array<{ rowIndex: number; column: FakeColumn }> = [];
	stopEditingCalls = 0;

	getDisplayedRowCount(): number {
		return this.rowCount;
	}

	getAllDisplayedColumns(): FakeColumn[] {
		return this.displayedColumns;
	}

	getFocusedCell(): { rowIndex: number; column: FakeColumn } | null {
		return this.focusedCell;
	}

	ensureIndexVisible(_index: number): void {
		// no-op for tests
	}

	setFocusedCell(rowIndex: number, colId: string): void {
		this.focusedCell = { rowIndex, column: new FakeColumn(colId) };
	}

	stopEditing(): void {
		this.stopEditingCalls += 1;
	}

	getEditingCells(): Array<{ rowIndex: number; column: FakeColumn }> {
		return this.editingCells;
	}

	getDisplayedRowAtIndex(index: number): { data: RowData | undefined } | null {
		if (index < 0 || index >= this.rowCount) {
			return null;
		}
		return { data: { [ROW_ID_FIELD]: index.toString(), title: `Title ${index}` } };
	}
}

function createControllerHarness() {
	const api = new FakeGridApi();
	let enterCallback: ((field: string) => void) | undefined;
	let cellEditCallback: ((event: any) => void) | undefined;
	const context: GridInteractionContext = {};

	const controller = new AgGridInteractionController({
		getGridApi: () => api as unknown as GridApi,
		getGridContext: () => context,
		getCellEditCallback: () => cellEditCallback,
		getEnterAtLastRowCallback: () => enterCallback,
		translate: (key: string) => key
	});

	return {
		controller,
		api,
		context,
		setEnterCallback(cb: (field: string) => void) {
			enterCallback = cb;
		},
		setCellEditCallback(cb: (event: any) => void) {
			cellEditCallback = cb;
		}
	};
}

const tests: TestCase[] = [
	{
		name: 'handleEnterAtLastRow triggers callback and stops editing',
		run: async () => {
			const { controller, api, setEnterCallback } = createControllerHarness();
			api.rowCount = 3;
			api.setFocusedCell(2, 'notes');
			(controller as any).focusedRowIndex = 2;
			(controller as any).focusedColId = 'notes';
			(controller as any).pendingEnterAtLastRow = false;

			let receivedField: string | null = null;
			setEnterCallback((field) => {
				receivedField = field;
			});

			const keyEvent = {
				key: 'Enter',
				ctrlKey: false,
				metaKey: false,
				altKey: false,
				shiftKey: false,
				preventDefaultCalled: false,
				preventDefault() {
					this.preventDefaultCalled = true;
				},
				stopPropagationCalled: false,
				stopPropagation() {
					this.stopPropagationCalled = true;
				}
			};

			const handled = (controller as any).handleEnterAtLastRow(
				api,
				'notes',
				undefined,
				keyEvent
			);
			assert(handled === true, 'Enter handler should return true on last row');
			await delay(25);
			assert(api.stopEditingCalls === 1, 'stopEditing should be invoked once');
			assert(receivedField === 'notes', 'enter callback should receive current column id');
			assert(
				(controller as any).pendingEnterAtLastRow === false,
				'pendingEnterAtLastRow should reset'
			);
			assert(keyEvent.preventDefaultCalled === true, 'preventDefault should be invoked');
		}
	},
	{
		name: 'handleGridCellKeyDown routes copy shortcut on # column',
		run: () => {
			const { controller, api, context } = createControllerHarness();
			api.rowCount = 1;
			api.setFocusedCell(0, '#');
			const copiedBlocks: number[] = [];
			context.onCopyH2Section = (blockIndex) => copiedBlocks.push(blockIndex);

			const keyEvent = {
				key: 'c',
				ctrlKey: true,
				metaKey: false,
				altKey: false,
				shiftKey: false,
				preventDefaultCalled: false,
				preventDefault() {
					this.preventDefaultCalled = true;
				},
				stopPropagationCalled: false,
				stopPropagation() {
					this.stopPropagationCalled = true;
				}
			};

			const cellEvent = {
				api: api as unknown as GridApi,
				column: new FakeColumn('#'),
				node: {
					data: {
						[ROW_ID_FIELD]: '5'
					}
				},
				event: keyEvent
			} as unknown as CellKeyDownEvent;

			controller.handleGridCellKeyDown(cellEvent);
			assert(copiedBlocks.length === 1, 'onCopyH2Section should be invoked');
			assert(copiedBlocks[0] === 5, 'block index should be parsed from row data');
			assert(keyEvent.preventDefaultCalled === true, 'preventDefault should be called');
			assert(api.stopEditingCalls === 0, 'stopEditing should not be called for copy');
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
		console.error(`\n${failed.length}/${results.length} interaction checks failed`);
		return;
	}

	console.log(`\nAll ${results.length} interaction checks passed`);
}

runAll().catch((error) => {
	console.error('Fatal error while running interaction verification');
	console.error(error);
	process.exitCode = 1;
});
