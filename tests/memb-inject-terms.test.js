'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// Dynamic import() of the ESM hook from this CommonJS test file. Importing
// must be side-effect free: the hook's main logic is guarded by an
// import.meta.url check, so this neither reads stdin nor exits the process.
const loadHook = () => import('../.claude/hooks/memb-inject.mjs');

test('pickTerms drops German/English filler words entirely', async () => {
  const { pickTerms } = await loadHook();
  assert.strictEqual(typeof pickTerms, 'function', 'hook must export pickTerms');

  const terms = pickTerms('WO stehen wir nun ? was muss noch gemacht werden');
  assert.ok(Array.isArray(terms), 'must return an array');
  for (const filler of ['stehen', 'noch', 'gemacht', 'werden', 'was', 'muss', 'nun']) {
    assert.ok(!terms.includes(filler), `must not contain filler word "${filler}"`);
  }
});

test('pickTerms returns distinctive terms sorted by length (longest first), max 4', async () => {
  const { pickTerms } = await loadHook();

  const terms = pickTerms('litha gathering festival softwareentwicklung');
  for (const expected of ['softwareentwicklung', 'gathering', 'festival', 'litha']) {
    assert.ok(terms.includes(expected), `must include "${expected}"`);
  }
  const lengths = terms.map((t) => t.length);
  assert.deepStrictEqual(
    lengths,
    [...lengths].sort((a, b) => b - a),
    'terms must be sorted by length descending'
  );
  assert.ok(terms.length <= 4, 'must return at most 4 terms');
});

test('pickTerms de-duplicates case-insensitively and skips words of length <= 3', async () => {
  const { pickTerms } = await loadHook();

  assert.deepStrictEqual(pickTerms('projekt projekt PROJEKT Projekt'), ['projekt']);
  assert.deepStrictEqual(pickTerms(''), []);
  assert.deepStrictEqual(pickTerms('abc de fghi'), ['fghi']);
  assert.deepStrictEqual(
    pickTerms('alpha bravo charlie delta echo foxtrot golf hotel'),
    ['charlie', 'foxtrot', 'alpha', 'bravo'],
    'caps at 4 terms, longest first (stable order)'
  );
});

test('categoryOf reads the whitelist category from flat and metadata payload paths', async () => {
  const { categoryOf } = await loadHook();
  assert.strictEqual(typeof categoryOf, 'function', 'hook must export categoryOf');

  assert.strictEqual(categoryOf('{"category":"godmode"}'), 'godmode');
  assert.strictEqual(categoryOf('{"metadata":{"category":"godmode"}}'), 'godmode');
  assert.strictEqual(categoryOf('{"category":"project_card"}'), 'project_card');
  assert.strictEqual(categoryOf('{"category":" project_card "}'), 'project_card', 'value is trimmed');
});

test('categoryOf returns an empty string for uncategorized or null payloads', async () => {
  const { categoryOf } = await loadHook();

  assert.strictEqual(categoryOf('{}'), '');
  assert.strictEqual(categoryOf('{"memory":"legacy domain row without category"}'), '');
  assert.strictEqual(categoryOf('{"metadata":{}}'), '');
  assert.strictEqual(categoryOf('null'), '');
});
