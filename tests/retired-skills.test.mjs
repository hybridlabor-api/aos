import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { pruneRetiredSkills, RETIRED_SKILLS } = require('../lib/retired-skills.js');
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
