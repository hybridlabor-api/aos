import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STRINGS, t, detectLang } from '../ui/i18n.js';

const here = new URL('../ui/', import.meta.url);

test('en and de have the same keys and no empty strings', () => {
  const en = Object.keys(STRINGS.en).sort();
  const de = Object.keys(STRINGS.de).sort();
  assert.deepEqual(de, en);
  for (const l of ['en', 'de']) for (const [k, v] of Object.entries(STRINGS[l])) assert.ok(v.trim(), `${l}.${k} empty`);
});

test('placeholders match between languages', () => {
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
  for (const k of Object.keys(STRINGS.en)) assert.equal(ph(STRINGS.de[k]), ph(STRINGS.en[k]), k);
});

test('every key used in index.html and app.js exists', () => {
  const html = readFileSync(new URL('index.html', here), 'utf8');
  const js = readFileSync(new URL('app.js', here), 'utf8');
  const used = new Set([...html.matchAll(/data-i18n(?:-aria)?="([\w.]+)"/g)].map((m) => m[1]));
  for (const m of js.matchAll(/\bt\('([\w.]+)'/g)) used.add(m[1]);
  for (const k of used) assert.ok(k in STRINGS.en, `missing key ${k}`);
});

test('t fills placeholders and falls back', () => {
  assert.equal(t('de', 'home.servicesUp', { up: 2, total: 3 }), '2 von 3 laufen');
  assert.equal(t('xx', 'nav.home'), 'Home');
  assert.equal(t('en', 'no.such.key'), 'no.such.key');
  assert.equal(t('en', 'services.restarted', {}), '{id} restarted.');
});

test('detectLang prefers stored, then navigator, then en', () => {
  assert.equal(detectLang('de', ['en-US']), 'de');
  assert.equal(detectLang(null, ['de-AT', 'en']), 'de');
  assert.equal(detectLang('fr', ['fr-FR']), 'en');
});
