import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

// The shape the advisor contract tells the dispatcher to run at call point 2.
const CAPTURE_SHAPE = /aos-evolve capture --error "<[^"]+>" --skill <[^>]+>/;

test('advisor skill and agent name call point 2 and the capture command', () => {
  for (const file of [['skills', 'basic', 'advisor', 'SKILL.md'], ['agents', 'advisor.md']]) {
    const text = read(...file);
    assert.match(text, /call point 2/i, `${file.join('/')} must name call point 2`);
    assert.match(text, CAPTURE_SHAPE, `${file.join('/')} must give the exact aos-evolve capture shape`);
  }
});

test('advisor capture shape matches the aos-evolve CLI spec', async () => {
  const specs = (await import('../lib/cli-specs/agents.mjs')).default;
  const spec = specs.find((s) => s.name === 'aos-evolve');
  assert.ok(spec, 'aos-evolve must have a CLI spec');
  assert.ok(
    spec.usage.some((u) => u.startsWith('aos-evolve capture <failure.json | --error "..."> [--skill <name>]')),
    'CLI spec must document capture with --error and --skill'
  );
  const flagNames = spec.flags.map((f) => f.name);
  assert.ok(flagNames.includes('--error'), 'CLI spec must define --error');
  assert.ok(flagNames.includes('--skill'), 'CLI spec must define --skill');
  // The documented command must use only flags the spec defines.
  const skill = read('skills', 'basic', 'advisor', 'SKILL.md');
  const used = skill.match(/aos-evolve capture ([^`\n]*)/)[1].match(/--[a-z-]+/g) || [];
  for (const flag of used) {
    assert.ok(flagNames.includes(flag), `flag ${flag} used by the advisor must exist in the CLI spec`);
  }
});

test('advisor docs describe the call point 2 capture and the silent skip when evolve is off', () => {
  const docs = read('docs', 'agent-models.md');
  const section = docs.split('## advisor role')[1];
  assert.ok(section, 'docs has an advisor role section');
  assert.match(section, /call point 2/i);
  assert.match(section, CAPTURE_SHAPE);
  assert.match(section, /AOS_EVOLVE=off/);
});
