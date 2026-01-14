import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tsEslintPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';
import jsoncParser from 'jsonc-eslint-parser';
import importPlugin from 'eslint-plugin-import';
import eslintCommentsPlugin from 'eslint-plugin-eslint-comments';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


let obsidianFlatConfigs = [];
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
} catch {
	obsidianFlatConfigs = [];
}


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
		linterOptions: {
			reportUnusedDisableDirectives: 'error',
		},
	},
	{
		plugins: {
			'eslint-comments': eslintCommentsPlugin,
		},
		rules: {
			'eslint-comments/disable-enable-pair': ['error', { allowWholeFile: false }],
			'eslint-comments/no-restricted-disable': ['error', 'no-console', 'obsidianmd/no-static-styles-assignment'],
			'eslint-comments/no-unused-disable': 'error',
			'eslint-comments/require-description': 'error',
		},
	},
	...obsidianFlatConfigs,
	{
		rules: {
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
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/explicit-module-boundary-types': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-base-to-string': 'error',
			'@typescript-eslint/no-unnecessary-type-assertion': 'error',
			'@typescript-eslint/no-redundant-type-constituents': 'error',
			'@typescript-eslint/require-await': 'error',
			'import/no-unused-modules': ['error', { unusedExports: true }],
		},
	},
	{
		files: ['src/locales/**/*.json', 'manifest.json'],
		languageOptions: {
			parser: jsoncParser,
		},
		rules: {
			'max-lines': 'off',
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
