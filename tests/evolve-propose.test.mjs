import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { proposeCandidate } from '../lib/evolve/propose.mjs';
import { disableEvolve, enableEvolve, captureFailure } from '../lib/evolve/capture.mjs';

describe('aos-evolve propose', () => {
  let tmpHome;
  let storePath;
  let testFailure;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-evolve-propose-'));
    storePath = path.join(tmpHome, '.aos', 'evolve', 'failure.json');
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.aos', 'evolve', 'ENABLED'), 'Enabled\n');

    const capRes = captureFailure({
      error: 'Test failure error message',
      skill: 'test-skill',
      storagePath: storePath,
      home: tmpHome,
    });
    testFailure = capRes.record;
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    enableEvolve();
  });

  test('kill switch disables propose', async () => {
    disableEvolve(tmpHome);
    const res = await proposeCandidate({ storagePath: storePath, home: tmpHome });
    assert.equal(res.ok, false);
    assert.match(res.error, /disabled via kill switch/i);
  });

  test('--dry-run writes nothing', async () => {
    let prCreated = false;
    const res = await proposeCandidate({
      signature: testFailure.error_sig,
      dryRun: true,
      storagePath: storePath,
      home: tmpHome,
      fixer: async () => ({ diff: 'good diff', files: ['lib/test.mjs'] }),
      createPr: async () => { prCreated = true; },
      probes: [async () => ({ ok: true })],
      useWorktree: false,
    });

    assert.equal(res.ok, true);
    assert.equal(res.dryRun, true);
    assert.equal(prCreated, false);
  });

  test('deny-listed path in diff is rejected', async () => {
    const res = await proposeCandidate({
      signature: testFailure.error_sig,
      storagePath: storePath,
      home: tmpHome,
      fixer: async () => ({ diff: 'bad diff', files: ['evolve/deny-list.json'] }), // evolve/deny-list.json is denied
      createPr: async () => {},
      probes: [],
    });

    assert.equal(res.ok, false);
    assert.match(res.error, /touches deny-listed path/);
  });

  test('secret string in diff is rejected', async () => {
    const res = await proposeCandidate({
      signature: testFailure.error_sig,
      storagePath: storePath,
      home: tmpHome,
      fixer: async () => ({ diff: 'sk-proj-123456789012345678901234567890', files: ['lib/safe.mjs'] }),
      createPr: async () => {},
      probes: [],
    });

    assert.equal(res.ok, false);
    assert.match(res.error, /potential secrets/);
  });

  test('regression in probe is rejected', async () => {
    const res = await proposeCandidate({
      signature: testFailure.error_sig,
      storagePath: storePath,
      home: tmpHome,
      fixer: async () => ({ diff: 'diff', files: ['lib/safe.mjs'] }),
      createPr: async () => {},
      probes: [async () => ({ ok: false, error: 'Probe failed to run' })],
      useWorktree: false,
    });

    assert.equal(res.ok, false);
    assert.match(res.error, /probe failed/);
  });

  test('improvement in probe -> draft PR requested exactly once', async () => {
    let prCalls = 0;
    let requestedDiff = '';
    const res = await proposeCandidate({
      signature: testFailure.error_sig,
      storagePath: storePath,
      home: tmpHome,
      fixer: async () => ({ diff: 'great diff', files: ['lib/safe.mjs'] }),
      createPr: async (failure, diff) => {
        prCalls++;
        requestedDiff = diff;
      },
      probes: [async () => ({ ok: true })],
      useWorktree: false,
    });

    assert.equal(res.ok, true);
    assert.equal(prCalls, 1);
    assert.equal(requestedDiff, 'great diff');
  });
});
