import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWatcher } from '../lib/hub/watch.mjs';

// Temp dirs are never deleted (rules forbid recursive deletes).
const tmp = mkdtempSync(join(tmpdir(), 'aos-hub-watch-'));
const home = join(tmp, 'home');
mkdirSync(home, { recursive: true });
const statusFile = join(home, '.aos', 'status.json');

const ctx = { home, run: async () => ({ ok: true, code: 0, stdout: '', stderr: '' }) };

// Fake rows: a subset of the statusService shape (id, up, loaded, control,
// observe, installed). now is a manual clock, control records its calls.
const mk = (rows, opts = {}) => {
  const now = { t: 1_000_000 };
  const restarts = [];
  const w = createWatcher({
    ctx,
    status: async () => rows,
    control: async (c, id, action) => { restarts.push({ id, action, t: now.t }); },
    now: () => now.t,
    statusFile,
    ...opts,
  });
  return { w, now, restarts };
};

const row = (id, up, extra = {}) =>
  ({ id, up, loaded: up === false ? true : null, control: 'launchd', observe: false, installed: true, ...extra });

test('down for 1 probe is not restarted; after 2 restarted exactly once', async () => {
  let up = false;
  const rows = () => [row('memb', up)];
  const { w, restarts } = mk(rows);
  await w.tick();
  assert.equal(restarts.length, 0);
  await w.tick();
  assert.equal(restarts.length, 1);
  assert.deepEqual(restarts[0], { id: 'memb', action: 'restart', t: 1_000_000 });
  // a third miss on a still-down service is NOT a second restart (brake holds)
  await w.tick();
  assert.equal(restarts.length, 1);
  up = true;
  await w.tick();
  assert.equal(restarts.length, 1);
});

test('restart brake: 3 restarts max in 10 minutes, then failed; clears when up', async () => {
  let up = false;
  const { w, now } = mk(() => [row('memb', up)]);
  for (let i = 0; i < 4; i++) {
    now.t += 11 * 60_000; // outside any window: misses accrue again each round
    await w.tick();
    await w.tick();
  }
  const st = () => w.state.get('memb');
  assert.equal(st().restarts.length, 3);
  assert.equal(st().failed, true);
  // brake holds beyond the window once failed
  now.t += 11 * 60_000;
  await w.tick(); await w.tick();
  assert.equal(st().restarts.length, 3);
  assert.equal(st().failed, true);
  up = true;
  await w.tick();
  assert.equal(st().failed, false);
  assert.equal(st().misses, 0);
});

test('observe rows and installed:false rows are never restarted', async () => {
  const { w, restarts } = mk(() => [
    row('a2a', false, { observe: true, control: 'observe' }),
    row('agenttrail', false, { observe: true, control: 'observe' }),
    row('hub', false, { observe: true, control: 'observe' }),
    row('synapse', false, { installed: false }),
  ]);
  for (let i = 0; i < 5; i++) await w.tick();
  assert.equal(restarts.length, 0);
  assert.equal(w.state.get('synapse').misses, 5); // tracked, but untouched
});

test('overlapping tick calls cause only one status call', async () => {
  let statusCalls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const w = createWatcher({
    ctx,
    status: () => { statusCalls += 1; return gate.then(() => [row('memb', true)]); },
    control: async () => {},
    now: () => 0,
    statusFile,
  });
  const a = w.tick();
  const b = w.tick();
  release();
  await Promise.all([a, b]);
  assert.equal(statusCalls, 1);
});

test('status.json is written and parses back', async () => {
  const { w } = mk(() => [row('memb', false)]);
  await w.tick(); await w.tick();
  const parsed = JSON.parse(readFileSync(statusFile, 'utf8'));
  assert.equal(typeof parsed.at, 'number');
  assert.deepEqual(parsed.services.memb, {
    up: false, misses: 0, restarts: [1_000_000], failed: false, lastError: null,
  });
});

test('a restart that throws records lastError and still counts', async () => {
  const w = createWatcher({
    ctx,
    status: async () => [row('memb', false)],
    control: async () => { throw new Error('launchd blew up'); },
    now: () => 1_000_000,
    statusFile,
  });
  await w.tick(); await w.tick();
  const st = w.state.get('memb');
  assert.equal(st.lastError, 'launchd blew up');
  assert.equal(st.restarts.length, 1);
  const parsed = JSON.parse(readFileSync(statusFile, 'utf8'));
  assert.equal(parsed.services.memb.lastError, 'launchd blew up');
});
