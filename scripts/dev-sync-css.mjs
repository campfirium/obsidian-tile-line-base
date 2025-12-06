#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const pluginDir = process.argv[2] ?? process.env.OBSIDIAN_PLUGIN_DIR;

if (!pluginDir) {
	console.error('缺少插件目录，请传入参数或设置环境变量 OBSIDIAN_PLUGIN_DIR');
	process.exit(1);
}

if (!fs.existsSync(pluginDir)) {
	console.error(`插件目录不存在：${pluginDir}`);
	process.exit(1);
}

const status = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' }).trim();
const changedFiles = status
	? status.split('\n').map((line) => line.slice(3).trim()).filter(Boolean)
	: [];

const cssOnly = changedFiles.length > 0 && changedFiles.every((file) => file === 'styles.css');

if (cssOnly) {
	const srcCss = path.join(repoRoot, 'styles.css');
	const destCss = path.join(pluginDir, 'styles.css');
	fs.copyFileSync(srcCss, destCss);
	console.log('检测到仅 CSS 变更，跳过 lint/build，直接同步 CSS。');
	console.log(`已同步 CSS 到插件目录：${destCss}`);
	process.exit(0);
}

console.log('存在非 CSS 变更，执行构建...');
execSync('npm run build', { cwd: repoRoot, stdio: 'inherit' });
console.log('构建完成。');
