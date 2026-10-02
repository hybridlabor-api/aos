import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

// Subfolder plugin: identical manifest, symlinks into the repo root.
const SUB = join(ROOT, 'plugins', 'bdb-aos');
const SUB_MANIFEST = join(SUB, '.claude-plugin', 'plugin.json');
const subOriginal = readFileSync(SUB_MANIFEST, 'utf8');
assert.equal(subOriginal, original, 'subfolder plugin.json must match the root manifest');
assert.equal(entry.source, './plugins/bdb-aos', 'marketplace entry must point at the subfolder plugin');
for (const name of ['skills', 'agents']) {
  assert.ok(lstatSync(join(SUB, name)).isSymbolicLink(), `plugins/bdb-aos/${name} must be a symlink`);
  assert.equal(readlinkSync(join(SUB, name)), `../../${name}`);
}
assert.ok(readFileSync(join(SUB, manifest.skills[0], 'SKILL.md'), 'utf8').length > 0, 'skills resolve through the symlink');

try {
  writeFileSync(SUB_MANIFEST, '{"name":"bdb-aos"}\n');
  assert.throws(() => run('--check'), /out of date/, '--check must fail on a stale subfolder manifest');
} finally {
  writeFileSync(SUB_MANIFEST, subOriginal);
}
try {
  rmSync(join(SUB, 'agents'));
  assert.throws(() => run('--check'), /symlinks/, '--check must fail on a missing symlink');
} finally {
  rmSync(join(SUB, 'agents'), { force: true });
  symlinkSync('../../agents', join(SUB, 'agents'));
}
run('--check');

try {
  writeFileSync(MANIFEST, '{"name":"bdb-aos"}\n');
  assert.throws(() => run('--check'), /out of date/, '--check must fail on a stale manifest');
} finally {
  writeFileSync(MANIFEST, original);
}
run('--check');


// Codex and agy manifests: checked in, version-locked, covered by --check.
const CODEX_ROOT = 'plugins/bdb-aos-codex';
const generatedFiles = [
  '.codex-plugin/plugin.json',
  `${CODEX_ROOT}/.codex-plugin/plugin.json`,
  '.agents/plugins/marketplace.json',
  'plugin.json',
  'plugins/bdb-aos/plugin.json',
];
for (const file of generatedFiles.filter((f) => f.endsWith('plugin.json'))) {
  assert.equal(JSON.parse(readFileSync(join(ROOT, file), 'utf8')).version, pkg.version, `${file} must track package.json`);
}
const releaseCfg = JSON.parse(readFileSync(join(ROOT, 'release-please-config.json'), 'utf8'));
const bumped = releaseCfg.packages['.']['extra-files'].map((f) => f.path);
for (const file of generatedFiles.filter((f) => f.endsWith('plugin.json'))) {
  assert.ok(bumped.includes(file), `release-please must bump ${file}`);
}
const cmds = JSON.parse(readFileSync(join(ROOT, 'plugin-commands.json'), 'utf8')).commands;
for (const name of Object.keys(cmds)) {
  const body = readFileSync(join(ROOT, CODEX_ROOT, 'skills', name, 'SKILL.md'), 'utf8');
  assert.ok(!body.includes('disable-model-invocation'), `${name}: codex wrapper must not set disable-model-invocation`);
  assert.ok(!/\/bdb-aos:/.test(body), `${name}: codex wrapper must use $bdb-aos:<cmd>, not /bdb-aos:`);
  assert.ok(body.startsWith(`---\nname: ${name}\n`), `${name}: wrapper skill name`);
}
assert.ok(JSON.parse(readFileSync(join(ROOT, 'plugin.json'), 'utf8')).commands.length === Object.keys(cmds).length, 'agy plugin.json wires every command');

for (const file of ['.codex-plugin/plugin.json', 'plugin.json', '.agents/plugins/marketplace.json', `${CODEX_ROOT}/skills/setup/SKILL.md`]) {
  const path = join(ROOT, file);
  const keep = readFileSync(path, 'utf8');
  try {
    writeFileSync(path, keep.replace(/"?(version|name|description)\b/, '$&X'));
    assert.throws(() => run('--check'), /out of date/, `--check must fail on a stale ${file}`);
    rmSync(path);
    assert.throws(() => run('--check'), /out of date/, `--check must fail on a missing ${file}`);
  } finally {
    writeFileSync(path, keep);
  }
}
{
  const path = join(ROOT, '.codex-plugin', 'plugin.json');
  const keep = readFileSync(path, 'utf8');
  try {
    writeFileSync(path, `${keep.trimEnd().slice(0, -1)}, "disable-model-invocation": true}\n`);
    assert.throws(() => run('--check'), /out of date/, 'drifted codex output is rejected');
  } finally {
    writeFileSync(path, keep);
  }
}
run('--check');

console.log(`build-plugin-manifest: ${manifest.skills.length} skills, --check catches drift`);
