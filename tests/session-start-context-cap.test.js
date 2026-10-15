'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HINT_HOOK = path.join(ROOT, '.claude', 'hooks', 'aos-session-hint.mjs');
const MEMB_HOOK = path.join(ROOT, '.claude', 'hooks', 'memb-inject.mjs');

test('aos-session-hint honors AOS_SESSION_START_CONTEXT=off and caps context', () => {
  // Normal run
  const res1 = spawnSync(process.execPath, [HINT_HOOK], {
    input: JSON.stringify({ hook_event_name: 'SessionStart' }),
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });
  assert.strictEqual(res1.status, 0);
  assert.ok(res1.stdout.trim().length > 0);
  const out1 = JSON.parse(res1.stdout.trim());
  assert.strictEqual(out1.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.ok(out1.hookSpecificOutput.additionalContext.length <= 2000);

  // AOS_SESSION_START_CONTEXT=off
  const res2 = spawnSync(process.execPath, [HINT_HOOK], {
    input: JSON.stringify({ hook_event_name: 'SessionStart' }),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, AOS_SESSION_START_CONTEXT: 'off' },
  });
  assert.strictEqual(res2.status, 0);
  assert.strictEqual(res2.stdout.trim(), '');

  // AOS_SESSION_HINT=off
  const res3 = spawnSync(process.execPath, [HINT_HOOK], {
    input: JSON.stringify({ hook_event_name: 'SessionStart' }),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, AOS_SESSION_HINT: 'off' },
  });
  assert.strictEqual(res3.status, 0);
  assert.strictEqual(res3.stdout.trim(), '');
});

test('memb-inject honors AOS_SESSION_START_CONTEXT=off on SessionStart', () => {
  // SessionStart with AOS_SESSION_START_CONTEXT=off must exit 0 and emit nothing
  const res = spawnSync(process.execPath, [MEMB_HOOK], {
    input: JSON.stringify({ hook_event_name: 'SessionStart' }),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, AOS_SESSION_START_CONTEXT: 'off' },
  });
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout.trim(), '');
});
