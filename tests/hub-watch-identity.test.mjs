import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWatcher } from '../lib/hub/watch.mjs';
import { defaultIdentify } from '../lib/hub/identity.mjs';
import { createServer } from 'node:http';

const serveOn = (handler) => new Promise((resolve) => {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
});

test('hub identity: only a JSON body with service aos-hub counts as our hub', async () => {
  const ours = await serveOn((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true,"service":"aos-hub"}'); });
  const bare = await serveOn((req, res) => { res.writeHead(200); res.end('ok'); });
  const other = await serveOn((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"service":"someone-else"}'); });
  try {
    assert.equal(await defaultIdentify('hub', 800, ours.port), true);
    assert.equal(await defaultIdentify('hub', 800, bare.port), false, 'a bare 200 from a foreign process is not the hub');
    assert.equal(await defaultIdentify('hub', 800, other.port), false);
  } finally {
    await Promise.all([ours, bare, other].map((s) => new Promise((r) => s.server.close(r))));
  }
});

test('hub identity: nothing listening is not our hub', async () => {
  const s = await serveOn((req, res) => res.end());
  const port = s.port;
  await new Promise((r) => s.server.close(r));
  assert.equal(await defaultIdentify('hub', 800, port), false);
});

test('a hub row on a foreign-held port is flagged foreign by the watcher and never restarted', async () => {
  const restarts = [];
  const w = createWatcher({
    ctx: { home, run: async () => ({ ok: true, code: 0, stdout: '', stderr: '' }) },
    status: async () => [{ id: 'hub', up: true, loaded: true, control: 'launchd', observe: false, installed: true, port: 7900 }],
    control: async (c, id, action) => { restarts.push({ id, action }); },
    now: () => 1_000_000,
    statusFile,
    identify: async (id, t, port) => { assert.equal(port, 7900); return false; },
  });
  for (let i = 0; i < 3; i++) await w.tick();
  assert.equal(restarts.length, 0);
  assert.equal(w.state.get('hub').foreign, true);
});

// Temp dirs are never deleted (rules forbid recursive deletes).
const tmp = mkdtempSync(join(tmpdir(), 'aos-hub-identity-'));
const home = join(tmp, 'home');
mkdirSync(home, { recursive: true });
const statusFile = join(home, '.aos', 'status.json');
const ctx = { home, run: async () => ({ ok: true, code: 0, stdout: '', stderr: '' }) };

test('a port that answers but fails the identity check is flagged foreign and never restarted', async () => {
  const restarts = [];
  const w = createWatcher({
    ctx,
    status: async () => [{ id: 'plan-canvas', up: true, loaded: true, control: 'launchd', observe: false, installed: true }],
    control: async (c, id, action) => { restarts.push({ id, action }); },
    now: () => 1_000_000,
    statusFile,
    identify: async () => false,
  });
  for (let i = 0; i < 3; i++) await w.tick();
  assert.equal(restarts.length, 0);
  const e = w.state.get('plan-canvas');
  assert.equal(e.foreign, true);
  assert.match(e.lastError, /foreign process/);
  const written = JSON.parse(readFileSync(statusFile, 'utf8'));
  assert.equal(written.services['plan-canvas'].foreign, true);
});

test('a verified service clears the foreign flag; null (not verifiable) is not foreign', async () => {
  let answer = false;
  const w = createWatcher({
    ctx,
    status: async () => [{ id: 'gateway', up: true, loaded: true, control: 'launchd', observe: false, installed: true }],
    control: async () => {},
    now: () => 1_000_000,
    statusFile,
    identify: async () => answer,
  });
  await w.tick();
  assert.equal(w.state.get('gateway').foreign, true);
  answer = true;
  await w.tick();
  assert.equal(w.state.get('gateway').foreign, false);
  assert.equal(w.state.get('gateway').lastError, null);
  w.state.get('gateway').foreign = false;
  const w2 = createWatcher({
    ctx,
    status: async () => [{ id: 'memb', up: true, loaded: true, control: 'launchd', observe: false, installed: true }],
    control: async () => {},
    now: () => 1_000_000,
    statusFile,
    identify: async () => null,
  });
  await w2.tick();
  assert.equal(w2.state.get('memb').foreign, false);
});
