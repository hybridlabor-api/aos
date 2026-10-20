// WP-ROUTING: the SessionStart hint hook must emit exactly one JSON envelope
// with the additional context, honour AOS_SESSION_HINT=off, stay silent for
// delegated workers (AOS_DELEGATE_DEPTH > 0), and exit 0 on any input.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { memoryTools } from '../.claude/hooks/aos-session-hint.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = join(REPO, '.claude', 'hooks', 'aos-session-hint.mjs');

// Hermetic: throwaway HOME and an empty PATH dir; the real ~/.aos and ~/.agents are never read.
const HOME = mkdtempSync(join(tmpdir(), 'session-hint-'));
const BIN = join(HOME, 'bin');
mkdirSync(BIN);
const envPatched = (env) => ({ PATH: BIN, HOME, USERPROFILE: HOME, ...env });
const run = (env, stdin = '{"session_id":"test"}') =>
  spawnSync(process.execPath, [HOOK], { input: stdin, encoding: 'utf8', env });

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
  // line 4 is the optional "pull more" line (the fixed dirs the hook also probes may hold tools on a dev machine)
  assert.ok(lines.length === 3 || (lines.length === 4 && /Pull it on demand/.test(lines[3])), `${c.label}: hint must be 3 lines plus the optional pull line`);
  assert.match(lines[0], /aos-plan-canvas/);
  assert.match(lines[1], /agenttrail/);
  assert.match(lines[2], /AGENTS\.md/);
}

// Pull-hint tool list per fixture: installed / disabled / absent.
const fixture = (present, disabled = []) => {
  const home = mkdtempSync(join(tmpdir(), 'session-hint-fx-'));
  mkdirSync(join(home, '.aos'), { recursive: true });
  writeFileSync(join(home, '.aos', 'v5-settings.json'), JSON.stringify({ disabled }));
  const have = new Set(present.map((p) => p.replace('~', home)));
  const tools = memoryTools({ home, env: { PATH: '/fx/bin' }, platform: 'linux', exists: (f) => have.has(f) });
  rmSync(home, { recursive: true, force: true });
  return tools;
};
const ALL = ['~/.agents/memB', '/fx/bin/deja', '/fx/bin/openwiki', '/fx/bin/codebase-memory-mcp'];
assert.deepEqual(fixture(ALL), ['memb search', 'deja search', 'openwiki_search', 'codebase_memory_mcp'], 'all installed');
assert.deepEqual(fixture(ALL, ['memb', 'deja', 'openwiki']), ['codebase_memory_mcp'], 'disabled tools are dropped');
assert.deepEqual(fixture([]), [], 'nothing installed');
assert.deepEqual(fixture(['~/.MemBDB/memb.db']), [], 'a bare memb.db is not a memB install');
assert.deepEqual(fixture(['~/.agents/memB']), ['memb search'], 'memB module alone');

rmSync(HOME, { recursive: true, force: true });
console.log('✓ session-hint.test.js passed');
