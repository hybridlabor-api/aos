import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const cli = join(root, 'bin', 'aos-store.mjs');

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test('store index is compact and pinned', () => {
  const index = JSON.parse(readFileSync(join(root, 'lib', 'ecc-store-index.json'), 'utf8'));
  assert.match(index.pinned_commit, /^[a-f0-9]{40}$/);
  assert.ok(statSync(join(root, 'lib', 'ecc-store-index.json')).size < 100 * 1024);
  assert.ok(Object.keys(index.skills).length > 0);
  assert.ok(Object.keys(index.subagents).length > 0);
});

test('store CLI lists and searches skills', () => {
  assert.match(run(['list', '--type=skills']), /skill\t/);
  assert.match(run(['search', 'django']), /django/);
});

test('store CLI dry-run does not write files', () => {
  const output = run(['install', 'django-patterns', '--project', '--dry-run']);
  assert.match(output, /\[dry-run\] write/);
});
