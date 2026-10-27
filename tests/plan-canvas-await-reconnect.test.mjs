import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = '../skills/global_config/plan-canvas/scripts/lib/plan-canvas';
const { createSessionStore } = require(`${lib}/sessions.js`);
const { createPlanCanvasServer } = require(`${lib}/server.js`);
const CLI = path.resolve('skills/global_config/plan-canvas/scripts/plan-canvas.js');

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Same drop as watchCodeStamp (server.js): the code changed on disk, so the server drops every socket and restarts.
test('await survives a server restart that resets the held long-poll (ECONNRESET)', async () => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pc-reconnect-')));
  const stateDir = path.join(ws, '.state');
  const plan = path.join(ws, 'plan.md');
  fs.writeFileSync(plan, '# Plan\n');
  const port = await freePort();
  const boot = async () => {
    const server = createPlanCanvasServer({ store: createSessionStore({ stateDir }), workspaceRoot: ws, idleTimeoutMs: 0 });
    await server.listen(port);
    return server;
  };
  let server = await boot();
  const base = `http://127.0.0.1:${port}`;
  const opened = await (await fetch(`${base}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: plan }) })).json();
  const cli = spawn(process.execPath, [CLI, 'await', plan], { cwd: ws, env: { ...process.env, AOS_PLAN_CANVAS_PORT: String(port), AOS_PLAN_CANVAS_STATE_DIR: stateDir, AOS_NO_OPEN: '1' } });
  let stdout = '';
  cli.stdout.on('data', (d) => { stdout += d; });
  cli.stderr.on('data', (d) => { stdout += d; });
  const exited = new Promise((resolve) => cli.once('exit', resolve));
  try {
    await sleep(700);
    server.server.closeAllConnections();
    await new Promise((r) => server.server.close(r));
    await sleep(300);
    server = await boot();
    await sleep(300);
    await fetch(`${base}/api/session/${opened.key}/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [{ kind: 'verdict', verdict: 'approve' }] }) });
    await Promise.race([exited, sleep(10000)]);
    const out = JSON.parse(stdout.slice(stdout.indexOf('{')));
    assert.equal(out.error, undefined, out.error);
    assert.equal(out.status, 'feedback');
  } finally {
    cli.kill();
    server.server.closeAllConnections();
    await server.close().catch(() => {});
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
