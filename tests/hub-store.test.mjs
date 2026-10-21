import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { routes as storeRoutes } from '../lib/hub/routes-store.mjs';
import { rollbackInstall, appendInstallLog, fetchSkillFiles, installWithBackup, installsLogPath, storeIso, readInstallsLog } from '../lib/store-shared.mjs';

const reqCjs = createRequire(import.meta.url);

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
// Unique temp dirs, never deleted (rules forbid recursive deletes).
const base = mkdtempSync(join(tmpdir(), 'hub-store-'));
const proj = join(base, 'proj');
const projHome = join(base, 'home');
mkdirSync(proj, { recursive: true });
mkdirSync(projHome, { recursive: true });

// ---- fixture index + fixture HTTP server ------------------------------------
const COMMIT = 'b'.repeat(40);
const SKILL_DIR = 'skills/hub-fixture';
const FILES = {
  'SKILL.md': '---\nname: hub-fixture\n---\nhello\n',
  'scripts/hub.sh': '#!/bin/sh\necho hub\n',
  'refs/h.md': 'refs\n',
};
const ENVELOPE = Buffer.from('---\nname: hub-agent\n---\nagent\n');
const ENVELOPE_SHA = createHash('sha256').update(ENVELOPE).digest('hex');
const fileEntries = Object.entries(FILES).map(([p, data]) => ({
  path: p,
  size: Buffer.byteLength(data),
  sha256: createHash('sha256').update(data).digest('hex'),
}));

let srv, rawPort;
const savedEnv = {};
before(async () => {
  // Route handlers read the store index / raw base from process.env.
  for (const k of ['AOS_STORE_INDEX', 'AOS_STORE_RAW_BASE', 'AOS_STORE_TEST_OVERRIDES']) savedEnv[k] = process.env[k];
  process.env.AOS_STORE_TEST_OVERRIDES = '1';
  process.env.AOS_STORE_INDEX = join(base, 'index.json');
  srv = createServer((req, res) => {
    const trimmed = req.url.replace(`/${COMMIT}/`, '');
    if (trimmed === 'subagents/hub-agent.md') return res.end(ENVELOPE);
    if (trimmed.startsWith(`${SKILL_DIR}/`)) {
      const hit = FILES[trimmed.slice(SKILL_DIR.length + 1)];
      if (hit) return res.end(hit);
    }
    res.statusCode = 404;
    res.end('nope');
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  rawPort = srv.address().port;
  process.env.AOS_STORE_RAW_BASE = `http://127.0.0.1:${rawPort}`;
});
after(() => {
  srv.close();
  if (savedEnv.AOS_STORE_INDEX === undefined) delete process.env.AOS_STORE_INDEX; else process.env.AOS_STORE_INDEX = savedEnv.AOS_STORE_INDEX;
  if (savedEnv.AOS_STORE_RAW_BASE === undefined) delete process.env.AOS_STORE_RAW_BASE; else process.env.AOS_STORE_RAW_BASE = savedEnv.AOS_STORE_RAW_BASE;
  if (savedEnv.AOS_STORE_TEST_OVERRIDES === undefined) delete process.env.AOS_STORE_TEST_OVERRIDES; else process.env.AOS_STORE_TEST_OVERRIDES = savedEnv.AOS_STORE_TEST_OVERRIDES;
});

writeFileSync(join(base, 'index.json'), JSON.stringify({
  version: '1.0.0',
  pinned_commit: COMMIT,
  skills: {
    'hub-fixture': {
      description: 'hub-store fixture skill',
      category: 'library',
      sha256: fileEntries[0].sha256,
      upstream_path: `${SKILL_DIR}/SKILL.md`,
      files: fileEntries,
    },
  },
  subagents: {
    'hub-agent': { description: 'hub fixture agent', category: 'library', sha256: ENVELOPE_SHA, upstream_path: 'subagents/hub-agent.md' },
  },
}));

const env = (overrides = {}) => ({
  ...process.env,
  HOME: projHome,
  USERPROFILE: projHome,
  AOS_STORE_TEST_OVERRIDES: '1',
  AOS_STORE_INDEX: join(base, 'index.json'),
  AOS_STORE_RAW_BASE: `http://127.0.0.1:${rawPort}`,
  ...overrides,
});

const cli = (args, overrides = {}, cwd = proj) => new Promise((ok) => execFile(
  process.execPath,
  [join(ROOT, 'bin', 'aos-store.mjs'), ...args],
  { cwd, env: env(overrides), maxBuffer: 1 << 22 },
  (error, stdout, stderr) => ok({ code: error ? (error.code || 1) : 0, stdout, stderr: stderr || (error?.message || '') }),
));

const route = (path) => storeRoutes.find((r) => r.path === path);
const reRoute = storeRoutes.find((r) => r.path instanceof RegExp);
const handler = (path) => route(path).handler;
const reHandler = reRoute.handler;

// fake ctx.run: records argv, resolves ok (the hub spawns; the fixture does not).
const calls = [];
const fakeRun = async (cmd, args, opts) => {
  calls.push({ cmd, args, opts });
  return { ok: true, stdout: 'simulated', stderr: '' };
};

const storeCtx = (home = projHome, cwd = proj, { run = fakeRun } = {}) => ({
  root: ROOT,
  home,
  cwd,
  log: () => {},
  run,
  now: () => Date.now(),
});

const post = async (path, body, ctx = storeCtx()) =>
  handler(path)({ url: new URL(path, 'http://127.0.0.1'), params: [], body, ctx });

// ---------------------------------------------------------------------------
const isoRe = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

test('routes carry the planned mutates/confirm/lock flags; regexes anchored', () => {
  assert.equal(route('/api/store').mutates, undefined);
  assert.equal(route('/api/store/preview').mutates, true);
  assert.equal(route('/api/store/install').confirm, 'name');
  assert.equal(route('/api/store/install').lock, 'packages');
  assert.equal(route('/api/store/rollback').confirm, 'name');
  assert.equal(route('/api/store/rollback').lock, 'packages');
  assert.equal(reRoute.path.source, '^\\/api\\/packages\\/([A-Za-z0-9_-]+)\\/(install|update|repair)$');
  assert.equal(reRoute.confirm, 'id');
  assert.equal(reRoute.lock, 'packages');
  assert.equal(reRoute.path.exec('/api/packages/ao/destroy'), null);
});

test('install writes targets + a jsonl log line', async () => {
  const r = await cli(['install', 'hub-fixture', '--project', '--net']);
  assert.equal(r.code, 0, r.stderr || r.stdout);
  const target = join(proj, 'skills', 'hub-fixture', 'SKILL.md');
  assert.equal(readFileSync(target, 'utf8'), FILES['SKILL.md']);
  const log = readInstallsLog(projHome);
  const entry = log[log.length - 1];
  assert.equal(entry.name, 'hub-fixture');
  assert.equal(entry.kind, 'skill');
  assert.equal(entry.scope, 'project');
  assert.match(entry.commit, /^[a-f0-9]{40}$/);
  assert.deepEqual(entry.targets, [target]);
  assert.equal(entry.backups[0], null, 'first install has nothing to back up');
});

test('re-install renames the existing target to .aos-bak-<ISO> and keeps it', async () => {
  const r = await cli(['install', 'hub-fixture', '--project', '--net']);
  assert.equal(r.code, 0, r.stderr || r.stdout);
  const entries = readdirSync(join(proj, 'skills'))
    .filter((n) => /^hub-fixture\.aos-bak-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(n) && statSync(join(proj, 'skills', n)).isDirectory());
  assert.equal(entries.length, 1);
  assert.equal(readFileSync(join(proj, 'skills', 'hub-fixture', 'SKILL.md'), 'utf8'), FILES['SKILL.md'], 'new copy in place');
  const bak = join(proj, 'skills', entries[0]);
  assert.ok(existsSync(join(bak, 'SKILL.md')), 'backup keeps the whole skill dir');
  assert.match(String(readInstallsLog(projHome).at(-1).backups[0]), /\.aos-bak-\d{4}/);
  // backups[0] is a full path ending in .aos-bak-<ISO>: extract the ISO suffix.
  const loggedBackup = String(readInstallsLog(projHome).at(-1).backups[0]);
  const loggedSuffix = loggedBackup.slice(loggedBackup.indexOf('.aos-bak-') + '.aos-bak-'.length);
  assert.match(loggedSuffix, isoRe);
});

test('a tampered download byte fails verification and writes nothing', async () => {
  const bad = createServer((_req, res) => { res.end(Buffer.from(FILES['SKILL.md'] + '\n')); });
  await new Promise((ok) => bad.listen(0, '127.0.0.1', ok));
  const badPort = bad.address().port;
  try {
    const listSkills = () => (existsSync(join(proj, 'skills')) ? readdirSync(join(proj, 'skills')).sort() : []);
    const beforeNames = listSkills();
    const beforeLog = readInstallsLog(projHome).length;
    // The +1 byte trips in-memory verification: fetchSkillFiles checks the
    // recorded size before the digest, so the real message is Size mismatch
    // (the unaffected paths still report SHA-256 mismatch).
    const r = await cli(['install', 'hub-fixture', '--project', '--net'], { AOS_STORE_RAW_BASE: `http://127.0.0.1:${badPort}` });
    assert.notEqual(r.code, 0);
    assert.match(`${r.stderr}\n${r.stdout}`, /(Size|SHA-256) mismatch for SKILL\.md/);
    assert.deepEqual(listSkills(), beforeNames, 'no renames, no writes');
    assert.equal(readInstallsLog(projHome).length, beforeLog, 'no log line appended');
    assert.equal(readFileSync(join(proj, 'skills', 'hub-fixture', 'SKILL.md'), 'utf8'), FILES['SKILL.md'], 'on-disk content untouched');
  } finally { bad.close(); }
});

test('rollback restores the last installed content (bak -> target, old state parked)', async () => {
  const dir = join(proj, 'skills', 'hub-fixture');
  writeFileSync(join(dir, 'SKILL.md'), 'tampered later revision\n');
  const r = await cli(['rollback', 'hub-fixture', '--project']);
  assert.equal(r.code, 0, r.stderr || r.stdout);
  assert.equal(readFileSync(join(dir, 'SKILL.md'), 'utf8'), FILES['SKILL.md'], 'content restored from the backup');
  const dirs = readdirSync(join(proj, 'skills')).filter((n) => n.startsWith('hub-fixture.'));
  assert.ok(dirs.some((n) => n.startsWith('hub-fixture.aos-failed-')), 'the overwritten state is parked, not deleted');
});

// ---- hub routes -------------------------------------------------------------
test('install route: 400 without the typed confirm, and never spawns', async () => {
  const before = calls.length;
  const res = await post('/api/store/install', { name: 'hub-fixture' });
  assert.equal(res.status, 400);
  const res2 = await post('/api/store/install', { name: 'hub-fixture', confirm: 'other-name' });
  assert.equal(res2.status, 400);
  const nope = await post('/api/store/install', { name: '../etc/passwd', confirm: '../etc/passwd' });
  assert.equal(nope.status, 400);
  const unknown = await post('/api/store/install', { name: 'hub-never-existed', confirm: 'hub-never-existed' });
  assert.equal(unknown.status, 404);
  assert.equal(calls.length, before);
});

test('install route spawns the fixed-argv CLI (shell:false), nothing interpolated', async () => {
  const before = calls.length;
  const res = await post('/api/store/install', { name: 'hub-fixture', scope: 'global', confirm: 'hub-fixture' });
  assert.equal(res.status, 200);
  assert.equal(calls.length, before + 1);
  const { cmd, args, opts } = calls[calls.length - 1];
  assert.equal(cmd, 'node');
  assert.equal(args[0], join(ROOT, 'bin', 'aos-store.mjs'));
  assert.deepEqual(args.slice(1), ['install', 'hub-fixture', '--net']);
  assert.equal(opts.shell, false);
});

test('scope project is refused by the hub (400) on preview, install and rollback — nothing spawns', async () => {
  const before = calls.length;
  const pv = await post('/api/store/preview', { kind: 'skill', name: 'hub-fixture', scope: 'project' });
  assert.equal(pv.status, 400);
  const ins = await post('/api/store/install', { name: 'hub-fixture', scope: 'project', confirm: 'hub-fixture' });
  assert.equal(ins.status, 400);
  const insMcp = await post('/api/store/install', { kind: 'mcp', name: 'gog-gateway', scope: 'project', target: 'claude', confirm: 'gog-gateway' });
  assert.equal(insMcp.status, 400);
  const rb = await post('/api/store/rollback', { name: 'hub-fixture', scope: 'project', confirm: 'hub-fixture' });
  assert.equal(rb.status, 400);
  assert.equal(calls.length, before, 'refusals never spawn');
  for (const j of [pv, ins, insMcp, rb]) assert.equal(j.json.error, 'project scope is not available from the hub');
});

test('mcp kind refuses names not shipped in mcp_config.json/mcp_picks.json', async () => {
  const before = calls.length;
  const pv = await post('/api/store/preview', { kind: 'mcp', name: 'hub-never-shipped' });
  assert.equal(pv.status, 404);
  const iv = await post('/api/store/install', { kind: 'mcp', name: 'hub-never-shipped', target: 'claude', confirm: 'hub-never-shipped' });
  assert.equal(iv.status, 404);
  assert.equal(calls.length, before, 'nothing spawned for refused names');
});

test('mcp preview lists harness targets; install validates the target + argv', async () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'mcp_config.json'), 'utf8'));
  const name = Object.keys(cfg.mcpServers)[0];
  const pv = await post('/api/store/preview', { kind: 'mcp', name });
  assert.equal(pv.status, 200);
  assert.ok(Array.isArray(pv.json.targets));
  for (const t of pv.json.targets) assert.ok(t.file && t.kind, 'targets are harness config descriptors, not arbitrary paths');
  const badTarget = await post('/api/store/install', { kind: 'mcp', name, target: 'opencode-ish', confirm: name });
  assert.equal(badTarget.status, 400);
  const missingTarget = await post('/api/store/install', { kind: 'mcp', name, confirm: name });
  assert.equal(missingTarget.status, 400);
  const ok = await post('/api/store/install', { kind: 'mcp', name, target: 'claude', confirm: name });
  assert.equal(ok.status, 200);
  assert.deepEqual(calls.at(-1).args, [join(ROOT, 'installer.js'), 'package', 'mcp', name, '--target', 'claude']);
  // finding 2: the mcp verb reaches the real installer, so it must be exported.
  const { installMcpsForTarget } = reqCjs(join(ROOT, 'installer.js'));
  assert.equal(typeof installMcpsForTarget, 'function');
  // stdout/stderr pass through redact before leaving the route (finding 9).
  const routesSrc = readFileSync(join(ROOT, 'lib', 'hub', 'routes-store.mjs'), 'utf8');
  assert.doesNotMatch(routesSrc, /stdout: String\(/);
  assert.doesNotMatch(routesSrc, /stderr: String\(/);
});

test('rollback route refuses scope project; the in-process restore stays CLI-covered', async () => {
  const home2 = join(base, 'home-route');
  const proj2 = join(base, 'proj-route');
  mkdirSync(proj2, { recursive: true });
  await cli(['install', 'hub-fixture', '--project', '--net'], { HOME: home2 }, proj2);
  await cli(['install', 'hub-fixture', '--project', '--net'], { HOME: home2 }, proj2);
  const target = join(proj2, 'skills', 'hub-fixture', 'SKILL.md');
  writeFileSync(target, 'current (bad) content\n');
  const before = calls.length;
  const ok = await handler('/api/store/rollback')({
    url: new URL('/api/store/rollback', 'http://127.0.0.1'),
    params: [],
    body: { name: 'hub-fixture', scope: 'project', confirm: 'hub-fixture' },
    ctx: storeCtx(home2, proj2),
  });
  assert.equal(ok.status, 400, 'project scope refused from the hub');
  assert.equal(calls.length, before, 'refusal never spawns');
  assert.equal(readFileSync(target, 'utf8'), 'current (bad) content\n', 'refusal renamed nothing');
});

test('tampered installs.jsonl: abort with zero renames (target outside roots, foo.bak backup, non-ISO suffix)', () => {
  const home = join(base, 'home-tamper');
  const cwd = join(base, 'proj-tamper');
  mkdirSync(join(cwd, 'skills', 'hub-fixture'), { recursive: true });
  mkdirSync(home, { recursive: true });
  const target = join(cwd, 'skills', 'hub-fixture', 'SKILL.md');
  const iso = storeIso();
  writeFileSync(target, FILES['SKILL.md']);
  writeFileSync(`${target}.aos-bak-${iso}`, FILES['SKILL.md']);
  const put = (entry) => {
    mkdirSync(join(home, '.aos', 'store'), { recursive: true });
    writeFileSync(installsLogPath(home), `${JSON.stringify(entry)}\n`);
  };
  const baseEntry = { ts: new Date().toISOString(), name: 'hub-fixture', kind: 'skill', source: 'ecc', commit: COMMIT, scope: 'project' };
  const expectNoRenames = () => {
    assert.equal(readFileSync(target, 'utf8'), FILES['SKILL.md']);
    assert.ok(existsSync(`${target}.aos-bak-${iso}`));
    assert.ok(!readdirSync(join(cwd, 'skills')).some((n) => n.startsWith('hub-fixture.aos-failed-')));
  };
  // a log entry whose target is not produced by targetsFor
  put({ ...baseEntry, targets: ['/etc/x'], backups: ['foo.bak'] });
  assert.throws(() => rollbackInstall({ name: 'hub-fixture', home, project: true, cwd }), /not a current target/);
  expectNoRenames();
  // a backup not named <target>.aos-bak-<ISO>
  put({ ...baseEntry, targets: [target], backups: ['foo.bak'] });
  assert.throws(() => rollbackInstall({ name: 'hub-fixture', home, project: true, cwd }), /does not match target/);
  expectNoRenames();
  // a non-ISO suffix
  put({ ...baseEntry, targets: [target], backups: [`${target}.aos-bak-foo.bak`] });
  assert.throws(() => rollbackInstall({ name: 'hub-fixture', home, project: true, cwd }), /suffix/);
  expectNoRenames();
  // bad names refused outright
  assert.throws(() => rollbackInstall({ name: '/etc/x', home, project: true, cwd }), /Invalid store name/);
  assert.throws(() => rollbackInstall({ name: '../etc/passwd', home, project: true, cwd }), /Invalid store name/);
  expectNoRenames();
});

test('a valid installs.jsonl restores content and parks the overwritten state', () => {
  const home = join(base, 'home-ok');
  const cwd = join(base, 'proj-ok');
  mkdirSync(join(cwd, 'skills', 'hub-fixture'), { recursive: true });
  mkdirSync(home, { recursive: true });
  const target = join(cwd, 'skills', 'hub-fixture', 'SKILL.md');
  const iso = storeIso();
  writeFileSync(target, 'current (bad) content\n');
  writeFileSync(`${target}.aos-bak-${iso}`, FILES['SKILL.md']);
  appendInstallLog(home, { ts: new Date().toISOString(), name: 'hub-fixture', kind: 'skill', source: 'ecc', commit: COMMIT, scope: 'project', targets: [target], backups: [`${target}.aos-bak-${iso}`] });
  const res = rollbackInstall({ name: 'hub-fixture', home, project: true, cwd });
  assert.equal(res.restored, 1);
  assert.equal(readFileSync(target, 'utf8'), FILES['SKILL.md']);
  assert.ok(readdirSync(join(cwd, 'skills')).some((n) => n.startsWith('hub-fixture.aos-failed-')));
});

// ---- security round: partial states, disk validation, ISO reservations ----
test('installWithBackup: mid-write failure parks the partial target and restores the backup', () => {
  const home = join(base, 'home-partial');
  const cwd = join(base, 'proj-partial');
  mkdirSync(join(cwd, 'skills', 'partial'), { recursive: true });
  mkdirSync(home, { recursive: true });
  const target = join(cwd, 'skills', 'partial', 'SKILL.md');
  writeFileSync(target, 'v1\n');
  // the second write walks into a file used as its parent dir: mkdirSync fails mid-write
  writeFileSync(join(cwd, 'agents'), 'not a directory\n');
  const writes = [
    { type: 'file', target, data: 'v2\n' },
    { type: 'file', target: join(cwd, 'agents', 'agent-x.md'), data: 'y\n' },
  ];
  assert.throws(() => installWithBackup({ writes, home }), /installWithBackup failed|ENOTDIR|EEXIST/);
  assert.equal(readFileSync(target, 'utf8'), 'v1\n', 'backup restored after the failure');
  const parkedFiles = readdirSync(join(cwd, 'skills', 'partial')).filter((n) => n.startsWith('SKILL.md.aos-failed-'));
  assert.equal(parkedFiles.length, 1, 'the partial (no-backup) write was parked, never deleted');
  assert.ok(existsSync(join(join(cwd, 'skills', 'partial'), parkedFiles[0])), 'parked artifact keeps its bytes');
});

test('rollback: a last entry with no backups is an error, and a dirname disk for agents or a harness root is refused', () => {
  const home = join(base, 'home-validate');
  const cwd = join(base, 'proj-validate');
  mkdirSync(home, { recursive: true });
  const agentTarget = join(cwd, 'agents', 'agent-x.md');
  const agentEntry = { ts: new Date().toISOString(), name: 'agent-x', kind: 'agent', source: 'ecc', commit: COMMIT, scope: 'project', targets: [agentTarget] };
  appendInstallLog(home, { ...agentEntry, backups: [null] });
  // no backups at all -> nothing to restore must be an ERROR, not a silent ok
  assert.throws(() => rollbackInstall({ name: 'agent-x', home, project: true, cwd }), /nothing to restore/);
  // agents: the unit is the file itself; a dirname disk must be refused
  const placed = { ...agentEntry, disks: [dirname(agentTarget)], backups: [] };
  writeFileSync(installsLogPath(home), `${JSON.stringify(placed)}\n`);
  assert.throws(() => rollbackInstall({ name: 'agent-x', home, project: true, cwd }), /does not belong/);
  // skills: a logged disk equal to the harness skills ROOT is refused
  const skillTarget = join(cwd, 'skills', 'grad-one', 'SKILL.md');
  const skillEntry = { ts: new Date().toISOString(), name: 'grad-one', kind: 'skill', source: 'ecc', commit: COMMIT, scope: 'project', targets: [skillTarget] };
  writeFileSync(installsLogPath(home), `${JSON.stringify({ ...skillEntry, disks: [join(cwd, 'skills')], backups: [null] })}\n`);
  assert.throws(() => rollbackInstall({ name: 'grad-one', home, project: true, cwd }), /harness skills\/agents root|does not belong/);
  // ...but a legit skill dir-unit disk (dirname of SKILL.md) stays allowed
  const isoDir = storeIso();
  mkdirSync(dirname(skillTarget), { recursive: true });
  writeFileSync(skillTarget, 'bad\n');
  // a skill's physical backup is the renamed DIRECTORY (<dir>.aos-bak-<ISO>), the unit named by `disks`
  const bakDir = `${join(cwd, 'skills', 'grad-one')}.aos-bak-${isoDir}`;
  mkdirSync(bakDir, { recursive: true });
  writeFileSync(join(bakDir, 'SKILL.md'), 'good\n');
  writeFileSync(installsLogPath(home), `${JSON.stringify({ ...skillEntry, disks: [join(cwd, 'skills', 'grad-one')], backups: [bakDir] })}\n`);
  assert.equal(rollbackInstall({ name: 'grad-one', home, project: true, cwd }).restored, 1);
  assert.equal(readFileSync(skillTarget, 'utf8'), 'good\n');
});

test('GET /api/store returns index items + package rows', async () => {
  const res = await route('/api/store').handler({
    url: new URL('/api/store', 'http://127.0.0.1'),
    params: [],
    body: undefined,
    ctx: storeCtx(),
  });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.json.items) && res.json.items.length > 0, 'index items listed');
  assert.ok(res.json.items.some((i) => i.name === 'hub-fixture'), 'fixture item present');
  assert.ok(Array.isArray(res.json.packages));
  assert.ok(res.json.packages.some((p) => p.id === 'kernel'), 'packages detected via the registry');
  assert.ok(res.json.items.every((i) => ['skill', 'agent'].includes(i.kind)));
});

test('packages route: registry id lookup, fixed spawn, unknown id 404', async () => {
  const pk = createRequire(import.meta.url)(join(ROOT, 'lib', 'v5', 'packages.js'));
  const p0 = pk.registry[0].id;
  const before = calls.length;
  const ok = await reHandler({
    url: new URL(`/api/packages/${p0}/install`, 'http://127.0.0.1'),
    params: [p0, 'install'],
    body: { id: p0, confirm: p0 },
    ctx: storeCtx(),
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(calls.at(-1).args, [join(ROOT, 'installer.js'), 'package', 'install', p0]);
  const wrongAction = await reHandler({
    url: new URL(`/api/packages/${p0}/destroy`, 'http://127.0.0.1'),
    params: [p0, 'destroy'],
    body: { id: p0, confirm: p0 },
    ctx: storeCtx(),
  });
  assert.equal(wrongAction.status, 400);
  const unknown = await reHandler({
    url: new URL('/api/packages/zzz/install', 'http://127.0.0.1'),
    params: ['zzz', 'install'],
    body: { id: 'zzz', confirm: 'zzz' },
    ctx: storeCtx(),
  });
  assert.equal(unknown.status, 404);
  const noConfirm = await reHandler({
    url: new URL(`/api/packages/${p0}/install`, 'http://127.0.0.1'),
    params: [p0, 'install'],
    body: { id: p0 },
    ctx: storeCtx(),
  });
  assert.equal(noConfirm.status, 400);
  assert.equal(calls.length, before + 1);
});

test('installWithBackup: one failed restore step does not skip the later ones', () => {
  const home = join(base, 'home-restore-agg');
  const cwd = join(base, 'proj-restore-agg');
  const dirA = join(cwd, 'skills', 'agg-a');
  mkdirSync(dirA, { recursive: true });
  mkdirSync(home, { recursive: true });
  // Unit A: a basename long enough that parking it adds 'aos-failed-' + the
  // 24-char ISO beyond the 255-byte NAME_MAX while the .aos-bak- backup of
  // the same unit still fits (221 + 33 = 254 <= 255, 221 + 36 = 257 > 255).
  // The parking step of THIS unit fails (ENAMETOOLONG) without breaking the
  // earlier backup or write phases.
  const longName = 'K'.repeat(221);
  const ta = join(dirA, longName);
  writeFileSync(ta, 'a-v1\n');
  // Unit B is fully restorable: a v1 on disk, a successful backup, a
  // successful v2 write — only its restore step stands behind unit A's.
  const dirB = join(cwd, 'skills', 'agg-b');
  const tb = join(dirB, 'b.md');
  mkdirSync(dirB, { recursive: true });
  writeFileSync(tb, 'b-v1\n');
  // Unit C's write walks into a file used as its parent dir: ENOTDIR
  // mid-write, so the restore phase runs while B is genuinely restorable.
  writeFileSync(join(cwd, 'agents'), 'not a directory\n');
  const tc = join(cwd, 'agents', 'c.md');
  const writes = [
    { type: 'file', target: ta, data: 'a-v2\n' },
    { type: 'file', target: tb, data: 'b-v2\n' },
    { type: 'file', target: tc, data: 'c-v2\n' },
  ];
  let caught = null;
  try { installWithBackup({ writes, home }); } catch (e) { caught = e; }
  assert.ok(caught, 'install fails');
  assert.match(caught.message, /restore also failed/, 'restore errors are aggregated into ONE error');
  // Unit A's park-name is beyond NAME_MAX, so A's own restore cannot move its
  // disk aside again: a-v2 stays on disk and its .aos-bak- backup stays parked.
  // That is the code's honest, non-destructive outcome — still every byte is
  // accounted for and nothing is deleted. The regression being proven is that
  // this failure does NOT skip the LATER step: unit B's backup must come back.
  assert.equal(readFileSync(ta, 'utf8'), 'a-v2\n', 'a too-long-to-park disk cannot be moved aside again');
  assert.equal(readFileSync(tb, 'utf8'), 'b-v1\n', 'unit B is restored even though unit A\'s restore failed');
});

test('fetchSkillFiles: oversized content-length is refused before buffering; the body is streamed and verified', async () => {
  const srvF = createServer((req, res) => {
    if (req.url.endsWith('/too-big.bin')) {
      res.writeHead(200, { 'content-length': String(6 * 1024 * 1024) });
      return res.end('x');
    }
    const body = Buffer.from('tiny\n');
    res.writeHead(200, { 'content-length': String(body.length) });
    res.end(body);
  });
  await new Promise((ok) => srvF.listen(0, '127.0.0.1', ok));
  const rawBase = `http://127.0.0.1:${srvF.address().port}/c/sk`;
  try {
    await assert.rejects(
      () => fetchSkillFiles(rawBase, 'c', 'sk', [{ path: 'too-big.bin' }]),
      /too large/,
      'declared content-length over the cap must be rejected without buffering the body',
    );
    const sha = createHash('sha256').update('tiny\n').digest('hex');
    const out = await fetchSkillFiles(rawBase, 'c', 'sk', [{ path: 'tiny.txt', size: 5, sha256: sha }]);
    assert.equal(out[0].data.toString('utf8'), 'tiny\n', 'the streamed body is hash-verified');
  } finally {
    srvF.close();
  }
});

test('static: store-shared.mjs and routes-store.mjs contain no destructive fs calls', () => {
  for (const f of ['lib/store-shared.mjs', 'lib/hub/routes-store.mjs']) {
    const text = readFileSync(join(ROOT, f), 'utf8');
    assert.doesNotMatch(text, /rmSync|unlinkSync/, f);
    assert.doesNotMatch(text, /\brm -|fs\.rm\b/, f);
  }
  assert.doesNotMatch(readFileSync(join(ROOT, 'bin', 'aos-store.mjs'), 'utf8'), /rmSync|unlinkSync|\brm -|fs\.rm\b/);
  assert.doesNotMatch(readFileSync(join(ROOT, 'lib', 'hub', 'ui', 'store.js'), 'utf8'), /window\.prompt|rmSync|unlinkSync/);
});

test('B3: hub store UI has the inspector and reads /api/store/skill', () => {
  const js = readFileSync(join(ROOT, 'lib', 'hub', 'ui', 'store.js'), 'utf8');
  assert.match(js, /inspector/);
  assert.match(js, /api\/store\/skill/);
  const dry = js.slice(js.indexOf('const dryRun = async'), js.indexOf('const onKey'));
  assert.ok(dry.includes("'api/store/preview'"), 'dry run posts to /api/store/preview');
  assert.ok(!dry.includes('/api/store/install'), 'dry run body never references /api/store/install');
});

test('GET /api/store/skill: same contract as /api/skill', async () => {
  const h = handler('/api/store/skill');
  const ok = await h({ url: new URL('/api/store/skill?name=fabric', 'http://127.0.0.1'), params: [], body: undefined, ctx: storeCtx() });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.name, 'fabric');
  assert.match(ok.json.frontmatter, /name:/);
  assert.ok(ok.json.body.length > 0);
  assert.match(ok.json.path, /^(skills|agents|\.claude)\//);
  const bad = await h({ url: new URL('/api/store/skill?name=a%2Fb', 'http://127.0.0.1'), params: [], body: undefined, ctx: storeCtx() });
  assert.equal(bad.status, 400);
  const kind = await h({ url: new URL('/api/store/skill?name=fabric&kind=foo', 'http://127.0.0.1'), params: [], body: undefined, ctx: storeCtx() });
  assert.equal(kind.status, 400);
  const missing = await h({ url: new URL('/api/store/skill?name=no-such-skill-xyz', 'http://127.0.0.1'), params: [], body: undefined, ctx: storeCtx() });
  assert.equal(missing.status, 404);
});

test('temp dirs are never deleted by the tests', () => {
  assert.ok(existsSync(base));
});
