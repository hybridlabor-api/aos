import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { aosSource, loadSources, findItem } from '../lib/store-shared.mjs';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cli = join(root, 'bin', 'aos-store.mjs');
const core = require('../lib/core-skills.js');
const profile = require('../lib/v5/profile.js');

const tmpHome = () => realpathSync(mkdtempSync(join(tmpdir(), 'aos-skillset-')));
const store = (home, args, extraEnv = {}) => spawnSync(process.execPath, [cli, ...args], {
  env: { ...process.env, HOME: home, USERPROFILE: home, AOS_TEST_SANDBOX: '1', ...extraEnv }, encoding: 'utf8',
});

// ---- local aos source ----

test('aosSource indexes every shipped skill from the package, offline', () => {
  const src = aosSource(root, '0.0.0');
  const names = Object.keys(src.index.skills);
  assert.equal(src.id, 'aos');
  assert.ok(src.local);
  assert.deepEqual(names.sort(), core.shippedSkills(root));
  const item = src.index.skills.tdd;
  assert.ok(item.files.some((f) => f.path === 'SKILL.md'));
  assert.match(item.sha256, /^[0-9a-f]{64}$/);
});

test('aos store list: default hides the aos source, --source aos shows it', () => {
  const home = tmpHome();
  const dflt = store(home, ['list']);
  assert.equal(dflt.status, 0, dflt.stderr);
  assert.ok(!/\tAOS\t/.test(dflt.stdout), 'default list stays external-only');
  const aos = store(home, ['list', '--source=aos']);
  assert.equal(aos.status, 0, aos.stderr);
  assert.match(aos.stdout, /skill\tgrill-me\t/);
  assert.match(aos.stdout, new RegExp(`${core.shippedSkills(root).length} item\\(s\\)`));
  assert.notEqual(store(home, ['list', '--source=nope']).status, 0);
});

test('aos store install copies from the package into every harness dir, offline, and is idempotent', () => {
  const home = tmpHome();
  const r = store(home, ['install', 'tdd']);
  assert.equal(r.status, 0, r.stderr);
  for (const base of ['.agents', '.claude', '.cursor', '.roo']) {
    const md = join(home, base, 'skills', 'tdd', 'SKILL.md');
    assert.ok(existsSync(md), md);
    assert.equal(readFileSync(md, 'utf8'), readFileSync(join(root, 'skills', 'global_config', 'tdd', 'SKILL.md'), 'utf8'));
  }
  assert.ok(!existsSync(join(home, '.codex', 'skills', 'tdd')), 'Codex reads ~/.agents/skills; the store must not recreate .codex copies');
  const again = store(home, ['install', 'tdd']);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /Already installed: tdd/);
  assert.ok(!readdirSync(join(home, '.claude', 'skills')).some((n) => n.includes('aos-bak')), 'no backup for an identical copy');
});

test('install of a locally edited copy backs it up, and rollback restores it', () => {
  const home = tmpHome();
  const dir = join(home, '.claude', 'skills', 'tdd');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), 'my own edits\n');
  const r = store(home, ['install', 'tdd']);
  assert.equal(r.status, 0, r.stderr);
  const baks = readdirSync(join(home, '.claude', 'skills')).filter((n) => n.startsWith('tdd.aos-bak-'));
  assert.equal(baks.length, 1);
  assert.equal(readFileSync(join(home, '.claude', 'skills', baks[0], 'SKILL.md'), 'utf8'), 'my own edits\n');
  const rb = store(home, ['rollback', 'tdd']);
  assert.equal(rb.status, 0, rb.stderr);
  assert.equal(readFileSync(join(dir, 'SKILL.md'), 'utf8'), 'my own edits\n');
});

test('install --dry-run writes nothing; unknown name fails', () => {
  const home = tmpHome();
  const r = store(home, ['install', 'tdd', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[dry-run\] write/);
  assert.ok(!existsSync(join(home, '.claude', 'skills', 'tdd')));
  assert.notEqual(store(home, ['install', 'no-such-skill-x']).status, 0);
});

test('name collision between the aos source and an external source is refused, nothing written', () => {
  const home = tmpHome();
  const idx = join(home, 'ecc.json');
  writeFileSync(idx, JSON.stringify({
    version: '1', pinned_commit: 'a'.repeat(40), subagents: {},
    skills: { tdd: { description: 'x', category: 'library', tier: 'free', origin: 'ecc', requires_auth: false, sha256: '0'.repeat(64), upstream_path: 'skills/tdd/SKILL.md' } },
  }));
  const r = store(home, ['install', 'tdd'], { AOS_STORE_TEST_OVERRIDES: '1', AOS_STORE_INDEX: idx, AOS_STORE_RAW_BASE: 'http://127.0.0.1:9' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Name collision/);
  assert.ok(!existsSync(join(home, '.claude', 'skills', 'tdd')));
  const sources = loadSources(root, { AOS_STORE_TEST_OVERRIDES: '1', AOS_STORE_INDEX: idx, AOS_STORE_RAW_BASE: 'http://127.0.0.1:9' }, { withAos: true });
  assert.throws(() => findItem(sources, 'tdd'), /Name collision/);
});

// ---- skillSet setting ----

test('skillSet option: flag, validation, persisted setting, default all', () => {
  const o = profile.parseOptions(['node', 'aos', '--skill-set=core'], {}, []);
  assert.equal(o.skillSet, 'core');
  assert.ok(o.skillSetFromFlag);
  assert.throws(() => profile.parseOptions(['node', 'aos', '--skill-set=few'], {}, []), /Unknown skill set/);
  assert.throws(() => profile.parseOptions(['node', 'aos', '--skill-set'], {}, []), /needs a value/);
  const none = profile.parseOptions(['node', 'aos'], {}, []);
  assert.equal(profile.resolve(none, {}).skillSet, 'all');
  assert.equal(profile.resolve(none, { skillSet: 'core' }).skillSet, 'core');
  assert.equal(profile.resolve(o, { skillSet: 'all' }).skillSet, 'core', 'flag wins');
  const bad = profile.sanitizeSettings({ skillSet: 'weird' }, null);
  assert.equal(bad.settings.skillSet, undefined);
  assert.equal(bad.problems.length, 1);
});

test('core list: every entry is shipped, moved set is the complement, no nested name collides', () => {
  const shipped = new Set(core.shippedSkills(root));
  const list = core.coreList(root);
  for (const n of list) assert.ok(shipped.has(n), `core list names an unknown skill: ${n}`);
  const moved = core.movedSkills(root);
  assert.equal(moved.length + [...list].length, shipped.size);
  assert.deepEqual(core.excludedBySkillSet('all', root), []);
  assert.deepEqual(core.excludedBySkillSet('core', root), moved);
  // The installer excludes by entry name at any depth: a moved name must not be a file or folder inside a core skill.
  const movedSet = new Set(moved);
  const hits = [];
  const walk = (dir, inCore) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      const isSkill = e.isDirectory() && existsSync(join(abs, 'SKILL.md'));
      if (inCore && movedSet.has(e.name)) hits.push(abs);
      if (e.isDirectory()) walk(abs, isSkill ? list.has(e.name) : inCore);
    }
  };
  walk(join(root, 'skills'), false);
  assert.deepEqual(hits, []);
});

test('core mode removes installed copies of moved skills: edited files backed up, store-installed kept, announced', () => {
  const home = tmpHome();
  const moved = core.movedSkills(root);
  const kept = core.coreList(root);
  assert.ok(moved.length > 2 && kept.size > 0);
  const [a, b, c] = moved;
  const skills = join(home, '.agents', 'skills');
  const manifest = {};
  const put = (name, text) => {
    const f = join(skills, name, 'SKILL.md');
    mkdirSync(join(skills, name), { recursive: true });
    writeFileSync(f, text);
    return f;
  };
  const sha = (t) => require('node:crypto').createHash('sha256').update(t).digest('hex');
  const fa = put(a, 'shipped');
  manifest[fa] = { sha256: sha('shipped') };
  const fb = put(b, 'shipped');
  manifest[fb] = { sha256: sha('shipped') };
  writeFileSync(fb, 'user edit');
  const fc = put(c, 'from store');
  manifest[fc] = { sha256: sha('from store') };
  mkdirSync(join(home, '.aos', 'store'), { recursive: true });
  writeFileSync(join(home, '.aos', 'store', 'installs.jsonl'), `${JSON.stringify({ name: c, kind: 'skill' })}\n`);
  const keepName = [...kept][0];
  const fk = put(keepName, 'core');
  manifest[fk] = { sha256: sha('core') };

  const lines = [];
  const backupDir = join(home, '.agents', 'backups', 'skill-set-core-test');
  const res = core.pruneMoved({ root, home, manifest, roots: [skills], backupDir, log: { step: (m) => lines.push(m), warn: (m) => lines.push(m) } });
  assert.deepEqual(res.moved, moved);
  assert.ok(!existsSync(join(skills, a)), 'identical installer copy removed');
  assert.ok(!existsSync(join(skills, b)), 'edited copy removed');
  assert.equal(readFileSync(join(backupDir, '.agents', 'skills', b, 'SKILL.md'), 'utf8'), 'user edit', 'edited copy backed up first');
  assert.ok(existsSync(fc), 'store-installed copy kept');
  assert.ok(existsSync(fk), 'core skill kept');
  const text = lines.join('\n');
  assert.match(text, /Skill set "core": \d+ skill\(s\) are not installed/);
  assert.match(text, /aos store install <name>/);
});

test('with skillSet all nothing is excluded or announced', () => {
  assert.deepEqual(core.excludedBySkillSet('all', root), []);
  assert.deepEqual(core.announceLines([]), []);
});

test('copy helper: package skills install offline into a fresh HOME with a copied package (installed-package shape)', () => {
  const pkg = realpathSync(mkdtempSync(join(tmpdir(), 'aos-pkg-')));
  mkdirSync(join(pkg, 'bin'));
  cpSync(join(root, 'bin', 'aos-store.mjs'), join(pkg, 'bin', 'aos-store.mjs'));
  cpSync(join(root, 'lib'), join(pkg, 'lib'), { recursive: true });
  cpSync(join(root, 'package.json'), join(pkg, 'package.json'));
  cpSync(join(root, 'skills', 'global_config', 'grill-me'), join(pkg, 'skills', 'global_config', 'grill-me'), { recursive: true });
  const home = tmpHome();
  const r = spawnSync(process.execPath, [join(pkg, 'bin', 'aos-store.mjs'), 'install', 'grill-me'], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(home, '.claude', 'skills', 'grill-me', 'SKILL.md')));
});
