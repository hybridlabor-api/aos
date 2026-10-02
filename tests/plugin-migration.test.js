// C4: bdb-aos plugin registration, loose-copy migration and uninstall, always in a temp HOME.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pm = require('../lib/plugin-migration');

const ROOT = path.join(__dirname, '..');
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
const home = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-c4-')); tmps.push(d); return d; };
function seedInstalled(h, skills = ['a', 'b', 'x', 'startcycle']) {
  const installPath = path.join(h, '.claude', 'plugins', 'cache', 'bdb-marketplace', 'bdb-aos', '1.0.0');
  for (const s of skills) {
    fs.mkdirSync(path.join(installPath, 'skills', s), { recursive: true });
    fs.writeFileSync(path.join(installPath, 'skills', s, 'SKILL.md'), s);
  }
  fs.writeFileSync(path.join(h, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2, plugins: { 'bdb-aos@bdb-marketplace': [{ scope: 'user', installPath, version: '1.0.0' }] },
  }));
}
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
const run = (h, manifest, { installed = true, ...extra } = {}) => {
  if (installed) seedInstalled(h);
  return pm.migrate({ home: h, manifest, detected: ['claudecode', 'codex', 'antigravity'], ...extra });
};

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

test('migration removes own loose copies after a backup and keeps unknown files and other stores', () => {
  const h = home();
  const manifest = seedLoose(h, { 'a/SKILL.md': 'A', 'b/SKILL.md': 'B', 'b/extra.md': 'X' });
  const unknown = path.join(h, '.claude', 'skills', 'mine', 'SKILL.md');
  fs.mkdirSync(path.dirname(unknown), { recursive: true });
  fs.writeFileSync(unknown, 'mine');
  Object.assign(manifest, seedLoose(h, { 'a/SKILL.md': 'A' }, path.join(h, '.agents', 'skills')), seedLoose(h, { 'a/SKILL.md': 'A' }, path.join(h, '.config', 'opencode', 'skills')));
  const r = run(h, manifest);
  const skills = path.join(h, '.claude', 'skills');
  assert.ok(!fs.existsSync(path.join(skills, 'a')));
  assert.ok(!fs.existsSync(path.join(skills, 'b')));
  assert.equal(fs.readFileSync(unknown, 'utf8'), 'mine');
  assert.ok(fs.existsSync(path.join(h, '.agents', 'skills', 'a', 'SKILL.md')), 'shared store stays');
  assert.ok(fs.existsSync(path.join(h, '.config', 'opencode', 'skills', 'a', 'SKILL.md')), 'OpenCode copies stay');
  const [backup] = pm.readState(h).backups;
  assert.equal(fs.readFileSync(path.join(backup, '.claude', 'skills', 'a', 'SKILL.md'), 'utf8'), 'A');
  assert.ok(!(path.join(skills, 'a', 'SKILL.md') in manifest));
  assert.ok(r.covered.has('claudecode'));
});

test('M-B: an edited copy keeps every copy, lists the skill, and Claude is not covered', () => {
  const h = home();
  const manifest = seedLoose(h, { 'a/SKILL.md': 'A', 'b/SKILL.md': 'B' });
  const edited = path.join(h, '.claude', 'skills', 'b', 'SKILL.md');
  fs.writeFileSync(edited, 'B edited by user');
  const r = run(h, manifest);
  assert.equal(r.covered.size, 0);
  assert.ok(fs.existsSync(path.join(h, '.claude', 'skills', 'a', 'SKILL.md')), 'nothing removed, so the installer keeps updating it');
  assert.equal(fs.readFileSync(edited, 'utf8'), 'B edited by user');
  assert.ok(r.lines.some((l) => /1 skill\(s\) have edited or unsafe loose copies \(b\)/.test(l)));
  assert.equal(pm.readState(h).backups.length, 0);
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

  seedInstalled(h);
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

  assert.deepEqual(readSettings(h), { theme: 'dark', extraKnownMarketplaces: { bdb: ext }, enabledPlugins: { 'bdb-aos@bdb-marketplace': false } }, 'restore deregisters and persists the opt-out');
  assert.deepEqual(pm.readState(h).registered, {});
  assert.ok(skill in JSON.parse(fs.readFileSync(path.join(h, '.agents', '.bdb-install-manifest.json'), 'utf8')), 'restored file is tracked again');
});

test('restore still finds the backups after uninstall retired the state or removed the state file', () => {
  const h = home();
  const manifest = seedLoose(h, { 'a/SKILL.md': 'A' });
  run(h, manifest);
  const skill = path.join(h, '.claude', 'skills', 'a', 'SKILL.md');
  pm.retireState(h);
  assert.deepEqual(pm.readState(h).registered, {});
  assert.equal(pm.readState(h).backups.length, 1, 'backup index survives');
  fs.rmSync(pm.statePath(h));
  assert.equal(pm.listBackups(h).length, 1, 'found by scanning ~/.agents/backups');
  const res = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'aos-uninstall.mjs'), '--restore-plugin-backup'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: h } });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(fs.readFileSync(skill, 'utf8'), 'A');
});

test('M-C: a restore sticks, the next migration neither registers nor retires the restored files', () => {
  const h = home();
  const manifest = seedLoose(h, { 'a/SKILL.md': 'A' });
  run(h, manifest);
  const r = pm.restorePluginBackups({ home: h });
  assert.equal(r.files.length, 1);
  assert.ok(r.deregistered && r.optedOut);
  const tracked = JSON.parse(fs.readFileSync(path.join(h, '.agents', '.bdb-install-manifest.json'), 'utf8'));
  const again = run(h, tracked);
  assert.ok(fs.existsSync(path.join(h, '.claude', 'skills', 'a', 'SKILL.md')));
  assert.equal(again.covered.size, 0);
  assert.equal(readSettings(h).enabledPlugins['bdb-aos@bdb-marketplace'], false);
  const s = readSettings(h);
  s.enabledPlugins['bdb-aos@bdb-marketplace'] = true;
  fs.writeFileSync(settingsOf(h), JSON.stringify(s));
  run(h, tracked);
  assert.ok(!fs.existsSync(path.join(h, '.claude', 'skills', 'a', 'SKILL.md')), 'tracked, so retired again once the human re-enables the plugin');
});

test('uninstall keeps the backup index but drops the registration record', () => {
  const h = home();
  run(h, seedLoose(h, { 'a/SKILL.md': 'A' }));
  pm.retireState(h);
  assert.equal(pm.readState(h).registered.claudecode, undefined);
  const h2 = home();
  run(h2, {});
  pm.retireState(h2);
  assert.ok(!fs.existsSync(pm.statePath(h2)), 'no backups, no state file left');
});

test('H-1: registered but not verifiably installed keeps the copies and says how to finish', () => {
  const h = home();
  const manifest = seedLoose(h, { 'a/SKILL.md': 'A' });
  const r = run(h, manifest, { installed: false });
  const skill = path.join(h, '.claude', 'skills', 'a', 'SKILL.md');
  assert.ok(fs.existsSync(skill));
  assert.equal(r.covered.size, 0);
  assert.equal(readSettings(h).enabledPlugins['bdb-aos@bdb-marketplace'], true, 'still registered');
  assert.ok(r.lines.some((l) => /restart Claude Code, then run the installer again to retire the loose copies/.test(l)));
  assert.equal(pm.readState(h).backups.length, 0);
  seedInstalled(h);
  const later = run(h, manifest, { installed: false });
  assert.ok(!fs.existsSync(skill), 'removed once the evidence exists');
  assert.ok(later.covered.has('claudecode'));
});

test('M-A: weak evidence is rejected, a real skill under the plugin cache counts', () => {
  const h = home();
  const plugins = path.join(h, '.claude', 'plugins');
  fs.mkdirSync(plugins, { recursive: true });
  const entry = (installPath) => fs.writeFileSync(path.join(plugins, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'bdb-aos@bdb-marketplace': [{ installPath }] } }));
  entry(path.join(h, 'gone'));
  assert.equal(pm.pluginInstalled(h, ['a']), false);
  entry('/');
  assert.equal(pm.pluginInstalled(h, ['a']), false, 'installPath / is outside ~/.claude/plugins');
  const outside = path.join(h, 'elsewhere');
  fs.mkdirSync(path.join(outside, 'skills', 'a'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'skills', 'a', 'SKILL.md'), 'a');
  entry(outside);
  assert.equal(pm.pluginInstalled(h, ['a']), false, 'outside ~/.claude/plugins');
  const base = path.join(plugins, 'cache', 'bdb-marketplace', 'bdb-aos', '2.0.0');
  fs.mkdirSync(path.join(base, 'skills'), { recursive: true });
  entry(base);
  assert.equal(pm.pluginInstalled(h, ['a']), false, 'empty skills dir');
  fs.mkdirSync(path.join(base, 'skills', 'other'));
  fs.writeFileSync(path.join(base, 'skills', 'other', 'SKILL.md'), 'o');
  assert.equal(pm.pluginInstalled(h, ['a']), false, 'no manifest-listed skill inside');
  fs.mkdirSync(path.join(base, 'skills', 'a'));
  fs.writeFileSync(path.join(base, 'skills', 'a', 'SKILL.md'), 'a');
  assert.equal(pm.pluginInstalled(h, ['a']), true);
  fs.rmSync(path.join(plugins, 'installed_plugins.json'));
  assert.equal(pm.pluginInstalled(h, ['a']), true, 'cache fallback with the same strictness');
});

test('M-A: an install cached from an older external marketplace is no evidence', () => {
  const h = home();
  const old = path.join(h, '.claude', 'plugins', 'cache', 'ext', 'bdb-aos', '1.0.0');
  fs.mkdirSync(path.join(old, 'skills', 'a'), { recursive: true });
  fs.writeFileSync(path.join(old, 'skills', 'a', 'SKILL.md'), 'a');
  fs.writeFileSync(path.join(h, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'bdb-aos@bdb-marketplace': [{ installPath: old }] } }));
  assert.equal(pm.pluginInstalled(h, ['a']), false);
});

test('H-2: a symlinked ~/.claude/skills is refused and nothing behind it is touched', () => {
  const h = home();
  fs.mkdirSync(path.join(h, '.claude'), { recursive: true });
  const repo = path.join(h, 'dev', 'aos', 'skills');
  fs.mkdirSync(path.join(repo, 'x'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'x', 'SKILL.md'), 'src');
  fs.symlinkSync(repo, path.join(h, '.claude', 'skills'));
  const f = path.join(h, '.claude', 'skills', 'x', 'SKILL.md');
  const r = run(h, { [f]: { sha256: sha('src') } });
  assert.equal(fs.readFileSync(path.join(repo, 'x', 'SKILL.md'), 'utf8'), 'src');
  assert.equal(r.covered.size, 0);
  assert.ok(r.lines.some((l) => /is a symlink; loose copies kept/.test(l)));
  assert.equal(pm.readState(h).backups.length, 0);
});

test('H-2: a manifest key escaping the root with .. is rejected, a symlinked file or dir inside is skipped', () => {
  const h = home();
  const skills = path.join(h, '.claude', 'skills');
  fs.mkdirSync(skills, { recursive: true });
  const victim = path.join(h, 'victim.txt');
  fs.writeFileSync(victim, 'v');
  const outside = path.join(h, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'o.txt'), 'o');
  fs.symlinkSync(victim, path.join(skills, 'link.md'));
  fs.symlinkSync(outside, path.join(skills, 'dirlink'));
  const manifest = {
    [skills + path.sep + '..' + path.sep + '..' + path.sep + 'victim.txt']: { sha256: sha('v') },
    [path.join(skills, 'link.md')]: { sha256: sha('v') },
    [path.join(skills, 'dirlink', 'o.txt')]: { sha256: sha('o') },
    'relative/SKILL.md': { sha256: sha('x') },
  };
  run(h, manifest);
  assert.ok(fs.existsSync(victim));
  assert.ok(fs.existsSync(path.join(outside, 'o.txt')));
  assert.ok(fs.lstatSync(path.join(skills, 'link.md')).isSymbolicLink());
});

test('H-3: other plugins keep their ids; a foreign marketplace listing them stays; deregister reverses exactly', () => {
  const h = home();
  fs.mkdirSync(path.join(h, '.claude'));
  const ext = { source: { source: 'github', repo: 'hybridlabor-api/bdb-marketplace' } };
  const original = { extraKnownMarketplaces: { ext }, enabledPlugins: { 'other@ext': true, 'bdb-aos@ext': true, 'z@elsewhere': false } };
  fs.writeFileSync(settingsOf(h), JSON.stringify(original));
  const r = run(h, {});
  const s = readSettings(h);
  assert.deepEqual(s.extraKnownMarketplaces.ext, ext, 'foreign marketplace stays');
  assert.equal(s.enabledPlugins['other@ext'], true, 'other plugin id untouched');
  assert.ok(!('bdb-aos@ext' in s.enabledPlugins));
  assert.equal(s.enabledPlugins['bdb-aos@bdb-marketplace'], true);
  assert.ok(r.lines.some((l) => /also lists other plugins and stays in place/.test(l)));
  const rec = pm.readState(h).registered.claudecode;
  assert.deepEqual(rec.renames.map((x) => x.from), ['bdb-aos@ext']);
  pm.deregisterClaude({ home: h, record: rec });
  assert.deepEqual(readSettings(h), original);
});

test('H-3: a rename only touches bdb-aos@<oldkey> when the external marketplace is replaced', () => {
  const h = home();
  fs.mkdirSync(path.join(h, '.claude'));
  const ext = { source: { source: 'github', repo: 'hybridlabor-api/bdb-marketplace' } };
  const original = { extraKnownMarketplaces: { ext }, enabledPlugins: { 'bdb-aos@ext': true } };
  fs.writeFileSync(settingsOf(h), JSON.stringify(original));
  run(h, {});
  const rec = pm.readState(h).registered.claudecode;
  assert.deepEqual(rec.replaced, { key: 'ext', entry: ext });
  pm.deregisterClaude({ home: h, record: rec });
  assert.deepEqual(readSettings(h), original);
});

test('H-3: bdb-marketplace already is the external one and others use it: refuse, change nothing', () => {
  const h = home();
  fs.mkdirSync(path.join(h, '.claude'));
  const body = JSON.stringify({ extraKnownMarketplaces: { 'bdb-marketplace': { source: { source: 'github', repo: 'hybridlabor-api/bdb-marketplace' } } }, enabledPlugins: { 'other@bdb-marketplace': true } });
  fs.writeFileSync(settingsOf(h), body);
  const manifest = seedLoose(h, { 'a/SKILL.md': 'A' });
  const r = run(h, manifest);
  assert.equal(fs.readFileSync(settingsOf(h), 'utf8'), body);
  assert.ok(r.lines.some((l) => /registration failed.*not replacing it/.test(l)));
  assert.ok(fs.existsSync(path.join(h, '.claude', 'skills', 'a', 'SKILL.md')));
});

test('M-1: a symlinked settings.json is written through, the link stays', () => {
  const h = home();
  fs.mkdirSync(path.join(h, '.claude'));
  const real = path.join(h, 'dotfiles-settings.json');
  fs.writeFileSync(real, '{"a":1}');
  fs.symlinkSync(real, settingsOf(h));
  const r = run(h, {});
  assert.ok(r.covered.has('claudecode'));
  assert.ok(fs.lstatSync(settingsOf(h)).isSymbolicLink());
  const s = JSON.parse(fs.readFileSync(real, 'utf8'));
  assert.equal(s.a, 1);
  assert.equal(s.enabledPlugins['bdb-aos@bdb-marketplace'], true);
  pm.deregisterClaude({ home: h, record: pm.readState(h).registered.claudecode });
  assert.ok(fs.lstatSync(settingsOf(h)).isSymbolicLink());
  assert.deepEqual(JSON.parse(fs.readFileSync(real, 'utf8')), { a: 1 });
});

test('M-2: an explicit false for the plugin is an opt-out: nothing registered, nothing removed', () => {
  const h = home();
  fs.mkdirSync(path.join(h, '.claude'));
  const body = JSON.stringify({ enabledPlugins: { 'bdb-aos@bdb-marketplace': false } });
  fs.writeFileSync(settingsOf(h), body);
  const manifest = seedLoose(h, { 'a/SKILL.md': 'A' });
  const r = run(h, manifest);
  assert.equal(fs.readFileSync(settingsOf(h), 'utf8'), body);
  assert.ok(fs.existsSync(path.join(h, '.claude', 'skills', 'a', 'SKILL.md')));
  assert.equal(r.covered.size, 0);
  assert.ok(r.lines.some((l) => /opt-out/.test(l)));
  assert.ok(!fs.existsSync(pm.statePath(h)));
});

const viaTargets = (h, env = {}) => {
  const skills = path.join(h, 'src-skills');
  fs.mkdirSync(path.join(skills, 'x'), { recursive: true });
  fs.writeFileSync(path.join(skills, 'x', 'SKILL.md'), 'A');
  const code = `const i = require(${JSON.stringify(path.join(ROOT, 'installer.js'))});` +
    `const c = ${JSON.stringify(path.join(h, '.claude'))};` +
    `i.installTargetSkills([{ value: '2', targetSkillDir: c + '/skills', targetLegacyDir: c + '/skills/legacy', targetWorkspaceDir: ${JSON.stringify(path.join(h, '.agents', 'workspace_skills'))} }],` +
    ` { mode: 'merge', backupDir: ${JSON.stringify(path.join(h, 'bk'))}, excludeSkills: [], skillsBase: ${JSON.stringify(skills)} });`;
  const res = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH, HOME: h, ...env } });
  assert.equal(res.status, 0, res.stderr);
};
const tree = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).sort().join('|') : '');

test('C-1: with the plugin installed the loose copies are retired before the target loop and a rerun changes nothing', () => {
  const h = home();
  const skill = path.join(h, '.claude', 'skills', 'x', 'SKILL.md');
  const manifest = seedLoose(h, { 'x/SKILL.md': 'A' });
  fs.mkdirSync(path.join(h, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(h, '.agents', '.bdb-install-manifest.json'), JSON.stringify(manifest));
  seedInstalled(h);
  viaTargets(h);
  assert.ok(!fs.existsSync(skill), 'retired and not written again');
  assert.equal(tree(path.join(h, '.claude', 'skills')), '');
  const snap = () => [fs.readFileSync(settingsOf(h), 'utf8'), tree(path.join(h, '.agents', 'backups')), fs.readFileSync(pm.statePath(h), 'utf8')];
  const first = snap();
  viaTargets(h);
  assert.deepEqual(snap(), first, 'byte-identical, no new backup dir');
  assert.equal(tree(path.join(h, '.claude', 'skills')), '');
});

test('C-1: without evidence the skills are written and reruns never create backups', () => {
  const h = home();
  fs.mkdirSync(path.join(h, '.claude'), { recursive: true });
  viaTargets(h);
  assert.equal(fs.readFileSync(path.join(h, '.claude', 'skills', 'x', 'SKILL.md'), 'utf8'), 'A');
  viaTargets(h);
  assert.ok(!fs.existsSync(path.join(h, '.agents', 'backups')));
});

test('M-3: the project harness copy leaves .agents/plugins (the Codex marketplace file) out', () => {
  const h = home();
  const proj = path.join(h, 'proj');
  fs.mkdirSync(proj);
  assert.deepEqual(require('../installer.js').AGENTS_COPY_EXCLUDE, ['plugins']);
  const code = `require(${JSON.stringify(path.join(ROOT, 'installer.js'))}).installProjectHarness();`;
  const res = spawnSync(process.execPath, ['-e', code], { cwd: proj, encoding: 'utf8', timeout: 60000, env: { PATH: process.env.PATH, HOME: h } });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(path.join(proj, '.agents', 'graph.md')));
  assert.ok(!fs.existsSync(path.join(proj, '.agents', 'plugins')));
});

test('M-5: package.json ships plugins/bdb-aos-codex only, a real directory without symlinks', () => {
  const files = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).files;
  assert.ok(!files.includes('plugins/') && !files.some((f) => f.startsWith('plugins/bdb-aos/')));
  assert.ok(files.includes('plugins/bdb-aos-codex/'));
  const links = fs.readdirSync(path.join(ROOT, 'plugins', 'bdb-aos-codex'), { recursive: true, withFileTypes: true }).filter((e) => e.isSymbolicLink());
  assert.equal(links.length, 0);
});

test('M-D: enabledPlugins or extraKnownMarketplaces that is not a plain object refuses and writes nothing', () => {
  for (const [key, bad] of [['enabledPlugins', []], ['enabledPlugins', null], ['enabledPlugins', 'x'], ['extraKnownMarketplaces', []], ['extraKnownMarketplaces', 'x']]) {
    const h = home();
    fs.mkdirSync(path.join(h, '.claude'));
    const body = JSON.stringify({ [key]: bad });
    fs.writeFileSync(settingsOf(h), body);
    const manifest = seedLoose(h, { 'a/SKILL.md': 'A' });
    const r = run(h, manifest);
    assert.equal(fs.readFileSync(settingsOf(h), 'utf8'), body, `${key}=${JSON.stringify(bad)}`);
    assert.equal(baks(h).length, 0);
    assert.ok(r.lines.some((l) => /not a plain JSON object; nothing changed/.test(l)));
    assert.ok(fs.existsSync(path.join(h, '.claude', 'skills', 'a', 'SKILL.md')));
  }
});

test('H-A: the scripts of openwiki-skill stay and the daemon installs from a stable store', () => {
  const h = home();
  const manifest = seedLoose(h, { 'a/SKILL.md': 'A', 'openwiki-skill/SKILL.md': 'S', 'openwiki-skill/scripts/openwiki_daemon.py': 'py', 'openwiki-skill/scripts/install_daemon.sh': 'sh' });
  run(h, manifest);
  const scripts = path.join(h, '.claude', 'skills', 'openwiki-skill', 'scripts');
  assert.ok(fs.existsSync(path.join(scripts, 'openwiki_daemon.py')), 'daemon scripts never retired');
  assert.ok(!fs.existsSync(path.join(h, '.claude', 'skills', 'a')));
  const code = `const i = require(${JSON.stringify(path.join(ROOT, 'installer.js'))}); console.log(i.stableOpenWikiScripts());`;
  const res = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: h } });
  assert.equal(res.status, 0, res.stderr);
  const dir = res.stdout.trim().split('\n').pop();
  assert.equal(dir, path.join(h, '.agents', 'skills', 'openwiki-skill', 'scripts'));
  assert.ok(fs.existsSync(path.join(dir, 'install_daemon.sh')));
  assert.ok(fs.existsSync(path.join(dir, 'openwiki_daemon.py')));
});

test('L-A: a held lock keeps the migration out, a stale lock is taken over, a vanished file is skipped', () => {
  const h = home();
  const manifest = seedLoose(h, { 'a/SKILL.md': 'A', 'b/SKILL.md': 'B' });
  const release = pm.acquireLock(h);
  const blocked = run(h, manifest);
  assert.ok(blocked.lines.some((l) => /Another plugin migration is running/.test(l)));
  assert.ok(fs.existsSync(path.join(h, '.claude', 'skills', 'a', 'SKILL.md')));
  release();
  fs.writeFileSync(pm.lockPath(h), '999999999');
  fs.rmSync(path.join(h, '.claude', 'skills', 'b', 'SKILL.md'));
  const r = run(h, manifest);
  assert.ok(r.covered.has('claudecode'), 'stale lock replaced, missing file skipped without throwing');
  assert.ok(!fs.existsSync(pm.lockPath(h)), 'lock released');
});

test('L-C: aos-doctor accepts the plugin evidence as Claude having the skills', () => {
  const h = home();
  seedInstalled(h);
  const res = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'aos-doctor.mjs'), '--json'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: h } });
  const row = JSON.parse(res.stdout).results.find((x) => x.name === 'Claude Code Skills');
  assert.equal(row.ok, true, res.stdout.slice(0, 400));
  const bare = home();
  const res2 = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'aos-doctor.mjs'), '--json'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: bare } });
  assert.equal(JSON.parse(res2.stdout).results.find((x) => x.name === 'Claude Code Skills').ok, false);
});
