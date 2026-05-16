#!/usr/bin/env node
import { existsSync, readFileSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const TARGETS = [
	'styles.css'
];

const lineOf = (content, index) => content.slice(0, index).split(/\r?\n/).length;

const findings = [];

for (const relativePath of TARGETS) {
	const filePath = path.join(ROOT, relativePath);
	if (!existsSync(filePath)) {
		continue;
	}
	const content = readFileSync(filePath, 'utf8');
	const regex = /!important\b/g;
	let match;
	while ((match = regex.exec(content)) !== null) {
		findings.push({
			file: relativePath,
			line: lineOf(content, match.index)
		});
	}
}

if (findings.length > 0) {
	console.error('[check-css-important] Found forbidden !important usage:');
	for (const finding of findings) {
		console.error(` - ${finding.file}:${finding.line}`);
	}
	process.exit(1);
}

console.log('[check-css-important] No !important usage detected.');
