import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wfPath = join(here, '..', '.github', 'workflows', 'skillspector.yml');
const wf = readFileSync(wfPath, 'utf8');
const filterPath = join(here, '..', '.github', 'scripts', 'skillspector-filter.mjs');

const baseline = JSON.parse(
  readFileSync(join(here, '..', '.github', 'skillspector-baseline.json'), 'utf8'),
);

const { evaluate, render, validateBaseline, matchesBaseline } = await import(pathToFileURL(filterPath).href);

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

test('NVIDIA install references the pinned commit and uses --no-cache-dir', () => {
  assert.match(wf, /pip install --no-cache-dir "git\+https:\/\/github\.com\/NVIDIA\/SkillSpector@\$\{SKILLSPECTOR_COMMIT\}"/);
  assert.match(wf, /SKILLSPECTOR_COMMIT:\s*c7958a3268d9498644b22edb75d0f051bbc8cbfc/);
});

test('diff is NUL-separated with core.quotepath=off and ACMR filter, read in a NUL-safe loop', () => {
  assert.match(wf, /git -c core\.quotepath=off diff -z --name-only --diff-filter=ACMR/);
  assert.match(wf, /while IFS= read -r -d '' path; do/);
});

test('Scan step fails loudly when a resolved dir is missing', () => {
  const scanStart = wf.indexOf('- name: Scan\n');
  const evaluateStart = wf.indexOf('- name: Evaluate findings');
  assert.ok(scanStart !== -1 && evaluateStart !== -1, 'Scan and Evaluate steps exist');
  const scan = wf.slice(scanStart, evaluateStart);
  assert.ok(scan.includes('[ ! -d "$dir" ]'), 'missing-dir check exists');
  assert.match(scan, /::error::Resolved skill directory missing on disk/);
  assert.match(scan, /exit 1/);
});

test('reports are indexed with .path sidecars (no double-underscore name collision)', () => {
  assert.doesNotMatch(wf, /\/\$\{?name/);
  assert.match(wf, /reports\/\$i\.json/);
  assert.match(wf, /reports\/\$i\.path/);
  assert.match(wf, /skillspector-filter\.mjs reports .* skill-dirs\.txt/);
});

// filter unit tests via exported functions
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

test('after enforce date: baselined finding (by id + skill) does not fail', () => {
  const r = evaluate({
    reports: [report('demo', [mkIssue('SH-001', 'HIGH')])],
    baseline: [{ skill: 'demo', id: 'SH-001', reason: 'ok' }],
    enforceFrom: '2026-10-21',
    today: '2026-10-22',
  });
  assert.equal(r.enforcing, true);
  assert.equal(r.fail, false);
  assert.equal(r.suppressed.length, 1);
});

test('baseline entry for one id must not suppress a different id of the same category', () => {
  const issues = [
    { id: 'A-100', category: 'category-X', severity: 'HIGH' },
    { id: 'A-200', category: 'category-X', severity: 'HIGH' },
  ];
  const r = evaluate({
    reports: [report('demo', issues)],
    baseline: [{ skill: 'demo', id: 'A-100', reason: 'ok' }],
    enforceFrom: '2026-10-21',
    today: '2026-10-22',
  });
  assert.equal(r.suppressed.length, 1);
  assert.equal(r.blocking.length, 1);
  assert.equal(r.fail, true);
});

test('baseline entry with file set only matches that file', () => {
  const issueA = { id: 'SH-001', severity: 'HIGH', location: { file: 'SKILL.md' } };
  const issueB = { id: 'SH-001', severity: 'HIGH', location: { file: 'refs.md' } };
  assert.equal(matchesBaseline(issueA, 'demo', [{ skill: 'demo', id: 'SH-001', file: 'SKILL.md', reason: 'ok' }]), true);
  assert.equal(matchesBaseline(issueB, 'demo', [{ skill: 'demo', id: 'SH-001', file: 'SKILL.md', reason: 'ok' }]), false);
});

test('baseline entry with undefined fields never matches', () => {
  const issue = { id: 'SH-001', severity: 'HIGH' };
  assert.equal(matchesBaseline(issue, 'demo', [{ skill: 'demo', reason: 'no id' }]), false);
  assert.equal(matchesBaseline(issue, 'demo', [{ id: 'SH-001', reason: 'no skill' }]), false);
});

test('baseline entries must validate: non-array/close to missing field throws', () => {
  assert.throws(() => validateBaseline({}), /must be a JSON array/);
  assert.throws(() => validateBaseline([{ skill: 'x', id: 'y' }]), /"reason" must be a non-empty string/);
  assert.throws(() => validateBaseline([{ skill: '', id: 'y', reason: 'r' }]), /"skill" must be a non-empty string/);
  assert.throws(() => validateBaseline([{ skill: 'x', id: 'y', reason: 'r', file: 1 }]), /"file" must be a string/);
  assert.doesNotThrow(() => validateBaseline([{ skill: 'x', id: 'y', reason: 'r', file: 'SKILL.md' }]));
});

test('report without issues array throws with exit code 2', () => {
  assert.throws(
    () => evaluate({ reports: [{ skill: 'demo', data: {} }], baseline: [], enforceFrom: '2026-10-21', today: '2026-10-01' }),
    (e) => e.exitCode === 2,
  );
});

test('evaluate validates the enforce date format strictly', () => {
  const args = {
    reports: [],
    baseline: [],
    today: '2026-10-22',
  };
  for (const bad of ['2026/10/21', '21-10-2026', '2026-10-2', 'abcd', '2026-10-21 ', '']) {
    assert.throws(() => evaluate({ ...args, enforceFrom: bad }), (e) => e.exitCode === 2, `bad: ${bad}`);
  }
  assert.doesNotThrow(() => evaluate({ ...args, enforceFrom: '2026-10-21' }));
});

test('date compare is UTC string order (equal date enforces)', () => {
  const r = evaluate({
    reports: [report('demo', [mkIssue('SH-001', 'HIGH')])],
    baseline: [],
    enforceFrom: '2026-10-21',
    today: '2026-10-21',
  });
  assert.equal(r.enforcing, true);
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

test('annotation escapes ":" and "," in property values', () => {
  const r = evaluate({
    reports: [report('demo', [{ id: 'SH-001', severity: 'HIGH', location: { file: 'a,b:c.md', start_line: 3 } }])],
    baseline: [],
    enforceFrom: '2026-10-21',
    today: '2026-10-01',
  });
  const { annotations } = render(r);
  assert.match(annotations[0], /file=a%2Cb%3Ac\.md/);
  assert.doesNotMatch(annotations[0], /file=a,b:c\.md/);
});

test('summary table cells are code spans with "|", backtick and newline escaped/replaced', () => {
  const r = evaluate({
    reports: [report('de|mo`x\ny', [{ id: 'SH|001', severity: 'HIGH', location: { file: 'a\nb|c.md' } }])],
    baseline: [],
    enforceFrom: '2026-10-21',
    today: '2026-10-22',
  });
  const { summary } = render(r);
  const rows = summary.split('\n').filter((l) => l.startsWith('| '));
  const header = rows.filter((l) => /Severity/.test(l));
  const dataRows = rows.filter((l) => l.includes('`'));
  // header exactly 1 line; an unescaped pipe would have split rows
  assert.equal(header.length, 1);
  assert.match(dataRows[0] ?? '', /\| `/);
  assert.match(summary, /\\`/);
  // a 4-column GFM row has exactly 5 raw pipes (leading, 3 separators, trailing);
  // adversarial '|' / newline inside cells must not change the pipe count per row
  const rawPipes = (row) => (row.match(/(?<!\\)\|/g) ?? []).length;
  assert.equal(rawPipes(header[0]), 5, `header pipe count changed: ${header[0]}`);
  assert.equal(rawPipes(dataRows[0] ?? ''), rawPipes(header[0]), `unescaped pipes leaked: ${dataRows[0]}`);
  assert.match(dataRows[0] ?? '', /`SH\\|001`/);
});

// --- end-to-end filter via spawn with fixture reports in a temp dir under os.tmpdir() ---
const FILTER = filterPath;

function makeFixture({ reports, baselineJson, skillDirs, enforceFrom = '2026-10-21' }) {
  const tmpRoot = mkdtempSync(join(os.tmpdir(), 'skillspector-test-'));
  const dir = join(tmpRoot, 'reports');
  mkdirSync(dir);
  reports.forEach(([idx, skill, issues]) => {
    writeFileSync(join(dir, `${idx}.json`), JSON.stringify({ issues }));
    if (skill !== null) writeFileSync(join(dir, `${idx}.path`), skill);
  });
  if (skillDirs !== null) writeFileSync(join(dir, 'skill-dirs.txt'), skillDirs.join('\n') + '\n');
  const baselinePath = join(tmpRoot, 'baseline.json');
  if (baselineJson !== null) writeFileSync(baselinePath, JSON.stringify(baselineJson));
  return { dir, baselinePath, enforceFrom };
}

function runFilter({ reports, baselineJson, skillDirs, enforceFrom }) {
  const fx = makeFixture({ reports, baselineJson, skillDirs, enforceFrom });
  const args = [FILTER, fx.dir, fx.baselinePath, fx.enforceFrom];
  if (skillDirs !== null) args.push(join(fx.dir, 'skill-dirs.txt'));
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

test('spawn: missing issues array -> exit 2', () => {
  const res = runFilter({
    reports: [[1, 'demo', 'not-an-array']],
    baselineJson: [],
    skillDirs: ['demo'],
    enforceFrom: '2026-10-21',
  });
  assert.equal(res.status, 2);
});

test('spawn: report count mismatch with skill-dirs.txt -> exit 2', () => {
  const res = runFilter({
    reports: [[1, 'demo', []]],
    baselineJson: [],
    skillDirs: ['demo', 'other'],
    enforceFrom: '2026-10-21',
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /Report count \(1\) does not match scanned skill dirs \(2\)/);
});

test('spawn: baseline schema violation -> exit 2 at load', () => {
  const res = runFilter({
    reports: [[1, 'demo', []]],
    baselineJson: [{ skill: 'demo' }],
    skillDirs: ['demo'],
    enforceFrom: '2026-10-21',
  });
  assert.equal(res.status, 2);
});

test('spawn: invalid enforce date -> exit 2', () => {
  const res = runFilter({
    reports: [[1, 'demo', []]],
    baselineJson: [],
    skillDirs: ['demo'],
    enforceFrom: '2026-21-10',
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /Invalid SKILLSPECTOR_ENFORCE_FROM/);
});

test('spawn: matching report count passes before enforce date', () => {
  const res = runFilter({
    reports: [[1, 'demo', [{ id: 'SH-001', severity: 'HIGH' }]]],
    baselineJson: [],
    skillDirs: ['demo'],
    enforceFrom: '2999-01-01', // the spawned filter uses the real date; a fixed near date turns into a time bomb
  });
  assert.equal(res.status, 0);
});

test('spawn: enforcing block fails with exit 1', () => {
  const res = runFilter({
    reports: [[1, 'demo', [{ id: 'SH-001', severity: 'HIGH' }]]],
    baselineJson: [],
    skillDirs: ['demo'],
    enforceFrom: '2000-01-01',
  });
  assert.equal(res.status, 1);
});

test('spawn: missing sidecar .path file -> exit 2', () => {
  const res = runFilter({
    reports: [[1, null, []]],
    baselineJson: [],
    skillDirs: ['demo'],
    enforceFrom: '2026-10-21',
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /sidecar 1\.path/);
});

// baseline on disk must itself be schema-valid
test('repo baseline validates', () => {
  assert.doesNotThrow(() => validateBaseline(baseline));
});
