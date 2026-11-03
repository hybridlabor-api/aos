import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runProbes } from '../lib/evolve/probe.mjs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('AOS Evolve Probe Runner', () => {
  let tmpHome;
  let evolveDir;
  let resultsFile;
  let probesDir;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-probe-runner-test-'));
    evolveDir = path.join(tmpHome, '.aos', 'evolve');
    resultsFile = path.join(evolveDir, 'probe_results.json');
    fs.mkdirSync(evolveDir, { recursive: true });

    // create fake probes dir
    probesDir = path.join(tmpHome, 'probes');
    fs.mkdirSync(path.join(probesDir, 'test-probe', 'test-probe-001'), { recursive: true });
    fs.mkdirSync(path.join(probesDir, 'another-probe', 'another-probe-001'), { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {}
  });

  test('Acceptance: improvement -> pass', () => {
    // Write baseline
    fs.writeFileSync(resultsFile, JSON.stringify({
      'test-probe-001': 0.5,
      'another-probe-001': 1.0
    }));

    // Mock loadProbe
    const loadProbeMock = (probeDir, opts) => {
      const pid = path.basename(probeDir);
      return {
        probe: { id: pid, repeats: 3 },
        probeDir,
        checkerPath: 'mock-checker.js'
      };
    };

    // Mock execFileSync: return score 1.0 for both (001 improved, another stayed same)
    const execFileSyncMock = (bin, args) => {
      return JSON.stringify({ pass: true, score: 1.0 });
    };

    const res = runProbes({
      home: tmpHome,
      probeNames: ['test-probe-001', 'another-probe-001'],
      probesDir,
      loadProbe: loadProbeMock,
      execFileSync: execFileSyncMock
    });

    assert.equal(res.ok, true, `Expected success but got error: ${res.error}`);

    // Verify file written
    const updated = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    assert.equal(updated['test-probe-001'], 1.0);
    assert.equal(updated['another-probe-001'], 1.0);
  });

  test('Acceptance: regression -> fail with probe name', () => {
    // Write baseline
    fs.writeFileSync(resultsFile, JSON.stringify({
      'test-probe-001': 1.0,
      'another-probe-001': 1.0
    }));

    const loadProbeMock = (probeDir) => {
      const pid = path.basename(probeDir);
      return {
        probe: { id: pid, repeats: 1 },
        probeDir,
        checkerPath: 'mock-checker.js'
      };
    };

    // Make probe another-probe-001 regress
    const execFileSyncMock = (bin, args, opts) => {
      if (opts.cwd.includes('another-probe-001')) {
        return JSON.stringify({ pass: false, score: 0.0 });
      }
      return JSON.stringify({ pass: true, score: 1.0 });
    };

    const res = runProbes({
      home: tmpHome,
      probeNames: ['test-probe-001', 'another-probe-001'],
      probesDir,
      loadProbe: loadProbeMock,
      execFileSync: execFileSyncMock
    });

    assert.equal(res.ok, false);
    assert.ok(res.error.includes('another-probe-001'), 'Error message must contain regression probe name');

    const updated = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    assert.equal(updated['another-probe-001'], 0.0);
  });

  test('Fails if no probe improved', () => {
    fs.writeFileSync(resultsFile, JSON.stringify({
      'test-probe-001': 1.0
    }));

    const loadProbeMock = (probeDir) => {
      return { probe: { id: path.basename(probeDir), repeats: 1 }, probeDir, checkerPath: 'm.js' };
    };
    const execFileSyncMock = () => JSON.stringify({ pass: true, score: 1.0 });

    const res = runProbes({
      home: tmpHome,
      probeNames: ['test-probe-001'],
      probesDir,
      loadProbe: loadProbeMock,
      execFileSync: execFileSyncMock
    });

    assert.equal(res.ok, false);
    assert.equal(res.error, 'No probe improved.');
  });
});
