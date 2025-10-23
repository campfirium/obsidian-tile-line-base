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
		'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
		'@typescript-eslint/no-explicit-any': 'off',
		'@typescript-eslint/explicit-module-boundary-types': 'off',
	},
	overrides: [
		{
			files: ['scripts/**/*.mjs', 'esbuild.config.mjs'],
			rules: {
				'@typescript-eslint/no-var-requires': 'off',
			},
		},
	],
};
