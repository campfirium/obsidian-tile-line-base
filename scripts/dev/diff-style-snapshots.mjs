#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const [, , baselinePath, afterPath] = process.argv;

if (!baselinePath || !afterPath) {
	console.error('Usage: node scripts/dev/diff-style-snapshots.mjs <baseline.json> <after.json>');
	process.exit(1);
}

const readSnapshot = (filePath) => {
	const resolved = path.resolve(filePath);
	const data = JSON.parse(fs.readFileSync(resolved, 'utf8'));
	if (!Array.isArray(data.rules)) {
		throw new Error(`Invalid snapshot: ${resolved}`);
	}
	return { ...data, filePath: resolved };
};

const stringify = (value) => JSON.stringify(value);

const normalizeSamples = (rule) => (rule.samples ?? []).map((sample) => ({
	index: sample.index,
	tag: sample.tag,
	className: sample.className,
	text: sample.text,
	style: sample.style ?? {}
}));

const baseline = readSnapshot(baselinePath);
const after = readSnapshot(afterPath);
const afterById = new Map(after.rules.map((rule) => [rule.id, rule]));
const lines = [];
let diffCount = 0;

lines.push('# TLB Style Snapshot Diff');
lines.push('');
lines.push(`- baseline: ${baseline.filePath}`);
lines.push(`- after: ${after.filePath}`);
lines.push(`- baselineCapturedAt: ${baseline.capturedAt ?? ''}`);
lines.push(`- afterCapturedAt: ${after.capturedAt ?? ''}`);
lines.push('');
lines.push('| # | status | baseline | after | selector |');
lines.push('|---:|---|---:|---:|---|');

for (const beforeRule of baseline.rules) {
	const afterRule = afterById.get(beforeRule.id);
	if (!afterRule) {
		diffCount += 1;
		lines.push(`| ${beforeRule.id} | missing-after | ${beforeRule.matched} | - | \`${beforeRule.selector}\` |`);
		continue;
	}

	const beforeSamples = normalizeSamples(beforeRule);
	const afterSamples = normalizeSamples(afterRule);
	const matchedChanged = beforeRule.matched !== afterRule.matched;
	const styleChanged = stringify(beforeSamples) !== stringify(afterSamples);
	const status = matchedChanged || styleChanged ? 'changed' : 'same';
	if (status === 'changed') {
		diffCount += 1;
	}
	lines.push(`| ${beforeRule.id} | ${status} | ${beforeRule.matched} | ${afterRule.matched} | \`${beforeRule.selector}\` |`);
}

if (diffCount > 0) {
	lines.push('');
	lines.push('## Details');
	for (const beforeRule of baseline.rules) {
		const afterRule = afterById.get(beforeRule.id);
		if (!afterRule) {
			continue;
		}
		const beforeSamples = normalizeSamples(beforeRule);
		const afterSamples = normalizeSamples(afterRule);
		if (beforeRule.matched === afterRule.matched && stringify(beforeSamples) === stringify(afterSamples)) {
			continue;
		}
		lines.push('');
		lines.push(`### ${beforeRule.id}. ${beforeRule.selector}`);
		lines.push('');
		lines.push(`- baselineMatched: ${beforeRule.matched}`);
		lines.push(`- afterMatched: ${afterRule.matched}`);
		lines.push('');
		lines.push('```json');
		lines.push(JSON.stringify({ baseline: beforeSamples, after: afterSamples }, null, '\t'));
		lines.push('```');
	}
}

console.log(lines.join('\n'));
process.exit(diffCount > 0 ? 1 : 0);
