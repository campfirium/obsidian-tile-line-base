import path from 'path';
import Module from 'module';

process.env.NODE_PATH = path.join(__dirname, 'test-shims');
// @ts-ignore internal API for test env
Module._initPaths();
(global as any).__LOG_PROD__ = false;

import { MagicMigrationController } from '../src/table-view/MagicMigrationController';

const controller = new MagicMigrationController({} as any);
const content = [
	'任务A 重构导入逻辑 张三 进行中 截止时间 2025年12月01日 高优先级',
	'任务B 设计全局主题系统 李四 未开始 截止时间 2025年12月10日 中优先级'
].join('\n');
const sample = '任务A 重构导入逻辑 张三 进行中 截止时间 2025年12月01日 高优先级';

function assertEqual(actual: unknown, expected: unknown, message: string): void {
	if (actual !== expected) {
		throw new Error(`${message}: expected "${expected}", got "${actual}"`);
	}
}

function assertRow(template: string, expectedRows: string[][]): void {
	const result = controller.runExtractionForTest(template, sample, content);
	if (result.error) {
		throw new Error(`Template "${template}" error: ${result.error}`);
	}
	assertEqual(result.rows.length, expectedRows.length, `Template "${template}" row count`);
	expectedRows.forEach((expectedRow, rowIndex) => {
		const row = result.rows[rowIndex];
		assertEqual(row.length, expectedRow.length, `Template "${template}" row ${rowIndex + 1} column count`);
		expectedRow.forEach((value, index) => {
			assertEqual(row[index], value, `Template "${template}" row ${rowIndex + 1} field ${index + 1}`);
		});
	});
}

assertRow('*', [[sample]]);
assertRow('* *', [['任务A', '重构导入逻辑 张三 进行中 截止时间 2025年12月01日 高优先级']]);
assertRow('* * *', [['任务A', '重构导入逻辑', '张三 进行中 截止时间 2025年12月01日 高优先级']]);

console.log('Magic migration template tests passed.');
