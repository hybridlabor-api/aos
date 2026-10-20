'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const load = () => import('../.claude/hooks/memb-inject.mjs');

test('globalRowRelevant gates domain rows by project or prompt', async () => {
  const { globalRowRelevant } = await load();
  const ids = ['shop-service'];
  assert.ok(globalRowRelevant({ cat: 'godmode', text: 'x', ids }));
  assert.ok(globalRowRelevant({ cat: 'project_card', text: 'shop-service uses Postgres', ids }));
  assert.ok(!globalRowRelevant({ cat: 'project_card', text: 'other repo card', ids }));
  assert.ok(globalRowRelevant({ cat: 'branding', text: 'logo rules', ids, terms: ['branding'] }));
  assert.ok(!globalRowRelevant({ cat: 'mail', text: 'smtp setup', ids, terms: ['logo'] }));
  assert.ok(!globalRowRelevant({ cat: '', text: 'raw', ids }));
});

test('visibleMemoryLine is short, redacts secret-like titles and omits unknown parts', async () => {
  const { visibleMemoryLine } = await load();
  const now = Date.parse('2026-10-20T12:00:00Z');
  const line = visibleMemoryLine({ count: 7, project: 'aos', last: { title: 'Fix installer', updated: '2026-10-20T10:00:00Z' }, now });
  assert.strictEqual(line, 'memory: 7 notes (aos) · last session: Fix installer, 2h ago · aos memory show');
  const long = visibleMemoryLine({ count: 1, project: 'p', last: { title: 'x'.repeat(400), updated: '' }, now });
  assert.ok(long.length <= 160 && long.endsWith('aos memory show'));
  const secret = visibleMemoryLine({ count: 1, project: 'p', last: { title: 'use ghp_abcdefghijklmnop now', updated: '' }, now });
  assert.ok(!secret.includes('last session'));
});

test('dejaContext is off by default and runs `deja hook-context --once` only when on', async () => {
  const { dejaContextOn, dejaContext } = await load();
  assert.strictEqual(dejaContextOn({}, '/nonexistent'), false);
  assert.strictEqual(dejaContextOn({ AOS_DEJA_CONTEXT: 'on' }, '/nonexistent'), true);
  let seen;
  const out = dejaContext('/x', (cmd, args) => { seen = [cmd, ...args]; return ' digest \n'; });
  assert.deepStrictEqual(seen, ['deja', 'hook-context', '--plain', '--once']);
  assert.deepStrictEqual(out, ['digest']);
});
