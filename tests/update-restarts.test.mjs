import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { restartRunningServices } = require('../lib/v5/menu.js');
const { codeStampOf: pcStamp } = require('../skills/global_config/plan-canvas/scripts/lib/plan-canvas/server.js');
const { codeStampOf: trailStamp } = await import('../skills/global_config/agenttrail/lib/code-stamp.mjs');

test('aos update restarts only running, controllable services other than hub and gateway', async () => {
  const rows = [
    { id: 'memb', up: true, control: 'launchd' },
    { id: 'synapse', up: true, control: 'systemd' },
    { id: 'plan-canvas', up: false, control: 'launchd' },
    { id: 'openwiki', up: true, control: 'observe' },
    { id: 'gateway', up: true, control: 'launchd' },
    { id: 'hub', up: true, control: 'observe' },
    { id: 'ao', up: true, control: 'launchd' },
  ];
  const calls = [];
  const out = [];
  const done = await restartRunningServices({ home: '/nowhere', write: (s) => out.push(s) }, {
    statusService: async () => rows,
    controlService: async (ctx, id, action) => { calls.push([id, action]); if (id === 'ao') throw new Error('boom'); },
  });
  assert.deepEqual(calls, [['memb', 'restart'], ['synapse', 'restart'], ['ao', 'restart']]);
  assert.deepEqual(done, ['memb', 'synapse']);
  assert.ok(out.some((l) => /warning: could not restart ao/.test(l)), 'a failed restart warns and does not throw');
});

for (const [name, stampOf] of [['plan-canvas', pcStamp], ['agenttrail', trailStamp]]) {
  test(`${name}: touching a file in a watched folder raises the code stamp`, () => {
    const dir = mkdtempSync(join(tmpdir(), `aos-stamp-${name}-`));
    const entry = join(dir, 'entry.js');
    mkdirSync(join(dir, 'lib'));
    writeFileSync(entry, 'x');
    writeFileSync(join(dir, 'lib', 'a.js'), 'x');
    const old = new Date(Date.now() - 60_000);
    utimesSync(entry, old, old);
    utimesSync(join(dir, 'lib', 'a.js'), old, old);
    const before = stampOf(entry, [join(dir, 'lib')]);
    const now = new Date();
    utimesSync(join(dir, 'lib', 'a.js'), now, now);
    assert.ok(stampOf(entry, [join(dir, 'lib')]) > before);
  });
}
