// C4: bdb-aos plugin registration, loose-copy migration and uninstall, always in a temp HOME.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pm = require('../lib/plugin-migration');

const ROOT = path.join(__dirname, '..');
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-c4-'));
const settingsOf = (h) => path.join(h, '.claude', 'settings.json');
const readSettings = (h) => JSON.parse(fs.readFileSync(settingsOf(h), 'utf8'));
const baks = (h) => fs.readdirSync(path.join(h, '.claude')).filter((f) => f.endsWith('.bak'));

function seedLoose(h, files, root = path.join(h, '.claude', 'skills')) {
  const manifest = {};
  for (const [rel, text] of Object.entries(files)) {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
    manifest[f] = { path: f, sha256: sha(text) };
  }
  return manifest;
}
const run = (h, manifest, extra = {}) => pm.migrate({ home: h, manifest, detected: ['claudecode', 'codex', 'antigravity'], ...extra });

test('fresh install registers marketplace and plugin, keeps other settings keys', () => {
  const h = home();
  fs.mkdirSync(path.join(h, '.claude'));
  fs.writeFileSync(settingsOf(h), JSON.stringify({ theme: 'dark', hooks: { Stop: [] }, enabledPlugins: { 'x@y': true } }));
  const r = run(h, {});
  const s = readSettings(h);
  assert.deepEqual(s.extraKnownMarketplaces['bdb-marketplace'], { source: { source: 'github', repo: 'hybridlabor-api/aos' } });
  assert.deepEqual(s.enabledPlugins, { 'x@y': true, 'bdb-aos@bdb-marketplace': true });
  assert.equal(s.theme, 'dark');
  assert.deepEqual(s.hooks, { Stop: [] });
  assert.equal(baks(h).length, 1, 'settings backed up before the write');
  assert.ok(r.covered.has('claudecode'));
  assert.deepEqual([...r.covered], ['claudecode']);
  assert.ok(r.lines.some((l) => /codex: loose copies .* kept/.test(l)));
  assert.ok(r.lines.some((l) => /antigravity: loose copies .* kept/.test(l)));
});

test('no settings file at all: created', () => {
  const h = home();
  assert.ok(run(h, {}).covered.has('claudecode'));
  assert.equal(readSettings(h).enabledPlugins['bdb-aos@bdb-marketplace'], true);
});

test('second run changes nothing', () => {
  const h = home();
  const manifest = seedLoose(h, { 'a/SKILL.md': 'A' });
  run(h, manifest);
  const before = fs.readFileSync(settingsOf(h), 'utf8');
  const nBaks = baks(h).length;
  const r = run(h, manifest);
  assert.equal(fs.readFileSync(settingsOf(h), 'utf8'), before);
  assert.equal(baks(h).length, nBaks);
  assert.ok(r.lines.some((l) => /already in place/.test(l)));
  assert.equal(pm.readState(h).backups.length, 1, 'no second backup dir');
});

test('migration removes own loose copies after a backup, keeps edited and unknown files', () => {
  const h = home();
  const manifest = seedLoose(h, { 'a/SKILL.md': 'A', 'b/SKILL.md': 'B', 'b/extra.md': 'X' });
  const edited = path.join(h, '.claude', 'skills', 'b', 'SKILL.md');
  fs.writeFileSync(edited, 'B edited by user');
  const unknown = path.join(h, '.claude', 'skills', 'mine', 'SKILL.md');
  fs.mkdirSync(path.dirname(unknown), { recursive: true });
  fs.writeFileSync(unknown, 'mine');
  const shared = seedLoose(h, { 'a/SKILL.md': 'A' }, path.join(h, '.agents', 'skills'));
  const oc = seedLoose(h, { 'a/SKILL.md': 'A' }, path.join(h, '.config', 'opencode', 'skills'));
  Object.assign(manifest, shared, oc);

  const r = run(h, manifest);
  const skills = path.join(h, '.claude', 'skills');
  assert.ok(!fs.existsSync(path.join(skills, 'a')), 'unmodified own copy and its empty dir removed');
  assert.ok(!fs.existsSync(path.join(skills, 'b', 'extra.md')));
  assert.equal(fs.readFileSync(edited, 'utf8'), 'B edited by user');
  assert.equal(fs.readFileSync(unknown, 'utf8'), 'mine');
  assert.ok(fs.existsSync(path.join(h, '.agents', 'skills', 'a', 'SKILL.md')), 'shared store stays');
  assert.ok(fs.existsSync(path.join(h, '.config', 'opencode', 'skills', 'a', 'SKILL.md')), 'OpenCode copies stay');
  const [backup] = pm.readState(h).backups;
  assert.equal(fs.readFileSync(path.join(backup, '.claude', 'skills', 'a', 'SKILL.md'), 'utf8'), 'A');
  assert.ok(!fs.existsSync(path.join(backup, '.claude', 'skills', 'b', 'SKILL.md')), 'edited file was not removed, so not backed up');
  assert.ok(!(path.join(skills, 'a', 'SKILL.md') in manifest));
  assert.ok(edited in manifest);
  assert.ok(r.lines.some((l) => /1 edited kept/.test(l)));
});

test('external marketplace is replaced, enabledPlugins follow, nothing else lost', () => {
  const h = home();
  fs.mkdirSync(path.join(h, '.claude'));
  fs.writeFileSync(settingsOf(h), JSON.stringify({
    extraKnownMarketplaces: {
      ext: { source: { source: 'github', repo: 'hybridlabor-api/bdb-marketplace' } },
      other: { source: { source: 'github', repo: 'someone/else' } },
    },
    enabledPlugins: { 'bdb-aos@ext': true, 'foo@other': true },
  }));
  const r = run(h, {});
  const s = readSettings(h);
  assert.ok(!('ext' in s.extraKnownMarketplaces));
  assert.equal(s.extraKnownMarketplaces.other.source.repo, 'someone/else');
  assert.equal(s.extraKnownMarketplaces['bdb-marketplace'].source.repo, 'hybridlabor-api/aos');
  assert.deepEqual(s.enabledPlugins, { 'foo@other': true, 'bdb-aos@bdb-marketplace': true });
  assert.ok(r.lines.some((l) => /replaced external marketplace "ext".*Nothing on GitHub was changed/.test(l)));
});

test('registration failure keeps every copy', () => {
  const h = home();
  const manifest = seedLoose(h, { 'a/SKILL.md': 'A' });
  fs.writeFileSync(settingsOf(h), '{ not json');
  const r = run(h, manifest);
  assert.ok(fs.existsSync(path.join(h, '.claude', 'skills', 'a', 'SKILL.md')));
  assert.equal(fs.readFileSync(settingsOf(h), 'utf8'), '{ not json');
  assert.equal(r.covered.size, 0);
  assert.ok(r.lines.some((l) => /registration failed.*kept/.test(l)));

  const bad = run(h, manifest, { registrars: { claudecode: () => ({ ok: false, error: 'boom' }) } });
  assert.ok(fs.existsSync(path.join(h, '.claude', 'skills', 'a', 'SKILL.md')));
  assert.equal(bad.covered.size, 0);
});

test('Codex and agy copies stay even when a registrar says ok', () => {
  const h = home();
  const codexRoot = path.join(h, '.codex', 'skills');
  const agyRoot = path.join(h, '.gemini', 'config', 'skills');
  const manifest = { ...seedLoose(h, { 'c/SKILL.md': 'C' }, codexRoot), ...seedLoose(h, { 'g/SKILL.md': 'G' }, agyRoot) };
  const ok = () => ({ ok: true });
  const r = run(h, manifest, { registrars: { codex: ok, antigravity: ok } });
  assert.equal(r.covered.size, 0);
  assert.ok(fs.existsSync(path.join(codexRoot, 'c', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(agyRoot, 'g', 'SKILL.md')));
});

test('harness not detected is left alone', () => {
  const h = home();
  const manifest = seedLoose(h, { 'a/SKILL.md': 'A' });
  pm.migrate({ home: h, manifest, detected: ['opencode'] });
  assert.ok(fs.existsSync(path.join(h, '.claude', 'skills', 'a', 'SKILL.md')));
  assert.ok(!fs.existsSync(settingsOf(h)));
});

function viaInstaller(h, env, argv = []) {
  const code = `const i = require(${JSON.stringify(path.join(ROOT, 'installer.js'))});` +
    `const r = i.runPluginMigration({ detected: ['claudecode'] }); console.log(JSON.stringify([...r.covered]));`;
  return spawnSync(process.execPath, ['-e', code, '--', ...argv], { encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH, HOME: h, ...env } });
}

test('installer: default on, AOS_PLUGIN_MIGRATION=off and check leave everything alone', () => {
  const h = home();
  const manifest = seedLoose(h, { 'a/SKILL.md': 'A' });
  fs.mkdirSync(path.join(h, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(h, '.agents', '.bdb-install-manifest.json'), JSON.stringify(manifest));
  const skill = path.join(h, '.claude', 'skills', 'a', 'SKILL.md');

  for (const env of [{ AOS_PLUGIN_MIGRATION: 'off' }, { AOS_PLUGIN_MIGRATION: 'check' }]) {
    const res = viaInstaller(h, env);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(fs.existsSync(skill));
    assert.ok(!fs.existsSync(settingsOf(h)));
  }
  assert.equal(viaInstaller(h, {}, ['--plugin-migration=off']).status, 0);
  assert.ok(fs.existsSync(skill));

  const on = viaInstaller(h, {});
  assert.equal(on.status, 0, on.stderr);
  assert.ok(!fs.existsSync(skill));
  assert.equal(readSettings(h).enabledPlugins['bdb-aos@bdb-marketplace'], true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(h, '.agents', '.bdb-install-manifest.json'), 'utf8')), {});
});

test('uninstall: deregisters what was registered, restores the external marketplace and the backup', () => {
  const h = home();
  fs.mkdirSync(path.join(h, '.claude'));
  const ext = { source: { source: 'github', repo: 'hybridlabor-api/bdb-marketplace' } };
  fs.writeFileSync(settingsOf(h), JSON.stringify({ theme: 'dark', extraKnownMarketplaces: { bdb: ext } }));
  const manifest = seedLoose(h, { 'a/SKILL.md': 'A' });
  run(h, manifest);
  const skill = path.join(h, '.claude', 'skills', 'a', 'SKILL.md');
  assert.ok(!fs.existsSync(skill));

  const res = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'aos-uninstall.mjs'), '--restore-plugin-backup'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: h } });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(fs.readFileSync(skill, 'utf8'), 'A');
  fs.writeFileSync(skill, 'changed');
  spawnSync(process.execPath, [path.join(ROOT, 'bin', 'aos-uninstall.mjs'), '--restore-plugin-backup'], { env: { PATH: process.env.PATH, HOME: h } });
  assert.equal(fs.readFileSync(skill, 'utf8'), 'changed', 'restore never overwrites');

  const d = pm.deregisterClaude({ home: h, record: pm.readState(h).registered.claudecode });
  assert.ok(d.changed);
  assert.deepEqual(readSettings(h), { theme: 'dark', extraKnownMarketplaces: { bdb: ext } });
});
