import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

describe('fabric-loop', () => {
  const loop = read('skills', 'basic', 'fabric-loop', 'SKILL.md');

  test('is a real mode, not the 5.4.1 stub', () => {
    assert.ok(!loop.includes('arrives in 5.4.1'));
    assert.ok(!/arrives in 5\.4\.1/i.test(loop));
  });

  test('states round limits, no-progress rule and the round log', () => {
    assert.match(loop, /S=3, M=4, L=5/);
    assert.match(loop, /No-progress stop/);
    assert.match(loop, /same set of blocking finding IDs/);
    assert.ok(loop.includes('production_artifacts/loop.log'));
  });

  test('carries the GO safety lines', () => {
    assert.match(loop, /NEVER issues a GO/);
    assert.match(loop, /NEVER types or runs `gogate`/);
    assert.match(loop, /never a GO/);
  });

  test('enforces time, quota, signature, grant and terminal logging', () => {
    assert.match(loop, /Compare elapsed time since the first line with 3 hours/);
    assert.match(loop, /stay-within-limits/);
    assert.match(loop, /95 %/);
    assert.match(loop, /same failing exit-check output signature/);
    assert.match(loop, /valid grant/);
    assert.match(loop, /STOP and report/);
    assert.match(loop, /before any stop decision, terminal rounds included/);
    assert.match(loop, /govern even when/);
  });

  test('fabric master row for fabric-loop has no 5.4.1', () => {
    const row = read('skills', 'basic', 'fabric', 'SKILL.md').split('\n').find((l) => l.startsWith('| `fabric-loop`'));
    assert.ok(row, 'fabric-loop row exists');
    assert.ok(!row.includes('5.4.1'));
  });

  test('flow-loop template points to fabric-loop', () => {
    assert.ok(read('skills', 'global_config', 'loop-templates', 'references', 'flow-loop.md').includes('`fabric-loop`'));
  });
});
