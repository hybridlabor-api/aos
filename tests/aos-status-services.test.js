'use strict';
// 26-W4: the `aos status` Services block (formatServicesBlock) and the
// `aos restart` no-TTY/no---confirm usage exit.
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { formatServicesBlock } = require('../lib/v5/menu');

const NOW = 1_800_000_000_000;
const MIN = 60_000;

test('missing file (null) prints the supervisor-not-running line', () => {
  const lines = formatServicesBlock(null, NOW);
  assert.deepStrictEqual(lines, ['Supervisor not running (no ~/.aos/status.json)']);
});

test('up service shows up with no extras', () => {
  const lines = formatServicesBlock({ at: NOW - 10_000, services: { memb: { up: true, misses: 0, restarts: [], failed: false, lastError: null } } }, NOW);
  assert.deepStrictEqual(lines, ['Services:', '  up     memb']);
});

test('down service shows its lastError', () => {
  const lines = formatServicesBlock({ at: NOW - 10_000, services: { memb: { up: false, misses: 1, restarts: [], failed: false, lastError: 'launchctl bootstrap failed: no plist' } } }, NOW);
  assert.deepStrictEqual(lines, ['Services:', '  down   memb · launchctl bootstrap failed: no plist']);
});

test('failed service shows failed and counts only restarts inside the 10 min window', () => {
  const lines = formatServicesBlock(
    { at: NOW - 10_000, services: { memb: { up: false, misses: 0, restarts: [NOW - 5 * MIN, NOW - 30 * MIN], failed: true, lastError: null } } },
    NOW,
  );
  assert.deepStrictEqual(lines, ['Services:', '  failed memb · 1 restart (10 min)']);
});

test('stale at (older than 2 minutes) adds the stale line', () => {
  const lines = formatServicesBlock({ at: NOW - 3 * MIN, services: {} }, NOW);
  assert.strictEqual(lines[0], 'Services:');
  assert.match(lines[1], /stale/);
  assert.strictEqual(lines[2], '  (no services tracked)');
});

test('aos restart without --confirm and without a TTY exits 2', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'aos-status-test-'));
  try {
    const r = spawnSync(process.execPath, ['installer.js', 'restart', 'memb'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: 'utf8',
    });
    assert.strictEqual(r.status, 2);
    assert.match(String(r.stdout) + String(r.stderr), /confirm|usage|typed/i);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
