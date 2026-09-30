import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { execFile, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createStoreServer } from '../lib/store-ui/server.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const cli = join(root, 'bin', 'aos-store.mjs');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const SC = 'b'.repeat(40);
const ECC = 'a'.repeat(40);
const tree = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }) : []);

const LEAD = {
  'SKILL.md': '---\nname: fx-lead\ndescription: Use when driving FakeApp 1.2\n---\nlead\n',
  'scripts/bridge.py': '#!/usr/bin/env python3\n# inbox poller\nexec(open("x").read())\n',
};
const CHILD = { 'SKILL.md': '---\nname: fx-child\n---\nchild\n', 'scripts/tool.py': 'print(1)\n' };
const asFiles = (map) => Object.entries(map).map(([path, data]) => ({ path, sha256: sha(data), size: Buffer.byteLength(data), exec: path.endsWith('.py') && path !== 'scripts/tool.py' }));

function scenarioIndex(mutate) {
  const item = (name, map, extra) => ({
    description: 'x', category: 'media-eventtech', tier: 'free', origin: 'scenario', requires_auth: false,
    sha256: sha(map['SKILL.md']), upstream_path: `skills/${name}/SKILL.md`, files: asFiles(map), software: [], ...extra,
  });
  const index = {
    version: '1.1.0', pinned_commit: SC,
    source: { id: 'scenario', label: 'Scenario', raw_base: 'https://raw.githubusercontent.com/scenario-labs/skills', license: 'MIT', copyright: 'Copyright (c) 2026 Scenario', third_party: true },
    skills: {
      'fx-lead': item('fx-lead', LEAD, { hasScripts: true, scriptCount: 1, execBridge: true, execBridgeFiles: [{ path: 'scripts/bridge.py', reason: 'calls exec()/eval() + file inbox polled for requests' }], software: ['FakeApp 1.2'] }),
      'fx-child': item('fx-child', CHILD, { requires: ['fx-lead'], hasScripts: true, scriptCount: 1, execBridge: false, execBridgeFiles: [] }),
    },
    subagents: {},
  };
  mutate?.(index);
  return index;
}

async function withEnv(fn, { scenario, eccSkills } = {}) {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'aos-store-scn-')));
  const store = { [`/${SC}/skills/fx-lead/`]: LEAD, [`/${SC}/skills/fx-child/`]: CHILD };
  const srv = createServer((req, res) => {
    for (const [prefix, map] of Object.entries(store)) {
      if (req.url.startsWith(prefix) && map[req.url.slice(prefix.length)] !== undefined) { res.end(map[req.url.slice(prefix.length)]); return; }
    }
    res.statusCode = 404;
    res.end('nope');
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    writeFileSync(join(tmp, 'scenario.json'), JSON.stringify(scenarioIndex(scenario)));
    const eccItem = { description: 'x', category: 'library', tier: 'free', origin: 'ecc', requires_auth: false, sha256: '0'.repeat(64), upstream_path: 'skills/dup/SKILL.md' };
    writeFileSync(join(tmp, 'ecc.json'), JSON.stringify({ version: '1.0.0', pinned_commit: ECC, skills: eccSkills || { 'ecc-only': eccItem }, subagents: {} }));
    const cwd = join(tmp, 'proj');
    mkdirSync(cwd);
    mkdirSync(join(tmp, 'home'));
    const env = { ...process.env, HOME: join(tmp, 'home'), AOS_STORE_INDEX: join(tmp, 'ecc.json'), AOS_STORE_RAW_BASE: base, AOS_STORE_INDEX_SCENARIO: join(tmp, 'scenario.json'), AOS_STORE_RAW_BASE_SCENARIO: base };
    const run = (args, e = env) => new Promise((ok) => execFile(process.execPath, [cli, ...args], { cwd, env: e }, (error, stdout, stderr) => ok({ code: error ? error.code : 0, stdout, stderr })));
    await fn({ run, cwd, env, store, tmp });
  } finally {
    srv.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('real Scenario index: shape, pin, license, sizes, dependencies, flags', () => {
  const file = join(root, 'lib', 'scenario-store-index.json');
  const idx = JSON.parse(readFileSync(file, 'utf8'));
  const ecc = JSON.parse(readFileSync(join(root, 'lib', 'ecc-store-index.json'), 'utf8'));
  assert.match(idx.pinned_commit, /^[a-f0-9]{40}$/);
  assert.equal(idx.source.license, 'MIT');
  assert.equal(idx.source.label, 'Scenario');
  assert.match(idx.source.raw_base, /^https:\/\/raw\.githubusercontent\.com\/scenario-labs\/skills$/);
  assert.match(idx.source.copyright, /^Copyright \(c\) 2026 Scenario$/);
  assert.ok(statSync(file).size < 300 * 1024);
  const names = Object.keys(idx.skills);
  assert.ok(names.length > 0);
  for (const [name, it] of Object.entries(idx.skills)) {
    assert.match(name, /^[A-Za-z0-9_-]+$/);
    assert.ok(it.upstream_path.startsWith('skills/'), name);
    assert.equal(it.requires_auth, false);
    assert.equal(typeof it.hasScripts, 'boolean');
    assert.equal(typeof it.execBridge, 'boolean');
    assert.equal(it.hasScripts, it.files.some((f) => f.path.startsWith('scripts/')));
    assert.equal(it.execBridge, it.execBridgeFiles.length > 0);
    for (const dep of it.requires || []) assert.ok(idx.skills[dep], `${name} requires ${dep}`);
    assert.ok(it.files.every((f) => /^[a-f0-9]{64}$/.test(f.sha256)));
    assert.ok(!(name in ecc.skills) && !(name in ecc.subagents), `collides with ECC: ${name}`);
  }
  assert.equal(idx.skills['scenario-unity-expert'].execBridge, true);
  assert.equal(idx.skills['scenario-unity-performance'].requires[0], 'scenario-unity-expert');
  assert.equal(idx.skills['scenario-blender-expert'].execBridge, false);
});

test('list and search show the source for both indexes', () => {
  const out = spawnSync(process.execPath, [cli, 'list', '--type=skills'], { cwd: root, encoding: 'utf8' }).stdout;
  assert.match(out, /\tECC\t/);
  assert.match(out, /scenario-blender-expert\tmedia-eventtech\tScenario\t/);
  assert.match(spawnSync(process.execPath, [cli, 'search', 'unity'], { cwd: root, encoding: 'utf8' }).stdout, /scenario-unity-ui\tdesign-ui-ux\tScenario/);
});

test('install pulls the required skill first from the Scenario base and pin', async () => {
  await withEnv(async ({ run, cwd }) => {
    const r = await run(['install', 'fx-child', '--project', '--net']);
    assert.equal(r.code, 0, r.stderr);
    for (const [name, map] of [['fx-lead', LEAD], ['fx-child', CHILD]]) {
      for (const [p, data] of Object.entries(map)) assert.equal(readFileSync(join(cwd, 'skills', name, p), 'utf8'), data);
    }
    assert.equal(statSync(join(cwd, 'skills', 'fx-lead', 'scripts', 'bridge.py')).mode & 0o777, 0o755);
    assert.ok(r.stdout.indexOf('Installed fx-lead') < r.stdout.indexOf('Installed fx-child'));
    assert.match(r.stdout, /WARNING: contains a script that executes code received over a local socket or file channel without authentication/);
  });
});

test('hash mismatch in the dependency or in the item writes nothing', async () => {
  for (const which of ['fx-lead', 'fx-child']) {
    await withEnv(async ({ run, cwd }) => {
      const r = await run(['install', 'fx-child', '--project', '--net']);
      assert.notEqual(r.code, 0);
      assert.match(r.stderr, /SHA-256 mismatch/);
      assert.deepEqual(tree(cwd), []);
    }, { scenario: (idx) => { idx.skills[which].files[1].sha256 = '0'.repeat(64); } });
  }
});

test('a name present in both sources is refused, never overwritten', async () => {
  const dup = { description: 'x', category: 'library', tier: 'free', origin: 'ecc', requires_auth: false, sha256: '0'.repeat(64), upstream_path: 'skills/fx-lead/SKILL.md' };
  await withEnv(async ({ run, cwd }) => {
    const r = await run(['install', 'fx-lead', '--project', '--net']);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /Name collision: 'fx-lead' exists in ECC and Scenario/);
    assert.deepEqual(tree(cwd), []);
  }, { eccSkills: { 'fx-lead': dup } });
});

test('missing dependency and untrusted raw_base are rejected', async () => {
  await withEnv(async ({ run, cwd }) => {
    const r = await run(['install', 'fx-child', '--project', '--net']);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /requires 'fx-lead'/);
    assert.deepEqual(tree(cwd), []);
  }, { scenario: (idx) => { delete idx.skills['fx-lead']; } });
  await withEnv(async ({ run, env }) => {
    const { AOS_STORE_RAW_BASE_SCENARIO, ...noOverride } = env;
    const r = await run(['list'], noOverride);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /Untrusted raw_base/);
  }, { scenario: (idx) => { idx.source.raw_base = 'https://evil.example/x'; } });
});

test('dry-run lists the files of the required skill too and warns', async () => {
  await withEnv(async ({ run, cwd }) => {
    const r = await run(['install', 'fx-child', '--project', '--dry-run']);
    assert.equal(r.code, 0, r.stderr);
    for (const [name, map] of [['fx-lead', LEAD], ['fx-child', CHILD]]) {
      for (const p of Object.keys(map)) assert.ok(r.stdout.includes(join(cwd, 'skills', name, p)), `${name}/${p}`);
    }
    assert.match(r.stdout, /also installs required skill\(s\): fx-lead/);
    assert.deepEqual(tree(join(cwd, 'skills')), []);
  });
});

test('UI catalog shows both sources; preview carries license, requires and exec-bridge warning flags', async () => {
  await withEnv(async ({ cwd, env }) => {
    const saved = {};
    for (const k of ['HOME', 'AOS_STORE_INDEX', 'AOS_STORE_RAW_BASE', 'AOS_STORE_INDEX_SCENARIO', 'AOS_STORE_RAW_BASE_SCENARIO']) { saved[k] = process.env[k]; process.env[k] = env[k]; }
    const server = createStoreServer({ cwd });
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const token = (await (await fetch(base + '/')).text()).match(/const TOKEN='([0-9a-f]+)'/)[1];
      const cat = await (await fetch(base + '/api/catalog?scope=project')).json();
      assert.deepEqual([...new Set(cat.items.map((i) => i.source))].sort(), ['AOS Core', 'ECC', 'Scenario']);
      const lead = cat.items.find((i) => i.name === 'fx-lead');
      const child = cat.items.find((i) => i.name === 'fx-child');
      assert.equal(lead.execBridge, true);
      assert.equal(child.execBridge, true, 'installing the child installs the bridge through requires');
      assert.deepEqual(child.requires, ['fx-lead']);
      assert.equal(child.thirdParty, true);
      const call = (body) => fetch(base + '/api/preview', { method: 'POST', headers: { 'content-type': 'application/json', 'x-store-token': token }, body: JSON.stringify(body) });
      const d = await (await call({ name: 'fx-child', kind: 'skill', scope: 'project' })).json();
      assert.equal(d.meta.source, 'Scenario');
      assert.equal(d.meta.license, 'MIT');
      assert.equal(d.meta.execBridge, true);
      assert.equal(d.meta.hasScripts, true);
      assert.deepEqual(d.meta.requires, ['fx-lead']);
      assert.deepEqual(d.meta.software, ['FakeApp 1.2']);
      assert.deepEqual(d.meta.execBridgeFiles.map((f) => f.path), ['scripts/bridge.py']);
      assert.equal(d.targets.length, Object.keys(LEAD).length + Object.keys(CHILD).length);
      for (const t of d.targets) assert.ok(!existsSync(t));
      const html = readFileSync(join(root, 'lib', 'store-ui', 'index.html'), 'utf8');
      assert.match(html, /executes code received over a local socket or file channel without authentication/);
      assert.match(html, /install only if you use this bridge/);
    } finally {
      server.close();
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });
});
