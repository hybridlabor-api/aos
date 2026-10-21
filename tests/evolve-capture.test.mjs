import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  captureFailure,
  computeErrorSig,
  isEvolveDisabled,
  disableEvolve,
  enableEvolve,
  loadFailures,
  saveFailures,
} from '../lib/evolve/capture.mjs';
import { main as cliMain } from '../bin/aos-evolve.mjs';

describe('AOS Evolve Failure Capture Engine (WP2)', () => {
  let tmpDir;
  let testStorePath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-capture-test-'));
    testStorePath = path.join(tmpDir, 'failure.json');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  test('computeErrorSig produces stable deterministic hash for similar errors', () => {
    const err1 = 'TypeError: Cannot read properties of undefined at /Users/alice/repo/file.js:42:15 at 2026-10-21T03:00:00Z';
    const err2 = 'TypeError: Cannot read properties of undefined at /home/bob/repo/file.js:99:20 at 2026-10-21T04:30:15Z';

    const sig1 = computeErrorSig(err1);
    const sig2 = computeErrorSig(err2);

    assert.ok(typeof sig1 === 'string' && sig1.length === 32, 'signature must be 32-char hex string');
    assert.equal(sig1, sig2, 'signatures must match after path, timestamp, and line number normalization');
  });

  test('captureFailure writes new failure record conforming to schema', () => {
    const errorText = 'AssertionError: expected false to be true in test_parse\n    at /Users/testuser/work/test.js:10:5';
    const result = captureFailure({
      error: errorText,
      skill: 'clean-code',
      kind: 'test',
      storagePath: testStorePath,
    });

    assert.ok(result.ok, 'capture must succeed');
    assert.equal(result.deduplicated, false, 'first capture must not be deduplicated');
    assert.equal(result.record.count, 1, 'first capture count must be 1');
    assert.equal(result.record.skill, 'clean-code');
    assert.ok(!result.record.redacted_excerpt.includes('/Users/testuser'), 'excerpt must be redacted');
    assert.ok(result.record.first_seen, 'first_seen must be set');
    assert.ok(result.record.last_seen, 'last_seen must be set');

    // Verify on disk
    assert.ok(fs.existsSync(testStorePath), 'failure.json must be written to disk');
    const stored = JSON.parse(fs.readFileSync(testStorePath, 'utf8'));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].id, result.record.id);
  });

  test('captureFailure deduplicates repeated errors by signature and increments count', () => {
    const errorText1 = 'BuildError: exit code 1 at /Users/dev1/aos/file.js:12:3 2026-10-21T01:00:00Z';
    const errorText2 = 'BuildError: exit code 1 at /home/dev2/aos/file.js:88:9 2026-10-21T02:00:00Z';

    const res1 = captureFailure({
      error: errorText1,
      skill: 'instinct-export',
      kind: 'build',
      storagePath: testStorePath,
    });
    assert.equal(res1.record.count, 1);
    assert.equal(res1.deduplicated, false);

    const res2 = captureFailure({
      error: errorText2,
      skill: 'instinct-export',
      kind: 'build',
      storagePath: testStorePath,
    });
    assert.equal(res2.record.count, 2, 'subsequent failure with same signature must increment count to 2');
    assert.equal(res2.deduplicated, true, 'deduplicated flag must be true');
    assert.equal(res2.record.first_seen, res1.record.first_seen, 'first_seen must be preserved');

    // Third occurrence
    const res3 = captureFailure({
      error: errorText1,
      skill: 'instinct-export',
      kind: 'build',
      storagePath: testStorePath,
    });
    assert.equal(res3.record.count, 3, 'third occurrence must increment count to 3');
    assert.equal(res3.deduplicated, true);

    const stored = JSON.parse(fs.readFileSync(testStorePath, 'utf8'));
    assert.equal(stored.length, 1, 'deduplication must not add extra entries to failure.json');
    assert.equal(stored[0].count, 3);
  });

  test('captureFailure with dryRun does not write to disk', () => {
    const res = captureFailure({
      error: 'Error: temporary spike',
      skill: 'clean-code',
      storagePath: testStorePath,
      dryRun: true,
    });

    assert.ok(res.ok);
    assert.ok(res.record);
    assert.equal(fs.existsSync(testStorePath), false, 'storage file must not be created on dryRun');
  });

  test('kill switch: isEvolveDisabled, disableEvolve, and enableEvolve manage marker file', () => {
    const fakeHome = path.join(tmpDir, 'home');
    fs.mkdirSync(fakeHome, { recursive: true });

    assert.equal(isEvolveDisabled({ home: fakeHome }), false, 'initially enabled');

    const marker = disableEvolve({ home: fakeHome });
    assert.ok(fs.existsSync(marker), 'DISABLED marker file must be created');
    assert.equal(isEvolveDisabled({ home: fakeHome }), true, 'disabled after disableEvolve');

    const removed = enableEvolve({ home: fakeHome });
    assert.equal(removed, true, 'enableEvolve returns true when marker removed');
    assert.equal(fs.existsSync(marker), false, 'marker file must be gone');
    assert.equal(isEvolveDisabled({ home: fakeHome }), false, 'enabled after enableEvolve');
  });

  test('kill switch: respects environment variable AOS_EVOLVE=off', () => {
    const oldEnv = process.env.AOS_EVOLVE;
    try {
      process.env.AOS_EVOLVE = 'off';
      assert.equal(isEvolveDisabled(), true, 'disabled when AOS_EVOLVE=off');

      process.env.AOS_EVOLVE = '0';
      assert.equal(isEvolveDisabled(), true, 'disabled when AOS_EVOLVE=0');

      process.env.AOS_EVOLVE = 'on';
      assert.equal(isEvolveDisabled(), false, 'enabled when AOS_EVOLVE=on');
    } finally {
      if (oldEnv !== undefined) process.env.AOS_EVOLVE = oldEnv;
      else delete process.env.AOS_EVOLVE;
    }
  });

  test('CLI main: --help exits cleanly with code 0 and prints usage', async () => {
    let stdoutData = '';
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk) => {
      stdoutData += chunk;
      return true;
    };

    try {
      const code = await cliMain(['--help']);
      assert.equal(code, 0);
      assert.ok(stdoutData.includes('aos-evolve - Offline autonomous harness evolution engine'));
      assert.ok(stdoutData.includes('Commands:'));
      assert.ok(stdoutData.includes('capture'));
      assert.ok(stdoutData.includes('status'));
      assert.ok(stdoutData.includes('disable'));
    } finally {
      process.stdout.write = origWrite;
    }
  });

  test('CLI main: capture and status commands execute end-to-end', async () => {
    let stdoutData = '';
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk) => {
      stdoutData += chunk;
      return true;
    };

    try {
      // 1. Capture via CLI
      const captureCode = await cliMain([
        'capture',
        '--skill', 'clean-code',
        '--error', 'LintError: unused variable at /Users/tim/index.js:5',
        '--storage', testStorePath,
        '--json',
      ]);
      assert.equal(captureCode, 0, 'CLI capture must exit 0');
      const captureOut = JSON.parse(stdoutData);
      assert.equal(captureOut.ok, true);
      assert.equal(captureOut.record.skill, 'clean-code');

      // 2. Status via CLI
      stdoutData = '';
      const statusCode = await cliMain([
        'status',
        '--storage', testStorePath,
        '--json',
      ]);
      assert.equal(statusCode, 0, 'CLI status must exit 0');
      const statusOut = JSON.parse(stdoutData);
      assert.equal(statusOut.enabled, true);
      assert.equal(statusOut.failureCount, 1);
      assert.equal(statusOut.totalOccurrences, 1);
    } finally {
      process.stdout.write = origWrite;
    }
  });
});
