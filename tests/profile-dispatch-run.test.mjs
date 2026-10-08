import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DISPATCH = path.join(ROOT, '.claude', 'workflows', 'startcycle-dispatch.mjs');

function run(...cliArgs) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'r8-dispatch-'));
  try {
    fs.cpSync(path.join(ROOT, '.agents'), path.join(cwd, '.agents'), { recursive: true });
    // PATH holds only node, so the standalone shim never finds a real `agy` and uses its deterministic stubs.
    const r = spawnSync(process.execPath, [DISPATCH, ...cliArgs], {
      cwd,
      encoding: 'utf8',
      timeout: 20000,
      env: { PATH: path.dirname(process.execPath), HOME: cwd },
    });
    const out = r.stdout.slice(r.stdout.indexOf('{'));
    return { status: r.status, result: JSON.parse(out), stderr: r.stderr };
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test('a valid profile passes the load stage (no profile-related escalation)', () => {
  const { result } = run('--profile=kicad', 'add a status LED board');
  // Docker 2026-10-08: the stub run gets through plan, build and review, then ends at the archify
  // boundary check (the container has no archify), so it cannot reach ready_to_ship here.
  assert.doesNotMatch(String(result.reason ?? ''), /profile/i);
});

test('profile flag with a path-traversal name escalates before any build', () => {
  const { result } = run('--profile=../x', 'add a thing');
  assert.equal(result.phase, 'escalated');
  assert.match(result.reason, /not a lowercase kebab-case profile name/);
});

test('unknown profile escalates and never falls back to the default pipeline', () => {
  const { result } = run('--profile=nope', 'add a thing');
  assert.equal(result.phase, 'escalated');
  assert.match(result.reason, /could not be loaded: nope/);
});

test('empty --profile= value escalates', () => {
  const { result } = run('--profile=', 'add a thing');
  assert.equal(result.phase, 'escalated');
  assert.match(result.reason, /--profile was given with an empty value/);
});

test('bare --profile without a value escalates', () => {
  const { result } = run('--profile', 'kicad', 'add a thing');
  assert.equal(result.phase, 'escalated');
  assert.match(result.reason, /--profile needs a value/);
});
