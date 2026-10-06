import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wfPath = join(here, '..', '.github', 'workflows', 'skillspector.yml');
const wf = readFileSync(wfPath, 'utf8');

const baseline = JSON.parse(
  readFileSync(join(here, '..', '.github', 'skillspector-baseline.json'), 'utf8'),
);

const { evaluate, render } = await import(
  join(here, '..', '.github', 'scripts', 'skillspector-filter.mjs')
);

const wfLines = wf.split('\n');

// Returns the indented body lines that follow a top-level (2-space) key.
function section(topLevelKey) {
  const i = wfLines.indexOf(topLevelKey);
  if (i === -1) return null;
  const out = [];
  for (let j = i + 1; j < wfLines.length; j++) {
    const line = wfLines[j];
    if (line === '' || !line.startsWith(' ')) break;
    out.push(line);
  }
  return out;
}

test('permissions block is exactly contents: read', () => {
  const block = section('permissions:');
  assert.ok(block, 'permissions block exists');
  assert.equal(block.join('\n').trimEnd(), '  contents: read');
});

test('no pull_request_target trigger', () => {
  assert.doesNotMatch(wf, /pull_request_target/);
});

test('every uses: line is pinned to a 40-hex SHA', () => {
  const uses = [...wf.matchAll(/uses:\s*(.+)/g)].map((m) => m[1].trim());
  assert.ok(uses.length > 0);
  for (const u of uses) {
    const m = u.match(/^([\w./-]+)@([0-9a-f]{40})(?:\s*#.*)?$/);
    assert.ok(m, `unpinned uses: ${u}`);
  }
});

test('timeout-minutes is present and <= 10', () => {
  const m = /timeout-minutes:\s*(\d+)/.exec(wf);
  assert.ok(m, 'timeout-minutes present');
  assert.ok(Number(m[1]) <= 10);
});

test('triggers include pull_request and push with skills/** paths', () => {
  const pr = section('  pull_request:');
  const push = section('  push:');
  assert.ok(pr, 'pull_request trigger exists');
  assert.ok(push, 'push trigger exists');
  assert.ok(pr.includes('    paths:'), 'pull_request has paths:');
  assert.ok(push.includes('    paths:'), 'push has paths:');
  assert.match(wf, /-\s*'skills\/\*\*'/);
});

test('--no-llm is present', () => {
  assert.match(wf, /--no-llm/);
});

test('NVIDIA install references the pinned commit', () => {
  assert.match(wf, /github\.com\/NVIDIA\/SkillSpector@\$\{SKILLSPECTOR_COMMIT\}/);
  assert.match(wf, /SKILLSPECTOR_COMMIT:\s*c7958a3268d9498644b22edb75d0f051bbc8cbfc/);
});

test('concurrency cancel-in-progress only on pull_request', () => {
  assert.match(wf, /cancel-in-progress:\s*\$\{\{ github\.event_name == 'pull_request' \}\}/);
});

test('SKILLSPECTOR_ENFORCE_FROM is 2026-10-21', () => {
  assert.match(wf, /SKILLSPECTOR_ENFORCE_FROM:\s*'2026-10-21'/);
});

// baseline
test('baseline parses as JSON array', () => {
  assert.ok(Array.isArray(baseline));
});

// filter unit tests via exported evaluate()
const mkIssue = (id, severity) => ({ id, severity, category: id });
const report = (skill, issues) => ({ skill, data: { issues } });

test('before enforce date: high finding only warns (no fail)', () => {
  const r = evaluate({
    reports: [report('demo', [mkIssue('SH-001', 'HIGH')])],
    baseline: [],
    enforceFrom: '2026-10-21',
    today: '2026-10-01',
  });
  assert.equal(r.enforcing, false);
  assert.equal(r.fail, false);
  assert.equal(r.blocking.length, 1);
});

test('after enforce date: high finding not in baseline fails', () => {
  const r = evaluate({
    reports: [report('demo', [mkIssue('SH-001', 'HIGH')])],
    baseline: [],
    enforceFrom: '2026-10-21',
    today: '2026-10-22',
  });
  assert.equal(r.enforcing, true);
  assert.equal(r.fail, true);
});

test('after enforce date: baselined finding does not fail', () => {
  const r = evaluate({
    reports: [report('demo', [mkIssue('SH-001', 'HIGH')])],
    baseline: [{ skill: 'demo', rule: 'SH-001' }],
    enforceFrom: '2026-10-21',
    today: '2026-10-22',
  });
  assert.equal(r.enforcing, true);
  assert.equal(r.fail, false);
  assert.equal(r.suppressed.length, 1);
});

test('low findings never fail, even after enforce date', () => {
  const r = evaluate({
    reports: [report('demo', [mkIssue('SL-001', 'LOW'), mkIssue('SM-001', 'MEDIUM')])],
    baseline: [],
    enforceFrom: '2026-10-21',
    today: '2026-10-22',
  });
  assert.equal(r.enforcing, true);
  assert.equal(r.fail, false);
});

test('render produces summary table and annotations', () => {
  const r = evaluate({
    reports: [report('demo', [{ id: 'SH-001', severity: 'HIGH', location: { file: 'a.md', start_line: 3 } }])],
    baseline: [],
    enforceFrom: '2026-10-21',
    today: '2026-10-01',
  });
  const { summary, annotations } = render(r);
  assert.match(summary, /\| Skill \| Severity \|/);
  assert.match(annotations[0], /::warning/);
});
