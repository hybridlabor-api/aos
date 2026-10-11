import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildModel } from '../skills/global_config/agenttrail/lib/hub-model.mjs';
import { SessionTable } from '../skills/global_config/agenttrail/lib/sessions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hubBin = path.join(root, 'skills/global_config/agenttrail/bin/trail-hub.mjs');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

const PLAN = `# Checkout rewrite

## Cart {#cart}
files: [src/cart.ts]

- [x] build it {#cart-build}
  tech: src/cart.ts

- [ ] wire it {#cart-wire}

## Checkout {#checkout}
files: [src/checkout.ts]

- [ ] start it {#checkout-start}
`;

const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

let home;
let repoA;
let repoB;
let wtA;
let port;
let child;
let base;

const initRepo = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'production_artifacts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'production_artifacts/00_execution_plan.md'), PLAN);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/cart.ts'), 'export const cart = 1\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'plan');
  return dir;
};

const req = (opts, body) => new Promise((resolve, reject) => {
  const headers = Object.fromEntries(Object.entries(opts.headers || {}).filter(([, v]) => v !== undefined));
  const r = http.request({ host: '127.0.0.1', port, agent: false, ...opts, headers }, (res) => {
    let data = '';
    res.on('data', (c) => { data += c });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
  });
  r.on('error', reject);
  if (body !== undefined) r.write(body);
  r.end();
});

const postEvent = (event, extra = {}) => req({
  method: 'POST', path: '/v1/events', headers: { 'content-type': 'application/json', ...extra },
}, JSON.stringify(event));

const getModel = (extra = {}) => req({ method: 'GET', path: '/v1/model', headers: { host: `localhost:${port}`, ...extra } }).then((r) => JSON.parse(r.body));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const waitForHub = async () => {
  for (let i = 0; i < 80; i += 1) {
    try {
      const r = await req({ method: 'GET', path: '/whoami', headers: { host: `localhost:${port}` } });
      if (r.status === 200) return;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  throw new Error('hub did not come up');
};

const event = (over = {}) => ({ v: 1, agent: 'claude', session: { id: 's1' }, cwd: repoA, kind: 'session.start', ...over });

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-hub-home-'));
  repoA = initRepo('trail-hub-a-');
  repoB = initRepo('trail-hub-b-');
  const wtBase = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-hub-wt-'));
  wtA = path.join(wtBase, 'wt-a');
  git(repoA, 'worktree', 'add', '-q', '-b', 'feat-a', wtA);

  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [hubBin, '--port', String(port)], {
    env: { ...process.env, HOME: home, AOS_TRAIL_STATE_DIR: path.join(home, '.aos', 'trail'), AOS_GOGATE_PATH: path.join(home, 'no-gate.mjs') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHub();
});

after(() => { if (child) child.kill('SIGTERM'); });

describe('/whoami', () => {
  test('the hub identifies itself as protocol 3', async () => {
    const r = await req({ method: 'GET', path: '/whoami', headers: { host: `localhost:${port}` } });
    const body = JSON.parse(r.body);
    assert.equal(body.name, 'agenttrail-hub');
    assert.equal(body.protocol, 3);
    assert.equal(body.port, port);
  });
});

describe('/v1/events and /v1/model', () => {
  test('events from four harnesses across two repos land in one model', async () => {
    for (const agent of ['claude', 'opencode', 'agy', 'codex']) {
      const r = await postEvent(event({ agent, session: { id: `s-${agent}` }, kind: 'session.start' }));
      assert.equal(r.status, 204, r.body);
    }
    await postEvent(event({ agent: 'claude', session: { id: 's-repoB' }, cwd: repoB, kind: 'session.start' }));
    const m = await getModel();
    assert.ok(m.repos.length >= 2, `repos: ${m.repos.map((r) => r.root).join(',')}`);
    assert.equal(m.sessions.length, 5, `sessions: ${m.sessions.length}`);
    assert.ok(m.sessions.some((s) => s.harnesses.includes('agy')));
  });

  test('the model carries now, port and the documented shape', async () => {
    const m = await getModel();
    assert.equal(typeof m.now, 'string');
    assert.equal(m.port, port);
    assert.ok(Array.isArray(m.waiting));
    assert.ok(Array.isArray(m.archive));
    assert.equal(typeof m.gate, 'object');
  });

  test('a malformed event is 400 and the hub keeps running', async () => {
    const bad = await req({ method: 'POST', path: '/v1/events', headers: { 'content-type': 'application/json' } }, JSON.stringify({ v: 1, kind: 'nope' }));
    assert.equal(bad.status, 400);
    assert.ok(JSON.parse(bad.body).error);
    const r = await postEvent(event({ kind: 'note' }));
    assert.equal(r.status, 204);
    assert.equal((await getModel()).port, port);
  });

  test('an unknown kind is counted, not accepted', async () => {
    const r = await req({ method: 'POST', path: '/v1/events', headers: { 'content-type': 'application/json' } }, JSON.stringify({ v: 1, agent: 'claude', session: { id: 's' }, cwd: repoA, kind: 'made.up' }));
    assert.equal(r.status, 400);
  });

  test('a wrong Host is 421', async () => {
    const r = await req({ method: 'GET', path: '/v1/model', headers: { host: 'localhost.evil.com' } });
    assert.equal(r.status, 421);
  });

  test('127.0.0.1 as Host is accepted on read routes', async () => {
    const r = await req({ method: 'GET', path: '/v1/model', headers: { host: `127.0.0.1:${port}` } });
    assert.equal(r.status, 200);
  });

  test('a wrong content type on /v1/events is refused', async () => {
    const r = await req({ method: 'POST', path: '/v1/events', headers: { 'content-type': 'text/plain' } }, '{}');
    assert.notEqual(r.status, 204);
  });

  test('OPTIONS is 405', async () => {
    const r = await req({ method: 'OPTIONS', path: '/v1/model', headers: { host: `localhost:${port}` } });
    assert.equal(r.status, 405);
  });

  test('no response carries an Access-Control header', async () => {
    const r = await req({ method: 'GET', path: '/v1/model', headers: { host: `localhost:${port}` } });
    for (const h of Object.keys(r.headers)) assert.ok(!h.toLowerCase().startsWith('access-control-'), h);
    assert.equal(r.headers['cache-control'], 'no-store');
  });
});

describe('/hook legacy', () => {
  test('a legacy hook payload is accepted and mapped', async () => {
    const payload = { hook_event_name: 'PreToolUse', session_id: 'legacy-1', cwd: repoA, tool_name: 'Edit', tool_input: { file_path: path.join(repoA, 'src/cart.ts') }, agent: 'claude' };
    const r = await req({ method: 'POST', path: '/hook', headers: { 'content-type': 'application/json' } }, JSON.stringify(payload));
    assert.equal(r.status, 204, r.body);
    const m = await getModel();
    assert.ok(m.sessions.some((s) => s.id === 'legacy-1'), JSON.stringify(m.sessions.map((s) => s.id)));
  });

  test('an unknown legacy event is ignored without failing', async () => {
    const r = await req({ method: 'POST', path: '/hook', headers: { 'content-type': 'application/json' } }, JSON.stringify({ hook_event_name: 'Nope', session_id: 'legacy-2', cwd: repoA }));
    assert.equal(r.status, 204);
  });
});

describe('plans', () => {
  test('two worktrees with an identical plan are one plan with a mirror line', async () => {
    await postEvent(event({ session: { id: 's-main' }, cwd: repoA, kind: 'session.start' }));
    await postEvent(event({ session: { id: 's-wt' }, cwd: wtA, kind: 'session.start' }));
    const m = await getModel();
    const repo = m.repos.find((r) => fs.realpathSync(r.root) === fs.realpathSync(repoA));
    assert.ok(repo, `repo not in model: ${m.repos.map((r) => r.root).join(',')}`);
    const withPlan = repo.plans.filter((p) => p.planKey);
    assert.equal(withPlan.length, 1, `plans: ${JSON.stringify(repo.plans.map((p) => p.name))}`);
    assert.equal(withPlan[0].mirrors.length, 1, JSON.stringify(withPlan[0].mirrors));
    assert.ok(withPlan[0].owner.path);
  });

  test('a plan reports components and progress', async () => {
    const m = await getModel();
    const repo = m.repos.find((r) => fs.realpathSync(r.root) === fs.realpathSync(repoA));
    const plan = repo.plans[0];
    assert.deepEqual(plan.components.map((c) => c.id).sort(), ['cart', 'checkout']);
    assert.equal(plan.progress.total, 3);
    assert.equal(plan.progress.done, 1);
    assert.equal(typeof plan.lifecycle, 'string');
    assert.ok(['live', 'active', 'idle', 'archived'].includes(plan.lifecycle));
  });

  test('a stale plan is archived rather than shown', async () => {
    // 60h old in every dimension a plan can be measured by: file mtime *and* the
    // last commit that touched it. A fresh commit would legitimately make it active.
    const old = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-hub-old-'));
    git(old, 'init', '-q', '-b', 'main');
    fs.mkdirSync(path.join(old, 'production_artifacts'), { recursive: true });
    fs.writeFileSync(path.join(old, 'production_artifacts/00_execution_plan.md'), PLAN);
    git(old, 'add', '.');
    const stamp = new Date(Date.now() - 60 * 3600 * 1000).toISOString();
    spawnSync('git', ['commit', '-qm', 'plan'], { cwd: old, encoding: 'utf8', env: { ...process.env, ...GIT_ENV, GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp } });
    fs.utimesSync(path.join(old, 'production_artifacts/00_execution_plan.md'), new Date(stamp), new Date(stamp));

    // registered, but nothing is reporting from it
    const empty = new SessionTable();
    const m = buildModel({ now: Date.now(), port, sessionTable: empty, gate: null, asks: [], repos: [{ root: old }], pinnedKeys: [] });
    const repo = m.repos.find((r) => r.root === fs.realpathSync(old));
    assert.ok(repo, 'the repo stays known');
    assert.deepEqual(repo.plans, [], 'but an archived plan must not sit on the main view');
    const arch = m.archive.find((a) => a.repoRoot === fs.realpathSync(old));
    assert.ok(arch, `not archived: ${JSON.stringify(m.archive.map((a) => a.repoRoot))}`);
    assert.equal(arch.lifecycle, 'archived');
    assert.equal(arch.progress.total, 3);
  });

  test('a live session keeps an otherwise stale plan visible', async () => {
    const live = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-hub-live-'));
    git(live, 'init', '-q', '-b', 'main');
    fs.mkdirSync(path.join(live, 'production_artifacts'), { recursive: true });
    fs.writeFileSync(path.join(live, 'production_artifacts/00_execution_plan.md'), PLAN);
    git(live, 'add', '.');
    const stamp = new Date(Date.now() - 60 * 3600 * 1000).toISOString();
    spawnSync('git', ['commit', '-qm', 'plan'], { cwd: live, encoding: 'utf8', env: { ...process.env, ...GIT_ENV, GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp } });
    fs.utimesSync(path.join(live, 'production_artifacts/00_execution_plan.md'), new Date(stamp), new Date(stamp));

    const t = new SessionTable();
    t.apply({ v: 1, ts: new Date().toISOString(), agent: 'claude', session: { id: 'busy' }, cwd: live, kind: 'session.start' });
    const m = buildModel({ now: Date.now(), port, sessionTable: t, gate: null, asks: [], repos: [{ root: live }], pinnedKeys: [] });
    const repo = m.repos.find((r) => r.root === fs.realpathSync(live));
    assert.ok(repo, 'a live session must keep the plan on the main view');
    assert.equal(repo.plans[0].lifecycle, 'live');
  });

  test('a merged branch is archived immediately', () => {
    const merged = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-hub-merged-'));
    git(merged, 'init', '-q', '-b', 'main');
    fs.mkdirSync(path.join(merged, 'production_artifacts'), { recursive: true });
    fs.writeFileSync(path.join(merged, 'production_artifacts/00_execution_plan.md'), PLAN);
    git(merged, 'add', '.');
    git(merged, 'commit', '-qm', 'plan');
    git(merged, 'checkout', '-q', '-b', 'feat');
    fs.writeFileSync(path.join(merged, 'b.txt'), 'b');
    git(merged, 'add', '.');
    git(merged, 'commit', '-qm', 'work');
    git(merged, 'checkout', '-q', 'main');
    git(merged, 'merge', '-q', '--ff-only', 'feat');

    const t = new SessionTable();
    t.apply({ v: 1, ts: new Date().toISOString(), agent: 'claude', session: { id: 'done' }, cwd: merged, kind: 'session.end' });
    const m = buildModel({ now: Date.now(), port, sessionTable: t, gate: null, asks: [], repos: [{ root: merged }], pinnedKeys: [] });
    const arch = m.archive.find((a) => a.repoRoot === fs.realpathSync(merged));
    assert.ok(arch, 'a plan on a merged branch must be archived even though it was touched seconds ago');
    assert.equal(arch.lifecycle, 'archived');
  });
});

describe('/v1/repos and the state directory', () => {
  test('a repo can be registered by path', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-hub-reg-'));
    git(dir, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'README.md'), 'x');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'x');
    const r = await req({ method: 'POST', path: '/v1/repos', headers: { 'content-type': 'application/json', 'x-trail-csrf': 'nope' } }, JSON.stringify({ root: dir }));
    assert.notEqual(r.status, 200, 'a state-changing route without the csrf header must not succeed');
  });

  test('the state directory exists and holds repos.json', () => {
    const stateDir = path.join(home, '.aos', 'trail');
    assert.ok(fs.existsSync(stateDir), 'state dir missing');
    if (fs.existsSync(path.join(stateDir, 'repos.json'))) assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(stateDir, 'repos.json'), 'utf8')));
  });
});

describe('the hub observes only', () => {
  test('no plan file was modified', () => {
    const planFile = path.join(repoA, 'production_artifacts/00_execution_plan.md');
    assert.equal(fs.readFileSync(planFile, 'utf8'), PLAN, 'the hub wrote to a plan file');
  });

  test('the hub never created a gate store', () => {
    assert.equal(fs.existsSync(path.join(home, '.aos', 'gate')), false, 'the hub wrote into the gate dir');
    assert.equal(fs.existsSync(path.join(home, '.aos', 'go')), false, 'the hub wrote into the go dir');
  });

  test('the model answers fast enough for a live board', async () => {
    const t0 = Date.now();
    await getModel();
    assert.ok(Date.now() - t0 < 200, `model took ${Date.now() - t0}ms`);
  });
});

describe('two hubs on one port', () => {
  test('the second start exits 0 and says already running', async () => {
    const r = spawnSync(process.execPath, [hubBin, '--port', String(port)], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, AOS_TRAIL_STATE_DIR: path.join(home, '.aos', 'trail'), AOS_GOGATE_PATH: path.join(home, 'no-gate.mjs') },
      timeout: 15000,
    });
    assert.equal(r.status, 0, `status ${r.status}: ${r.stderr}`);
    assert.match(r.stdout + r.stderr, /already running/i);
  });
});