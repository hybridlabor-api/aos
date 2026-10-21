import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

test('fabric-swarm skill is the real contract', () => {
  const s = read('skills', 'basic', 'fabric-swarm', 'SKILL.md');
  assert.ok(!/arrives in 5\.4\.1/i.test(s));
  assert.match(s, /swarm\.json/);
  for (const st of ['open', 'claimed', 'done', 'failed']) assert.ok(s.includes(st), st);
  assert.match(s, /hard cap 6/);
  assert.match(s, /Default 4 workers/);
  assert.match(s, /retry once/);
  assert.match(s, /attempts/);
  assert.match(s, /review pass/);
  assert.match(s, /never counts as a GO/);
  assert.match(s, /Agents never invoke each other/);
});

test('fabric skill documents swarm and the flags', () => {
  const s = read('skills', 'basic', 'fabric', 'SKILL.md');
  const row = s.split('\n').find((l) => l.startsWith('| `fabric-swarm`'));
  assert.ok(row && !row.includes('5.4.1'));
  for (const w of ['--profile', '--workstreams', '--skill', 'aos-team']) assert.ok(s.includes(w), w);
});
