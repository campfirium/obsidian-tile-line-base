#!/usr/bin/env node
/**
 * Scan for hard-coded UI strings that should go through i18n.
 * Rules are intentionally simple: flag literal English text passed to setText/text/placeholder/title.
 */
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'src');
const TARGET_EXT = new Set(['.ts', '.tsx']);

const DETECTORS = [
	{ name: 'setText', regex: /\bsetText\(\s*(['"`])([^'"`]*[A-Za-z][^'"`]*)\1/ },
	{ name: 'textProp', regex: /\btext:\s*(['"`])([^'"`]*[A-Za-z][^'"`]*)\1/ },
	{ name: 'placeholderProp', regex: /\bplaceholder:\s*(['"`])([^'"`]*[A-Za-z][^'"`]*)\1/ },
	{ name: 'titleProp', regex: /\btitle:\s*(['"`])([^'"`]*[A-Za-z][^'"`]*)\1/ }
];

function collectFiles(dir) {
	const entries = readdirSync(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectFiles(full));
			continue;
		}
		if (!TARGET_EXT.has(path.extname(entry.name))) {
			continue;
		}
		files.push(full);
	}
	return files;
}

const findings = [];
for (const file of collectFiles(SRC_DIR)) {
	const content = readFileSync(file, 'utf8');
	const lines = content.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		for (const detector of DETECTORS) {
			const match = detector.regex.exec(line);
			if (match) {
				findings.push({
					file,
					line: i + 1,
					kind: detector.name,
					snippet: match[2].trim()
				});
			}
		}
	}
}

if (findings.length > 0) {
	console.error('[check-i18n] Found hard-coded UI strings (use t() + locales):');
	for (const f of findings) {
		console.error(` - ${path.relative(ROOT, f.file)}:${f.line} [${f.kind}] "${f.snippet}"`);
	}
	process.exit(1);
} else {
	console.log('[check-i18n] No hard-coded UI strings detected.');
}
