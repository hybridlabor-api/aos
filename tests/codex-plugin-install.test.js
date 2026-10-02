// Codex plugin install: fake runner for every branch, real codex CLI only with AOS_E2E_CLI=1 (temp HOME).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('../lib/codex-plugin-install');

const ROOT = path.join(__dirname, '..');
const V = require('../package.json').version;
const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
const home = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-cx-')); tmps.push(d); return d; };

// Minimal stateful stand-in for `codex plugin ...`.
function fakeCodex({ marketplace = null, installed = null, failOn = null } = {}) {
  const calls = [];
  const st = { marketplace, installed };
  const run = (cmd, args) => {
    calls.push(args.join(' '));
    const key = args.slice(1).join(' ');
    if (failOn && key.startsWith(failOn)) return { status: 1, stdout: '', stderr: 'WARNING: x\nboom' };
    if (args[1] === 'list') {
      const row = (extra) => ({ pluginId: 'bdb-aos@bdb-aos', name: 'bdb-aos', marketplaceName: 'bdb-aos', marketplaceSource: st.marketplace, ...extra });
      return { status: 0, stderr: 'WARNING: x', stdout: JSON.stringify({
        installed: st.installed ? [row({ version: st.installed, enabled: true })] : [],
        available: !st.installed && st.marketplace ? [row({ installed: false })] : [] }) };
    }
    if (args[1] === 'marketplace' && args[2] === 'add') st.marketplace = { sourceType: args[3].includes('/') && fs.existsSync(args[3]) ? 'local' : 'git', source: args[3] };
    if (args[1] === 'marketplace' && args[2] === 'remove') { st.marketplace = null; st.installed = null; }
    if (args[1] === 'add') st.installed = V;
    if (args[1] === 'remove') st.installed = null;
    return { status: 0, stdout: 'ok', stderr: '' };
  };
  return { run, calls, st };
}
const go = (fake, extra = {}) => cp.installCodexPlugin({ home: extra.home || home(), pkgRoot: ROOT, version: V, run: fake.run, hasCodex: () => true, ...extra });

test('mode off: nothing happens', () => {
  const f = fakeCodex();
  const r = go(f, { mode: 'off' });
  assert.deepEqual(f.calls, []);
  assert.deepEqual(r.lines, []);
});

test('codex missing: skip with the exact commands', () => {
  const f = fakeCodex();
  const r = go(f, { hasCodex: () => false });
  assert.deepEqual(f.calls, []);
  assert.ok(r.ok);
  assert.equal(r.lines.length, 1);
  assert.match(r.lines[0], /codex plugin marketplace add .* && codex plugin add bdb-aos@bdb-aos/);
});

test('a disabled plugin stays disabled: one line, no add', () => {
  const f = fakeCodex({ marketplace: { sourceType: 'local', source: ROOT }, installed: '0.0.1' });
  const run = (cmd, args) => {
    const r = f.run(cmd, args);
    if (args[1] === 'list') { const d = JSON.parse(r.stdout); d.installed.forEach((p) => { p.enabled = false; }); r.stdout = JSON.stringify(d); }
    return r;
  };
  const res = go({ run, calls: f.calls });
  assert.deepEqual(f.calls.filter((c) => !c.includes('list')), []);
  assert.equal(res.lines.length, 1);
  assert.match(res.lines[0], /disabled in Codex; leaving it disabled/);
});

test('an npx package root is never registered: GitHub source, vanishing local marketplace re-pointed', () => {
  const npx = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-npx-'));
  tmps.push(npx);
  const pkg = path.join(npx, '_npx', 'abc123', 'node_modules', '@x', 'aos');
  fs.mkdirSync(path.join(pkg, '.agents', 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(pkg, '.agents', 'plugins', 'marketplace.json'), '{}');
  const f = fakeCodex({ marketplace: { sourceType: 'local', source: path.join(npx, '_npx', 'old', 'gone') }, installed: '0.0.1' });
  const announced = [];
  cp.installCodexPlugin({ home: home(), pkgRoot: pkg, version: V, run: f.run, hasCodex: () => true, announce: (m) => announced.push(m) });
  const calls = f.calls.filter((c) => !c.includes('list'));
  assert.deepEqual(calls, ['plugin marketplace remove bdb-aos', 'plugin marketplace add hybridlabor-api/aos', 'plugin add bdb-aos@bdb-aos']);
  assert.ok(!calls.some((c) => c.includes('_npx')));
  assert.match(announced.join('\n'), /fetching hybridlabor-api\/aos from GitHub.*few minutes/);
  const miss = cp.installCodexPlugin({ home: home(), pkgRoot: pkg, version: V, run: f.run, hasCodex: () => false });
  assert.ok(!miss.lines.join('').includes('_npx'));
});

test('fresh machine: marketplace add, plugin add, state recorded', () => {
  const h = home(); const f = fakeCodex();
  const r = go(f, { home: h });
  assert.deepEqual(f.calls.filter((c) => !c.includes('list')), [`plugin marketplace add ${ROOT}`, 'plugin add bdb-aos@bdb-aos']);
  assert.ok(r.changed && r.ok);
  assert.deepEqual(JSON.parse(fs.readFileSync(cp.statePath(h), 'utf8')), { addedMarketplace: true, installedPlugin: true, version: V, source: ROOT });
});

test('already installed at the current version: list only', () => {
  const f = fakeCodex({ marketplace: { sourceType: 'local', source: ROOT }, installed: V });
  const r = go(f);
  assert.deepEqual(f.calls, ['plugin list --json']);
  assert.match(r.lines[0], /already installed/);
  assert.ok(!r.changed);
});

test('marketplace present, plugin missing: only plugin add', () => {
  const f = fakeCodex({ marketplace: { sourceType: 'local', source: ROOT } });
  go(f);
  assert.deepEqual(f.calls.filter((c) => !c.includes('list')), ['plugin add bdb-aos@bdb-aos']);
});

test('older installed version, git marketplace: upgrade then plugin add', () => {
  const f = fakeCodex({ marketplace: { sourceType: 'git', source: 'https://github.com/hybridlabor-api/aos.git' }, installed: '0.0.1' });
  const r = go(f);
  assert.deepEqual(f.calls.filter((c) => !c.includes('list')), ['plugin marketplace upgrade bdb-aos', 'plugin add bdb-aos@bdb-aos']);
  assert.ok(r.lines.some((l) => /0\.0\.1 -> /.test(l)));
});

test('git upgrade failure (offline) is soft', () => {
  const f = fakeCodex({ marketplace: { sourceType: 'git', source: 'g' }, installed: '0.0.1', failOn: 'marketplace upgrade' });
  const r = go(f);
  assert.ok(f.calls.includes('plugin add bdb-aos@bdb-aos'));
  assert.ok(r.lines.some((l) => /upgrade skipped/.test(l)));
});

test('stale local marketplace source is re-pointed to this package', () => {
  const f = fakeCodex({ marketplace: { sourceType: 'local', source: '/gone/elsewhere' }, installed: '0.0.1' });
  go(f);
  assert.deepEqual(f.calls.filter((c) => !c.includes('list')), ['plugin marketplace remove bdb-aos', `plugin marketplace add ${ROOT}`, 'plugin add bdb-aos@bdb-aos']);
});

test('without a local marketplace file the GitHub repo is the source', () => {
  const f = fakeCodex();
  cp.installCodexPlugin({ home: home(), pkgRoot: os.tmpdir(), version: V, run: f.run, hasCodex: () => true });
  assert.ok(f.calls.includes('plugin marketplace add hybridlabor-api/aos'));
});

test('a failing step reports the manual commands and does not throw', () => {
  const f = fakeCodex({ failOn: 'add bdb-aos' });
  const r = go(f);
  assert.equal(r.ok, false);
  assert.match(r.lines.join('\n'), /FAILED \(boom\)[\s\S]*run: codex plugin add bdb-aos@bdb-aos/);
});

test('check mode and dryRun never mutate or write state', () => {
  for (const extra of [{ mode: 'check' }, { dryRun: true }]) {
    const h = home(); const f = fakeCodex();
    const r = go(f, { home: h, ...extra });
    assert.deepEqual(f.calls, ['plugin list --json']);
    assert.match(r.lines.join('\n'), /would marketplace add[\s\S]*would plugin add/);
    assert.ok(!fs.existsSync(cp.statePath(h)));
  }
});

test('unparseable list output and runner exceptions are reported, not thrown', () => {
  const h = home();
  const r1 = cp.installCodexPlugin({ home: h, pkgRoot: ROOT, version: V, hasCodex: () => true, run: () => ({ status: 0, stdout: 'garbage', stderr: '' }) });
  assert.equal(r1.ok, false);
  const r2 = cp.installCodexPlugin({ home: h, pkgRoot: ROOT, version: V, hasCodex: () => true, run: () => { throw new Error('spawn died'); } });
  assert.equal(r2.ok, false);
  assert.match(r2.lines.join('\n'), /spawn died/);
});

test('uninstall: nothing recorded means nothing runs', () => {
  const f = fakeCodex({ installed: V });
  const r = cp.uninstallCodexPlugin({ home: home(), run: f.run, hasCodex: () => true });
  assert.deepEqual(f.calls, []);
  assert.deepEqual(r.lines, []);
});

test('uninstall removes what was recorded, then the state', () => {
  const h = home(); const f = fakeCodex();
  go(f, { home: h });
  f.calls.length = 0;
  const r = cp.uninstallCodexPlugin({ home: h, run: f.run, hasCodex: () => true });
  assert.deepEqual(f.calls, ['plugin remove bdb-aos@bdb-aos', 'plugin marketplace remove bdb-aos']);
  assert.ok(r.changed && !fs.existsSync(cp.statePath(h)));
});

test('uninstall dry run and missing codex change nothing', () => {
  const h = home(); const f = fakeCodex();
  go(f, { home: h });
  f.calls.length = 0;
  cp.uninstallCodexPlugin({ home: h, run: f.run, hasCodex: () => true, dryRun: true });
  const r = cp.uninstallCodexPlugin({ home: h, run: f.run, hasCodex: () => false });
  assert.deepEqual(f.calls, []);
  assert.match(r.lines[0], /by hand/);
  assert.ok(fs.existsSync(cp.statePath(h)));
});

test('uninstall keeps a plugin the installer did not install', () => {
  const h = home(); const f = fakeCodex({ marketplace: { sourceType: 'local', source: ROOT }, installed: V });
  go(f, { home: h });
  fs.mkdirSync(path.dirname(cp.statePath(h)), { recursive: true });
  fs.writeFileSync(cp.statePath(h), JSON.stringify({ installedPlugin: false, addedMarketplace: false }));
  f.calls.length = 0;
  cp.uninstallCodexPlugin({ home: h, run: f.run, hasCodex: () => true });
  assert.deepEqual(f.calls, []);
});

test('E2E with the real codex CLI in a temp HOME (AOS_E2E_CLI=1)', { skip: process.env.AOS_E2E_CLI !== '1' }, () => {
  const h = home();
  const env = { ...process.env, HOME: h };
  const real = (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8', env, timeout: 120000 });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const opts = { home: h, pkgRoot: ROOT, version: V, run: real, hasCodex: () => true };
  const first = cp.installCodexPlugin(opts);
  assert.ok(first.ok, first.lines.join('\n'));
  const listed = JSON.parse(real('codex', ['plugin', 'list', '--json']).stdout.replace(/^[^{]*/, ''));
  assert.equal(listed.installed[0].version, V);
  const cache = path.join(h, '.codex', 'plugins', 'cache', 'bdb-aos', 'bdb-aos', V, 'skills');
  assert.ok(fs.readdirSync(cache).length >= 14);
  assert.match(cp.installCodexPlugin(opts).lines[0], /already installed/);
  assert.ok(!fs.existsSync(path.join(h, '.codex', 'skills')));
  const un = cp.uninstallCodexPlugin({ home: h, run: real, hasCodex: () => true });
  assert.ok(un.changed, un.lines.join('\n'));
  assert.equal(JSON.parse(real('codex', ['plugin', 'list', '--json']).stdout.replace(/^[^{]*/, '')).installed.length, 0);
});
