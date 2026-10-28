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
  assert.match(s, /hard cap 6/i);
  assert.match(s, /Default 4 workers/i);
  assert.ok(s.includes('open|claimed|done|failed'));
  assert.match(s, /every `claimed` item goes back to `open`/i);
  assert.match(s, /clamps `max_workers` to 1\.\.6/i);
  assert.match(s, /stay-within-limits/i);
  assert.match(s, /95 %/i);
  assert.match(s, /Workers get no push, merge or publish/i);
  assert.match(s, /no second review round/i);
  assert.match(s, /attempts/i);
  assert.match(s, /review pass/i);
  assert.match(s, /never counts as a GO/i);
  assert.match(s, /Agents never invoke each other/i);
});

test('fabric-swarm attempt counter is incremented exactly once, at claim', () => {
  const s = read('skills', 'basic', 'fabric-swarm', 'SKILL.md');
  assert.match(s, /incremented exactly once/i);
  assert.match(s, /when the dispatcher claims an item \(`open` -> `claimed`\)\. Nowhere else/i);
  assert.match(s, /increment `attempts` by 1\. This is the only place `attempts` is incremented/i);
  assert.match(s, /nothing is incremented/i);
});

test('fabric-swarm allows 2 attempts per item, then failed', () => {
  const s = read('skills', 'basic', 'fabric-swarm', 'SKILL.md');
  assert.match(s, /Max 2 attempts per item/i);
  assert.match(s, /if `attempts` < 2, set the item back to `open`/i);
  assert.match(s, /if `attempts` = 2, mark it `failed` with the error as `result`/i);
  assert.match(s, /already has `attempts` = 2, it becomes `failed` with result `interrupted`/i);
});

test('fabric-swarm runs one review pass tracked by review_done', () => {
  const s = read('skills', 'basic', 'fabric-swarm', 'SKILL.md');
  assert.match(s, /"review_done": false/);
  assert.match(s, /`review_done` is `false` until the one review pass has run/i);
  assert.match(s, /and `review_done` is `false`, run the review pass once/i);
  assert.match(s, /then set `review_done` to `true`/i);
  assert.match(s, /and `review_done` is `true`, the run ends/i);
  assert.match(s, /No second review round/i);
});

test('fabric-swarm rejected items get exactly one more attempt', () => {
  const s = read('skills', 'basic', 'fabric-swarm', 'SKILL.md');
  assert.match(s, /Rejected items go back to `open` with `attempts` set to 1/i);
  assert.match(s, /so each gets exactly one more attempt/i);
});

test('fabric skill documents swarm and the flags', () => {
  const s = read('skills', 'basic', 'fabric', 'SKILL.md');
  const row = s.split('\n').find((l) => l.startsWith('| `fabric-swarm`'));
  assert.ok(row && !row.includes('5.4.1'));
  for (const w of ['--profile', '--workstreams', '--skill', 'aos-team']) assert.ok(s.includes(w), w);
});
