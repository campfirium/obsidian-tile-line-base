// Run with: node scripts/dev/verify-audit-regressions.cjs
// Vault operations are mocked; this script never reads or writes user notes.
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs' } });
const assert = require('node:assert/strict');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');
const originalLoad = Module._load;
class TFile { constructor() { this.path = 'audit.md'; } }
global.window = globalThis;
global.__LOG_PROD__ = true;
Module._load = function (id, parent, main) {
	if (id === 'obsidian') return { TFile, Notice: class {}, normalizePath: value => value.replace(/\\/g, '/'), Plugin: class {} };
	return originalLoad.call(this, id, parent, main);
};
const { scanCellLinkTokens } = require('../../src/utils/cellLinkTokens');
const { parseCellLinkSegments } = require('../../src/utils/linkDetection');
const { resolveDirectImage } = require('../../src/table-view/slide/SlideContentResolver');
const { parseBackupIndex } = require('../../src/services/backupIndexParser');
const { buildBackupFileName, buildLegacyEntryPath, getLegacyPathSegments } = require('../../src/services/backupPath');
const { TablePersistenceService } = require('../../src/table-view/TablePersistenceService');
const { BackupManager } = require('../../src/services/BackupManager');

function deferred() {
	let resolve;
	const promise = new Promise(done => { resolve = done; });
	return { promise, resolve };
}

async function verifySave(phase, flushImmediately) {
	const file = new TFile();
	const entered = deferred();
	const gate = deferred();
	let blocked = false;
	let content = 'first edit';
	let dirty = true;
	const writes = [];
	const baselines = [];
	async function pause(name) {
		if (phase === name && !blocked) {
			blocked = true;
			entered.resolve();
			await gate.promise;
		}
	}
	const service = new TablePersistenceService({
		app: { vault: {
			getAbstractFileByPath: () => file,
			modify: async (_, value) => { await pause('modify'); writes.push(value); }
		} },
		getFile: () => file,
		dataStore: { blocksToMarkdown: () => content },
		getBackupManager: () => ({ ensureBackup: () => pause('backup') }),
		configManager: { save: () => pause('config') },
		shouldAllowSave: () => dirty,
		replaceConversionBaseline: value => { dirty = false; baselines.push(value); },
		getSaveDelayMs: () => 5
	});
	service.getConfigPayload = () => ({});
	const first = service.save();
	await entered.promise;
	content = 'second edit';
	service.scheduleSave();
	assert.equal(service.hasPendingSave(), true);
	// A close/switch flush must join the writer and wait for the newest edit.
	const flush = flushImmediately ? service.save() : Promise.resolve();
	gate.resolve();
	await Promise.all([first, flush]);
	assert.deepEqual(writes, ['first edit\n', 'second edit\n']);
	assert.deepEqual(baselines, ['second edit\n']);
	assert.equal(service.hasPendingSave(), false);
	assert.equal(dirty, false);
	service.dispose();
	console.log(`PASS save during ${phase}, flush=${flushImmediately}, latest baseline`);
}

function verifyBackupPaths() {
	const validId = '20260920-123456-001';
	const entry = { id: validId, createdAt: 1, size: 0, hash: 'test' };
	const parse = (file, id) => parseBackupIndex(JSON.stringify({ version: 1, files: { [file]: { entries: [{ ...entry, id }] } } }), 1);
	assert.equal(parse('笔记/测试.md', validId).files['笔记/测试.md'].entries.length, 1);
	assert.ok(buildBackupFileName('笔记/测试.md', `${validId}-100`, '.tlbkp').endsWith('-100.tlbkp'));
	assert.equal(buildLegacyEntryPath('.obsidian/plugins/tlb/backups', ['笔记', '测试'], validId, '.tlbkp'), `.obsidian/plugins/tlb/backups/笔记/测试/${validId}.tlbkp`);
	for (const id of ['x/../../../../target', '../x', '..\\x', '/absolute', 'C:\\x', `${validId}\u0000`, `${validId}\n`, `${validId}/child`]) {
		assert.deepEqual(Object.keys(parse('audit.md', id).files), []);
		assert.throws(() => buildBackupFileName('audit.md', id, '.tlbkp'));
		assert.throws(() => buildLegacyEntryPath('backups', ['audit'], id, '.tlbkp'));
	}
	for (const file of ['../note.md', 'x/../../note.md', '/note.md', 'C:/note.md', 'x\\..\\note.md', './note.md']) {
		assert.deepEqual(Object.keys(parse(file, validId).files), []);
		assert.throws(() => getLegacyPathSegments(file));
		assert.throws(() => buildBackupFileName(file, validId, '.tlbkp'));
	}
	assert.throws(() => buildLegacyEntryPath('backups', ['..', 'outside'], validId, '.tlbkp'));
	assert.throws(() => buildLegacyEntryPath('../backups', ['note'], validId, '.tlbkp'));
	console.log('PASS backup index/path rejection, Unicode and legacy paths, empty snapshots');
}

function verifyLinkCompatibility() {
	const original = /\[\[([^[\]]+)\]\]|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s<>"')]+)/gi;
	const parts = ['[', ']', '(', ')', '[[note]]', '[label](https://a)', 'https://a', 'H', 'a', ' ', '\n', '|', '[[]](x)'];
	let seed = 42;
	for (let i = 0; i < 3000; i++) {
		let input = '';
		for (let j = 0; j < 20; j++) {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			input += parts[seed % parts.length];
		}
		const expected = [...input.matchAll(original)].map(m => [m[0], m.index, m[1], m[2], m[3], m[4]]);
		const actual = [...scanCellLinkTokens(input)].map(m => [m.text, m.index, m.wikiInner, m.markdownText, m.markdownTarget, m.bareUrl]);
		assert.deepEqual(actual, expected, input);
	}
	console.log('PASS 3000 seeded link token compatibility cases');
}

async function verifyBackupAdapterBoundary() {
	const calls = [];
	const root = '.obsidian/plugins/tlb';
	const id = '20260920-123456-001';
	const raw = JSON.stringify({ version: 1, files: {
		'audit.md': { entries: [{ id, createdAt: 1, size: 1, hash: 'test' }, { id: 'x/../../../../outside', createdAt: 1, size: 1, hash: 'test' }] },
		'../../outside.md': { entries: [{ id, createdAt: 1, size: 1, hash: 'test' }] }
	} });
	const adapter = {
		exists: async name => { calls.push(name); return true; },
		read: async name => { calls.push(name); return raw; },
		write: async name => { calls.push(name); },
		stat: async name => { calls.push(name); return { type: 'file', size: 1 }; }
	};
	const manager = new BackupManager({
		plugin: { manifest: { id: 'tlb' }, app: { vault: { configDir: '.obsidian', adapter } } },
		getSettings: () => ({ enabled: true, maxSizeMB: 10 })
	});
	await manager.initialize();
	const backups = await manager.listBackups('audit.md');
	assert.deepEqual(backups.map(entry => entry.id), [id]);
	assert.deepEqual(await manager.listBackups('../../outside.md'), []);
	assert.ok(calls.every(name => (name === root || name.startsWith(root + '/')) && !name.includes('..')));
	assert.ok(!calls.some(name => name.includes('outside')));
	console.log('PASS malformed backup entries never reach the adapter');
}

function verifyLongText() {
	for (const size of [8000, 16000, 32000, 128000]) {
		const start = performance.now();
		assert.deepEqual(parseCellLinkSegments('['.repeat(size)), [{ kind: 'text', text: '['.repeat(size) }]);
		const linkMs = performance.now() - start;
		const imageStart = performance.now();
		assert.equal(resolveDirectImage('a'.repeat(size)), null);
		const imageMs = performance.now() - imageStart;
		assert.ok(linkMs < 1000 && imageMs < 1000, 'Long text exceeded the conservative 1s regression budget');
		console.log(JSON.stringify({ size, linkMs: +linkMs.toFixed(2), imageMs: +imageMs.toFixed(2) }));
	}
	assert.equal(parseCellLinkSegments(`[${'a'.repeat(32000)}](https://example.com)`)[0].kind, 'link');
	assert.equal(resolveDirectImage(`${'a'.repeat(32000)} image.png`), '![[image.png]]');
	for (let i = 0; i < 3; i++) assert.equal(resolveDirectImage('![alt](https://example.com/render?id=1)'), '![alt](https://example.com/render?id=1)');
}

async function main() {
	verifyBackupPaths();
	await verifyBackupAdapterBoundary();
	verifyLinkCompatibility();
	verifyLongText();
	for (const phase of ['backup', 'modify', 'config']) {
		await verifySave(phase, false);
		await verifySave(phase, true);
	}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
