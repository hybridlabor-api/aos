import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = '../skills/global_config/plan-canvas/scripts/lib/';
const { planComponents, ensureTrailOnApprove } = require(`${lib}plan-canvas/trail-on-approve.js`);
const { createSessionStore } = require(`${lib}plan-canvas/sessions.js`);
const { createPlanCanvasServer } = require(`${lib}plan-canvas/server.js`);

const PLAN = '# Plan\n\n## Backend {#backend}\n\nwork\n\n## UI {#ui}\nneeds: [backend]\n';
let tmp;
let stateDir;
const mkdir = (n) => fs.mkdirSync(path.join(tmp, n), { recursive: true }) && path.join(tmp, n);

function fakeSpawn() {
  const calls = [];
  const impl = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { on() {}, once() {}, unref() {}, kill() {} };
  };
  return { calls, impl };
}
const noGit = () => ({ status: 1, stdout: '' });
const baseEnv = () => ({ AOS_PLAN_CANVAS_STATE_DIR: stateDir, AOS_PLAN_CANVAS_TRAIL_BIN: '/fake/aos-trail' });

describe('trail-on-approve', () => {
  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-trail-'));
    stateDir = path.join(tmp, 'state');
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test('planComponents reads {#id} markers and ignores other files', () => {
    const d = mkdir('comp');
    fs.writeFileSync(path.join(d, 'plan.md'), PLAN);
    fs.writeFileSync(path.join(d, 'plain.md'), '# Plan\n\n## Backend\n');
    fs.writeFileSync(path.join(d, 'x.html'), '<h1>x</h1>');
    assert.deepEqual(planComponents(path.join(d, 'plan.md')), ['backend', 'ui']);
    assert.deepEqual(planComponents(path.join(d, 'plain.md')), []);
    assert.deepEqual(planComponents(path.join(d, 'x.html')), []);
    assert.deepEqual(planComponents(path.join(d, 'missing.md')), []);
  });

  test('md plan with components spawns ensure with the contract argv', () => {
    const d = mkdir('md');
    const file = path.join(d, 'plan.md');
    fs.writeFileSync(file, PLAN);
    const s = fakeSpawn();
    ensureTrailOnApprove({ file, key: 'abc123abc123', spawnImpl: s.impl, spawnSyncImpl: noGit, env: baseEnv() });
    assert.equal(s.calls.length, 1);
    const { cmd, args, opts } = s.calls[0];
    assert.equal(cmd, '/fake/aos-trail');
    assert.deepEqual(args, ['--ensure', '--cwd', d, '--plan', file, '--session', 'plan-canvas-abc123abc123', '--json']);
    assert.equal(opts.shell, false);
    assert.equal(opts.detached, true);
  });

  test('git toplevel becomes the repo path', () => {
    const d = mkdir('git');
    const file = path.join(d, 'plan.md');
    fs.writeFileSync(file, PLAN);
    const s = fakeSpawn();
    ensureTrailOnApprove({ file, key: 'k', spawnImpl: s.impl, spawnSyncImpl: () => ({ status: 0, stdout: '/repo/top\n' }), env: baseEnv() });
    assert.equal(s.calls[0].args[2], '/repo/top');
  });

  test('plan without markers, off switch and non-plan files spawn nothing', () => {
    const d = mkdir('none');
    const plain = path.join(d, 'plain.md');
    const full = path.join(d, 'full.md');
    fs.writeFileSync(plain, '# no components\n');
    fs.writeFileSync(full, PLAN);
    const s = fakeSpawn();
    ensureTrailOnApprove({ file: plain, key: 'k', spawnImpl: s.impl, spawnSyncImpl: noGit, env: baseEnv() });
    ensureTrailOnApprove({ file: full, key: 'k', spawnImpl: s.impl, spawnSyncImpl: noGit, env: { ...baseEnv(), AOS_PLAN_CANVAS_TRAIL: 'off' } });
    ensureTrailOnApprove({ file: path.join(d, 'a.html'), key: 'k', spawnImpl: s.impl, spawnSyncImpl: noGit, env: baseEnv() });
    assert.equal(s.calls.length, 0);
  });

  test('spawn failure never throws and is logged', () => {
    const d = mkdir('fail');
    const file = path.join(d, 'plan.md');
    fs.writeFileSync(file, PLAN);
    const lines = [];
    assert.doesNotThrow(() => ensureTrailOnApprove({
      file, key: 'k', log: (l) => lines.push(l), spawnSyncImpl: noGit, env: baseEnv(),
      spawnImpl: () => { throw new Error('ENOENT boom'); }
    }));
    assert.match(lines.join('\n'), /\[plan-canvas\] trail: ENOENT boom/);
  });

  test('builder folder writes 00_execution_plan.md only when missing', () => {
    const repo = mkdir('builder');
    const dir = path.join(repo, 'plans', 'p1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'plan.mdx'), '# Demo\n\n## Backend {#backend}\n\n- nothing\n');
    const file = path.join(dir, 'plan.builder.html');
    fs.writeFileSync(file, '<html></html>');
    const target = path.join(repo, 'production_artifacts', '00_execution_plan.md');
    const rootOf = () => ({ status: 0, stdout: `${repo}\n` });

    assert.deepEqual(planComponents(file), ['backend']);
    const s = fakeSpawn();
    ensureTrailOnApprove({ file, key: 'k', spawnImpl: s.impl, spawnSyncImpl: rootOf, env: baseEnv() });
    assert.ok(fs.existsSync(target));
    assert.equal(s.calls[0].args[s.calls[0].args.indexOf('--plan') + 1], target);

    fs.writeFileSync(target, 'custom\n');
    ensureTrailOnApprove({ file, key: 'k', spawnImpl: s.impl, spawnSyncImpl: rootOf, env: baseEnv() });
    assert.equal(fs.readFileSync(target, 'utf8'), 'custom\n');
    assert.equal(s.calls.length, 2);
  });
});

describe('approve over HTTP', () => {
  let server;
  let base;
  let store;
  let file;
  let saved;
  let argvLog;

  before(async () => {
    saved = { bin: process.env.AOS_PLAN_CANVAS_TRAIL_BIN, state: process.env.AOS_PLAN_CANVAS_STATE_DIR };
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-trail-http-'));
    stateDir = path.join(tmp, 'state');
    argvLog = path.join(tmp, 'argv.log');
    const bin = path.join(tmp, 'fake-trail.sh');
    fs.writeFileSync(bin, `#!/bin/sh\necho "$@" >> "${argvLog}"\n`, { mode: 0o755 });
    process.env.AOS_PLAN_CANVAS_TRAIL_BIN = bin;
    process.env.AOS_PLAN_CANVAS_STATE_DIR = stateDir;
    file = path.join(tmp, 'plan.md');
    fs.writeFileSync(file, PLAN);
    store = createSessionStore({ stateDir });
    server = createPlanCanvasServer({ store, workspaceRoot: tmp, idleTimeoutMs: 0 });
    base = `http://127.0.0.1:${(await server.listen(0)).port}`;
  });

  after(async () => {
    if (server) await server.close().catch(() => {});
    for (const [k, v] of [['AOS_PLAN_CANVAS_TRAIL_BIN', saved.bin], ['AOS_PLAN_CANVAS_STATE_DIR', saved.state]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const post = async (p, body) => {
    const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const waitFor = async (fn) => {
    for (let i = 0; i < 50; i++) { if (fn()) return true; await new Promise((r) => setTimeout(r, 40)); }
    return false;
  };

  test('approve queues the verdict and starts ensure; chat does not', async () => {
    const opened = await post('/api/sessions', { file });
    const key = opened.body.key || opened.body.session?.key;
    assert.ok(key);
    const url = `/api/session/${key}/feedback`;

    const chat = await post(url, { items: [{ kind: 'chat', text: 'hello' }] });
    assert.equal(chat.status, 200);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(fs.existsSync(argvLog), false);

    const approve = await post(url, { items: [{ kind: 'verdict', verdict: 'approve' }] });
    assert.equal(approve.status, 200);
    assert.equal(approve.body.status, 'queued');
    assert.ok(await waitFor(() => fs.existsSync(argvLog) && fs.readFileSync(argvLog, 'utf8').includes('--ensure')));
    const line = fs.readFileSync(argvLog, 'utf8');
    assert.match(line, new RegExp(`--session plan-canvas-${key} --json`));
    assert.ok(line.includes(`--plan ${fs.realpathSync(file)}`) || line.includes(`--plan ${file}`));
  });

  test('a failing binary never breaks the approve', async () => {
    process.env.AOS_PLAN_CANVAS_TRAIL_BIN = path.join(tmp, 'does-not-exist');
    const file2 = path.join(tmp, 'plan2.md');
    fs.writeFileSync(file2, PLAN);
    const opened = await post('/api/sessions', { file: file2 });
    const key = opened.body.key || opened.body.session?.key;
    const approve = await post(`/api/session/${key}/feedback`, { items: [{ kind: 'verdict', verdict: 'approve' }] });
    assert.equal(approve.status, 200);
    assert.equal(approve.body.pending, 1);
  });
});
