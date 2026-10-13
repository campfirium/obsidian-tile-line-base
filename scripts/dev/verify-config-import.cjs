// Run with: node scripts/dev/verify-config-import.cjs
// Exercise production config/session code with an isolated in-memory Vault.
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs' } });
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
class TFile { constructor(path) { this.path = path; this.basename = path.replace(/\.md$/, ''); this.extension = 'md'; this.parent = null; } }
global.window = globalThis;
global.__LOG_PROD__ = true;
Module._load = function(id, parent, main) {
 if (id === 'obsidian') return { TFile, Notice: class {}, Plugin: class {}, Modal: class {}, Menu: class {}, Setting: class {}, normalizePath: value => value.replace(/\\/g, '/') };
 return originalLoad.call(this, id, parent, main);
};
const { SettingsService } = require('../../src/services/SettingsService');
const { setPluginContext } = require('../../src/pluginContext');
const { TableConfigManager } = require('../../src/table-view/TableConfigManager');
const { TablePersistenceService } = require('../../src/table-view/TablePersistenceService');
const { ConversionSessionManager } = require('../../src/table-view/ConversionSessionManager');
const { TableFileDuplicationController } = require('../../src/table-view/TableFileDuplicationController');
const { buildConfigCalloutBlock } = require('../../src/table-view/config/ConfigBlockIO');
const { mergeConfigEdits, runConfigOperation } = require('../../src/table-view/config/ConfigOperations');
function gate() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(data = {}) {
 const files = new Map(); const contents = new Map(); const writes = [];
 let stored = structuredClone(data); let fail = false; let onModify = () => {};
 const plugin = { loadData: async () => stored, saveData: async value => { if (fail) throw new Error('disk failure'); stored = structuredClone(value); } };
 plugin.app = { vault: {
  getAbstractFileByPath: path => files.get(path) ?? null,
  read: async file => contents.get(file.path),
  create: async (path, content) => { const file = new TFile(path); files.set(path, file); contents.set(path, content); return file; },
  process: async (file, change) => { const old = contents.get(file.path); const next = change(old); if (next !== old) { contents.set(file.path, next); writes.push(next); onModify(file); } },
  modify: async (file, content) => { contents.set(file.path, content); writes.push(content); onModify(file); }
 } };
 const settings = new SettingsService(plugin); await settings.load();
 plugin.getSettingsService = () => settings;
 for (const name of ['getFilterViewsForFile', 'getTagGroupsForFile', 'getGalleryFilterViewsForFile', 'getGalleryTagGroupsForFile', 'getKanbanBoardsForFile', 'saveFilterViewsForFile', 'saveTagGroupsForFile', 'saveGalleryFilterViewsForFile', 'saveGalleryTagGroupsForFile', 'saveKanbanBoardsForFile']) plugin[name] = (...args) => settings[name](...args);
 setPluginContext(plugin);
 const file = await plugin.app.vault.create('note.md', '## Entry\nstatus: todo\n');
 const config = new TableConfigManager();
 function persistence() {
  const service = new TablePersistenceService({ app: plugin.app, configManager: config, getFile: () => file, getBackupManager: () => null });
  let payload = { viewPreference: 'table', copyTemplate: 'old' };
  service.getConfigPayload = () => structuredClone(payload);
  return { service, setPayload: value => { payload = value; } };
 }
 return { plugin, settings, config, file, contents, writes, files, persistence, stored: () => stored, fail: value => { fail = value; }, onModify: fn => { onModify = fn; } };
}
async function main() {
 let f = await fixture();
 const Q = { viewPreference: 'kanban', copyTemplate: 'Q', galleryViews: { activeViewId: 'g', views: [{ id: 'g', name: 'Gallery', template: {}, groupField: 'status' }] } };
 const original = `## Entry\nstatus: todo\n\n${buildConfigCalloutBlock(Q)}\n\n`;
 f.contents.set(f.file.path, original);
 const imported = await f.config.load(f.file);
 assert.equal(imported.galleryViews.views[0].groupField, 'status');
 assert.equal(f.contents.get(f.file.path), original); assert.equal(f.writes.length, 0);
 await f.settings.saveCopyTemplateForFile(f.file.path, 'R');
 assert.equal((await f.config.load(f.file)).copyTemplate, 'R');
 const identity = f.config.getContentIdentity(original);
 assert.equal(identity, f.settings.getSettings().importedConfigBlocks[f.file.path]);
 const restartData = f.stored(); f = await fixture(restartData); f.contents.set(f.file.path, original);
 assert.equal((await f.config.load(f.file)).copyTemplate, 'R');
 const external = original.replace('"copyTemplate":"Q"', '"copyTemplate":"S"');
 f.contents.set(f.file.path, external);
 assert.equal((await f.config.load(f.file)).copyTemplate, 'S');
 console.log('PASS read-only import, retained groupField, unchanged-block skip after restart, external change without metadata update');
 const { service, setPayload } = f.persistence();
 const latest = f.config.getStoredConfig(f.file);
 setPayload(latest); service.captureConfigBaseline();
 setPayload({ ...latest, viewPreference: 'gallery' });
 const before = f.contents.get(f.file.path);
 await service.saveConfig({ writeNote: false });
 assert.equal(f.contents.get(f.file.path), before); assert.equal(f.writes.length, 0);
 await f.settings.setSaveConfigBlockInNote(true);
 await service.saveConfig();
 const count = f.writes.length; assert.equal(count, 1);
 await service.saveConfig(); assert.equal(f.writes.length, count);
 assert.equal((await f.config.load(f.file)).viewPreference, 'gallery');
 console.log('PASS browsing config saves do not write notes, explicit mirror saves, equal content skips writes');
 const entered = gate(); const release = gate(); const originalSave = f.config.save.bind(f.config);
 let blocked = true; f.config.save = async (file, value) => { if (blocked) { blocked = false; entered.resolve(); await release.promise; } return originalSave(file, value); };
 setPayload({ ...latest, viewPreference: 'slide', copyTemplate: 'new' });
 const write = service.saveConfig(); await entered.promise;
 let settled = false; const sibling = new TableConfigManager();
 const read = sibling.load(f.file).then(value => { settled = true; return value; });
 await Promise.resolve(); assert.equal(settled, false);
 release.resolve(); await write; assert.equal((await read).copyTemplate, 'new');
 assert.equal(f.settings.getSettings().importedConfigBlocks[f.file.path], f.config.getContentIdentity(f.contents.get(f.file.path)));
 console.log('PASS sibling import waits for write/settings/identity settlement');
 f.config.save = originalSave;
 const beforeFailure = f.settings.getSettings().importedConfigBlocks[f.file.path];
 f.contents.set(f.file.path, buildConfigCalloutBlock({ copyTemplate: 'retry' }));
 const priorTemplate = f.settings.getCopyTemplateForFile(f.file.path);
 f.fail(true); const fallback = await f.config.load(f.file);
 assert.equal(fallback.copyTemplate, priorTemplate);
 assert.equal(f.settings.getCopyTemplateForFile(f.file.path), priorTemplate);
 assert.equal(f.settings.getSettings().importedConfigBlocks[f.file.path], beforeFailure);
 f.fail(false); assert.equal((await f.config.load(f.file)).copyTemplate, 'retry');
 assert.equal(f.settings.getFileViewPreference(f.file.path), 'table');
 console.log('PASS failed import renders saved settings, does not acknowledge, retry works, partial block follows existing default rules');
 const base = { galleryViews: { activeViewId: 'g', views: [{ id: 'g', name: 'before', groupField: 'status', template: { title: 'A', body: 'B' } }] } };
 const local = structuredClone(base); local.galleryViews.views[0].template.title = 'edited';
 const remote = structuredClone(base); remote.galleryViews.views[0].groupField = 'category'; remote.galleryViews.views[0].template.body = 'external';
 const merged = mergeConfigEdits(base, local, remote);
 assert.equal(merged.galleryViews.views[0].template.title, 'edited');
 assert.equal(merged.galleryViews.views[0].template.body, 'external');
 assert.equal(merged.galleryViews.views[0].groupField, 'category');
 console.log('PASS draft commit preserves unrelated sibling settings including nested gallery fields');
 f.contents.set(f.file.path, original); await f.settings.saveCopyTemplateForFile(f.file.path, 'current');
 service.getConfigPayload = () => ({ copyTemplate: 'current', viewPreference: 'table' });
 const copy = new TableFileDuplicationController({ app: f.plugin.app, configManager: f.config, persistence: service, getCurrentFile: () => f.file, getOwnerDocument: () => null });
 await copy.duplicateCurrentFile();
 const copied = [...f.files.values()].find(file => file !== f.file);
 assert.ok(copied); assert.equal(f.contents.get(copied.path), original);
 assert.equal((await new TableConfigManager().load(copied)).copyTemplate, 'current');
 const oldPath = copied.path; copied.path = 'renamed.md'; f.files.delete(oldPath); f.files.set(copied.path, copied); f.contents.set(copied.path, original);
 await f.settings.migrateFileScopedSettings(oldPath, copied.path);
 assert.equal((await f.config.load(copied)).copyTemplate, 'current');
 assert.ok(f.settings.getSettings().importedConfigBlocks[copied.path]);
 assert.equal(f.settings.getSettings().importedConfigBlocks[oldPath], undefined);
 await f.settings.pruneFileScopedSettingsForPath(copied.path);
 assert.equal(f.settings.getSettings().importedConfigBlocks[copied.path], undefined);
 console.log('PASS duplicate opens with current settings, identity-only rename migration and delete cleanup');
 const snapshots = []; f.plugin.getBackupManager = () => ({ ensureInitialBackup: async (_, value) => { snapshots.push(value); } });
 const view = { file: f.file }; const session = new ConversionSessionManager(view);
 session.prepare(f.file); session.captureBaseline('A'); session.captureBaseline('D'); session.markUserMutation('edit');
 await Promise.resolve(); assert.deepEqual(snapshots, ['D']);
 session.captureBaseline('later'); assert.equal(session.hasUserMutations(), true);
 assert.equal(session.restoreBaselineIfEligible, undefined);
 console.log('PASS refreshed initial backup uses D, render does not clear dirty flag, no exit restore API');

 const { AgGridColumnService } = require('../../src/grid/column/AgGridColumnService');
 let width = 100; let resizeEdits = 0;
 const column = { getColId: () => 'Value', getColDef: () => ({ field: 'Value' }), getActualWidth: () => width, isResizable: () => true };
 const columnService = new AgGridColumnService({ getContainer: () => ({ clientWidth: 500, clientHeight: 300 }) });
 columnService.configureCallbacks({ onColumnResize: () => { resizeEdits++; } });
 columnService.attachApis({
  getAllDisplayedColumns: () => [column], autoSizeColumns: () => { width = 180; },
  setColumnWidths: changes => { width = changes[0].newWidth; }, refreshHeader() {}, refreshCells() {}
 }, null);
 columnService.resizeColumns(); assert.equal(resizeEdits, 0);
 columnService.handleColumnResized({ finished: true, column, source: 'uiColumnDragged' }); assert.equal(resizeEdits, 1);
 console.log('PASS initial auto-size is browsing, explicit resize remains an edit');

 const { FilterViewController } = require('../../src/table-view/filter/FilterViewController');
 const { FilterStateStore } = require('../../src/table-view/filter/FilterStateStore');
 let explicitFilterEdits = 0; let generatedFilterSaves = 0;
 const filters = new FilterViewController({ app: {}, stateStore: new FilterStateStore(null), getAvailableColumns: () => ['status'],
  persist: () => { explicitFilterEdits++; }, persistPreferences: () => { generatedFilterSaves++; },
  applyActiveFilterView() {}, syncState() {}, renderBar() {}
 });
 assert.equal(filters.ensureFilterViewsForFieldValues('status', ['todo']).length, 1);
 assert.equal(explicitFilterEdits, 0); assert.equal(generatedFilterSaves, 1);
 filters.ensureFilterViewsForFieldValues('status', ['todo']); assert.equal(generatedFilterSaves, 1);
 console.log('PASS generated status filters persist settings without becoming user edits');

 const { TagGroupController } = require('../../src/table-view/filter/tag-group/TagGroupController');
 const { TagGroupStore } = require('../../src/table-view/filter/tag-group/TagGroupStore');
 // Both table and gallery controllers use the same activation boundary.
 for (const scope of ['table', 'gallery']) {
  const stateStore = new FilterStateStore(null);
  const groupStore = new TagGroupStore(null, scope);
  let writes = 0; let backups = 0; let selections = 0;
  const controller = new FilterViewController({ app: {}, stateStore, getAvailableColumns: () => ['status'],
   persist: () => { writes++; backups++; }, persistPreferences: () => { selections++; },
   applyActiveFilterView() {}, syncState() {}, renderBar() {}
  });
  const [tab] = controller.ensureFilterViewsForFieldValues('status', ['todo']);
  controller.activateFilterView(tab.id); controller.activateFilterView(null);
  assert.equal(stateStore.getState().activeViewId, null);
  const group = { id: 'test-group', name: 'Test', viewIds: [tab.id] };
  groupStore.setState({ activeGroupId: null, groups: [group], metadata: {} });
  const groups = new TagGroupController({ app: {}, store: groupStore,
   getFilterViewState: () => stateStore.getState(), getAvailableColumns: () => ['status'], getUniqueFieldValues: () => [],
   ensureFilterViewsForFieldValues: (field, values) => controller.ensureFilterViewsForFieldValues(field, values),
   activateFilterView: id => controller.activateFilterView(id), renderBar() {},
   persist: () => { writes++; backups++; }, persistPreferences: () => { selections++; },
   isStatusBaselineSeeded: () => true, markStatusBaselineSeeded() {}, cloneFilterView: () => null
  });
  groups.activateGroup(group);
  assert.equal(groupStore.getState().activeGroupId, group.id);
  assert.equal(writes, 0); assert.equal(backups, 0); assert.ok(selections >= 4);
  // Deleting an existing definition still takes the explicit edit boundary.
  controller.deleteFilterView(tab.id); assert.ok(writes > 0);
  console.log(`PASS ${scope} filter and tag-group selection stays read-only; definition deletion remains an edit`);
 }
 const { stableConfigIdentity } = require('../../src/table-view/config/ConfigOperations');
 assert.equal(stableConfigIdentity({ z: 1, A: 2, a: 3 }), '{"A":2,"a":3,"z":1}');
 // Old records may use a different key order but must still suppress stale imports.
 const legacy = await fixture();
 const legacyBlock = buildConfigCalloutBlock({ copyTemplate: 'old', viewPreference: 'table' });
 legacy.contents.set(legacy.file.path, legacyBlock);
 legacy.settings.getSettings().importedConfigBlocks[legacy.file.path] = '{"viewPreference":"table","copyTemplate":"old"}';
 await legacy.settings.saveCopyTemplateForFile(legacy.file.path, 'current');
 assert.equal((await legacy.config.load(legacy.file)).copyTemplate, 'current');
 assert.equal(legacy.settings.getSettings().importedConfigBlocks[legacy.file.path], legacy.config.getContentIdentity(legacyBlock));
 console.log('PASS locale-independent ordering accepts old identity without reimport');
 service.dispose(); setPluginContext(null);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
