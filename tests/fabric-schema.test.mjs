import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failReport, GATE_KEYS, stateFinding, STEP_KINDS, validateReport, validateStep } from '../lib/fabric/schema.mjs';

const step = (over = {}) => ({
  schema: 'aos.fabric.step/1', run: 'r', step_id: '0-architect-1', node: 'architect', role: 'architect', kind: 'plan',
  brief: '/x/brief.md', cwd: '/x', model_hint: {}, timeout_s: 900, scope: 'read-only', allowed_writes: ['production_artifacts/**'],
  expected_report: '/x/report.json', attempt: 1, max_attempts: 2, ...over,
});
const report = (over = {}) => ({ schema: 'aos.fabric.report/1', step_id: '0-architect-1', status: 'ok', ...over });

test('a complete step is valid', () => {
  assert.deepEqual(validateStep(step()), { ok: true, errors: [] });
});

test('a step with unknown fields of the same major stays valid', () => {
  assert.equal(validateStep(step({ future: true, schema: 'aos.fabric.step/1.4' })).ok, true);
});

test('another major version is rejected, not guessed', () => {
  const r = validateStep(step({ schema: 'aos.fabric.step/2' }));
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /unsupported step major version 2/);
  assert.match(validateReport(report({ schema: 'aos.fabric.report/2' })).errors[0], /unsupported report major version 2/);
});

test('a schema id of another kind or without a version is rejected', () => {
  for (const schema of ['aos.fabric.report/1', 'foo/1', 'aos.fabric.step', 'aos.fabric.step/x', undefined, 7]) {
    assert.equal(validateStep(step({ schema })).ok, false, String(schema));
  }
});

test('step: every field is checked', () => {
  const cases = [
    [{ step_id: 'architect' }, /step_id/], [{ node: '' }, /node/], [{ kind: 'deploy' }, /kind/], [{ scope: 'root' }, /scope/],
    [{ timeout_s: 0 }, /timeout_s/], [{ attempt: 1.5 }, /attempt/], [{ allowed_writes: 'all' }, /allowed_writes/],
    [{ allowed_writes: [1] }, /allowed_writes/], [{ model_hint: [] }, /model_hint/], [{ brief: '' }, /brief/], [{ expected_report: 3 }, /expected_report/],
  ];
  for (const [over, re] of cases) {
    const r = validateStep(step(over));
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.ok(r.errors.some((e) => re.test(e)), `${JSON.stringify(over)} -> ${r.errors}`);
  }
  assert.equal(validateStep(null).ok, false);
  assert.equal(validateStep([]).ok, false);
});

test('every step kind of the plan exists', () => {
  assert.deepEqual([...STEP_KINDS].sort(), ['build', 'human', 'plan', 'review', 'ship', 'techlead']);
});

test('a minimal report needs only schema, step_id and status and gets defaults', () => {
  const r = validateReport(report());
  assert.equal(r.ok, true, r.errors?.join());
  assert.deepEqual(
    { exit_code: r.report.exit_code, findings: r.report.findings, artifacts: r.report.artifacts, files_changed: r.report.files_changed, needs_human: r.report.needs_human, executor: r.report.executor },
    { exit_code: 0, findings: [], artifacts: {}, files_changed: [], needs_human: false, executor: {} },
  );
  assert.equal(validateReport(report({ status: 'fail' })).report.exit_code, 1);
});

test('report: unknown fields of the same major are kept, the input is not changed', () => {
  const input = report({ extra: { a: 1 } });
  const r = validateReport(input);
  assert.deepEqual(r.report.extra, { a: 1 });
  assert.equal('findings' in input, false);
});

test('report: missing or wrong required fields are listed', () => {
  assert.equal(validateReport({}).ok, false);
  assert.ok(validateReport(report({ status: 'done' })).errors.some((e) => /status/.test(e)));
  assert.ok(validateReport(report({ step_id: '' })).errors.some((e) => /step_id/.test(e)));
  assert.equal(validateReport('text').ok, false);
});

test('report: findings are validated item by item', () => {
  const good = { id: 'f1', severity: 'blocking', node: 'engineering', status: 'open', summary: 's' };
  assert.equal(validateReport(report({ findings: [good] })).ok, true);
  for (const bad of [{ ...good, id: '' }, { ...good, severity: 'fatal' }, { ...good, status: 'done' }, { ...good, node: 'Not A Node' }, { ...good, summary: 5 }, 'x']) {
    assert.equal(validateReport(report({ findings: [bad] })).ok, false, JSON.stringify(bad));
  }
  assert.equal(validateReport(report({ findings: 'none' })).ok, false);
  assert.equal(validateReport(report({ findings: Array.from({ length: 201 }, (_, i) => ({ ...good, id: `f${i}` })) })).ok, false);
});

test('report: artifacts, gate, optional_nodes, files_changed and needs_human are typed', () => {
  assert.equal(validateReport(report({ artifacts: { plan: 'a.md' } })).ok, true);
  assert.equal(validateReport(report({ artifacts: { plan: 3 } })).ok, false);
  assert.equal(validateReport(report({ artifacts: [] })).ok, false);
  assert.equal(validateReport(report({ gate: Object.fromEntries(GATE_KEYS.map((k) => [k, 'pass'])) })).ok, true);
  assert.equal(validateReport(report({ gate: { lint: 'maybe' } })).ok, false);
  assert.equal(validateReport(report({ optional_nodes: ['media_eventtech'] })).ok, true);
  assert.equal(validateReport(report({ optional_nodes: ['Media'] })).ok, false);
  assert.equal(validateReport(report({ files_changed: [1] })).ok, false);
  assert.equal(validateReport(report({ needs_human: 'yes' })).ok, false);
  assert.equal(validateReport(report({ exit_code: 'x' })).ok, false);
});

test('stateFinding keeps exactly the keys the state schema allows and caps the summary', () => {
  const f = stateFinding({ id: 'a', severity: 'blocking', node: 'n', status: 'open', summary: 'x'.repeat(9000), updated: true });
  assert.deepEqual(Object.keys(f).sort(), ['id', 'node', 'severity', 'status', 'summary']);
  assert.equal(f.summary.length, 4000);
  assert.equal(stateFinding({ id: 'a', severity: 'advisory', node: 'n', status: 'fixed' }).summary, '');
});

test('failReport is a valid failed report that names the step and node', () => {
  const r = failReport({ step_id: '0-architect-1', node: 'architect' }, 'timeout', 'too slow', 124, { name: 'x' });
  assert.equal(validateReport(r).ok, true);
  assert.equal(r.status, 'fail');
  assert.equal(r.exit_code, 124);
  assert.equal(r.findings[0].node, 'architect');
});
