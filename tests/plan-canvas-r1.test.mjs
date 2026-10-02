// Repair round R1 regressions: real servers on free ports, temp state dir and temp HOME,
// never the live canvas or agenttrail ports.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = path.join(root, 'skills/global_config/plan-canvas/scripts');
const lib = path.join(scripts, 'lib/plan-canvas');
const CLI = path.join(scripts, 'plan-canvas.js');
const { createSessionStore } = require(path.join(lib, 'sessions.js'));
const { createPlanCanvasServer } = require(path.join(lib, 'server.js'));
const { ensureTrailOnApprove } = require(path.join(lib, 'trail-on-approve.js'));
const { isOlderVersion } = require(CLI);

const APP = 'http://localhost:5173';
const PLAN = '# Plan\n\n## Backend {#backend}\n\nwork\n';
let tmp;
let workspace;
let home;
let stateDir;
let fakeTrail;
let n = 0;

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on('error', reject);
});

const cliEnv = port => ({
  PATH: '/opt/homebrew/bin:/usr/bin:/bin', HOME: home, AOS_PLAN_CANVAS_PORT: String(port),
  AOS_PLAN_CANVAS_STATE_DIR: stateDir, AOS_PLAN_CANVAS_TRAIL_BIN: fakeTrail
});

const runCli = (port, ...args) => new Promise(resolve => {
  const child = spawn(process.execPath, [CLI, ...args], { env: cliEnv(port), cwd: workspace });
  let out = '';
  child.stdout.on('data', c => { out += c; });
  child.on('close', () => { try { resolve(JSON.parse(out)); } catch { resolve({ raw: out }); } });
});

function call(port, method, urlPath, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const h = { host: `127.0.0.1:${port}`, ...headers };
    if (payload !== null) { h['content-length'] = Buffer.byteLength(payload); h['content-type'] = 'application/json'; }
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: h, agent: false }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function planFile(text = PLAN) {
  n += 1;
  const file = path.join(workspace, `plan-${n}.md`);
  fs.writeFileSync(file, text);
  return file;
}

async function inProcess(version, extra = {}) {
  const store = createSessionStore({ stateDir });
  const server = createPlanCanvasServer({ store, workspaceRoot: workspace, idleTimeoutMs: 0, version, ...extra });
  const { port } = await server.listen(await freePort());
  return { store, server, port };
}

const health = async port => (await call(port, 'GET', '/health')).json;

describe('plan-canvas R1 repairs', () => {
  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pc-r1-')));
    workspace = path.join(tmp, 'ws');
    home = path.join(tmp, 'home');
    stateDir = path.join(tmp, 'state');
    fs.mkdirSync(workspace);
    fs.mkdirSync(home);
    fakeTrail = path.join(tmp, 'fake-trail.sh');
    fs.writeFileSync(fakeTrail, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    process.env.AOS_PLAN_CANVAS_STATE_DIR = stateDir;
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test('resume refuses a session whose file is outside the workspace root', async () => {
    const { store, server, port } = await inProcess('9.9.9');
    try {
      const outside = path.join(tmp, 'outside.md');
      fs.writeFileSync(outside, '# out\n');
      const { session } = store.open(outside);
      const res = await call(port, 'POST', `/api/session/${session.key}/resume`, { body: {} });
      assert.equal(res.status, 403);
      const inside = store.open(planFile()).session;
      const ok = await call(port, 'POST', `/api/session/${inside.key}/resume`, { body: {} });
      assert.equal(ok.status, 303);
    } finally {
      await server.close();
    }
  });

  test('L3 a malformed request target gets 400 and the server survives', async () => {
    const port = await freePort();
    const child = spawn(process.execPath, [CLI, 'server', '--port', String(port)], { env: cliEnv(port), cwd: workspace, stdio: 'ignore' });
    try {
      for (let i = 0; i < 50 && !(await health(port).catch(() => null)); i++) await new Promise(r => setTimeout(r, 100));
      const status = await new Promise(resolve => {
        const socket = net.connect(port, '127.0.0.1', () => socket.write(`GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`));
        let data = '';
        socket.on('data', c => { data += c; });
        socket.on('close', () => resolve(/^HTTP\/1\.1 (\d+)/.exec(data)?.[1] || 'none'));
        socket.on('error', () => resolve('error'));
      });
      assert.equal(status, '400');
      assert.equal((await health(port)).app, 'aos-plan-canvas', 'server still answers');
    } finally {
      child.kill();
    }
  });

  test('M3 app annotations show as "dev app" in the chat log; L1 chat is capped at 500', async () => {
    const { store, server, port } = await inProcess('9.9.9');
    try {
      const { session } = store.open(planFile());
      const tok = await call(port, 'POST', `/api/annotate/${session.key}/token`, { body: { origin: APP } });
      const res = await call(port, 'POST', `/api/annotate/${session.key}`, {
        headers: { origin: APP, 'x-aos-annotate-token': tok.json.token },
        body: { items: [{ kind: 'annotation', text: 'from the page', anchor: { selector: 'body', tag: 'body', snippet: 'x' } }] }
      });
      assert.equal(res.status, 200, res.text);
      assert.equal(store.get(session.key).chat.at(-1).source, 'app');
      store.queueFeedback(session.key, [{ kind: 'chat', text: 'from the human' }]);
      assert.equal(store.get(session.key).chat.at(-1).source, undefined);
      assert.match((await call(port, 'GET', '/client.js')).text, /'dev app'/);
      assert.match((await call(port, 'GET', '/canvas.css')).text, /\.msg\.src-app/);
      for (let i = 0; i < 620; i++) store.addAgentReply(session.key, `r${i}`);
      store.queueFeedback(session.key, Array.from({ length: 30 }, (_, i) => ({ kind: 'chat', text: `c${i}` })));
      const chat = store.get(session.key).chat;
      assert.equal(chat.length, 500);
      assert.equal(chat.at(-1).text, 'c29');
    } finally {
      await server.close();
    }
  });

  describe('trail outcome', () => {
    const fake = (override = {}) => ({ on() {}, once() {}, unref() {}, kill() {}, ...override });

    test('ensureTrailOnApprove reports every outcome and never throws', () => {
      const env = { AOS_PLAN_CANVAS_STATE_DIR: stateDir, AOS_PLAN_CANVAS_TRAIL_BIN: '/fake/trail' };
      const noGit = () => ({ status: 1, stdout: '' });
      const run = (file, over = {}) => {
        const seen = [];
        ensureTrailOnApprove({ file, key: 'abc123abc123', spawnSyncImpl: noGit, env, onOutcome: o => seen.push(o), spawnImpl: () => fake(), ...over });
        return seen;
      };
      assert.deepEqual(run(planFile(), { env: { ...env, AOS_PLAN_CANVAS_TRAIL: 'off' } }), ['off']);
      assert.deepEqual(run(planFile('# nothing here\n')), ['skipped:no-markers']);
      assert.deepEqual(run(planFile()), ['requested']);
      assert.deepEqual(run(planFile(), { spawnImpl: () => { throw new Error('boom'); } }), ['error:exception']);
      let onError;
      const seen = run(planFile(), { spawnImpl: () => fake({ on: (ev, fn) => { if (ev === 'error') onError = fn; } }) });
      onError(new Error('ENOENT'));
      assert.deepEqual(seen, ['requested', 'error:spawn']);
    });

    for (const [label, trailEnv, expected] of [['started', undefined, 'requested'], ['off', 'off', 'off']]) {
      test(`await build next_step reports the real outcome (${label})`, async () => {
        const prev = process.env.AOS_PLAN_CANVAS_TRAIL_BIN;
        const prevTrail = process.env.AOS_PLAN_CANVAS_TRAIL;
        process.env.AOS_PLAN_CANVAS_TRAIL_BIN = fakeTrail;
        if (trailEnv) process.env.AOS_PLAN_CANVAS_TRAIL = trailEnv; else delete process.env.AOS_PLAN_CANVAS_TRAIL;
        const { store, server, port } = await inProcess('9.9.9');
        try {
          const file = planFile();
          const { session } = store.open(file);
          const res = await call(port, 'POST', `/api/session/${session.key}/feedback`, {
            headers: { origin: `http://127.0.0.1:${port}` },
            body: { items: [{ kind: 'verdict', verdict: 'approve' }] }
          });
          assert.equal(res.status, 200, res.text);
          const out = await runCli(port, 'await', file, '--timeout-ms', '500');
          assert.equal(out.status, 'feedback', JSON.stringify(out));
          assert.match(out.next_step, new RegExp(`the canvas tried to start agenttrail; outcome: ${expected}`));
          assert.ok(!/agenttrail was started/.test(out.next_step));
        } finally {
          await server.close();
          if (prev === undefined) delete process.env.AOS_PLAN_CANVAS_TRAIL_BIN; else process.env.AOS_PLAN_CANVAS_TRAIL_BIN = prev;
          if (prevTrail === undefined) delete process.env.AOS_PLAN_CANVAS_TRAIL; else process.env.AOS_PLAN_CANVAS_TRAIL = prevTrail;
        }
      });
    }
  });

  describe('ensureServer version policy', () => {
    test('isOlderVersion compares semver numerically', () => {
      assert.equal(isOlderVersion('1.9.0', '1.10.0'), true);
      assert.equal(isOlderVersion('1.10.0', '1.9.0'), false);
      assert.equal(isOlderVersion('1.1.0', '1.1.0'), false);
      assert.equal(isOlderVersion('2.0.0', '1.99.99'), false);
      assert.equal(isOlderVersion('garbage', '1.1.0'), true);
    });

    test('a NEWER running server is kept; an OLDER one is replaced', async () => {
      let handle;
      const start = async version => {
        const refs = {};
        refs.value = await inProcess(version, { onIdleShutdown: () => refs.value.server.close().catch(() => {}) });
        return refs.value;
      };
      handle = await start('99.0.0');
      const file = planFile();
      try {
        const kept = await runCli(handle.port, 'open', file, '--no-open');
        assert.equal(kept.status, 'open', JSON.stringify(kept));
        assert.equal((await health(handle.port)).version, '99.0.0', 'newer server must not be replaced');
        await handle.server.close();

        handle = await start('0.0.1');
        const replaced = await runCli(handle.port, 'open', file, '--no-open');
        assert.equal(replaced.status, 'open', JSON.stringify(replaced));
        const now = await health(handle.port);
        assert.notEqual(now.version, '0.0.1', 'older server must be replaced');
      } finally {
        await runCli(handle.port, 'stop');
        await handle.server.close().catch(() => {});
      }
    });
  });
});
