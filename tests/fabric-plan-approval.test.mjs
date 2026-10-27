import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import crypto from 'node:crypto';

function computeSha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function deduplicateFindings(allFindings) {
  const seen = new Map();
  const result = [];
  for (const f of allFindings) {
    const key = `${f.file}:${f.line || 'summary'}:${f.summary?.slice(0, 50) || ''}`;
    if (seen.has(key)) {
      const existing = seen.get(key);
      if (['blocking', 'advisory'].includes(f.severity) &&
          (!['blocking', 'advisory'].includes(existing.severity) ||
           (f.severity === 'blocking' && existing.severity === 'advisory'))) {
        existing.severity = f.severity;
      }
      existing.sources = (existing.sources || [existing.agent || 'unknown']).concat([f.agent || 'unknown']);
    } else {
      seen.set(key, { ...f, sources: [f.agent || 'unknown'] });
      result.push(seen.get(key));
    }
  }
  return result;
}

test('plan approval hash verification', () => {
  const content = 'plan content here';
  const hash = computeSha256(content);
  const approval = { verdict: 'approve', contentHash: hash, timestamp: Date.now() };

  assert.strictEqual(hash, computeSha256(content), 'hash should match same content');
  assert.notStrictEqual(hash, computeSha256(content + ' modified'), 'hash should differ for modified content');
});

test('deduplicates findings by file:line:summary', () => {
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

test('no-progress guard detects same finding IDs', () => {
  const previousIds = new Set(['F001', 'F002']);
  const currentIds = new Set(['F001', 'F002']);

  const sameAsLastTime =
    currentIds.size > 0 &&
    currentIds.size === previousIds.size &&
    [...currentIds].every(id => previousIds.has(id));

  assert.ok(sameAsLastTime, 'should detect identical finding sets');
});

test('no-progress guard allows new findings', () => {
  const previousIds = new Set(['F001']);
  const currentIds = new Set(['F001', 'F002']);

  const sameAsLastTime =
    currentIds.size > 0 &&
    currentIds.size === previousIds.size &&
    [...currentIds].every(id => previousIds.has(id));

  assert.ok(!sameAsLastTime, 'should allow progress when new findings appear');
});
