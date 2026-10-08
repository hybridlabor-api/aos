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
    const r = spawnSync(process.execPath, [DISPATCH, ...cliArgs], { cwd, encoding: 'utf8', timeout: 20000 });
    const out = r.stdout.slice(r.stdout.indexOf('{'));
    return { status: r.status, result: JSON.parse(out), stderr: r.stderr };
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

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
