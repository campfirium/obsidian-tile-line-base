/**
 * ESLint configuration tuned for TileLineBase.
 * Ensures TypeScript sources in `src/` align with the guidance captured in AGENTS.md.
 */
module.exports = {
	root: true,
	env: {
		node: true,
		es2022: true,
	},
	parser: '@typescript-eslint/parser',
	parserOptions: {
		project: './tsconfig.json',
		tsconfigRootDir: __dirname,
		sourceType: 'module',
	},
	plugins: ['@typescript-eslint'],
	extends: [
		'eslint:recommended',
		'plugin:@typescript-eslint/recommended',
	],
	ignorePatterns: ['dist/', 'node_modules/', '*.js'],
	rules: {
		'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
		'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
		'@typescript-eslint/no-explicit-any': 'off',
		'@typescript-eslint/explicit-module-boundary-types': 'off',
	},
	overrides: [
		{
			files: [
				'src/TableView.ts',
				'src/table-view/BaseTableView.ts',
				'src/table-view/GridController.ts',
				'src/table-view/GridInteractionController.ts',
				'src/table-view/TableViewRenderer.ts',
				'src/table-view/TableViewInteractions.ts',
				'src/table-view/TableDataStore.ts',
				'src/table-view/SchemaBuilder.ts',
				'src/table-view/MarkdownBlockParser.ts',
				'src/grid/AgGridAdapter.ts',
				'src/grid/column/AgGridColumnService.ts',
				'src/grid/interactions/AgGridInteractionController.ts',
			],
			rules: {
				'max-lines': ['error', { max: 250, skipBlankLines: true, skipComments: true }],
			},
		},
		{
			files: ['scripts/**/*.mjs', 'esbuild.config.mjs'],
			rules: {
				'@typescript-eslint/no-var-requires': 'off',
			},
		},
	],
};
