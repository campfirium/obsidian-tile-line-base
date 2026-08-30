#!/usr/bin/env node
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import eslintExperimental from 'eslint/use-at-your-own-risk';

const { FlatESLint } = eslintExperimental;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const reportPath = path.join(repoRoot, 'docs', 'obsidian-strict-lint-report.md');
const require = createRequire(import.meta.url);

// Mirrors the rule families surfaced by the Obsidian review report. Keep this
// focused on parity reporting instead of silently broadening the build gate.
const OBSIDIAN_REVIEW_RULES = {
	'@typescript-eslint/no-unsafe-argument': 'warn',
	'@typescript-eslint/no-unsafe-assignment': 'warn',
	'@typescript-eslint/no-unsafe-call': 'warn',
	'@typescript-eslint/no-unsafe-member-access': 'warn',
	'@typescript-eslint/no-unsafe-return': 'warn',
	'@typescript-eslint/no-unsafe-unary-minus': 'warn',
	'@typescript-eslint/no-unnecessary-type-assertion': 'warn',
	'obsidianmd/prefer-create-el': 'warn',
	'obsidianmd/settings-tab/prefer-setting-definitions': 'warn',
};

const REVIEW_IGNORES = ['src/i18n/**', 'src/locales/**'];

const isReviewIgnoredFile = (file) =>
	file.startsWith('src/i18n/') || file.startsWith('src/locales/');

const severityLabel = (severity) => (severity === 2 ? 'Error' : 'Warning');

const toMarkdown = (issues) => {
	const obsidianLintVersion = require('eslint-plugin-obsidianmd/package.json').version;
	const obsidianApiVersion = require('obsidian/package.json').version;
	const typeScriptEslintVersion = require('typescript-eslint/package.json').version;
	const countsByRule = new Map();
	for (const issue of issues) {
		countsByRule.set(issue.ruleId, (countsByRule.get(issue.ruleId) ?? 0) + 1);
	}
	const lines = [
		'Obsidian Review Parity Report',
		`Generated ${new Date().toISOString()}`,
		`eslint-plugin-obsidianmd ${obsidianLintVersion}`,
		`obsidian ${obsidianApiVersion}`,
		`typescript-eslint ${typeScriptEslintVersion}`,
		`Total issues ${issues.length}`,
		'',
	];

	if (issues.length === 0) {
		lines.push('No issues detected.');
		return lines.join('\n');
	}

	lines.push('| Rule | Count |');
	lines.push('| --- | ---: |');
	for (const [ruleId, count] of Array.from(countsByRule).sort(([a], [b]) => a.localeCompare(b))) {
		lines.push(`| ${ruleId} | ${count} |`);
	}
	lines.push('', '| Severity | Rule | Location | Message |');
	lines.push('| --- | --- | --- | --- |');
	for (const issue of issues) {
		const location = `${issue.file}:${issue.line ?? 'N/A'}:${issue.column ?? 'N/A'}`;
		const message = issue.message.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
		lines.push(`| ${issue.severity} | ${issue.ruleId} | ${location} | ${message} |`);
	}
	return lines.join('\n');
};

const buildStrictConfig = async () => {
	const baseConfig = (await import(path.join(repoRoot, 'eslint.config.mjs'))).default;

	return [
		...baseConfig,
		{
			files: ['src/**/*.{ts,tsx}'],
			ignores: REVIEW_IGNORES,
			rules: OBSIDIAN_REVIEW_RULES,
		},
	];
};

const collectStrictIssues = (results) => {
	const issues = [];

	for (const result of results) {
		const file = path.relative(repoRoot, result.filePath).replace(/\\/g, '/');
		if (isReviewIgnoredFile(file)) {
			continue;
		}
		for (const message of result.messages) {
			if (!message.ruleId || !Object.hasOwn(OBSIDIAN_REVIEW_RULES, message.ruleId)) {
				continue;
			}
			issues.push({
				file,
				line: message.line,
				column: message.column,
				severity: severityLabel(message.severity),
				ruleId: message.ruleId,
				message: message.message,
			});
		}
	}

	return issues;
};

const run = async () => {
	const strictConfig = await buildStrictConfig();
	const eslint = new FlatESLint({
		cwd: repoRoot,
		overrideConfigFile: true,
		overrideConfig: strictConfig,
	});
	const results = await eslint.lintFiles(['src/**/*.{ts,tsx}']);
	const issues = collectStrictIssues(results);

	if (issues.length === 0) {
		await rm(reportPath, { force: true });
		console.log('[obsidian-strict-lint] No issues detected.');
		return;
	}

	await mkdir(path.dirname(reportPath), { recursive: true });
	await writeFile(reportPath, `${toMarkdown(issues)}\n`, 'utf8');
	console.error(`[obsidian-strict-lint] Detected ${issues.length} issue(s). See ${path.relative(repoRoot, reportPath)}.`);
	process.exitCode = 1;
};

run().catch((error) => {
	console.error(error);
	process.exit(1);
});
