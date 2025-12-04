#!/usr/bin/env node
/**
 * Scan for hard-coded UI strings that should go through i18n.
 * Coverage:
 * - getText second argument (forbidden fallback)
 * - common UI properties: text/title/placeholder/aria-label
 * - helper calls: numberRow/createDiv/createSpan/createEl text, setAttribute(title/aria-label)
 */
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'src');
const TARGET_EXT = new Set(['.ts', '.tsx']);

const DETECTORS = [
	{ name: 'getTextFallback', regex: /getText\(\s*[^,]+,\s*(['"`])([^'"`]*[A-Za-z][^'"`]*)\1/gms, group: 2 },
	{ name: 'setText', regex: /\bsetText\(\s*(['"`])([^'"`]*[A-Za-z][^'"`]*)\1/gms, group: 2 },
	{ name: 'textProp', regex: /\btext:\s*(['"`])([^'"`]*[A-Za-z][^'"`]*)\1/gms, group: 2 },
	{ name: 'placeholderProp', regex: /\bplaceholder:\s*(['"`])([^'"`]*[A-Za-z][^'"`]*)\1/gms, group: 2 },
	{ name: 'titleProp', regex: /\btitle:\s*(['"`])([^'"`]*[A-Za-z][^'"`]*)\1/gms, group: 2 },
	{
		name: 'createNodeText',
		regex: /create(?:Div|Span)\(\s*{[^}]*?\btext:\s*(['"`])([^'"`]*[A-Za-z][^'"`]*)\1/gms,
		group: 2
	},
	{
		name: 'createElText',
		regex: /createEl\([^,]+,\s*{[^}]*?\btext:\s*(['"`])([^'"`]*[A-Za-z][^'"`]*)\1/gms,
		group: 2
	},
	{
		name: 'setAttributeTitle',
		regex: /setAttribute\(\s*(['"`])(title|aria-label)\1\s*,\s*(['"`])([^'"`]*[A-Za-z][^'"`]*)\3/gms,
		group: 4
	},
	{
		name: 'attrTitle',
		regex: /attr:\s*{[^}]*?(['"`])(title|aria-label)\1\s*:\s*(['"`])([^'"`]*[A-Za-z][^'"`]*)\3/gms,
		group: 4
	},
	{
		name: 'numberRowLabel',
		regex: /numberRow\(\s*(['"`])([^'"`]*[A-Za-z][^'"`]*)\1/gms,
		group: 2
	}
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

function lineOf(content, index) {
	return content.slice(0, index).split(/\r?\n/).length;
}

const findings = [];
const seen = new Set();

for (const file of collectFiles(SRC_DIR)) {
	const content = readFileSync(file, 'utf8');
	for (const detector of DETECTORS) {
		detector.regex.lastIndex = 0;
		let match;
		while ((match = detector.regex.exec(content)) !== null) {
			const snippet = match[detector.group ?? 2]?.trim();
			if (!snippet) continue;
			const line = lineOf(content, match.index);
			const key = `${file}:${line}:${detector.name}:${snippet}`;
			if (seen.has(key)) continue;
			seen.add(key);
			findings.push({ file, line, kind: detector.name, snippet });
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
