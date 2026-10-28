import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { verifyPlanApproval } from '../lib/fabric-plan-approval.mjs';
import { deduplicateFindings, normalizeComparisonKey } from '../lib/fabric-review-dedupe.mjs';

function computeHash(content) {
  return createHash('sha256').update(content).digest('hex');
}

test('verifyPlanApproval with valid sidecar', () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'fabric-test-'));
  try {
    const planPath = path.join(tmpDir, 'plan.md');
    const content = 'Test plan content';
    writeFileSync(planPath, content);

    const hash = computeHash(content);
    const approvalPath = path.join(tmpDir, 'plan.approval.json');
    const approval = {
      schema: 'aos.plan-approval/1',
      verdict: 'approve',
      contentHash: hash,
      timestamp: new Date().toISOString(),
      source: 'plan-canvas'
    };
    writeFileSync(approvalPath, JSON.stringify(approval));

    const result = verifyPlanApproval(planPath);
    assert.strictEqual(result.valid, true, 'should validate correct approval');
    assert.strictEqual(result.hash, hash, 'should return correct hash');
    assert.deepStrictEqual(result.approval, approval, 'should return approval record');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('verifyPlanApproval accepts an upper-case hash and a BOM written by Windows tools', () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'fabric-test-'));
  try {
    const planPath = path.join(tmpDir, 'plan.md');
    writeFileSync(planPath, 'Test plan content');
    const record = { verdict: 'approve', contentHash: computeHash('Test plan content').toUpperCase() };
    writeFileSync(path.join(tmpDir, 'plan.approval.json'), '\uFEFF' + JSON.stringify(record));

    assert.strictEqual(verifyPlanApproval(planPath).valid, true);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('verifyPlanApproval with wrong hash', () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'fabric-test-'));
  try {
    const planPath = path.join(tmpDir, 'plan.md');
    const content = 'Test plan content';
    writeFileSync(planPath, content);

    const wrongHash = 'badhash' + computeHash('different content');
    const approvalPath = path.join(tmpDir, 'plan.approval.json');
    const approval = {
      schema: 'aos.plan-approval/1',
      verdict: 'approve',
      contentHash: wrongHash,
      source: 'plan-canvas'
    };
    writeFileSync(approvalPath, JSON.stringify(approval));

    const result = verifyPlanApproval(planPath);
    assert.strictEqual(result.valid, false, 'should reject wrong hash');
    assert.match(result.reason, /does not match/, 'should report hash mismatch');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('verifyPlanApproval with missing sidecar', () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'fabric-test-'));
  try {
    const planPath = path.join(tmpDir, 'plan.md');
    const content = 'Test plan content';
    writeFileSync(planPath, content);

    const result = verifyPlanApproval(planPath);
    assert.strictEqual(result.valid, false, 'should fail when sidecar missing');
    assert.match(result.reason, /could not read/i, 'should report read failure');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('verifyPlanApproval with malformed JSON', () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'fabric-test-'));
  try {
    const planPath = path.join(tmpDir, 'plan.md');
    const content = 'Test plan content';
    writeFileSync(planPath, content);

    const approvalPath = path.join(tmpDir, 'plan.approval.json');
    writeFileSync(approvalPath, '{invalid json}');

    const result = verifyPlanApproval(planPath);
    assert.strictEqual(result.valid, false, 'should fail on malformed JSON');
    assert.match(result.reason, /could not read/i, 'should report parse error');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('verifyPlanApproval refuses a record that is not an approval of this plan', () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'fabric-test-'));
  try {
    const planPath = path.join(tmpDir, 'plan.md');
    writeFileSync(planPath, 'Test plan content');
    const hash = computeHash('Test plan content');

    const cases = [
      [{ verdict: 'request-changes', contentHash: hash }, /not "approve"/],
      [{ verdict: 'approve' }, /missing contentHash/],
      [null, /not a valid JSON object/],
    ];
    for (const [record, reason] of cases) {
      writeFileSync(path.join(tmpDir, 'plan.approval.json'), JSON.stringify(record));
      const result = verifyPlanApproval(planPath);
      assert.strictEqual(result.valid, false, JSON.stringify(record));
      assert.match(result.reason, reason);
    }
    assert.strictEqual(verifyPlanApproval(path.join(tmpDir, 'gone.md')).valid, false, 'a missing plan file is refused');
    assert.strictEqual(verifyPlanApproval('').valid, false, 'no plan path is refused');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('deduplicateFindings merges by file:line:title', () => {
  const findings = [
    { file: 'src/app.ts', line: 10, summary: 'unused variable', severity: 'advisory', agent: 'reviewer-1' },
    { file: 'src/app.ts', line: 10, summary: 'unused variable', severity: 'blocking', agent: 'code-reviewer' },
    { file: 'src/api.ts', line: 5, summary: 'sql injection risk', severity: 'blocking', agent: 'reviewer-2' },
  ];

  const deduped = deduplicateFindings(findings);
  assert.strictEqual(deduped.length, 2, 'should have 2 unique findings');
  assert.strictEqual(deduped[0].severity, 'blocking', 'should upgrade severity to blocking');
  assert.deepStrictEqual(deduped[0].sources, ['reviewer-1', 'code-reviewer'], 'should track both sources');
});

test('deduplicateFindings normalizes titles', () => {
  const findings = [
    { file: 'src/x.ts', line: 10, summary: 'Missing error handler!!!', severity: 'blocking', agent: 'reviewer-1' },
    { file: 'src/x.ts', line: 10, summary: 'missing error handler', severity: 'advisory', agent: 'reviewer-2' },
  ];

  const deduped = deduplicateFindings(findings);
  assert.strictEqual(deduped.length, 1, 'should merge normalized titles');
  assert.strictEqual(deduped[0].severity, 'blocking', 'should take highest severity');
  assert.strictEqual(deduped[0].sources.length, 2, 'should list both sources');
});

test('normalizeComparisonKey uses node and title, and the location when given', () => {
  const finding = { node: 'engineering', summary: 'Missing Error Handler!!' };
  assert.equal(normalizeComparisonKey(finding), 'engineering:missing error handler', 'node, then the lowercased title without punctuation');
  assert.equal(normalizeComparisonKey({ ...finding, file: 'src/a.ts', line: 10 }), 'engineering:missing error handler:src/a.ts:10');
  assert.notEqual(
    normalizeComparisonKey({ ...finding, file: 'src/a.ts', line: 10 }),
    normalizeComparisonKey({ ...finding, file: 'src/b.ts', line: 3 }),
    'the same title at two places is two findings'
  );
});

test('normalizeComparisonKey keeps non-Latin titles and falls back to the id for untitled findings', () => {
  const cyr = normalizeComparisonKey({ node: 'engineering', summary: 'Нет проверки ввода' });
  const cyr2 = normalizeComparisonKey({ node: 'engineering', summary: 'Нет обработки ошибок' });
  assert.notEqual(cyr, cyr2, 'distinct Cyrillic titles stay distinct');
  assert.notEqual(
    normalizeComparisonKey({ node: 'engineering', summary: '输入没有校验' }),
    normalizeComparisonKey({ node: 'engineering', summary: '错误没有处理' }),
    'distinct CJK titles stay distinct'
  );
  assert.notEqual(
    normalizeComparisonKey({ node: 'engineering', id: 'A1' }),
    normalizeComparisonKey({ node: 'engineering', id: 'A2' }),
    'untitled findings are told apart by id'
  );
});

test('deduplicateFindings keeps the same title on different nodes apart', () => {
  const findings = [
    { id: 'A1', node: 'engineering', summary: 'Missing input validation', severity: 'blocking', status: 'open', agent: 'reviewer-1' },
    { id: 'B1', node: 'ui_ux', summary: 'Missing input validation', severity: 'blocking', status: 'open', agent: 'reviewer-2' },
  ];

  const deduped = deduplicateFindings(findings);
  assert.deepStrictEqual(deduped.map((f) => f.node), ['engineering', 'ui_ux'], 'each owning node keeps its finding');
});

test('deduplicateFindings never lets a duplicate hide an open report', () => {
  const base = { node: 'engineering', summary: 'Race in the merge step', severity: 'blocking' };

  const fixedThenOpen = deduplicateFindings([
    { ...base, id: 'A1', status: 'fixed', agent: 'reviewer-1' },
    { ...base, id: 'B1', status: 'open', agent: 'reviewer-2' },
  ]);
  assert.strictEqual(fixedThenOpen.length, 1);
  assert.strictEqual(fixedThenOpen[0].status, 'open', 'a later open report reopens the merged finding');

  const openThenFixed = deduplicateFindings([
    { ...base, id: 'A1', status: 'open', agent: 'reviewer-1' },
    { ...base, id: 'B1', status: 'fixed', agent: 'reviewer-2' },
  ]);
  assert.strictEqual(openThenFixed[0].status, 'open', 'a later fixed report does not close it');
});

test('deduplicateFindings reads a missing or unknown severity as blocking', () => {
  const deduped = deduplicateFindings([
    { id: 'A1', node: 'engineering', summary: 'No severity', status: 'open' },
    { id: 'A2', node: 'engineering', summary: 'Odd severity', severity: 'critical', status: 'open' },
    { id: 'A3', node: 'engineering', summary: 'A nit', severity: 'advisory', status: 'open' },
  ]);

  assert.deepStrictEqual(deduped.map((f) => f.severity), ['blocking', 'blocking', 'advisory']);
});

test('deduplicateFindings reads a missing or unknown status as open', () => {
  const deduped = deduplicateFindings([
    { id: 'A1', node: 'engineering', summary: 'No status', severity: 'blocking' },
    { id: 'A2', node: 'engineering', summary: 'Odd status', severity: 'blocking', status: 'resolved' },
  ]);

  assert.deepStrictEqual(deduped.map((f) => f.status), ['open', 'open']);
});

test('verifyPlanApproval hashes the correct source file (plan.mdx)', () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'fabric-test-'));
  try {
    // Create plan.mdx and plan.builder.html in same directory
    const planMdx = path.join(tmpDir, 'plan.mdx');
    const planBuilderHtml = path.join(tmpDir, 'plan.builder.html');
    const mdxContent = 'Original plan content';
    const htmlContent = '<html>Built plan</html>';

    writeFileSync(planMdx, mdxContent);
    writeFileSync(planBuilderHtml, htmlContent);

    // Create approval sidecar for plan.mdx (hashing the mdx content)
    const mdxHash = computeHash(mdxContent);
    const approvalPath = path.join(tmpDir, 'plan.approval.json');
    const approval = {
      schema: 'aos.plan-approval/1',
      verdict: 'approve',
      contentHash: mdxHash,
      timestamp: new Date().toISOString(),
      source: 'plan-canvas'
    };
    writeFileSync(approvalPath, JSON.stringify(approval));

    // Verify with plan.mdx path: should succeed
    const result1 = verifyPlanApproval(planMdx);
    assert.strictEqual(result1.valid, true, 'should validate with plan.mdx path');

    // Note: verifyPlanApproval expects the sidecar next to the input file,
    // so if we pass plan.builder.html, it would look for plan.builder.approval.json
    // This test validates that the mdx sidecar works with the mdx file path
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
