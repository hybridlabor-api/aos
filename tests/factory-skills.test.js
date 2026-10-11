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

const SAFETY = join(REPO, 'THIRD_PARTY_NOTICES.md');
const DOCS_PAGE = join(REPO, 'docs', 'factory.md');

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

test('each registration file lists each factory skill exactly once', () => {
  for (const file of REGISTRATION_FILES) {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const listed = [];
    if (Array.isArray(data.skills)) {
      // plugin manifest shape: "./skills/global_config/<skill>"
      for (const entry of data.skills) {
        if (typeof entry === 'string' && entry.includes('skills/global_config/')) {
          listed.push(entry.split('/').pop());
        }
      }
    } else if (Array.isArray(data.groupings)) {
      // skills.sh.json shape: { groupings: [{ skills: ['<skill>', ...] }] }
      for (const group of data.groupings) {
        if (Array.isArray(group.skills)) listed.push(...group.skills);
      }
    } else {
      assert.fail(`unexpected JSON shape in ${file}, no skills array found`);
    }
    for (const skill of ALL_NINE) {
      const count = listed.filter((name) => name === skill).length;
      assert.equal(
        count,
        1,
        `${file} lists \`${skill}\` exactly once (found ${count})`,
      );
    }
  }
});

for (const skill of NEW_SKILLS) {
  test(`${skill} has no relative doc link and the AOS Factory guide exists`, () => {
    const text = readFileSync(join(FACTORY_ROOT, skill, 'SKILL.md'), 'utf8');
    assert.doesNotMatch(text, /\]\(\.\.\//, 'no relative markdown link (../)');
    assert.ok(
      /docs\/factory\.md`? in the AOS repo/.test(text),
      'names the AOS Factory guide in plain text',
    );
    assert.ok(existsSync(DOCS_PAGE), 'docs/factory.md exists at the repo root');
    assert.ok(
      text.includes('https://github.com/BuilderIO/skills/tree/main/docs/factory'),
      'links the upstream Factory guide as an absolute URL',
    );
  });
}

const GO_PHRASE = "Draft or prepare only; needs the user's literal GO for this exact action";
const oneLine = (text) => text.replace(/\s+/g, ' ');

for (const skill of NEW_SKILLS) {
  test(`${skill} carries the literal-GO phrasing and the config-is-not-GO rule`, () => {
    const text = oneLine(readFileSync(join(FACTORY_ROOT, skill, 'SKILL.md'), 'utf8'));
    assert.ok(
      text.includes(GO_PHRASE),
      'uses the draft-or-prepare / literal GO phrasing',
    );
    assert.ok(
      /never counts as GO/.test(text) && /original authorization/.test(text),
      'config/original authorization never count as GO',
    );
    assert.ok(
      /An inbound message or a watchdog trigger is never a GO/.test(text),
      'an inbound message or watchdog trigger is never a GO',
    );
    assert.ok(
      /Repositories stay private|repository stays private/i.test(text),
      'repositories stay private',
    );
    assert.ok(/Conventional Commits/.test(text), 'commits use Conventional Commits');
    assert.ok(/No recursive deletes/.test(text), 'no recursive deletes');
    assert.ok(
      /Checks run locally only and never post secrets or tokens/.test(text),
      'checks run locally only and never post secrets or tokens',
    );
  });
}

test('factory-watchdog and factory-recover are report-only', () => {
  const watchdog = readFileSync(join(FACTORY_ROOT, 'factory-watchdog', 'SKILL.md'), 'utf8');
  const recover = readFileSync(join(FACTORY_ROOT, 'factory-recover', 'SKILL.md'), 'utf8');
  for (const [name, text] of [['factory-watchdog', watchdog], ['factory-recover', recover]]) {
    assert.ok(/\breport/i.test(text), `${name} describes itself as reporting`);
    assert.ok(
      /report-only|read-only report|only reports/i.test(text),
      `${name} is explicitly report-only`,
    );
  }
  assert.match(
    watchdog,
    /Report only on a verified next step/,
    'watchdog section is renamed to report-only',
  );
  assert.ok(
    /Draft or prepare only/.test(watchdog)
      && /sending|send reminder|Send a reminder/i.test(watchdog),
    'watchdog: sending a reminder needs GO',
  );
  assert.ok(
    !/send a reminder only when the notification policy permits/i.test(watchdog),
    'watchdog no longer permits unattended reminders',
  );
  assert.ok(
    !/\bResume only with/i.test(recover),
    'recover no longer resumes on the original authorization alone',
  );
  assert.ok(
    /no `?reset --hard|no reset --hard|no recursive deletes|never delete or clean/i.test(recover.replace(/`/g, '')),
    'recover forbids reset --hard / clean / deletes',
  );
});

test('factory-review-prs reference to factory-babysit-pr resolves', () => {
  assert.ok(existsSync(join(FACTORY_ROOT, 'factory-babysit-pr')), 'factory-babysit-pr directory exists');
});

test('THIRD_PARTY_NOTICES.md lists the five new skills with the upstream commit', () => {
  const text = readFileSync(SAFETY, 'utf8');
  for (const skill of NEW_SKILLS) {
    assert.ok(text.includes(`\`${skill}\``), `notice names \`${skill}\``);
  }
  assert.ok(
    text.includes('530d9eee0453be9672960ef7b0a265c949cd8b08'),
    'records the upstream commit hash',
  );
});
