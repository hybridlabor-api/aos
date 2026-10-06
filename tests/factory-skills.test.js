#!/usr/bin/env node
// Task 24 phase 2: contract for the five newly ported BuilderIO/skills
// Factory skills plus the complete nine-skill registration set.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FACTORY_ROOT = join(REPO, 'skills', 'global_config');

const NEW_SKILLS = [
  'factory',
  'factory-babysit-pr',
  'factory-ship',
  'factory-watchdog',
  'factory-recover',
];
const ALL_NINE = [
  ...NEW_SKILLS,
  'factory-collect',
  'factory-lookback',
  'factory-human-digest',
  'factory-review-prs',
];

const REGISTRATION_FILES = [
  join(REPO, '.claude-plugin', 'plugin.json'),
  join(REPO, 'plugins', 'bdb-aos', '.claude-plugin', 'plugin.json'),
  join(REPO, 'plugins', 'bdb-aos', 'plugin.json'),
  join(REPO, 'skills.sh.json'),
];

const SAFTY = join(REPO, 'THIRD_PARTY_NOTICES.md');

function frontmatter(text) {
  assert.match(text, /^---\n/, 'SKILL.md must start with a --- frontmatter block');
  const end = text.indexOf('\n---\n', 1);
  assert.notEqual(end, -1, 'frontmatter block must be closed');
  const fm = text.slice(1, end + 1);
  const pick = (key) => {
    const re = new RegExp(`^${key}:\\s*(.+)$`, 'm') // single-line value
      ;
    const inline = re.exec(fm);
    if (inline && !/^[>|]/.test(inline[1].trim())) return inline[1].trim();
    // folded (>-, >) scalar: first indented onward is part of the value
    const folded = new RegExp(`^${key}:\\s*>-?\\n((?:[ \\t]+.*)\\n(?:\\n?[ \\t]+.*)*)`, 'm').exec(fm);
    if (folded) return folded[1].split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
    return undefined;
  };
  return { fm, pick };
}

for (const skill of NEW_SKILLS) {
  test(`${skill}/SKILL.md exists with valid frontmatter`, () => {
    const file = join(FACTORY_ROOT, skill, 'SKILL.md');
    assert.ok(existsSync(file), `file exists: ${skill}/SKILL.md`);
    const text = readFileSync(file, 'utf8');
    const { pick } = frontmatter(text);
    assert.equal(pick('name'), skill, 'frontmatter name equals the directory name');
    assert.ok(pick('category'), 'frontmatter has category');
    assert.match(pick('source'), /^BuilderIO\/skills$/, 'source is BuilderIO/skills');
    assert.ok(pick('description') && pick('description').length > 10, 'frontmatter has a description');
  });
}

// Skills whose upstream text performs external writes (push, merge, release,
// reply, close, approve, recover) must carry the AOS safety rules / GO gate.
const WRITE_SKILLS = [...NEW_SKILLS, 'factory-collect', 'factory-lookback', 'factory-review-prs'];
for (const skill of WRITE_SKILLS) {
  test(`${skill} is GO-gated via the AOS safety rules section`, () => {
    const text = readFileSync(join(FACTORY_ROOT, skill, 'SKILL.md'), 'utf8');
    assert.ok(text.includes('## AOS safety rules'), 'has the AOS safety rules section');
    assert.ok(/\bGO\b/.test(text), 'mentions the user GO gate');
  });
}

test('all nine factory skills are present in each registration file', () => {
  for (const file of REGISTRATION_FILES) {
    const content = readFileSync(file, 'utf8');
    for (const skill of ALL_NINE) {
      assert.ok(
        content.includes(skill),
        `${file} registers ${skill}`,
      );
    }
  }
});

test('factory-review-prs reference to factory-babysit-pr resolves', () => {
  assert.ok(existsSync(join(FACTORY_ROOT, 'factory-babysit-pr')), 'factory-babysit-pr directory exists');
});

test('THIRD_PARTY_NOTICES.md lists the five new skills with the upstream commit', () => {
  const text = readFileSync(SAFTY, 'utf8');
  for (const skill of NEW_SKILLS) {
    assert.ok(text.includes(`\`${skill}\``), `notice names \`${skill}\``);
  }
  assert.ok(
    text.includes('530d9eee0453be9672960ef7b0a265c949cd8b08'),
    'records the upstream commit hash',
  );
});
