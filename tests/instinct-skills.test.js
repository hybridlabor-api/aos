import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanFrontmatter } from '../scripts/validate-skills.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = ['skill-create', 'instinct-status', 'instinct-export', 'instinct-import'];
const CATEGORIES = new Set([
  'design-ui-ux', 'engineering-method', 'media-eventtech',
  'bdb-core', 'saas-ops', 'library', 'engineering-hardware',
]);

const skillPath = (name) => join(ROOT, 'skills', 'basic', name, 'SKILL.md');
const readSkill = (name) => readFileSync(skillPath(name), 'utf8');

const frontmatter = (name) => {
  const fm = scanFrontmatter(readSkill(name));
  assert.equal(fm.ok, true, `${name} has clean frontmatter`);
  return new Map(fm.keys.map((k) => [k.key, k]));
};

// Placeholder mentions like `/Users/<name>/` are counter-examples the rule text
// has to show; only a real bare segment (e.g. `/Users/tim/`) is a leak.
const absHomePath = (text) => /((?:\/|\\)(?:Users|home)(?:\/|\\)[^<>/\s`'")\],\\]+)/.test(text) || /C:\\Users\\[^<>/\s`'")\],\\]+/.test(text);

// A basic skill registers the same way in every manifest: as
// `./skills/basic/<name>` in each plugin.json's `skills` array, and by bare
// name in a skills.sh.json grouping. startcycle is the reference basic skill.
const REFERENCE = 'startcycle';

const parseJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const basicSkillKeys = (rel, name) => {
  const manifest = parseJson(rel);
  assert.ok(Array.isArray(manifest.skills), `${rel}: no skills array`);
  const entries = manifest.skills.filter((s) => s === `./skills/basic/${REFERENCE}` || s === `./skills/basic/${name}`);
  assert.equal(entries.length, 2, `${rel}: ${name} not registered beside ${REFERENCE}`);
  return entries;
};

const groupedSkill = (name) => {
  const grouped = parseJson('skills.sh.json');
  assert.ok(Array.isArray(grouped.groupings), 'skills.sh.json: no groupings array');
  for (const g of grouped.groupings) {
    if (Array.isArray(g.skills) && g.skills.includes(name)) return { group: g.title, skill: name };
  }
  return null;
};

describe('instinct & skill-create ecosystem skills', () => {
  test('all four skill files exist', () => {
    for (const name of SKILLS) assert.equal(existsSync(skillPath(name)), true, `${name}/SKILL.md missing`);
  });

  test('frontmatter passes the validate-skills contract', () => {
    for (const name of SKILLS) {
      const fm = frontmatter(name);
      for (const req of ['name', 'description', 'category']) {
        assert.ok(fm.has(req), `${name}: missing required key \`${req}\``);
      }
      assert.equal(fm.get('name').value, name, `${name}: name must match its directory`);
      assert.ok(CATEGORIES.has(fm.get('category').value), `${name}: category not in the allowed set`);
      assert.ok(fm.get('description').value.length > 20, `${name}: description too short`);
    }
  });

  test('each skill stays under 120 lines', () => {
    for (const name of SKILLS) {
      assert.ok(readSkill(name).split('\n').length < 121, `${name}: exceeds 120 lines`);
    }
  });

  test('instinct skills document the shared JSON format consistently', () => {
    for (const name of ['instinct-status', 'instinct-export', 'instinct-import']) {
      const text = readSkill(name);
      for (const field of ['confidence', 'trigger', 'action', 'id', 'source', 'updated']) {
        assert.ok(text.includes(field), `${name}: does not document the \`${field}\` field`);
      }
      assert.ok(text.includes('~/.aos/instincts/instincts.json'), `${name}: does not name the instincts store path`);
    }
  });

  test('skill-create stays read-only and never targets the real skills tree', () => {
    const text = readSkill('skill-create');
    assert.ok(text.includes('git log'), 'skill-create: no git analysis');
    assert.match(text, /[Nn]ever overwrite/, 'skill-create: no overwrite guard');
    assert.ok(text.includes('Never copy into the draft'), 'skill-create: no never-copy rule');
    assert.match(text, /\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*/, 'skill-create: no skill-name pattern rule');
  });

  test('skill-create has a final scan-and-redact step before writing', () => {
    const text = readSkill('skill-create');
    assert.match(text, /Final scan[- ]and[- ]redact/i, 'skill-create: no final scan-and-redact step');
    for (const guard of ['secret', /e-mail/i, 'author names', 'absolute home paths']) {
      assert.ok(typeof guard === 'string' ? text.includes(guard) : guard.test(text),
        `skill-create: never-copy list missing \`${guard}\``);
    }
    assert.match(text, /paraphrase/i, 'skill-create: evidence rule must require paraphrase, not quoted diffs');
  });

  test('instinct-import treats entries as inert data and enforces bounds', () => {
    const text = readSkill('instinct-import');
    assert.ok(text.includes('inert'), 'instinct-import: no inert-data statement');
    assert.ok(text.includes('200 characters'), 'instinct-import: no trigger bound');
    assert.ok(text.includes('400 characters'), 'instinct-import: no action bound');
    assert.match(text, /(no newlines|control characters)/i, 'instinct-import: no newline/control-char rule');
    assert.ok(text.includes('200 instinct entries'), 'instinct-import: no 200-entry bound');
    for (const shot of ['shell commands', 'URLs', 'ignore previous']) {
      assert.ok(text.includes(shot), `instinct-import: no directive screen for "${shot}"`);
    }
    assert.match(text, /[Nn]ever\s+follow/, 'instinct-import: no follow-no-paths rule');
  });

  test('instinct-export allowlists six fields and redacts concrete patterns', () => {
    const text = readSkill('instinct-export');
    for (const token of ['sk-', 'ghp_', 'github_pat_', 'xox', 'AKIA', 'base64', 'user:pass@']) {
      assert.ok(text.includes(token), `instinct-export: redaction rules missing "${token}"`);
    }
    assert.match(text, /allowlist/i, 'instinct-export: no allowlist rule');
    assert.match(text, /re[- ]scan/i, 'instinct-export: no re-scan-before-writing rule');
    for (const field of ['id', 'trigger', 'action', 'confidence', 'source', 'updated']) {
      assert.ok(text.includes(`\`${field}\``), `instinct-export: allowlist missing \`${field}\``);
    }
  });

  test('instinct-export and skill-create default under a user-named scratch/output folder', () => {
    for (const name of ['skill-create', 'instinct-export']) {
      const text = readSkill(name);
      assert.match(text, /scratch\/output/, `${name}: no scratch/output default`);
    }
  });

  test('instinct-export refuses output inside the AOS state dir after resolving paths', () => {
    const text = readSkill('instinct-export');
    assert.match(text, /AOS state dir/, 'instinct-export: no state-dir refusal');
    assert.match(text, /symlink/, 'instinct-export: no resolve-symlinks requirement');
  });

  test('instinct-status says the store is user data, never executed, mode 0600', () => {
    const text = readSkill('instinct-status');
    assert.ok(text.includes("user's own data"), 'instinct-status: no user-own-data statement');
    assert.ok(text.includes('never executed'), 'instinct-status: no never-executed statement');
    assert.ok(text.includes('0600'), 'instinct-status: no mode 0600 requirement');
    assert.match(text, /quoted/, 'instinct-status: instincts must be printed quoted as data');
  });

  test('attribution is one neutral inspired-by line in every skill', () => {
    for (const name of SKILLS) {
      const text = readSkill(name);
      assert.ok(
        text.includes('affaan-m/ECC'),
        `${name}: no ECC concept credit`,
      );
      assert.ok(
        text.includes('no code copied'),
        `${name}: attribution does not state no code copied`,
      );
      assert.doesNotMatch(text, /compatible/i, `${name}: "ECC compatible" claim text`);
      // Case-sensitive \bMIT\b so prose words like "commit hashes" don't trip it.
      assert.doesNotMatch(text, /(licence|license).{0,20}verif|MIT(?![a-z])/,
        `${name}: licence claim text`);
    }
    const create = readSkill('skill-create');
    assert.ok(create.includes('source: community'), 'skill-create: no source declaration');
    for (const name of SKILLS) {
      assert.doesNotMatch(readSkill(name), /^source:/m, `${name}: must not add a source: frontmatter key`);
    }
  });

  test('no absolute user paths in any of the four skills', () => {
    for (const name of SKILLS) {
      assert.equal(absHomePath(readSkill(name)), false, `${name}: leaks an absolute home path`);
    }
  });

  test('all four are registered wherever basic skills are registered, exactly like startcycle', () => {
    const manifests = [
      'plugin.json',
      'plugins/bdb-aos/plugin.json',
    ];
    for (const rel of manifests) {
      for (const name of SKILLS) {
        const entry = basicSkillKeys(rel, name);
        assert.deepEqual([...entry].sort(), [`./skills/basic/${REFERENCE}`, `./skills/basic/${name}`].sort(),
          `${rel}: ${name} registration format differs from ${REFERENCE}'s`);
      }
    }
    for (const name of SKILLS) {
      const hit = groupedSkill(name);
      assert.ok(hit, `skills.sh.json: \`${name}\` not grouped`);
      const ref = groupedSkill(REFERENCE);
      assert.equal(typeof hit.skill, 'string', `skills.sh.json: ${name} not listed as a string like ${REFERENCE}`);
      assert.equal(typeof ref.skill, 'string', 'skills.sh.json: startcycle not listed as a string');
    }
  });
});
