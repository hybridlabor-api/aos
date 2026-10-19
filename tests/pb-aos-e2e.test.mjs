import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const skillPath = join(root, 'skills', 'playbooks', 'pb-aos-e2e', 'SKILL.md');
const scriptPath = join(root, 'scripts', 'e2e', 'aos-e2e.sh');

test('pb-aos-e2e playbook frontmatter is a complete playbook', () => {
  const text = readFileSync(skillPath, 'utf8');
  assert.match(text, /^---\n/, 'frontmatter block opens');
  const fm = text.split(/^---\n/m)[1];
  assert.ok(fm, 'frontmatter block present');
  for (const key of ['name', 'description', 'category', 'kind', 'trigger', 'inputs', 'requires', 'go_points', 'outputs', 'verify', 'difficulty', 'est_time']) {
    assert.match(fm, new RegExp(`^${key}:`, 'm'), () => `missing key ${key}`);
  }
  assert.match(fm, /^name: pb-aos-e2e$/m, 'name matches the directory name');
  assert.match(fm, /^kind: playbook$/m);
  assert.match(fm, /^difficulty: (beginner|intermediate|advanced)$/m);
  assert.match(fm, /^est_time: \S/m);
  assert.match(fm, /skills: \[[^\]]+\]/, 'requires.skills is a flow-style list with at least one skill');
  assert.match(fm, /^category: engineering-method$/m);
});

test('pb-aos-e2e covers every task step with a pass/fail judgement', () => {
  const body = readFileSync(skillPath, 'utf8').split(/^---\n/m).slice(2).join('---\n');
  for (const step of ['npm pack', 'aos doctor', 'go-gate', 'v5-settings', 'measure-session-context',
    'memb-inject', 'plan-canvas', 'aos hub', 'aos update', 'aos-uninstall', 'GO']) {
    assert.ok(body.includes(step), `step mention missing: ${step}`);
  }
  assert.match(body, /Pass:/, 'steps carry pass criteria');
  assert.match(body, /Fail:/, 'steps carry fail criteria');
  assert.match(body, /aos-ci-run/, 'netcup sandbox runner named');
  assert.match(body, /node:24-bookworm/, 'docker fallback named');
});

test('aos-e2e.sh passes bash -n and its basic shapes hold', () => {
  execFileSync('bash', ['-n', scriptPath], { stdio: 'pipe' });
  const text = readFileSync(scriptPath, 'utf8');
  assert.ok(text.startsWith('#!/usr/bin/env bash'), 'bash shebang');
  assert.match(text, /set -euo pipefail/, 'strict mode');
  assert.match(text, /AOS_TEST_SANDBOX/, 'sandbox guard so a real HOME can never be touched');
  assert.match(text, /summary\.txt/, 'writes the summary');
  assert.match(text, /SKIP /, 'SKIP lines for browser and harness steps');
  const passes = text.match(/step_pass /g) || [];
  const skips = text.match(/step_skip /g) || [];
  const fails = text.match(/step_fail /g) || [];
  assert.ok(passes.length > 0 && skips.length > 0 && fails.length > 0, 'each verdict form is reachable');
  // headless script runs the commands the playbook names for headless steps
  for (const needle of ['aos doctor', 'aos-uninstall --yes', 'aos hub']) {
    assert.ok(text.includes(needle), `script should run: ${needle}`);
  }
});
