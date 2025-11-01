import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tsEslintPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_COORDINATION_FILES = [
	'src/TableView.ts',
	'src/table-view/BaseTableView.ts',
	'src/table-view/GridController.ts',
	'src/table-view/GridInteractionController.ts',
	'src/table-view/TableViewRenderer.ts',
	'src/table-view/TableViewInteractions.ts',
	'src/table-view/TableViewSetup.ts',
	'src/table-view/TableConfigManager.ts',
	'src/table-view/TableDataStore.ts',
	'src/table-view/SchemaBuilder.ts',
	'src/table-view/MarkdownBlockParser.ts',
	'src/grid/AgGridAdapter.ts',
	'src/grid/column/AgGridColumnService.ts',
	'src/grid/interactions/AgGridInteractionController.ts',
];

const require = createRequire(import.meta.url);
let obsidianmdPlugin;
try {
	const imported = require('eslint-plugin-obsidianmd');
	obsidianmdPlugin = imported.default ?? imported;
} catch {
	obsidianmdPlugin = { configs: { recommended: [] } };
}

export default [
	{
		ignores: ['dist/**', 'node_modules/**', '*.js'],
	},
	{
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
	},
	...(obsidianmdPlugin.configs?.recommended ?? []),
	{
		rules: {
			'max-lines': ['error', { max: 520, skipBlankLines: true, skipComments: true }],
			'obsidianmd/ui/sentence-case': 'off',
			'obsidianmd/ui/sentence-case-json': 'off',
			'obsidianmd/ui/sentence-case-locale-module': 'off',
			'@microsoft/sdl/no-inner-html': 'off',
		},
	},
	{
		files: ['**/*.ts', '**/*.tsx'],
		plugins: {
			'@typescript-eslint': tsEslintPlugin,
		},
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				project: './tsconfig.json',
				tsconfigRootDir: __dirname,
			},
		},
		rules: {
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/explicit-module-boundary-types': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-base-to-string': 'off',
			'@typescript-eslint/no-unnecessary-type-assertion': 'off',
			'@typescript-eslint/no-redundant-type-constituents': 'off',
			'@typescript-eslint/require-await': 'off',
		},
	},
	{
		files: CORE_COORDINATION_FILES,
		rules: {
			'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
		},
	},
	{
		files: ['scripts/**/*.mjs', 'esbuild.config.mjs'],
		plugins: {
			'@typescript-eslint': tsEslintPlugin,
		},
		languageOptions: {
			parserOptions: {
				ecmaVersion: 2022,
				sourceType: 'module',
			},
		},
		rules: {
			'@typescript-eslint/no-var-requires': 'off',
		},
	},
];
