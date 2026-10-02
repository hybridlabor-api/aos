// Real `claude plugin ...` steps after settings registration, always with a fake runner and a temp HOME.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pm = require('../lib/plugin-migration');

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
const home = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-cli-')); tmps.push(d); return d; };
const OWN = 'hybridlabor-api/aos';
const EXT = 'hybridlabor-api/bdb-marketplace';

function seedInstalled(h) {
  const installPath = path.join(h, '.claude', 'plugins', 'cache', 'bdb-marketplace', 'bdb-aos', '1.0.0');
  fs.mkdirSync(path.join(installPath, 'skills', 'a'), { recursive: true });
  fs.writeFileSync(path.join(installPath, 'skills', 'a', 'SKILL.md'), 'a');
  fs.writeFileSync(path.join(h, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2, plugins: { 'bdb-aos@bdb-marketplace': [{ scope: 'user', installPath, version: '1.0.0' }] },
  }));
}
function seedLoose(h) {
  const f = path.join(h, '.claude', 'skills', 'a', 'SKILL.md');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, 'A');
  return { manifest: { [f]: { path: f, sha256: sha('A') } }, file: f };
}

// Fake claude: keeps marketplace/plugin state; a successful install seeds installed_plugins.json.
// Shapes captured from `claude plugin marketplace list` / `claude plugin list` (read-only) on a real machine.
const MK_FIXTURE = (m) => `Configured marketplaces:\n\n  ❯ token-saver-marketplace\n    Source: GitHub (ppgranger/token-saver@production)\n\n${Object.entries(m).map(([n, r]) => `  ❯ ${n}\n    Source: GitHub (${r})\n\n`).join('')}From claude.ai:\n\n  ❯ (no CLI name) · listed as "Anthropic Directory" (browse on claude.ai)\n`;
const PL_FIXTURE = (p, disabled) => `Installed plugins:\n\n${Object.entries(p).map(([n, v]) => `  ❯ ${n}\n    Version: ${v}\n    Scope: user\n    Status: ${disabled ? '✘ disabled' : '✔ enabled'}\n\n`).join('')}`;
function fake(h, { marketplaces = {}, plugins = {}, fail = {}, missing = false, timedOut = false, disabled = false, installOut = null } = {}) {
  const calls = [];
  const runner = (args) => {
    const key = args.join(' ');
    calls.push(key);
    if (missing) return { ok: false, missing: true };
    if (timedOut) return { ok: false, timedOut: true };
    if (fail[key]) return { ok: false, stderr: 'boom' };
    if (key === 'plugin marketplace list') return { ok: true, stdout: MK_FIXTURE(marketplaces) };
    if (key === 'plugin list') return { ok: true, stdout: PL_FIXTURE(plugins, disabled) };
    if (args[1] === 'enable') { disabled = false; return { ok: true }; }
    if (args[2] === 'add') { marketplaces['bdb-marketplace'] = args[3]; return { ok: true }; }
    if (args[2] === 'remove') { delete marketplaces[args[3]]; return { ok: true }; }
    if (args[1] === 'install' && installOut) return installOut;
    if (args[1] === 'install') { plugins[args[2]] = '1.0.0'; seedInstalled(h); return { ok: true }; }
    if (args[1] === 'update') { plugins[args[2]] = '9.9.9'; return { ok: true }; }
    return { ok: false };
  };
  return { runner, calls };
}
// Honest update log: the CLI exits 0 even when nothing newer exists.
function staleUpdateRunner(h, { bumpTo }) {
  const f = fake(h, { marketplaces: { 'bdb-marketplace': OWN }, plugins: { 'bdb-aos@bdb-marketplace': '1.0.0' } });
  const inner = f.runner;
  const state = { v: '1.0.0' };
  const runner = (args, opts) => {
    f.calls.push(`opts:${JSON.stringify(opts || null)}`);
    if (args[1] === 'update') { state.v = bumpTo; return { ok: true }; }
    if (args.join(' ') === 'plugin list') return { ok: true, stdout: PL_FIXTURE({ 'bdb-aos@bdb-marketplace': state.v }) };
    return inner(args, opts);
  };
  return { runner, calls: f.calls };
}
const migrate = (h, manifest, extra) => pm.migrate({ home: h, manifest, detected: ['claudecode'], version: '9.9.9', ...extra });
const mutating = (calls) => calls.filter((c) => /marketplace (add|remove)|plugin (install|update)/.test(c));

test('add + install succeed, loose copies retired in the SAME run, second run is a no-op', () => {
  const h = home();
  const { manifest, file } = seedLoose(h);
  const f = fake(h);
  const r = migrate(h, manifest, { cli: f.runner });
  assert.deepEqual(mutating(f.calls), [`plugin marketplace add ${OWN}`, 'plugin install bdb-aos@bdb-marketplace']);
  assert.ok(r.covered.has('claudecode'));
  assert.ok(!fs.existsSync(file));
  const f2 = fake(h, { marketplaces: { 'bdb-marketplace': OWN }, plugins: { 'bdb-aos@bdb-marketplace': '9.9.9' } });
  migrate(h, {}, { cli: f2.runner });
  assert.deepEqual(mutating(f2.calls), []);
});

test('claude missing: one manual line, copies kept, nothing thrown', () => {
  const h = home();
  const { manifest, file } = seedLoose(h);
  const r = migrate(h, manifest, { cli: fake(h, { missing: true }).runner });
  assert.equal(r.covered.size, 0);
  assert.ok(fs.existsSync(file));
  const l = r.lines.filter((x) => /not on PATH/.test(x));
  assert.equal(l.length, 1);
  assert.match(l[0], /claude plugin marketplace add hybridlabor-api\/aos ; claude plugin install bdb-aos@bdb-marketplace/);
});

test('CLI failure and timeout keep the copies with the manual commands', () => {
  for (const opts of [{ fail: { 'plugin install bdb-aos@bdb-marketplace': 1 } }, { timedOut: true }]) {
    const h = home();
    const { manifest, file } = seedLoose(h);
    const r = migrate(h, manifest, { cli: fake(h, opts).runner });
    assert.equal(r.covered.size, 0);
    assert.ok(fs.existsSync(file));
    assert.ok(r.lines.some((x) => /failed|timed out/.test(x) && /Run these two commands/.test(x)));
  }
});

test('foreign marketplace under the same name is protected unless this migration replaced the external one', () => {
  const h = home();
  const f = fake(h, { marketplaces: { 'bdb-marketplace': 'someone/else' } });
  const r = migrate(h, {}, { cli: f.runner });
  assert.deepEqual(mutating(f.calls), []);
  assert.ok(r.lines.some((x) => /another source/.test(x)));
});

test('external marketplace replaced in settings: removed, own added, plugin installed', () => {
  const h = home();
  fs.mkdirSync(path.join(h, '.claude'));
  fs.writeFileSync(path.join(h, '.claude', 'settings.json'), JSON.stringify({
    extraKnownMarketplaces: { 'bdb-marketplace': { source: { source: 'github', repo: EXT } } },
    enabledPlugins: { 'bdb-aos@bdb-marketplace': true },
  }));
  const f = fake(h, { marketplaces: { 'bdb-marketplace': EXT } });
  const r = migrate(h, {}, { cli: f.runner });
  assert.deepEqual(mutating(f.calls), ['plugin marketplace remove bdb-marketplace', `plugin marketplace add ${OWN}`, 'plugin install bdb-aos@bdb-marketplace']);
  assert.ok(r.covered.has('claudecode'));
});

test('external marketplace that other plugins use is never removed', () => {
  const h = home();
  fs.mkdirSync(path.join(h, '.claude'));
  fs.writeFileSync(path.join(h, '.claude', 'settings.json'), JSON.stringify({
    extraKnownMarketplaces: { 'bdb-marketplace': { source: { source: 'github', repo: EXT } } },
  }));
  const f = fake(h, { marketplaces: { 'bdb-marketplace': EXT }, plugins: { 'other@bdb-marketplace': '1.0.0' } });
  migrate(h, {}, { cli: f.runner });
  assert.deepEqual(mutating(f.calls), []);
});

test('check mode and AOS_PLUGIN_MIGRATION=off never call the CLI', () => {
  for (const mode of ['check', 'off']) {
    const h = home();
    const { manifest, file } = seedLoose(h);
    const f = fake(h);
    migrate(h, manifest, { cli: f.runner, mode });
    assert.deepEqual(f.calls, []);
    assert.ok(fs.existsSync(file));
  }
});

test('installed with a different version: update, not install', () => {
  const h = home();
  seedInstalled(h);
  const f = fake(h, { marketplaces: { 'bdb-marketplace': OWN }, plugins: { 'bdb-aos@bdb-marketplace': '1.0.0' } });
  migrate(h, {}, { cli: f.runner });
  assert.deepEqual(mutating(f.calls), ['plugin update bdb-aos@bdb-marketplace']);
});

test('installed but disabled: enable, no install', () => {
  const h = home();
  seedInstalled(h);
  const f = fake(h, { marketplaces: { 'bdb-marketplace': OWN }, plugins: { 'bdb-aos@bdb-marketplace': '9.9.9' }, disabled: true });
  migrate(h, {}, { cli: f.runner });
  assert.deepEqual(mutating(f.calls), []);
  assert.ok(f.calls.includes('plugin enable bdb-aos@bdb-marketplace'));
});

test('install reporting "already installed" with a non-zero exit is not a failure', () => {
  const h = home();
  seedInstalled(h);
  const f = fake(h, { marketplaces: { 'bdb-marketplace': OWN }, installOut: { ok: false, stderr: 'Plugin bdb-aos@bdb-marketplace is already installed' } });
  const r = migrate(h, {}, { cli: f.runner });
  assert.ok(r.covered.has('claudecode'));
  assert.ok(!r.lines.some((x) => /Run these two commands/.test(x)));
});

test('parseEntries ignores the claude.ai section', () => {
  const e = pm.parseEntries(MK_FIXTURE({ 'bdb-marketplace': OWN }));
  assert.deepEqual(e.map((x) => x.name), ['token-saver-marketplace', 'bdb-marketplace']);
});

test('update that changes nothing is logged as such, a real bump as updated (a -> b)', () => {
  const h1 = home();
  const same = staleUpdateRunner(h1, { bumpTo: '1.0.0' });
  const r1 = migrate(h1, {}, { cli: same.runner });
  assert.ok(r1.lines.some((l) => /stays at 1\.0\.0/.test(l)));
  assert.ok(!r1.lines.some((l) => /updated \(/.test(l)));
  const h2 = home();
  const bump = staleUpdateRunner(h2, { bumpTo: '9.9.9' });
  const r2 = migrate(h2, {}, { cli: bump.runner });
  assert.ok(r2.lines.some((l) => /updated \(1\.0\.0 -> 9\.9\.9\)/.test(l)));
});

test('marketplace add gets the 300 s clone timeout and an announcement before it starts', () => {
  const h = home();
  const f = fake(h);
  const seen = [];
  const cli = (args, opts) => { seen.push([args.join(' '), opts && opts.timeout]); return f.runner(args, opts); };
  const said = [];
  migrate(h, seedLoose(h).manifest, { cli, announce: (m) => said.push(m) });
  assert.equal(seen.find(([k]) => k.startsWith('plugin marketplace add'))[1], 300000);
  assert.equal(seen.find(([k]) => k === 'plugin list')[1], undefined);
  assert.match(said.join('\n'), /clones the repository, this can take a few minutes/);
});

test('CLAUDE_CONFIG_DIR is honoured for settings and plugin detection', () => {
  const h = home(); const cfg = home();
  process.env.CLAUDE_CONFIG_DIR = cfg;
  try {
    assert.equal(pm.claudeDir(h), cfg);
    assert.equal(pm.registerClaude({ home: h }).ok, true);
    assert.ok(fs.existsSync(path.join(cfg, 'settings.json')));
    assert.ok(!fs.existsSync(path.join(h, '.claude', 'settings.json')));
    assert.equal(pm.pluginInstalled(h), false);
    const installPath = path.join(cfg, 'plugins', 'cache', 'bdb-marketplace', 'bdb-aos', '1.0.0');
    fs.mkdirSync(path.join(installPath, 'skills', 'a'), { recursive: true });
    fs.writeFileSync(path.join(installPath, 'skills', 'a', 'SKILL.md'), 'a');
    assert.equal(pm.pluginInstalled(h), true);
  } finally { delete process.env.CLAUDE_CONFIG_DIR; }
});
