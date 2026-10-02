import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listPlaybooks, requiresLabel } from '../skills/bdb-aos/scripts/list-playbooks.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const script = join(root, 'skills', 'bdb-aos', 'scripts', 'list-playbooks.mjs');
const commands = JSON.parse(readFileSync(join(root, 'plugin-commands.json'), 'utf8')).commands;
const pbDirs = readdirSync(join(root, 'skills', 'playbooks')).filter((n) => n.startsWith('pb-')).sort();

test('list-playbooks reads every pb-* skill with est_time, difficulty and requires', () => {
  const list = listPlaybooks(join(root, 'skills'));
  assert.deepEqual(list.map((p) => p.name), pbDirs);
  for (const p of list) {
    assert.ok(p.description.length > 20, p.name);
    assert.match(p.est_time, /\S/, p.name);
    assert.match(p.difficulty, /^(beginner|intermediate|advanced)$/, p.name);
    assert.ok(p.requires.skills.length > 0, p.name);
  }
  const ci = list.find((p) => p.name === 'pb-ci-fix');
  assert.equal(ci.est_time, '15-45 min');
  assert.ok(ci.requires.skills.includes('github'));
  assert.match(requiresLabel(list.find((p) => p.name === 'pb-ship').requires), /agent:reviewer/);
});

test('list-playbooks CLI prints text and --json', () => {
  const text = execFileSync('node', [script], { encoding: 'utf8' });
  assert.match(text, new RegExp(`${pbDirs.length} playbook\\(s\\)`));
  assert.deepEqual(JSON.parse(execFileSync('node', [script, '--json'], { encoding: 'utf8' })).map((p) => p.name), pbDirs);
});

test('playbooks command calls the script, is no longer pending, and starts nothing unasked', () => {
  const c = commands.playbooks;
  assert.equal(c.pending, undefined);
  assert.match(c.bodies.claude, /scripts\/list-playbooks\.mjs/);
  assert.match(c.bodies.claude, /start nothing otherwise/);
});

const templates = ['ci-until-green', 'pr-to-merge', 'review-rounds', 'daily-summary'];
const tdir = join(root, 'skills', 'global_config', 'loop-templates');

test('every loop template has limits, a stop condition and the safety rules', () => {
  for (const t of templates) {
    const text = readFileSync(join(tdir, 'references', `${t}.md`), 'utf8');
    assert.match(text, /- Max runs: \S/, t);
    assert.match(text, /- Max duration: \S/, t);
    assert.match(text, /## Stop condition\n\S/, t);
    assert.match(text, /NEVER issues a GO/, t);
    assert.match(text, /NEVER types or runs `gogate`/, t);
    assert.match(text, /existing valid grant[^\n]*or after the human typed GO/, t);
    assert.match(text, /[Nn]ever issue a GO, never run or type gogate/, t);
  }
  const skill = readFileSync(join(tdir, 'SKILL.md'), 'utf8');
  for (const t of templates) assert.ok(skill.includes(`references/${t}.md`), t);
});

test('loop command has per-harness bodies, is no longer pending, and carries the safety rules', () => {
  const c = commands.loop;
  assert.equal(c.pending, undefined);
  assert.deepEqual(c.skills, ['loop-templates']);
  assert.match(c.bodies.claude, /built-in `\/loop/);
  assert.match(c.bodies.opencode, /opencode-loop/);
  assert.match(c.bodies.codex, /\/goal/);
  assert.match(c.bodies.codex, /no \/loop/);
  assert.match(c.bodies.agy, /[Uu]nverified, no loop mechanism confirmed/);
  assert.match(c.bodies.agy, /Manual repeat/);
  for (const [h, body] of Object.entries(c.bodies)) {
    assert.match(body, /never issues a GO/, h);
    assert.match(body, /never types or runs `gogate`/, h);
  }
});

test('skills.sh.json has one Playbooks group with every pb-* skill and no skill listed twice', () => {
  const groups = JSON.parse(readFileSync(join(root, 'skills.sh.json'), 'utf8')).groupings;
  const pb = groups.filter((g) => g.title === 'Playbooks');
  assert.equal(pb.length, 1);
  assert.deepEqual([...pb[0].skills].sort(), pbDirs);
  const all = groups.flatMap((g) => g.skills);
  assert.equal(new Set(all).size, all.length);
  assert.ok(!groups.filter((g) => g.title !== 'Playbooks').some((g) => g.skills.some((s) => s.startsWith('pb-'))));
  assert.ok(all.includes('loop-templates'));
});
