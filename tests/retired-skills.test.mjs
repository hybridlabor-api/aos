import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { pruneRetiredSkills, pruneRetiredFiles, storeProtectedDirs, RETIRED_FILES, RETIRED_SKILLS } = require('../lib/retired-skills.js');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

describe('pruneRetiredSkills', () => {
  let home;
  before(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-retired-')); });
  after(() => fs.rmSync(home, { recursive: true, force: true }));

  const put = (rel, body) => {
    const abs = path.join(home, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    return abs;
  };

  test('the three BuilderIO visual skills are retired', () => {
    for (const n of ['visual-edit', 'visual-plan', 'visual-recap']) assert.equal(RETIRED_SKILLS[n], '4.17.0');
  });

  test('the foreign agent-orchestrator skill is retired, the AO product dir is not', () => {
    assert.equal(RETIRED_SKILLS['agent-orchestrator'], '4.18.2');
    assert.equal(Object.hasOwn(RETIRED_SKILLS, 'bdb-agent-orchestrator'), false);
    assert.equal(Object.hasOwn(RETIRED_SKILLS, 'ao-orchestrator'), false);
  });

  test('untouched copy removed, edited and foreign files backed up before the dir goes', () => {
    const clean = put('.claude/skills/visual-plan/SKILL.md', 'shipped');
    const edited = put('.claude/skills/visual-plan/notes.md', 'user edit');
    const foreign = put('.claude/skills/visual-plan/mine.txt', 'not installer owned');
    const other = put('.claude/skills/plan-canvas/SKILL.md', 'keep');
    const outside = put('elsewhere/skills/visual-plan/SKILL.md', 'keep');
    const manifest = {
      [clean]: { sha256: sha('shipped') },
      [edited]: { sha256: sha('original') },
      [other]: { sha256: sha('keep') },
      [outside]: { sha256: sha('keep') },
    };
    const backupDir = path.join(home, '.agents', 'backups', 'retired-skills-test');
    const res = pruneRetiredSkills({ home, manifest, roots: [path.join(home, '.claude', 'skills')], backupDir });

    assert.ok(!fs.existsSync(path.join(home, '.claude/skills/visual-plan')));
    assert.equal(fs.readFileSync(path.join(backupDir, '.claude/skills/visual-plan/notes.md'), 'utf8'), 'user edit');
    assert.equal(fs.readFileSync(path.join(backupDir, '.claude/skills/visual-plan/mine.txt'), 'utf8'), 'not installer owned');
    assert.ok(!fs.existsSync(path.join(backupDir, '.claude/skills/visual-plan/SKILL.md')));
    assert.ok(!(clean in manifest) && !(edited in manifest));
    assert.ok(other in manifest && outside in manifest);
    assert.ok(fs.existsSync(other) && fs.existsSync(outside));
    assert.equal(res.backedUp.length, 2);
    assert.deepEqual(res.removed, [path.join(home, '.claude/skills/visual-plan')]);
    assert.ok(foreign);
  });

  test('a symlink inside a retired dir leaves it untouched', () => {
    const f = put('.claude/skills/visual-recap/SKILL.md', 'shipped');
    const target = put('victim/data.txt', 'precious');
    fs.symlinkSync(target, path.join(home, '.claude/skills/visual-recap/link'));
    const manifest = { [f]: { sha256: sha('shipped') } };
    pruneRetiredSkills({ home, manifest, roots: [path.join(home, '.claude', 'skills')], backupDir: path.join(home, 'bk2') });
    assert.ok(fs.existsSync(f));
    assert.equal(fs.readFileSync(target, 'utf8'), 'precious');
    assert.ok(f in manifest);
  });

  test('a symlinked skill dir is never followed', () => {
    const real = put('victim2/SKILL.md', 'precious');
    fs.mkdirSync(path.join(home, '.codex/skills'), { recursive: true });
    fs.symlinkSync(path.join(home, 'victim2'), path.join(home, '.codex/skills/visual-edit'));
    const manifest = { [path.join(home, '.codex/skills/visual-edit/SKILL.md')]: { sha256: sha('precious') } };
    pruneRetiredSkills({ home, manifest, roots: [path.join(home, '.codex', 'skills')], backupDir: path.join(home, 'bk3') });
    assert.ok(fs.existsSync(real));
  });

  test('manifest paths with .. segments are ignored', () => {
    const keep = put('.agents/skills/keepme/SKILL.md', 'keep');
    const manifest = { [path.join(home, '.agents/skills/visual-edit/../keepme/SKILL.md')]: { sha256: sha('keep') } };
    pruneRetiredSkills({ home, manifest, roots: [path.join(home, '.agents', 'skills')], backupDir: path.join(home, 'bk4') });
    assert.ok(fs.existsSync(keep));
  });
});

describe('pruneRetiredSkills keep', () => {
  test('a store-installed copy of a retired name survives, others go', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-retired-keep-'));
    try {
      const mk = (rel) => { const a = path.join(home, rel); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, 'x'); return a; };
      const stored = mk('.agents/skills/visual-plan/SKILL.md');
      const other = mk('.claude/skills/visual-plan/SKILL.md');
      fs.mkdirSync(path.join(home, '.aos', 'store'), { recursive: true });
      fs.writeFileSync(path.join(home, '.aos', 'store', 'installs.jsonl'), JSON.stringify({ kind: 'skill', name: 'visual-plan', targets: [stored] }) + '\n');
      const manifest = { [stored]: { sha256: sha('x') }, [other]: { sha256: sha('x') } };
      pruneRetiredSkills({ home, manifest, roots: [path.join(home, '.agents', 'skills'), path.join(home, '.claude', 'skills')], backupDir: path.join(home, 'bk'), keep: storeProtectedDirs(home) });
      assert.ok(fs.existsSync(stored));
      assert.ok(!fs.existsSync(other));
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
});

describe('pruneRetiredFiles', () => {
  test('removes only the exact retired paths, backs up edited ones, keeps neighbours', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-retired-files-'));
    try {
      const put = (rel, body) => {
        const abs = path.join(home, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, body);
        return abs;
      };
      const old = 'start' + 'cycle';
      const clean = put(`.claude/workflows/${old}-dispatch.mjs`, 'shipped');
      const edited = put(`.config/opencode/commands/${old}-graph.md`, 'user edit');
      const codex = put('.codex/workflows/teamwork-dispatch.mjs', 'x');
      const keepNew = put('.claude/workflows/fabric-dispatch.mjs', 'new');
      const keepOther = put('.claude/workflows/other.mjs', 'other');
      const outside = put('elsewhere/workflows/teamwork-dispatch.mjs', 'outside');
      const manifest = { [clean]: { sha256: sha('shipped') }, [edited]: { sha256: sha('original') } };
      const backupDir = path.join(home, 'bk');
      const res = pruneRetiredFiles({ home, manifest, backupDir });
      for (const f of [clean, edited, codex]) assert.ok(!fs.existsSync(f), f);
      for (const f of [keepNew, keepOther, outside]) assert.ok(fs.existsSync(f), f);
      assert.equal(res.removed.length, 3);
      assert.equal(fs.readFileSync(path.join(backupDir, '.config/opencode/commands', `${old}-graph.md`), 'utf8'), 'user edit');
      assert.ok(!fs.existsSync(path.join(backupDir, '.claude/workflows', `${old}-dispatch.mjs`)));
      assert.ok(!(clean in manifest) && !(edited in manifest));
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  test('a symlink at a retired path is left alone', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-retired-files-'));
    try {
      const target = path.join(home, 'real.mjs');
      fs.writeFileSync(target, 'x');
      const link = path.join(home, '.codex', 'workflows', 'teamwork-dispatch.mjs');
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(target, link);
      pruneRetiredFiles({ home, manifest: {}, backupDir: path.join(home, 'bk') });
      assert.ok(fs.lstatSync(link).isSymbolicLink());
      assert.ok(RETIRED_FILES.every((p) => p.every((x) => !/[*?]/.test(x))), 'no globs');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
});
