import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanFrontmatter, cleanDescription, DESC_MAX } from '../scripts/validate-skills.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const skillsDir = join(repo, 'skills');

function findSkills(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) findSkills(p, out);
    else if (e.name === 'SKILL.md') out.push(p);
  }
  return out;
}

test('DESC_MAX is set to 250 characters', () => {
  assert.equal(DESC_MAX, 250);
});

test('cleanDescription extracts clean text from folded or quoted scalars', () => {
  const folded = scanFrontmatter(`---
name: test-skill
description: >-
  This is a folded description
  across multiple lines.
category: bdb-core
---
`);
  const byKey = new Map(folded.keys.map((k) => [k.key, k]));
  const cd = cleanDescription(byKey.get('description'));
  assert.equal(cd, 'This is a folded description across multiple lines.');
});

test('description exceeding 250 characters is detectable', () => {
  const longDesc = 'a'.repeat(251);
  const text = `---
name: test-long
description: "${longDesc}"
category: bdb-core
---
`;
  const fm = scanFrontmatter(text);
  const byKey = new Map(fm.keys.map((k) => [k.key, k]));
  const cd = cleanDescription(byKey.get('description'));
  assert.equal(cd.length, 251);
  assert.ok(cd.length > DESC_MAX);
});

test('all SKILL.md in skills/ satisfy the 250 character budget', () => {
  const skillFiles = findSkills(skillsDir);
  assert.ok(skillFiles.length > 200, `Expected >200 skills, found ${skillFiles.length}`);

  const violations = [];
  for (const file of skillFiles) {
    const content = readFileSync(file, 'utf8');
    const fm = scanFrontmatter(content);
    assert.ok(fm.ok, `Frontmatter should parse in ${file}`);
    const byKey = new Map(fm.keys.map((k) => [k.key, k]));
    const descKey = byKey.get('description');
    assert.ok(descKey, `Missing description in ${file}`);
    const cd = cleanDescription(descKey);
    if (cd.length > DESC_MAX) {
      violations.push({ file, len: cd.length, desc: cd });
    }
  }

  assert.deepEqual(violations, [], `Found skills violating DESC_MAX (${DESC_MAX}): ${JSON.stringify(violations, null, 2)}`);
});
