import { test } from 'node:test';
import assert from 'node:assert';
import { validateStep, validateReport, STEP_SCHEMA, REPORT_SCHEMA } from '../lib/fabric/schema.mjs';

test('schema validation: step with all required fields', () => {
  const step = {
    schema: 'aos.fabric.step/1',
    step_id: 'step-1',
    node: 'engineer',
    role: 'build',
    kind: 'build',
    brief: '/path/to/brief.md',
    cwd: '/path/to/work',
    model_hint: { harness: 'claude' },
    timeout_s: 120,
    scope: 'worktree-write',
    allowed_writes: ['lib/**', 'src/**'],
    expected_report: '/path/to/report.json',
    attempt: 1,
    max_attempts: 2,
  };
  const { ok, errors } = validateStep(step);
  assert.strictEqual(ok, true, `Expected valid step but got errors: ${errors.join(', ')}`);
  assert.deepStrictEqual(errors, []);
});

test('schema validation: step missing required field', () => {
  const step = {
    schema: 'aos.fabric.step/1',
    step_id: 'step-1',
    // missing 'node'
    role: 'build',
  };
  const { ok, errors } = validateStep(step);
  assert.strictEqual(ok, false);
  assert(errors.some(e => e.includes('node')), `Expected node error in: ${errors.join(', ')}`);
});

test('schema validation: step with wrong schema major version', () => {
  const step = {
    schema: 'aos.fabric.step/2', // Wrong major
    step_id: 'step-1',
    node: 'engineer',
    role: 'build',
  };
  const { ok, errors } = validateStep(step);
  assert.strictEqual(ok, false);
  assert(errors.some(e => e.includes('major version')), `Expected major version error in: ${errors.join(', ')}`);
});

test('schema validation: report with all required fields', () => {
  const report = {
    schema: 'aos.fabric.report/1',
    step_id: 'step-1',
    status: 'ok',
    exit_code: 0,
    findings: [],
    artifacts: { backend: '/path/to/artifact.md' },
    files_changed: ['lib/foo.ts'],
    needs_human: false,
    executor: { name: 'aos-acp', harness: 'claude' },
  };
  const { ok, errors } = validateReport(report);
  assert.strictEqual(ok, true, `Expected valid report but got errors: ${errors.join(', ')}`);
  assert.deepStrictEqual(errors, []);
});

test('schema validation: report with invalid status', () => {
  const report = {
    schema: 'aos.fabric.report/1',
    step_id: 'step-1',
    status: 'invalid', // Must be ok, fail, or escalate
    exit_code: 0,
    findings: [],
    artifacts: {},
    needs_human: false,
    executor: {},
  };
  const { ok, errors } = validateReport(report);
  assert.strictEqual(ok, false);
  assert(errors.some(e => e.includes('status')), `Expected status error in: ${errors.join(', ')}`);
});

test('schema validation: report with invalid finding severity', () => {
  const report = {
    schema: 'aos.fabric.report/1',
    step_id: 'step-1',
    status: 'ok',
    exit_code: 0,
    findings: [
      { id: 'f1', severity: 'critical', node: 'eng', summary: 'Bad', status: 'open' } // Must be blocking or advisory
    ],
    artifacts: {},
    needs_human: false,
    executor: {},
  };
  const { ok, errors } = validateReport(report);
  assert.strictEqual(ok, false);
  assert(errors.some(e => e.includes('severity')), `Expected severity error in: ${errors.join(', ')}`);
});

test('schema validation: report with invalid finding status', () => {
  const report = {
    schema: 'aos.fabric.report/1',
    step_id: 'step-1',
    status: 'ok',
    exit_code: 0,
    findings: [
      { id: 'f1', severity: 'blocking', node: 'eng', summary: 'Bad', status: 'pending' } // Must be open, fixed, or wont_fix
    ],
    artifacts: {},
    needs_human: false,
    executor: {},
  };
  const { ok, errors } = validateReport(report);
  assert.strictEqual(ok, false);
  assert(errors.some(e => e.includes('status')), `Expected status error in: ${errors.join(', ')}`);
});

test('schema validation: report with non-object findings array item', () => {
  const report = {
    schema: 'aos.fabric.report/1',
    step_id: 'step-1',
    status: 'ok',
    exit_code: 0,
    findings: ['not an object'],
    artifacts: {},
    needs_human: false,
    executor: {},
  };
  const { ok, errors } = validateReport(report);
  assert.strictEqual(ok, false);
  assert(errors.length > 0, 'Expected errors for malformed findings');
});
