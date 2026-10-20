// Audit port-collision: plan-canvas must never stop or restart a canvas server of
// ANOTHER project/root. Real servers on free ports, temp state dir and temp HOME.
import { describe, before, after } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = path.join(root, 'skills/global_config/plan-canvas/scripts');
const CLI = path.join(scripts, 'plan-canvas.js');
const { createSessionStore } = require(path.join(scripts, 'lib/plan-canvas/sessions.js'));
const { createPlanCanvasServer } = require(path.join(scripts, 'lib/plan-canvas/server.js'));

const WIN = process.platform === 'win32';
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on('error', reject);
});

describe('plan-canvas port ownership', () => {
  let tmp, rootA, rootB, home, stateDir, n = 0;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pc-own-')));
    rootA = path.join(tmp, 'repo-a');
    rootB = path.join(tmp, 'repo-b');
    home = path.join(tmp, 'home');
    stateDir = path.join(tmp, 'state');
    for (const d of [rootA, rootB, home]) fs.mkdirSync(d);
    process.env.AOS_TEST_SANDBOX = '1';
  });
  after(() => { delete process.env.AOS_TEST_SANDBOX; fs.rmSync(tmp, { recursive: true, force: true }); });

  const planIn = (dir) => { n += 1; const f = path.join(dir, `plan-${n}.md`); fs.writeFileSync(f, '# P\n'); return f; };

  const runCli = (cwd, port, ...args) => {
    const env = {
      PATH: WIN ? process.env.PATH : '/opt/homebrew/bin:/usr/bin:/bin', HOME: home,
      ...(WIN ? { SystemRoot: process.env.SystemRoot, USERPROFILE: home } : {}),
      AOS_PLAN_CANVAS_PORT: String(port), AOS_PLAN_CANVAS_STATE_DIR: stateDir,
    };
    const r = spawnSync(process.execPath, [CLI, ...args], { env, cwd, encoding: 'utf8', timeout: 20000 });
    try { return JSON.parse(r.stdout); } catch { return { raw: r.stdout, stderr: r.stderr, status: r.status }; }
  };

  const health = async (port) => {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
      return await r.json();
    } catch { return null; }
  };

  async function serverFor(root, version) {
    const store = createSessionStore({ stateDir });
    let handle;
    const server = createPlanCanvasServer({
      store, workspaceRoot: root, version, idleTimeoutMs: 0,
      onIdleShutdown: () => { handle.ref = false; return server.close(); },
    });
    const { port } = await server.listen(await freePort());
    handle = { server, port, ref: true };
    return handle;
  }

  test('stop refuses a server of another root and leaves it running', async () => {
    const h = await serverFor(rootA);
    try {
      const out = runCli(rootB, h.port, 'stop');
      assert.equal(out.status, 'refused', JSON.stringify(out));
      assert.equal(typeof out.ownerRoot, 'string');
      assert.match(out.hint, /serves .*repo-a|stop it from that workspace/);
      const now = await health(h.port);
      assert.equal(now.app, 'aos-plan-canvas', 'foreign server stays up');
    } finally { await h.server.close(); }
  });

  test('stop shuts down a server started from this workspace', async () => {
    const h = await serverFor(rootB);
    try {
      const out = runCli(rootB, h.port, 'stop');
      assert.equal(out.status, 'stopping', JSON.stringify(out));
    } finally { await h.server.close().catch(() => {}); }
  });

  test('open from another root names the owning server instead of a bare 403', async () => {
    const h = await serverFor(rootA);
    try {
      const out = runCli(rootB, h.port, 'open', planIn(rootB), '--no-open');
      assert.equal(out.error !== undefined, true, JSON.stringify(out));
      assert.match(out.error, /serves .*repo-a/);
      assert.match(out.error, /AOS_PLAN_CANVAS_PORT/);
      assert.ok((await health(h.port)).app, 'foreign server still runs after the failed open');
    } finally { await h.server.close(); }
  });

  test('an OLDER server of another root is reused, never restarted over the shared port', async () => {
    const h = await serverFor(rootA, '0.0.1');
    try {
      const before = await health(h.port);
      assert.equal(before.version, '0.0.1');
      const out = runCli(rootB, h.port, 'open', planIn(rootB), '--no-open');
      assert.equal(out.error !== undefined, true, JSON.stringify(out));
      const now = await health(h.port);
      assert.equal(now.version, '0.0.1', 'foreign older server must not be replaced from another root');
    } finally { await h.server.close(); }
  });
});
