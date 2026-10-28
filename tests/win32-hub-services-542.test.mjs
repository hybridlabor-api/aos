// 5.4.2 Windows: Hub status must probe both loopback families and name the Startup/ScheduledTask controls, never launchd.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { statusService, portOpen, freePort, setA2aListForTests, setGatewayStatusForTests, resetMetaCacheForTests, resetWikiCacheForTests } from '../lib/hub/services.mjs';

const home = mkdtempSync(join(tmpdir(), 'aos-hub-win32-'));
mkdirSync(join(home, 'dev'), { recursive: true });

const listenOn = (host, port) => new Promise((resolve, reject) => {
  const srv = createServer();
  srv.once('error', reject);
  srv.listen(port, host, () => resolve(srv));
});
const close = (srv) => new Promise((ok) => srv.close(ok));

const winCtx = (calls, portOverrides = {}) => ({
  root: home, home, cwd: home, platform: 'win32', uid: '0', now: () => Date.now(), log: () => {},
  portOverrides,
  // Injected spawn: records every command, never runs one. PowerShell answers an empty task state.
  serviceRunner: (cmd, args) => { calls.push({ cmd, args }); return { ok: true, code: 0, stdout: '', stderr: '' }; },
});

test.before(() => { setA2aListForTests(async () => []); setGatewayStatusForTests(async () => ({ running: false })); resetMetaCacheForTests(); resetWikiCacheForTests(); });
test.after(() => { setA2aListForTests(null); setGatewayStatusForTests(null); });

test('win32: a service listening only on ::1 is up (localhost bind)', async (t) => {
  const port = await freePort();
  let srv;
  try { srv = await listenOn('::1', port); } catch (e) { return t.skip(`no IPv6 loopback: ${e.code}`); }
  try {
    const calls = [];
    const rows = await statusService(winCtx(calls, { memb: port }));
    const memb = rows.find((r) => r.id === 'memb');
    assert.equal(memb.up, true);
    assert.equal(await portOpen(port), true);
    assert.equal(calls.some((c) => c.cmd === 'launchctl'), false, 'no launchctl on Windows');
  } finally { await close(srv); }
});

test('win32: a service on 127.0.0.1 is up, a closed port is down', async () => {
  const live = await freePort();
  const srv = await listenOn('127.0.0.1', live);
  try {
    const down = await freePort();
    const rows = await statusService(winCtx([], { memb: live, synapse: down }));
    assert.equal(rows.find((r) => r.id === 'memb').up, true);
    assert.equal(rows.find((r) => r.id === 'synapse').up, false);
  } finally { await close(srv); }
});

test('win32: control is the Startup .vbs or the ScheduledTask, never launchd', async () => {
  const rows = await statusService(winCtx([]));
  const control = Object.fromEntries(rows.map((r) => [r.id, r.control]));
  assert.equal(control.memb, 'startup');
  assert.equal(control.synapse, 'startup');
  assert.equal(control.gateway, 'startup');
  assert.equal(control.openwiki, 'scheduledTask');
  assert.equal(control.ao, 'observe');
  assert.equal(control['plan-canvas'], 'observe');
  assert.equal(rows.find((r) => r.id === 'ao').observe, true);
  assert.equal(rows.find((r) => r.id === 'memb').observe, false);
  assert.ok(Object.values(control).every((c) => c !== 'launchd'));
});

test('darwin keeps launchd control for memb', async () => {
  const rows = await statusService({ ...winCtx([]), platform: 'darwin', portOverrides: {} });
  assert.equal(rows.find((r) => r.id === 'memb').control, 'launchd');
});
