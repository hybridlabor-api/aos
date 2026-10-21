import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOOP_DIR = join(REPO, 'skills', 'global_config', 'loop-templates');
const FLOW_LOOP_MD = join(LOOP_DIR, 'references', 'flow-loop.md');
const LOOP_SKILL_MD = join(LOOP_DIR, 'SKILL.md');

test('flow-loop template exists and conforms to standard loop-templates structure', () => {
  assert.ok(existsSync(FLOW_LOOP_MD), 'references/flow-loop.md must exist');
  const text = readFileSync(FLOW_LOOP_MD, 'utf8');

  // Limits
  assert.match(text, /- Max runs: \S+/, 'must specify max runs');
  assert.match(text, /- Max duration: \S+/, 'must specify max duration');
  assert.match(text, /3 to 5 rounds/, 'max runs must reference 3 to 5 rounds by effort S=3, M=4, L=5');

  // Stop conditions
  assert.match(text, /## Stop condition\n\S+/, 'must have a stop condition heading and body');
  assert.match(text, /blocking/, 'stop condition must check blocking findings');
  assert.match(text, /quality gates/, 'stop condition must check quality gates');
  assert.match(text, /no-progress guard/, 'stop condition must include no-progress guard');
  assert.match(text, /stay-within-limits/, 'stop condition must include stay-within-limits');

  // Safety rules (verbatim across all templates)
  assert.match(text, /NEVER issues a GO/, 'must contain verbatim GO safety rule');
  assert.match(text, /NEVER types or runs `gogate`/, 'must contain verbatim gogate safety rule');
  assert.match(text, /immediately preceding message is a literal GO or a valid grant/, 'must contain grant check rule');
  assert.match(text, /loop iteration never satisfies the first condition: STOP and report/, 'must contain stop-and-report rule');
  assert.match(text, /[Nn]ever issue a GO, never run or type gogate/, 'prompt template must state no GO / no gogate');
  assert.ok(!/after the human typed GO/.test(text), 'must not contain loose GO phrasing');
});

test('loop-templates SKILL.md indexes flow-loop and describes its mechanics', () => {
  const skill = readFileSync(LOOP_SKILL_MD, 'utf8');
  assert.ok(skill.includes('references/flow-loop.md'), 'SKILL.md table must link flow-loop.md');
  assert.match(skill, /## Flow loop/i, 'SKILL.md must have a section describing flow loop');
  assert.match(skill, /no-progress guard/i, 'SKILL.md must mention no-progress guard');
  assert.match(skill, /stay-within-limits/i, 'SKILL.md must mention stay-within-limits check');
  assert.match(skill, /effort/i, 'SKILL.md must mention effort mapping');
});

test('fabric family skills contain Teams and roles section with required registry concepts', () => {
  const skillsToCheck = [
    join(REPO, 'skills', 'basic', 'fabric-graph', 'SKILL.md'),
    join(REPO, 'skills', 'basic', 'fabric-multigraph', 'SKILL.md'),
    join(REPO, 'skills', 'basic', 'fabric-teamwork', 'SKILL.md'),
  ];

  for (const skillPath of skillsToCheck) {
    assert.ok(existsSync(skillPath), `skill file ${skillPath} must exist`);
    const content = readFileSync(skillPath, 'utf8');

    // Required section title
    assert.match(content, /## Teams and roles/, `${skillPath} must have '## Teams and roles' section`);

    // Required concepts from WP4 specification
    assert.match(content, /aos-team (?:list|show|new)/, `${skillPath} must mention 'aos-team list|show|new' CLI commands`);
    assert.match(content, /requires:/, `${skillPath} must mention playbook 'requires' derivation`);
    assert.match(content, /S`?\s*=\s*3.+M`?\s*=\s*4.+L`?\s*=\s*5/s, `${skillPath} must mention effort rounds (S=3, M=4, L=5)`);
    assert.match(content, /before.+during.+after/s, `${skillPath} must mention playbook phases (before/during/after)`);
    assert.match(content, /ad hoc roles.*TechLead approval/is, `${skillPath} must mention ad hoc roles requiring TechLead approval`);
  }
});
