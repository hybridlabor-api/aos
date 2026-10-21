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
    assert.match(loop, /no-progress stop/i);
    assert.match(loop, /same set of blocking finding IDs/);
    assert.ok(loop.includes('production_artifacts/loop.log'));
  });

  test('carries the GO safety lines', () => {
    assert.match(loop, /NEVER issues a GO/);
    assert.match(loop, /NEVER types or runs `gogate`/);
    assert.match(loop, /never a GO/);
  });

  test('enforces time, quota, signature, grant and terminal logging', () => {
    assert.match(loop, /Compare elapsed time since the `start` line with 3 hours/i);
    assert.match(loop, /stay-within-limits/);
    assert.match(loop, /95 %/);
    assert.match(loop, /same failing exit-check output signature/);
    assert.match(loop, /valid grant/);
    assert.match(loop, /STOP and report/);
    assert.match(loop, /before any stop or pause decision, terminal rounds included/);
    assert.match(loop, /govern even when/);
  });

  test('writes a start line with a timestamp before round 1', () => {
    assert.ok(loop.includes('append a `start` line with the start timestamp'));
    assert.ok(loop.includes('start ts=<ISO-8601 time>'));
    assert.ok(loop.includes('The 3-hour clock counts from that line'));
  });

  test('logs quota, pauses and waits without counting it as a round', () => {
    assert.ok(loop.includes('at 95 % or more the loop logs `quota`, pauses and waits until the usage window resets'));
    assert.ok(loop.includes('A quota pause is not a round, does not count toward the round limit and does not stop the run'));
  });

  test('defines the fabric-graph failing signature as IDs plus failing gates', () => {
    assert.ok(loop.includes('the sorted list of open blocking finding IDs plus the sorted failing gate names'));
  });

  test('keeps the four flow-loop safety bullets verbatim', () => {
    const flow = read('skills', 'global_config', 'loop-templates', 'references', 'flow-loop.md');
    const section = flow.split('## Safety rules')[1].split('\n## ')[0];
    const bullets = section.split('\n').filter((l) => l.startsWith('- '));
    assert.equal(bullets.length, 4);
    for (const bullet of bullets) assert.ok(loop.includes(bullet), `missing: ${bullet}`);
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
