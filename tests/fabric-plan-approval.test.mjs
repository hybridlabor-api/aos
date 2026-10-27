import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { verifyPlanApproval } from '../lib/fabric-plan-approval.mjs';
import { deduplicateFindings, checkNoProgress, normalizeComparisonKey } from '../lib/fabric-review-dedupe.mjs';

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
    assert.match(result.reason, /could not read/, 'should report read failure');
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
    assert.match(result.reason, /could not read/, 'should report parse error');
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

test('checkNoProgress detects same blocking IDs', () => {
  const currentFindings = [
    { id: 'F001', severity: 'blocking', status: 'open', node: 'eng', summary: 'Bug' },
    { id: 'F002', severity: 'blocking', status: 'open', node: 'ui', summary: 'Error' },
  ];
  const previousIds = new Set(['F001', 'F002']);

  const noProgress = checkNoProgress(currentFindings, previousIds);
  assert.ok(noProgress, 'should detect identical blocking IDs');
});

test('checkNoProgress allows new findings', () => {
  const currentFindings = [
    { id: 'F001', severity: 'blocking', status: 'open', node: 'eng', summary: 'Bug' },
    { id: 'F003', severity: 'blocking', status: 'open', node: 'ui', summary: 'New issue' },
  ];
  const previousIds = new Set(['F001', 'F002']);

  const noProgress = checkNoProgress(currentFindings, previousIds);
  assert.ok(!noProgress, 'should allow progress when new findings appear');
});

test('normalizeComparisonKey uses node and title', () => {
  const finding = { node: 'engineering', summary: 'Missing Error Handler!!' };
  const key = normalizeComparisonKey(finding);
  assert.match(key, /^engineering:/, 'should include node');
  assert.match(key, /missingerrorhandler/, 'should normalize title');
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
