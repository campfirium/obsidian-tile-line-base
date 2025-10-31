/**
 * Quick verification harness for AgGridColumnService pure helpers.
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/dev/verify-column-service.ts
 * or configure a package script that points to this file.
 */

import type { ColumnState, GridApi } from 'ag-grid-community';
import type { ColumnDef as SchemaColumnDef } from '../../src/grid/GridAdapter';
import { COLUMN_MAX_WIDTH } from '../../src/grid/columnSizing';

// Stub Obsidian runtime dependencies for scripts executed outside Obsidian.
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
const Module = require('module');
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
const originalLoad = Module._load;
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
Module._load = function mockObsidan(request: string, parent: unknown, isMain: boolean) {
	if (request === 'obsidian') {
		return {};
	}
	// eslint-disable-next-line @typescript-eslint/no-unsafe-return
	return originalLoad.call(this, request, parent, isMain);
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const columnServiceModule = require('../../src/grid/column/AgGridColumnService') as typeof import('../../src/grid/column/AgGridColumnService');
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
Module._load = originalLoad;
const { AgGridColumnService } = columnServiceModule;
type AgGridColumnServiceInstance = InstanceType<typeof AgGridColumnService>;

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

function assertJsonEqual(actual: unknown, expected: unknown, message: string): void {
	const actualJson = JSON.stringify(actual);
	const expectedJson = JSON.stringify(expected);
	assert(
		actualJson === expectedJson,
		`${message}\nExpected: ${expectedJson}\nActual:   ${actualJson}`
	);
}

function deepFreeze<T>(value: T): T {
	if (Array.isArray(value)) {
		for (const item of value) {
			deepFreeze(item);
		}
		return Object.freeze(value) as unknown as T;
	}
	if (value && typeof value === 'object') {
		for (const key of Object.getOwnPropertyNames(value)) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const nested = (value as any)[key];
			deepFreeze(nested);
		}
		return Object.freeze(value) as unknown as T;
	}
	return value;
}

type ColumnApiLike = Parameters<AgGridColumnServiceInstance['attachApis']>[1];

function createService(getContainer?: () => HTMLElement | null): AgGridColumnServiceInstance {
	return new AgGridColumnService({
		getContainer: getContainer ?? (() => null)
	});
}

interface MockColumnConfig {
	id: string;
	width: number;
	storedWidth?: number;
	resizable?: boolean;
}

interface MockColumnModel {
	id: string;
	width: number;
	resizable: boolean;
	colDef: Record<string, unknown>;
}

function buildMockColumns(configs: MockColumnConfig[]): {
	columns: unknown[];
	models: Map<string, MockColumnModel>;
} {
	const models = new Map<string, MockColumnModel>();
	const columns = configs.map((config) => {
		const model: MockColumnModel = {
			id: config.id,
			width: config.width,
			resizable: config.resizable ?? true,
			colDef: {
				field: config.id,
				__tlbStoredWidth: config.storedWidth,
				width: config.storedWidth
			}
		};
		models.set(model.id, model);
		return {
			getColId: () => model.id,
			getColDef: () => model.colDef,
			getActualWidth: () => model.width,
			isResizable: () => model.resizable
		};
	});
	return { columns, models };
}

const tests: TestCase[] = [
	{
		name: 'buildColumnDefs does not mutate schema inputs',
		run: () => {
			const service = createService();
			const schema: SchemaColumnDef[] = [
				{ field: '#', headerName: '#', editable: false },
				{
					field: 'title',
					headerName: 'Title',
					headerTooltip: 'Document title',
					editable: true
				},
				{ field: 'status', headerName: 'Status', editable: false }
			];

			deepFreeze(schema);
			const snapshot = JSON.stringify(schema);
			service.buildColumnDefs(schema);
			assert(
				JSON.stringify(schema) === snapshot,
				'Schema definition array should remain unchanged after buildColumnDefs invocation'
			);
		}
	},
	{
		name: 'buildColumnDefs output remains deterministic for identical input',
		run: () => {
			const service = createService();
			const schema: SchemaColumnDef[] = [
				{ field: '#', headerName: '#', editable: false },
				{ field: 'title', headerName: 'Title', editable: true },
				{ field: 'status', headerName: 'Status', editable: false }
			];

			const first = service.buildColumnDefs(schema);
			const second = service.buildColumnDefs(schema);

			assertJsonEqual(
				first,
				second,
				'Calling buildColumnDefs with identical inputs should yield the same serialized output'
			);

			for (let index = 0; index < first.length; index += 1) {
				const colDef = first[index];
				assert(
					colDef !== (schema as unknown as Array<Record<string, unknown>>)[index],
					`Column definition at index ${index} should not reference the original schema object`
				);
			}
		}
	},
	{
		name: 'cloneColumnState returns deep copies without retaining references',
		run: () => {
			const service = createService();
			const source: ColumnState[] = [
				{
					colId: 'title',
					sort: 'asc',
					sortIndex: 0,
					width: 150
				},
				{
					colId: 'status',
					sort: 'desc',
					sortIndex: 1,
					width: 80
				}
			];

			deepFreeze(source);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const clone = (service as any).cloneColumnState(source) as ColumnState[] | null;
			assert(clone !== null, 'cloneColumnState should return an array when provided with a populated state');
			assert(clone !== source, 'Returned column state must be a new array instance');

			clone?.forEach((item, index) => {
				assert(item !== source[index], `Column state item ${index} must not reuse the original reference`);
			});

			assertJsonEqual(
				clone,
				source,
				'Cloned column state should retain the same serializable shape as the original input'
			);

			if (clone) {
				clone[0].width = 999;
			}

			assert(
				source[0].width === 150,
				'Mutating the cloned column state must not impact the original frozen input'
			);
		}
	},
	{
		name: 'setSortModel delegates to columnApi with normalized payload',
		run: () => {
			const service = createService();
			const applyCalls: Array<{ state?: ColumnState[]; defaultState?: { sort?: string | null; sortIndex?: number | null } }> = [];
			const refreshCalls: string[] = [];

			const columnApi: ColumnApiLike = {
				applyColumnState: (params) => {
					applyCalls.push(params as { state?: ColumnState[]; defaultState?: { sort?: string | null; sortIndex?: number | null } });
					return true;
				}
			};

			const gridApi = {
				getAllDisplayedColumns: () => [],
				setColumnWidths: () => undefined,
				refreshHeader: () => undefined,
				refreshCells: () => undefined,
				refreshClientSideRowModel: (reason: string) => {
					refreshCalls.push(reason);
				}
			} as unknown as GridApi;

			service.attachApis(gridApi, columnApi);
			service.setSortModel([
				{ field: 'title', direction: 'desc' },
				{ field: 'priority', direction: 'asc' },
				{ field: '', direction: 'asc' }
			]);

			assert(applyCalls.length === 1, 'applyColumnState should be invoked exactly once');
			const payload = applyCalls[0];
			assert(payload != null, 'applyColumnState payload should be defined');
			assertJsonEqual(
				payload.defaultState,
				{ sort: null, sortIndex: null },
				'Default state should reset sort metadata'
			);
			assertJsonEqual(
				payload.state,
				[
					{ colId: 'title', sort: 'desc', sortIndex: 0 },
					{ colId: 'priority', sort: 'asc', sortIndex: 1 }
				],
				'Sort model should convert to ColumnState entries with sequential sortIndex'
			);
			assert(
				refreshCalls.length === 1 && refreshCalls[0] === 'sort',
				'refreshClientSideRowModel should be invoked with reason "sort"'
			);
		}
	},
	{
		name: 'resizeColumns applies stored widths and clamps oversized columns',
		run: () => {
			const container = {
				clientWidth: 300,
				clientHeight: 200
			} as unknown as HTMLElement;
			const service = createService(() => container);
			const { columns, models } = buildMockColumns([
				{ id: 'title', width: 100, storedWidth: 150 },
				{ id: 'assignee', width: 110, storedWidth: 150 }
			]);

			const resizeLogs = {
				setColumnWidths: [] as Array<{ key: string; newWidth: number }>,
				refreshHeader: 0,
				refreshCells: [] as Array<unknown>,
				refreshClientSideRowModel: [] as string[],
				sizeColumnsToFit: [] as Array<unknown>,
				doLayout: 0,
				checkGridSize: 0
			};

			const gridApi = {
				getAllDisplayedColumns: () => columns as unknown[],
				setColumnWidths: (updates: Array<{ key: string | number; newWidth: number }>) => {
					for (const update of updates) {
						const id = String(update.key);
						const model = models.get(id);
						if (model) {
							model.width = update.newWidth;
						}
						resizeLogs.setColumnWidths.push({ key: id, newWidth: update.newWidth });
					}
				},
				refreshHeader: () => {
					resizeLogs.refreshHeader += 1;
				},
				refreshCells: (params: unknown) => {
					resizeLogs.refreshCells.push(params);
				},
				refreshClientSideRowModel: (reason: string) => {
					resizeLogs.refreshClientSideRowModel.push(reason);
				},
				sizeColumnsToFit: (params: unknown) => {
					resizeLogs.sizeColumnsToFit.push(params);
				},
				doLayout: () => {
					resizeLogs.doLayout += 1;
				},
				checkGridSize: () => {
					resizeLogs.checkGridSize += 1;
				}
			} as unknown as GridApi;

			const columnApi: ColumnApiLike = {
				applyColumnState: () => true,
				getColumnState: () => []
			};

			service.attachApis(gridApi, columnApi);
			service.resizeColumns();

			assert(
				resizeLogs.setColumnWidths.length >= 2,
				'Expected setColumnWidths to be invoked for stored width restoration'
			);
			assert(
				resizeLogs.refreshHeader === 1,
				'Expected refreshHeader to be called once during initial resize'
			);
			assert(
				(resizeLogs.refreshCells[0] as { force?: boolean } | undefined)?.force === true,
				'refreshCells should receive a force flag'
			);

			const widthSum = Array.from(models.values()).reduce((sum, model) => sum + model.width, 0);
			assert(
				widthSum >= container.clientWidth - 1,
				'Columns should expand to fill the available container width after resize'
			);

			const titleModel = models.get('title');
			assert(titleModel != null, 'Mock title column should exist after initial resize');
			if (titleModel) {
				titleModel.width = COLUMN_MAX_WIDTH + 120;
			}

			resizeLogs.setColumnWidths.length = 0;
			service.resizeColumns();

			const updatedTitle = models.get('title');
			assert(
				(updatedTitle?.width ?? 0) <= COLUMN_MAX_WIDTH,
				`Expected oversized columns to be clamped to <= ${COLUMN_MAX_WIDTH}`
			);
			assert(
				resizeLogs.setColumnWidths.some((update) => update.key === 'title'),
				'Expected resizeColumns to issue a width update for the clamped column'
			);
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

	console.log(`\nAll ${results.length} column service checks passed`);
}

runAll().catch((error) => {
	console.error('Fatal error while running column service verification');
	console.error(error);
	process.exitCode = 1;
});
