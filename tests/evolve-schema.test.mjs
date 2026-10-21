import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateSchema, loadSchema, KNOWN_SCHEMAS } from '../lib/evolve/validate.mjs';

describe('AOS Evolve Schemas (WP1)', () => {
  test('all 5 schemas exist and load without error', () => {
    assert.equal(KNOWN_SCHEMAS.length, 5);
    for (const type of KNOWN_SCHEMAS) {
      const schema = loadSchema(type);
      assert.ok(schema, `Schema ${type} must be defined`);
      assert.equal(schema.type, 'object');
      assert.ok(schema.required, `Schema ${type} must specify required properties`);
    }
  });

  describe('failure.schema.json', () => {
    const validFailure = {
      version: 1,
      id: 'fail-001',
      ts: '2026-10-21T03:00:00Z',
      skill: 'instinct-export',
      kind: 'test',
      error_sig: 'sig-abc123456789',
      redacted_excerpt: 'AssertionError: expected true but got false at ~/test.js:12',
    };

    test('accepts valid failure record', () => {
      const res = validateSchema('failure', validFailure);
      assert.equal(res.valid, true, `Validation failed: ${res.errors.join(', ')}`);
      assert.equal(res.errors.length, 0);
    });

    test('accepts valid failure with optional fields', () => {
      const full = {
        ...validFailure,
        first_seen: '2026-10-20T12:00:00Z',
        last_seen: '2026-10-21T03:00:00Z',
        count: 5,
        harness: 'claude',
        role: 'builder',
        trail_node: 'node-42',
        session_ref: 'session-xyz',
        cwd_class: 'worktree',
      };
      const res = validateSchema('failure', full);
      assert.equal(res.valid, true, `Validation failed: ${res.errors.join(', ')}`);
    });

    test('rejects missing version', () => {
      const { version, ...bad } = validFailure;
      const res = validateSchema('failure', bad);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes("missing required property 'version'")));
    });

    test('rejects invalid version number', () => {
      const bad = { ...validFailure, version: 2 };
      const res = validateSchema('failure', bad);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('expected const value \'1\'')));
    });

    test('rejects invalid failure kind', () => {
      const bad = { ...validFailure, kind: 'unknown_kind' };
      const res = validateSchema('failure', bad);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('not in enum')));
    });

    test('rejects unexpected additional properties', () => {
      const bad = { ...validFailure, unauthorized_field: 'hack' };
      const res = validateSchema('failure', bad);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes("unexpected property 'unauthorized_field'")));
    });

    test('rejects unredacted absolute user home path in redacted_excerpt', () => {
      const bad = {
        ...validFailure,
        redacted_excerpt: 'Error occurred in /Users/timrennings/dev/project/index.js line 4',
      };
      const res = validateSchema('failure', bad);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes("unredacted absolute user path with '/Users/'")));
    });

    test('rejects path traversal or invalid characters in skill slug', () => {
      const bad1 = { ...validFailure, skill: '../../escaped-skill' };
      const res1 = validateSchema('failure', bad1);
      assert.equal(res1.valid, false);
      assert.ok(res1.errors.some((e) => e.includes('does not match pattern')));

      const bad2 = { ...validFailure, skill: 'Invalid Skill Name!' };
      const res2 = validateSchema('failure', bad2);
      assert.equal(res2.valid, false);
      assert.ok(res2.errors.some((e) => e.includes('does not match pattern')));
    });
  });

  describe('probe.schema.json', () => {
    const validProbe = {
      version: 1,
      id: 'instinct-export-001',
      skill: 'instinct-export',
      task: 'Export and sanitize instincts without leaking private home paths or secrets.',
      checker: 'check.mjs',
      seed: 1337,
      repeats: 3,
      timeout_s: 60,
      max_tokens: 10000,
    };

    test('accepts valid minimal probe', () => {
      const res = validateSchema('probe', validProbe);
      assert.equal(res.valid, true, `Validation failed: ${res.errors.join(', ')}`);
    });

    test('accepts valid probe with optional fields, origin, and tags', () => {
      const full = {
        ...validProbe,
        expected: 'expected.json',
        harness: 'agy',
        role: 'builder',
        origin: { kind: 'handwritten' },
        tags: ['target', 'sanitization'],
      };
      const res = validateSchema('probe', full);
      assert.equal(res.valid, true, `Validation failed: ${res.errors.join(', ')}`);
    });

    test('rejects probe containing duplicate pins or checksum properties in probe.json', () => {
      const bad1 = { ...validProbe, checker_sha256: 'a'.repeat(64) };
      const res1 = validateSchema('probe', bad1);
      assert.equal(res1.valid, false);
      assert.ok(res1.errors.some((e) => e.includes("unexpected property 'checker_sha256'")));

      const bad2 = { ...validProbe, expected_sha256: 'b'.repeat(64) };
      const res2 = validateSchema('probe', bad2);
      assert.equal(res2.valid, false);
      assert.ok(res2.errors.some((e) => e.includes("unexpected property 'expected_sha256'")));

      const bad3 = { ...validProbe, checksums: { 'check.mjs': 'a'.repeat(64) } };
      const res3 = validateSchema('probe', bad3);
      assert.equal(res3.valid, false);
      assert.ok(res3.errors.some((e) => e.includes("unexpected property 'checksums'")));
    });

    test('rejects non-positive timeout or repeats', () => {
      const bad = { ...validProbe, timeout_s: 0, repeats: -1 };
      const res = validateSchema('probe', bad);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('less than minimum')));
    });
  });

  describe('candidate.schema.json', () => {
    const validCandidate = {
      version: 1,
      id: 'cand-001',
      skill: 'instinct-export',
      base_sha: 'e28e1e70',
      diff_hash: 'c'.repeat(64),
      files: ['skills/basic/instinct-export/SKILL.md'],
      proposer: { role: 'builder', harness: 'agy' },
      failure_id: 'fail-001',
      probe_ids: ['instinct-export-001'],
      attempt: 1,
    };

    test('accepts valid candidate patch metadata', () => {
      const res = validateSchema('candidate', validCandidate);
      assert.equal(res.valid, true, `Validation failed: ${res.errors.join(', ')}`);
    });

    test('rejects empty files array', () => {
      const bad = { ...validCandidate, files: [] };
      const res = validateSchema('candidate', bad);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('less than minItems')));
    });

    test('rejects invalid proposer structure', () => {
      const bad = { ...validCandidate, proposer: { role: 'builder' } };
      const res = validateSchema('candidate', bad);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes("missing required property 'harness'")));
    });
  });

  describe('provenance.schema.json', () => {
    const validProvenance = {
      version: 1,
      id: 'prov-001',
      failure_id: 'fail-001',
      probe_ids: ['instinct-export-001'],
      baseline_run_id: 'run-base-101',
      candidate_run_id: 'run-cand-102',
      base_sha: 'e28e1e70',
      diff_hash: 'd'.repeat(64),
      model_roles: {
        proposer: 'claude-sonnet-4-6',
        reviewer: 'reviewer',
        prober: 'gemini-flash',
      },
      seeds: [1337],
      tokens_spent: 45000,
      runs_spent: 6,
      proposer_identity: { role: 'builder', harness: 'agy' },
      reviewer_identity: { role: 'reviewer', harness: 'claude' },
    };

    test('accepts complete valid provenance block', () => {
      const res = validateSchema('provenance', validProvenance);
      assert.equal(res.valid, true, `Validation failed: ${res.errors.join(', ')}`);
    });

    test('rejects negative tokens_spent', () => {
      const bad = { ...validProvenance, tokens_spent: -100 };
      const res = validateSchema('provenance', bad);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('less than minimum')));
    });
  });

  describe('summary.schema.json', () => {
    const validSummary = {
      version: 1,
      cycle_id: 'cycle-001',
      skill: 'instinct-export',
      candidate_id: 'cand-001',
      baseline_run_id: 'run-base-101',
      target_pass_rate: 1.0,
      heldout_pass_rate: 1.0,
      baseline_pass_rate: 0.5,
      regressions: [],
      passed_gate: true,
      probes: [
        {
          id: 'instinct-export-001',
          pass: true,
          score: 1.0,
          wall_time_ms: 1250,
          tokens: 4200,
          notes: 'Pass without issues',
        },
      ],
    };

    test('accepts valid run summary', () => {
      const res = validateSchema('summary', validSummary);
      assert.equal(res.valid, true, `Validation failed: ${res.errors.join(', ')}`);
    });

    test('rejects pass rate out of 0..1 range', () => {
      const bad = { ...validSummary, target_pass_rate: 1.5 };
      const res = validateSchema('summary', bad);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('exceeds maximum 1')));
    });
  });
});
