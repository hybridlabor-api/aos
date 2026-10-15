// WP-ROUTING: the SessionStart hint hook must emit exactly one JSON envelope
// with the additional context, honour AOS_SESSION_HINT=off, stay silent for
// delegated workers (AOS_DELEGATE_DEPTH > 0), and exit 0 on any input.
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = join(REPO, '.claude', 'hooks', 'aos-session-hint.mjs');

const run = (env, stdin = '{"session_id":"test"}') =>
  spawnSync(process.execPath, [HOOK], {
    input: stdin,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
  });

function envPatched(env) {
  return { PATH: process.env.PATH, ...env };
}

const cases = [
  {
    label: 'normal session: hint emitted as SessionStart additionalContext',
    env: {},
    expectSilent: false,
  },
  {
    label: 'AOS_SESSION_HINT=off: nothing printed',
    env: { AOS_SESSION_HINT: 'off' },
    expectSilent: true,
  },
  {
    label: 'AOS_SESSION_START_CONTEXT=off: nothing printed',
    env: { AOS_SESSION_START_CONTEXT: 'off' },
    expectSilent: true,
  },
  {
    label: 'AOS_DELEGATE_DEPTH>0: delegated worker stays silent',
    env: { AOS_DELEGATE_DEPTH: '1' },
    expectSilent: true,
  },
  {
    label: 'garbage stdin: still exit 0, hint still emitted',
    env: {},
    stdin: 'not json at all',
    expectSilent: false,
  },
];

for (const c of cases) {
  const r = run(envPatched(c.env), c.stdin);
  assert.equal(r.status, 0, `${c.label}: exit code must be 0 (stderr: ${r.stderr.trim()})`);

  if (c.expectSilent) {
    assert.equal(r.stdout.trim(), '', `${c.label}: stdout must be empty`);
    continue;
  }

  const parsed = JSON.parse(r.stdout.trim());
  assert.deepEqual(
    Object.keys(parsed),
    ['hookSpecificOutput'],
    `${c.label}: top level must hold only hookSpecificOutput`,
  );
  const out = parsed.hookSpecificOutput;
  assert.equal(out.hookEventName, 'SessionStart', `${c.label}: hookEventName must be SessionStart`);
  assert.ok(
    typeof out.additionalContext === 'string' && out.additionalContext.length > 0,
    `${c.label}: additionalContext must be a non-empty string`,
  );
  const lines = out.additionalContext.split('\n');
  assert.equal(lines.length, 3, `${c.label}: hint must be exactly 3 lines`);
  assert.match(lines[0], /aos-plan-canvas/);
  assert.match(lines[1], /agenttrail/);
  assert.match(lines[2], /AGENTS\.md/);
}

console.log('✓ session-hint.test.js passed');
