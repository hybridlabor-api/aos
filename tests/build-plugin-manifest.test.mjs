import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts', 'build-plugin-manifest.mjs');
const MANIFEST = join(ROOT, '.claude-plugin', 'plugin.json');

const run = (...args) => execFileSync('node', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
const original = readFileSync(MANIFEST, 'utf8');
const manifest = JSON.parse(original);
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

// The manifest ships one explicit path per skill directory. A new skill that
// nobody re-ran the generator for would reach users as an inert file, so
// --check is the only thing standing between that and a silently short plugin.
assert.equal(manifest.version, pkg.version, 'plugin version must track package.json');

// `claude plugin tag` refuses to release unless both manifests agree.
const market = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
const entry = market.plugins.find((plugin) => plugin.name === manifest.name);
assert.equal(entry?.version, pkg.version, 'marketplace entry version must track package.json');
assert.ok(manifest.skills.length > 100, `expected the full skill pack, got ${manifest.skills.length}`);
assert.deepEqual(manifest.skills, [...manifest.skills].sort(), 'skills must be sorted for a stable diff');

for (const entry of manifest.skills) {
  assert.ok(entry.startsWith('./skills/'), `unexpected skill path: ${entry}`);
  assert.ok(
    readFileSync(join(ROOT, entry, 'SKILL.md'), 'utf8').length > 0,
    `manifest lists a skill with no readable SKILL.md: ${entry}`,
  );
}

// Agents resolve by convention at <plugin-root>/agents/*.md. The manifest's
// "agents" key passes schema validation and then loads nothing, so it must stay
// out of the file.
assert.ok(!('agents' in manifest), 'the agents manifest key is a no-op; agents load by convention');

run('--check');

try {
  writeFileSync(MANIFEST, '{"name":"bdb-aos"}\n');
  assert.throws(() => run('--check'), /out of date/, '--check must fail on a stale manifest');
} finally {
  writeFileSync(MANIFEST, original);
}
run('--check');

console.log(`build-plugin-manifest: ${manifest.skills.length} skills, --check catches drift`);
