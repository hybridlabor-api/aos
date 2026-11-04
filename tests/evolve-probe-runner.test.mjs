import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runProbes } from '../lib/evolve/probe.mjs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

describe('AOS Evolve Probe Runner', () => {
  let tmpHome;
  let evolveDir;
  let resultsFile;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-probe-runner-test-'));
    evolveDir = path.join(tmpHome, '.aos', 'evolve');
    resultsFile = path.join(evolveDir, 'probe_results.json');
    fs.mkdirSync(evolveDir, { recursive: true });
    fs.mkdirSync(path.join(tmpHome, 'test-probe-001'), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, 'another-probe-001'), { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {}
  });

  test('Acceptance: target improves -> pass', () => {
    fs.writeFileSync(resultsFile, JSON.stringify({
      'test-probe-001': 0.5,
      'another-probe-001': 1.0
    }));

    const loadProbeMock = (probeDir) => {
      const pid = path.basename(probeDir);
      return { probe: { id: pid, repeats: 3 }, probeDir, checkerPath: 'mock-checker.js' };
    };

    const execFileSyncMock = (bin, args) => JSON.stringify({ pass: true, score: 1.0 });

    const res = runProbes({
      home: tmpHome,
      target: 'test-probe-001',
      probePaths: [path.join(tmpHome, 'test-probe-001'), path.join(tmpHome, 'another-probe-001')],
      loadProbe: loadProbeMock,
      execFileSync: execFileSyncMock
    });

    assert.equal(res.ok, true, `Expected success but got error: ${res.error}`);
    const updated = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    assert.equal(updated['test-probe-001'], 1.0);
    assert.equal(updated['another-probe-001'], 1.0);
  });

  test('Acceptance: other probe regresses -> fail', () => {
    fs.writeFileSync(resultsFile, JSON.stringify({
      'test-probe-001': 0.5,
      'another-probe-001': 1.0
    }));

    const loadProbeMock = (probeDir) => {
      const pid = path.basename(probeDir);
      return { probe: { id: pid, repeats: 1 }, probeDir, checkerPath: 'mock-checker.js' };
    };

    const execFileSyncMock = (bin, args, opts) => {
      if (opts.cwd.includes('another-probe-001')) {
        return JSON.stringify({ pass: false, score: 0.0 });
      }
      return JSON.stringify({ pass: true, score: 1.0 });
    };

    const res = runProbes({
      home: tmpHome,
      target: 'test-probe-001',
      probePaths: [path.join(tmpHome, 'test-probe-001'), path.join(tmpHome, 'another-probe-001')],
      loadProbe: loadProbeMock,
      execFileSync: execFileSyncMock
    });

    assert.equal(res.ok, false);
    assert.ok(res.error.includes('another-probe-001'), 'Error message must contain regression probe name');

    // Original file must not be modified if regressed
    const updated = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    assert.equal(updated['another-probe-001'], 1.0);
  });

  test('Acceptance: unchanged rerun without target -> ok (true)', () => {
    fs.writeFileSync(resultsFile, JSON.stringify({
      'test-probe-001': 1.0
    }));

    const loadProbeMock = (probeDir) => ({ probe: { id: path.basename(probeDir), repeats: 1 }, probeDir, checkerPath: 'm.js' });
    const execFileSyncMock = () => JSON.stringify({ pass: true, score: 1.0 });

    const res = runProbes({
      home: tmpHome,
      probePaths: [path.join(tmpHome, 'test-probe-001')],
      loadProbe: loadProbeMock,
      execFileSync: execFileSyncMock
    });

    assert.equal(res.ok, true, 'Report mode must pass on unchanged rerun');
  });

  test('Acceptance: broken probe -> fail', () => {
    const res = runProbes({
      home: tmpHome,
      probePaths: ['non-existent-probe-path'],
      loadProbe: () => { throw new Error('broken'); }
    });

    assert.equal(res.ok, false);
    assert.ok(res.error.includes('missing'), 'Must not silently skip missing probe dir');
  });
});
