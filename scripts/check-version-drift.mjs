#!/usr/bin/env node
// Fails when package.json, plugin.json and (if present) the marketplace entry disagree on version.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export function versionDrift({ pkg, plugin, market }) {
  const found = { 'package.json': pkg.version, 'plugin.json': plugin.version };
  const entry = market.plugins?.find((p) => p.name === plugin.name);
  if (!entry) return [`marketplace.json has no entry named ${plugin.name}`];
  if ('version' in entry) found['marketplace.json entry'] = entry.version;
  return new Set(Object.values(found)).size > 1 ? [`version drift: ${JSON.stringify(found)}`] : [];
}

const read = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));

if (process.argv.includes('--selftest')) {
  const base = { pkg: { version: '1.0.0' }, plugin: { name: 'a', version: '1.0.0' }, market: { plugins: [{ name: 'a' }] } };
  assert.deepEqual(versionDrift(base), []);
  assert.equal(versionDrift({ ...base, plugin: { name: 'a', version: '1.0.1' } }).length, 1);
  assert.equal(versionDrift({ ...base, market: { plugins: [{ name: 'a', version: '0.9.0' }] } }).length, 1);
  assert.equal(versionDrift({ ...base, market: { plugins: [] } }).length, 1);
  console.log('check-version-drift selftest ok');
} else {
  const errors = versionDrift({ pkg: read('package.json'), plugin: read('.claude-plugin/plugin.json'), market: read('.claude-plugin/marketplace.json') });
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('versions in sync');
}
