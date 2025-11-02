import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tsEslintPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';
import jsoncParser from 'jsonc-eslint-parser';
import importPlugin from 'eslint-plugin-import';

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

let obsidianFlatConfigs = [];
let hasObsidianPlugin = false;
try {
	// eslint-plugin-obsidianmd uses a hybrid config object to support both legacy and flat configs.
	// We translate the hybrid structure into pure flat configs manually to keep control over overrides.
	const obsidianModule = await import('eslint-plugin-obsidianmd');
	const obsidianPlugin = obsidianModule.default ?? obsidianModule;
	const recommended = obsidianPlugin?.configs?.recommended;
	if (recommended) {
		const toArray = (value) => {
			if (Array.isArray(value)) {
				return value;
			}

			if (value == null) {
				return [];
			}

			return [value];
		};

		const flattenHybridConfig = (entries, inheritedFiles) => {
			const flattened = [];

			for (const entry of entries) {
				if (entry == null) {
					continue;
				}

				if (Array.isArray(entry)) {
					flattened.push(...flattenHybridConfig(entry, inheritedFiles));
					continue;
				}

				const { extends: extended, files, ...rest } = entry;
				const effectiveFiles = files ?? inheritedFiles;

				if (extended) {
					const nestedEntries = flattenHybridConfig(toArray(extended), effectiveFiles);
					flattened.push(...nestedEntries);
				}

				const current = { ...rest };
				if (effectiveFiles) {
					current.files = effectiveFiles;
				}

				flattened.push(current);
			}

			return flattened;
		};

		obsidianFlatConfigs = flattenHybridConfig(Array.from(recommended));
	}
	hasObsidianPlugin = obsidianFlatConfigs.length > 0;
} catch {
	obsidianFlatConfigs = [];
}


const OBSIDIAN_RULE_OVERRIDES = hasObsidianPlugin ? {
	'obsidianmd/ui/sentence-case': 'off',
	'obsidianmd/ui/sentence-case-json': 'off',
	'obsidianmd/ui/sentence-case-locale-module': 'off',
} : {};

export default [
	{
		ignores: ['dist/**', 'node_modules/**', '*.js', 'src/cache/**'],
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
	...obsidianFlatConfigs,
	{
		rules: {
			...OBSIDIAN_RULE_OVERRIDES,
			'max-lines': ['error', { max: 520, skipBlankLines: true, skipComments: true }],
			'@microsoft/sdl/no-inner-html': 'off',
		},
	},
	{
		files: ['**/*.ts', '**/*.tsx'],
		plugins: {
			'@typescript-eslint': tsEslintPlugin,
			import: importPlugin,
		},
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				project: './tsconfig.json',
				tsconfigRootDir: __dirname,
			},
		},
		settings: {
			'import/resolver': {
				typescript: {
					project: path.resolve(__dirname, './tsconfig.json'),
				},
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
			'import/no-unused-modules': ['error', { unusedExports: true }],
		},
	},
	{
		files: ['src/locales/**/*.json', 'manifest.json'],
		languageOptions: {
			parser: jsoncParser,
		},
	},
	{
		files: CORE_COORDINATION_FILES,
		rules: {
			'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
		},
	},
	{
		files: ['src/table-view/filter/FilterViewModals.ts'],
		rules: {
			'max-lines': ['error', { max: 900, skipBlankLines: true, skipComments: true }],
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
