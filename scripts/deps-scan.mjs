import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

const dependencyChecks = {
	'ag-grid-community': ['ag-grid-community'],
	'monkey-around': ['monkey-around'],
	sortablejs: ['sortablejs'],
	'@eslint/js': ['@eslint/js'],
	'@types/node': ['@types/node'],
	'@types/sortablejs': ['@types/sortablejs'],
	'@typescript-eslint/eslint-plugin': ['@typescript-eslint/eslint-plugin'],
	'@typescript-eslint/parser': ['@typescript-eslint/parser'],
	'builtin-modules': ['builtin-modules'],
	esbuild: ['esbuild'],
	eslint: ['eslint', 'run-lint.mjs'],
	'eslint-import-resolver-typescript': ['eslint-import-resolver-typescript'],
	'eslint-plugin-eslint-comments': ['eslint-plugin-eslint-comments'],
	'eslint-plugin-import': ['eslint-plugin-import'],
	'eslint-plugin-obsidianmd': ['eslint-plugin-obsidianmd'],
	'jsonc-eslint-parser': ['jsonc-eslint-parser'],
	obsidian: ['obsidian'],
	terser: ['terser'],
	'ts-node': ['ts-node'],
	tslib: ['tslib'],
	typescript: ['typescript', 'tsc -noEmit'],
	'typescript-eslint': ['typescript-eslint']
};

const scanTargets = [
	'package.json',
	'.eslintrc.cjs',
	'esbuild.config.mjs',
	'version-bump.mjs',
	'README.md',
	'AGENTS.md',
	'scripts',
	'src',
	'.lab/scripts'
];

function collectFiles(targetPath, results) {
	if (!fs.existsSync(targetPath)) return;
	const stats = fs.statSync(targetPath);
	if (stats.isFile()) {
		results.push(targetPath);
		return;
	}
	for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
		collectFiles(path.join(targetPath, entry.name), results);
	}
}

const files = [];
for (const target of scanTargets) {
	collectFiles(path.join(rootDir, target), files);
}

const corpus = files
	.map((filePath) => fs.readFileSync(filePath, 'utf8'))
	.join('\n');

const declaredDependencies = Object.keys(packageJson.dependencies ?? {});
const declaredDevDependencies = Object.keys(packageJson.devDependencies ?? {});
const allDependencies = [...declaredDependencies, ...declaredDevDependencies];

const unknownPackages = allDependencies.filter((name) => !dependencyChecks[name]);
if (unknownPackages.length > 0) {
	console.error(`deps:scan 缺少这些包的检查规则：${unknownPackages.join(', ')}`);
	process.exit(1);
}

const unused = [];
for (const packageName of allDependencies) {
	const patterns = dependencyChecks[packageName];
	const matched = patterns.some((pattern) => corpus.includes(pattern));
	if (!matched) {
		unused.push(packageName);
	}
}

if (unused.length > 0) {
	console.error(`deps:scan 发现需要复核的直接依赖：${unused.join(', ')}`);
	process.exit(1);
}

console.log('deps:scan 未发现明显未使用的直接依赖');
