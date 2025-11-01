#!/usr/bin/env node
import eslintExperimental from 'eslint/use-at-your-own-risk';
const { FlatESLint } = eslintExperimental;
import { existsSync } from 'fs';
import { mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const lintCwd = (() => {
	let current = repoRoot;
	while (!existsSync(path.join(current, 'node_modules')) && path.dirname(current) !== current) {
		current = path.dirname(current);
	}
	return current;
})();

if (lintCwd !== repoRoot) {
	process.env.NODE_PATH = [lintCwd, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
	const moduleRequire = createRequire(import.meta.url);
	const Module = moduleRequire('module');
	Module.Module._initPaths();
}
const docsDir = path.join(repoRoot, 'docs');
const reportPath = path.join(docsDir, 'reports.md');
const legacyReportsDir = path.join(repoRoot, 'reports');
const legacyReportPath = path.join(legacyReportsDir, 'lint-report.md');

const EMPTY_VALUE = 'N/A';

const escapeCell = (value) => {
	if (!value) {
		return EMPTY_VALUE;
	}
	return String(value)
		.replace(/\r?\n/g, ' ');
};

const severityLabel = (severity) => (severity === 2 ? 'Error' : 'Warning');

const summarizeCounts = (results) => results.reduce((totals, result) => {
	totals.errors += result.errorCount;
	totals.warnings += result.warningCount;
	return totals;
}, { errors: 0, warnings: 0 });

const sanitizeLineNumber = (line) => (typeof line === 'number' && Number.isFinite(line) ? line : null);

const collectIssues = (results) => {
	const issues = [];

	for (const result of results) {
		const relativePath = path.relative(repoRoot, result.filePath).replace(/\\/g, '/');

		for (const message of result.messages) {
			if (message.severity === 0) {
				continue;
			}

			const issue = {
				file: relativePath || result.filePath,
				line: sanitizeLineNumber(message.line),
				column: sanitizeLineNumber(message.column),
				severity: severityLabel(message.severity),
				severityValue: message.severity,
				ruleId: message.ruleId ?? EMPTY_VALUE,
				message: message.message
			};

			issues.push(issue);
		}
	}

	return issues;
};

const sortIssues = (items) => {
	const toSortableNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER);
	const normalizeRule = (value) => (value && value !== EMPTY_VALUE ? value : '');
	return items.slice().sort((a, b) => {
		const aIsMaxLines = a.ruleId === 'max-lines';
		const bIsMaxLines = b.ruleId === 'max-lines';
		if (aIsMaxLines !== bIsMaxLines) {
			return aIsMaxLines ? 1 : -1;
		}

		const ruleDiff = normalizeRule(a.ruleId).localeCompare(normalizeRule(b.ruleId));
		if (ruleDiff !== 0) {
			return ruleDiff;
		}

		const fileDiff = a.file.localeCompare(b.file);
		if (fileDiff !== 0) {
			return fileDiff;
		}

		const lineDiff = toSortableNumber(a.line) - toSortableNumber(b.line);
		if (lineDiff !== 0) {
			return lineDiff;
		}

		return toSortableNumber(a.column) - toSortableNumber(b.column);
	});
};

const buildReportLines = (timestamp, totals, issues) => {
	const lines = [
		'ESLint Report',
		`Generated ${timestamp}`,
		`Total errors ${totals.errors}`,
		`Total warnings ${totals.warnings}`
	];

	if (issues.length === 0) {
		lines.push('', '```', 'No issues detected.', '```');
		return lines;
	}

	const sortedIssues = sortIssues(issues);
	const nonMaxIssues = sortedIssues.filter((issue) => issue.ruleId !== 'max-lines');
	const maxLineIssues = sortedIssues.filter((issue) => issue.ruleId === 'max-lines');

	const formatNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : EMPTY_VALUE);

	if (nonMaxIssues.length > 0) {
		lines.push('', '```');
		nonMaxIssues.forEach((issue, index) => {
			if (index > 0) {
				lines.push('');
			}
			lines.push(
				escapeCell(issue.file),
				`Line ${formatNumber(issue.line)} Column ${formatNumber(issue.column)}`,
				`${escapeCell(issue.ruleId)}`,
				`${escapeCell(issue.message)}`
			);
		});
		lines.push('```');
	}

	maxLineIssues.forEach((issue) => {
		lines.push(
			'',
			'```',
			escapeCell(issue.file),
			`Line ${formatNumber(issue.line)} Column ${formatNumber(issue.column)}`,
			`${escapeCell(issue.ruleId)}`,
			`${escapeCell(issue.message)}`,
			'```'
		);
	});

	return lines;
};

const run = async () => {
	const eslint = new FlatESLint({ cwd: repoRoot });
	const lintTargets = [
		'src/**/*.{ts,tsx}',
		'scripts/**/*.mjs',
	];
	const results = await eslint.lintFiles(lintTargets);
	const formatter = await eslint.loadFormatter('stylish');
	const formattedOutput = formatter.format(results);

	if (formattedOutput.trim().length > 0) {
		console.log(formattedOutput);
	}

	const timestamp = new Date().toISOString();
	const totals = summarizeCounts(results);
	const issues = collectIssues(results);
	const hasIssues = issues.length > 0;

	if (hasIssues) {
		await rm(legacyReportsDir, { recursive: true, force: true }).catch(() => {});
		await mkdir(docsDir, { recursive: true });
		const lines = buildReportLines(timestamp, totals, issues);
		await writeFile(reportPath, `${lines.join('\n')}\n`, 'utf8');
		await rm(legacyReportPath, { force: true }).catch(() => {});
		const reportLocation = path.relative(repoRoot, reportPath).replace(/\\/g, '/');
		console.error(`ESLint detected ${totals.errors} error(s) and ${totals.warnings} warning(s). See ${reportLocation} for detailed reports.`);
		process.exitCode = 1;
		return;
	}

	await rm(reportPath, { force: true }).catch(() => {});
	await rm(legacyReportsDir, { recursive: true, force: true }).catch(() => {});
	process.exitCode = 0;
};

run().catch((error) => {
	console.error(error);
	process.exit(1);
});
