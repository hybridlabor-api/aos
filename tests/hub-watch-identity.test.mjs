import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWatcher } from '../lib/hub/watch.mjs';

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
