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
  resolveFailureStorePath,
  acquireStoreLock,
  withStoreLock,
  confirmEnable,
  tryRecordToMemB,
} from '../lib/evolve/capture.mjs';
import { main as cliMain } from '../bin/aos-evolve.mjs';

describe('AOS Evolve Failure Capture Engine (WP2)', () => {
  let tmpDir;
  let fakeHome;
  let testStorePath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-capture-test-'));
    fakeHome = path.join(tmpDir, 'home');
    fs.mkdirSync(path.join(fakeHome, '.aos', 'evolve'), { recursive: true, mode: 0o700 });
    testStorePath = path.join(fakeHome, '.aos', 'evolve', 'failure.json');
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

  test('captureFailure writes new failure record and enforces 0600 file and 0700 dir permissions', () => {
    const errorText = 'AssertionError: expected false to be true in test_parse\n    at /Users/testuser/work/test.js:10:5';
    const result = captureFailure({
      error: errorText,
      skill: 'clean-code',
      kind: 'test',
      storagePath: testStorePath,
      home: fakeHome,
    });

    assert.ok(result.ok, 'capture must succeed');
    assert.equal(result.deduplicated, false, 'first capture must not be deduplicated');
    assert.equal(result.record.count, 1, 'first capture count must be 1');
    assert.equal(result.record.skill, 'clean-code');
    assert.ok(!result.record.redacted_excerpt.includes('/Users/testuser'), 'excerpt must be redacted');
    assert.ok(result.record.first_seen, 'first_seen must be set');
    assert.ok(result.record.last_seen, 'last_seen must be set');

    // Verify on disk and check permissions (review finding 1)
    assert.ok(fs.existsSync(testStorePath), 'failure.json must be written to disk');
    const statFile = fs.statSync(testStorePath);
    const statDir = fs.statSync(path.dirname(testStorePath));

    // File mode & 0777 should be 0600 on POSIX
    if (process.platform !== 'win32') {
      assert.equal((statFile.mode & 0o777), 0o600, 'failure.json must be 0600');
      assert.equal((statDir.mode & 0o777), 0o700, 'evolve directory must be 0700');
    }

    const stored = JSON.parse(fs.readFileSync(testStorePath, 'utf8'));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].id, result.record.id);
  });

  test('resolveFailureStorePath confines storage to ~/.aos/evolve/ and rejects external paths', () => {
    // Valid path inside fakeHome/.aos/evolve/
    const valid = resolveFailureStorePath(path.join(fakeHome, '.aos', 'evolve', 'custom.json'), { home: fakeHome });
    assert.equal(valid, path.join(fakeHome, '.aos', 'evolve', 'custom.json'));

    // Path traversal attempt outside allowed directory
    assert.throws(
      () => resolveFailureStorePath(path.join(fakeHome, 'escaped.json'), { home: fakeHome }),
      /outside allowed directory/,
      'must reject paths outside ~/.aos/evolve/'
    );

    // Non-json file attempt
    assert.throws(
      () => resolveFailureStorePath(path.join(fakeHome, '.aos', 'evolve', 'script.sh'), { home: fakeHome }),
      /must end with \.json or \.jsonl/,
      'must reject non-json storage destinations'
    );
  });

  test('captureFailure rejects inputs exceeding 64 KiB cap', () => {
    const hugeError = 'X'.repeat(65 * 1024);
    const result = captureFailure({
      error: hugeError,
      skill: 'clean-code',
      storagePath: testStorePath,
      home: fakeHome,
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /exceeds size cap/);
  });

  test('captureFailure deduplicates repeated errors by signature and increments count', () => {
    const errorText1 = 'BuildError: exit code 1 at /Users/dev1/aos/file.js:12:3 2026-10-21T01:00:00Z';
    const errorText2 = 'BuildError: exit code 1 at /home/dev2/aos/file.js:88:9 2026-10-21T02:00:00Z';

    const res1 = captureFailure({
      error: errorText1,
      skill: 'instinct-export',
      kind: 'build',
      storagePath: testStorePath,
      home: fakeHome,
    });
    assert.equal(res1.record.count, 1);
    assert.equal(res1.deduplicated, false);

    const res2 = captureFailure({
      error: errorText2,
      skill: 'instinct-export',
      kind: 'build',
      storagePath: testStorePath,
      home: fakeHome,
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
      home: fakeHome,
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
      home: fakeHome,
    });

    assert.ok(res.ok);
    assert.ok(res.record);
    assert.equal(fs.existsSync(testStorePath), false, 'storage file must not be created on dryRun');
  });

  test('kill switch: isEvolveDisabled, disableEvolve, and enableEvolve manage marker file', () => {
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
  test('N2: loadFailures throws on corrupt JSON and prevents data loss overwrite', () => {
    fs.writeFileSync(testStorePath, '{ broken json ...', 'utf8');

    assert.throws(
      () => loadFailures(testStorePath),
      /Failed to parse failures store/,
      'must throw on invalid JSON instead of returning empty array'
    );

    const res = captureFailure({
      error: 'New failure',
      skill: 'clean-code',
      storagePath: testStorePath,
      home: fakeHome,
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /Failed to parse failures store/);
    assert.equal(fs.readFileSync(testStorePath, 'utf8'), '{ broken json ...', 'corrupt store must not be overwritten');
  });

  test('N3: saveFailures atomic write uses wx flag to prevent symlink following', () => {
    const failures = [{ id: 'test-1', skill: 'clean-code' }];
    saveFailures(failures, testStorePath);
    assert.ok(fs.existsSync(testStorePath));

    // Try saveFailures targeting a denied path
    assert.throws(
      () => saveFailures(failures, '/etc/passwd'),
      /Access denied/,
      'saveFailures must block writes outside allowed base directory'
    );
  });
  test('CLI main: capture fails when stdin input exceeds 64 KiB cap', async () => {
    let stderrData = '';
    const origWrite = process.stderr.write;
    process.stderr.write = (chunk) => {
      stderrData += chunk;
      return true;
    };

    try {
      // Simulate large input via file Arg
      const hugeFile = path.join(tmpDir, 'huge.json');
      fs.writeFileSync(hugeFile, 'X'.repeat(65 * 1024), 'utf8');
      const code = await cliMain(['capture', hugeFile, '--skill', 'clean-code']);
      assert.equal(code, 1);
      assert.ok(stderrData.includes('exceeds 64 KiB size limit'));
    } finally {
      process.stderr.write = origWrite;
    }
  });

  test('R2-5: acquireStoreLock provides mutual exclusion with O_EXCL and cleans up lockfile', () => {
    const lock1 = acquireStoreLock(testStorePath, { baseDir: path.dirname(testStorePath) });
    assert.ok(fs.existsSync(`${testStorePath}.lock`), 'lock file must exist after acquire');

    // Attempting second acquire with short timeout must time out
    assert.throws(
      () => acquireStoreLock(testStorePath, { baseDir: path.dirname(testStorePath), maxWaitMs: 50 }),
      /Timed out waiting for store lock/,
      'must throw timeout when lock is already held'
    );

    lock1.release();
    assert.ok(!fs.existsSync(`${testStorePath}.lock`), 'lock file must be unlinked on release');

    // After release, new lock can be acquired immediately
    const lock2 = acquireStoreLock(testStorePath, { baseDir: path.dirname(testStorePath) });
    lock2.release();
  });

  test('R2-5: acquireStoreLock cleans up stale locks exceeding timeout', () => {
    const lockFile = `${testStorePath}.lock`;
    fs.writeFileSync(lockFile, '99999\n', 'utf8');

    // Set mtime to 10 seconds ago
    const past = new Date(Date.now() - 10000);
    fs.utimesSync(lockFile, past, past);

    // acquireStoreLock should detect stale lock, unlink, and acquire successfully
    const lock = acquireStoreLock(testStorePath, {
      baseDir: path.dirname(testStorePath),
      staleTimeoutMs: 1000,
      maxWaitMs: 500,
    });
    assert.ok(fs.existsSync(lockFile));
    lock.release();
  });

  test('NF-10: confirmEnable enforces interactive TTY and blocks automated harness execution', async () => {
    // 1. Non-TTY stdin/stdout
    const nonTtyResult = await confirmEnable({
      stdin: { isTTY: false },
      stdout: { isTTY: false },
    });
    assert.equal(nonTtyResult.ok, false);
    assert.ok(nonTtyResult.reason.includes('TTY required') || nonTtyResult.reason.includes('TTY terminal'));

    // 2. Harness environment detected
    const harnessResult = await confirmEnable({
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      env: { CLAUDE_SESSION_ID: 'sess-123' },
    });
    assert.equal(harnessResult.ok, false);
    assert.ok(harnessResult.reason.includes('harness session detected'));

    // 3. Mismatched human confirmation
    let stdoutBuf = '';
    const badConfirmResult = await confirmEnable({
      stdin: { isTTY: true },
      stdout: { isTTY: true, write: (s) => { stdoutBuf += s; } },
      ask: async () => 'no',
      env: {},
    });
    assert.equal(badConfirmResult.ok, false);
    assert.ok(badConfirmResult.reason.includes('confirmation does not match'));

    // 4. Successful human confirmation
    const goodConfirmResult = await confirmEnable({
      stdin: { isTTY: true },
      stdout: { isTTY: true, write: (s) => { stdoutBuf += s; } },
      ask: async () => 'ENABLE',
      env: {},
    });
    assert.equal(goodConfirmResult.ok, true);
  });

  test('NF-8: circular error objects are safely serialized without throwing TypeError', () => {
    const circularObj = { message: 'Circular test error' };
    circularObj.self = circularObj;

    const sig = computeErrorSig(circularObj);
    assert.ok(typeof sig === 'string' && sig.length === 32, 'Must compute signature for circular object');

    const result = captureFailure({
      error: circularObj,
      skill: 'clean-code',
      storagePath: testStorePath,
      home: fakeHome,
    });
    assert.equal(result.ok, true, 'captureFailure must succeed with circular error');
    assert.ok(result.record.redacted_excerpt.includes('[Circular]'));
  });

  test('NF-8: loadFailures gracefully ignores null and non-object entries in store', () => {
    fs.writeFileSync(testStorePath, JSON.stringify([null, 42, 'string', null, { id: 'valid-1', skill: 'clean-code', error_sig: 'sig123' }]), 'utf8');

    const loaded = loadFailures(testStorePath);
    assert.equal(loaded.length, 1, 'Only valid objects must be loaded');
    assert.equal(loaded[0].id, 'valid-1');

    // captureFailure must not throw TypeError when deduplicating against store containing nulls
    const res = captureFailure({
      error: 'test error',
      skill: 'clean-code',
      storagePath: testStorePath,
      home: fakeHome,
    });
    assert.equal(res.ok, true);
  });

  test('NF-4: tryRecordToMemB cleanly skips when memB module is absent without throwing', async () => {
    const fakeRecord = { id: 'fail-123', skill: 'clean-code', error_sig: 'abc', redacted_excerpt: 'err' };
    const recorded = await tryRecordToMemB(fakeRecord);
    // Since skills/global_config/memb-skill/lib/memb.mjs is absent, must cleanly return false
    assert.equal(recorded, false);
  });
});
