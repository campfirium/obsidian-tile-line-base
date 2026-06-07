#!/usr/bin/env node
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import eslintExperimental from 'eslint/use-at-your-own-risk';

const { FlatESLint } = eslintExperimental;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const reportPath = path.join(repoRoot, 'docs', 'obsidian-strict-lint-report.md');

const OBSIDIAN_STRICT_RULES = {
	'@typescript-eslint/no-unsafe-argument': 'warn',
	'@typescript-eslint/no-unsafe-assignment': 'warn',
	'@typescript-eslint/no-unsafe-call': 'warn',
	'@typescript-eslint/no-unsafe-member-access': 'warn',
	'@typescript-eslint/no-unsafe-return': 'warn',
	'@typescript-eslint/no-unsafe-unary-minus': 'warn',
};

const severityLabel = (severity) => (severity === 2 ? 'Error' : 'Warning');

const toMarkdown = (issues) => {
	const lines = [
		'Obsidian Strict Lint Report',
		`Generated ${new Date().toISOString()}`,
		`Total issues ${issues.length}`,
		'',
	];

	if (issues.length === 0) {
		lines.push('No issues detected.');
		return lines.join('\n');
	}

	lines.push('| Severity | Rule | Location | Message |');
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

	return baseConfig.map((entry) => {
		const files = Array.isArray(entry.files) ? entry.files : [];
		const isTypeScriptEntry = files.includes('**/*.ts') || files.includes('**/*.tsx');
		if (!isTypeScriptEntry) {
			return entry;
		}

		return {
			...entry,
			rules: {
				...entry.rules,
				...OBSIDIAN_STRICT_RULES,
			},
		};
	});
};

const collectStrictIssues = (results) => {
	const issues = [];

	for (const result of results) {
		const file = path.relative(repoRoot, result.filePath).replace(/\\/g, '/');
		for (const message of result.messages) {
			if (!message.ruleId || !Object.hasOwn(OBSIDIAN_STRICT_RULES, message.ruleId)) {
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
