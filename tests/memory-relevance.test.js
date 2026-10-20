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
