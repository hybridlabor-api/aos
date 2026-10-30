// Store pack commands: offline install from the library (package fallback), removal that
// parks instead of deletes and never touches user skills. Runs the real CLI with a throwaway HOME.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cli = join(root, 'bin', 'aos-store.mjs');
const pkgVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

const tmpHome = () => realpathSync(mkdtempSync(join(tmpdir(), 'aos-storepacks-')));
const store = (home, args, extraEnv = {}) => spawnSync(process.execPath, [cli, ...args], {
  env: { ...process.env, HOME: home, USERPROFILE: home, AOS_TEST_SANDBOX: '1', ...extraEnv }, encoding: 'utf8',
});
const roots = (home) => ['.agents', '.claude', '.cursor', '.roo', '.config/opencode', '.gemini/config'].map((d) => join(home, d, 'skills'));
const logLines = (home) => readFileSync(join(home, '.aos', 'store', 'installs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('aos store packs lists every pack with descriptions', () => {
  const home = tmpHome();
  const r = store(home, ['packs']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /pack\tmedia-eventtech\t18 skill\(s\)/);
  assert.match(r.stdout, /pack\thardware\t\d+ skill\(s\)/);
});

test('install --pack copies every pack skill into every harness dir, offline, from the package fallback', () => {
  const home = tmpHome();
  const r = store(home, ['install', '--pack', 'media-eventtech']);
  assert.equal(r.status, 0, r.stderr);
  for (const name of ['bdb-grandma3-mcp', 'bdb-resolume-mcp', 'mcp-manage']) {
    for (const dir of roots(home)) {
      const md = join(dir, name, 'SKILL.md');
      assert.ok(existsSync(md), md);
    }
  }
  const entries = logLines(home).filter((e) => e.kind === 'skill');
  assert.ok(entries.length >= 18);
  assert.ok(entries.every((e) => e.pack === 'media-eventtech' && e.source === 'aos' && Array.isArray(e.targets) && e.targets.length));
  // No stored pack selection existed: installing a pack must not start deselecting.
  assert.ok(!existsSync(join(home, '.aos', 'v5-settings.json')));
  // Idempotent rerun: everything already installed.
  const again = store(home, ['install', '--pack', 'media-eventtech']);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /0 installed, 18 skipped/);
});

test('install --pack prefers a fresh library copy and records from=library', () => {
  const home = tmpHome();
  // Library with the same version as the package, but a locally marked copy of one pack skill.
  const lib = join(home, '.aos', 'library');
  mkdirSync(join(lib, 'skills', 'mcp-manage'), { recursive: true });
  writeFileSync(join(lib, 'skills', 'mcp-manage', 'SKILL.md'), 'library marker\n');
  writeFileSync(join(lib, 'index.json'), JSON.stringify({ version: pkgVersion, base: [], packs: { 'live-show': { description: 'x', skills: ['mcp-manage'] } } }));
  const r = store(home, ['install', '--pack=live-show']);
  assert.equal(r.status, 0, r.stderr);
  const md = join(home, '.agents', 'skills', 'mcp-manage', 'SKILL.md');
  assert.equal(readFileSync(md, 'utf8'), 'library marker\n');
  assert.ok(logLines(home).some((e) => e.kind === 'skill' && e.name === 'mcp-manage' && e.from === 'library'));
});

test('install --pack with an unknown pack fails and with --dry-run writes nothing', () => {
  const home = tmpHome();
  assert.match(store(home, ['install', '--pack', 'nope']).stderr, /Unknown pack/);
  const d = store(home, ['install', '--pack', 'web-design', '--dry-run']);
  assert.equal(d.status, 0, d.stderr);
  assert.match(d.stdout, /\[dry-run\] write/);
  assert.ok(!existsSync(join(home, '.agents', 'skills')));
});

test('external pack skills missing from library and package are skipped with a reason', () => {
  const home = tmpHome();
  const r = store(home, ['install', '--pack', 'hardware']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Skipped code-first-hardware-design: Skill not found in the local library or package/);
});

test('remove --pack parks the copies (never deletes), keeps user skills, updates a stored selection', () => {
  const home = tmpHome();
  assert.equal(store(home, ['install', '--pack', 'media-eventtech']).status, 0);
  // A user-edited copy with no store log entry of its own: kept.
  const userDir = join(home, '.cursor', 'skills', 'mcp-manage');
  rmSync(userDir, { recursive: true, force: true });
  mkdirSync(userDir, { recursive: true });
  writeFileSync(join(userDir, 'SKILL.md'), 'my own variant\n');

  // An existing explicit selection gains the pack only via install; simulate a selection made before.
  const settings = join(home, '.aos', 'v5-settings.json');
  writeFileSync(settings, JSON.stringify({ packs: ['live-show', 'business'] }));

  const r = store(home, ['remove', '--pack', 'live-show']);
  assert.equal(r.status, 0, r.stderr);
  for (const name of ['bdb-grandma3-mcp', 'mcp-manage']) {
    for (const dir of roots(home)) {
      if (join(dir, name) === userDir) continue;
      assert.ok(!existsSync(join(dir, name)), `${join(dir, name)} removed`);
    }
  }
  assert.equal(readFileSync(join(userDir, 'SKILL.md'), 'utf8'), 'my own variant\n', 'user skill kept');
  // Parked, not deleted.
  const removedRoot = join(home, '.aos', 'store', 'removed');
  const parked = readdirSync(removedRoot).find((n) => n.startsWith('live-show-'));
  assert.ok(parked, 'parked backup dir exists');
  assert.ok(existsSync(join(removedRoot, parked, '_agents_skills', 'bdb-grandma3-mcp', 'SKILL.md')));
  // Selection updated: live-show out, business stays.
  const st = JSON.parse(readFileSync(settings, 'utf8'));
  assert.deepEqual(st.packs, ['business']);
  // Log records the removal.
  assert.ok(logLines(home).some((e) => e.kind === 'pack-remove' && e.pack === 'live-show'));
});

test('remove --pack dry-run lists without touching anything', () => {
  const home = tmpHome();
  assert.equal(store(home, ['install', '--pack', 'media-eventtech']).status, 0);
  const d = store(home, ['remove', '--pack', 'live-show', '--dry-run']);
  assert.equal(d.status, 0, d.stderr);
  assert.match(d.stdout, /dry-run/);
  for (const name of ['bdb-grandma3-mcp']) {
    for (const dir of roots(home)) assert.ok(existsSync(join(dir, name)), `${join(dir, name)} untouched`);
  }
});

test('single-skill install still works offline and logs the library origin when present', () => {
  const home = tmpHome();
  const r = store(home, ['install', 'grill-me']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(home, '.claude', 'skills', 'grill-me', 'SKILL.md')));
  assert.ok(logLines(home).some((e) => e.name === 'grill-me' && e.from === 'package'));
});
