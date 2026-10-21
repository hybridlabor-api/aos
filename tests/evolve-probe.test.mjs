import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadProbe, loadPins, computeFileSha256 } from '../lib/evolve/probe-load.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

describe('AOS Evolve Probe Loader & Benchmark Fixtures (WP3)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-probe-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test('loadProbe successfully loads instinct-export-001 probe with centralized pins', () => {
    const probeDir = path.join(REPO_ROOT, 'evolve', 'probes', 'instinct-export', 'instinct-export-001');
    const result = loadProbe(probeDir);

    assert.equal(result.ok, true);
    assert.equal(result.probe.id, 'instinct-export-001');
    assert.equal(result.probe.skill, 'instinct-export');
    assert.ok(result.checkerPath && fs.existsSync(result.checkerPath));
    assert.ok(result.expectedPath && fs.existsSync(result.expectedPath));
    assert.ok(result.fixtureDir && fs.existsSync(result.fixtureDir));
  });

  test('loadProbe successfully loads skill-create-001 probe with centralized pins', () => {
    const probeDir = path.join(REPO_ROOT, 'evolve', 'probes', 'skill-create', 'skill-create-001');
    const result = loadProbe(probeDir);

    assert.equal(result.ok, true);
    assert.equal(result.probe.id, 'skill-create-001');
    assert.equal(result.probe.skill, 'skill-create');
    assert.ok(result.checkerPath && fs.existsSync(result.checkerPath));
    assert.ok(result.expectedPath && fs.existsSync(result.expectedPath));
    assert.ok(result.fixtureDir && fs.existsSync(result.fixtureDir));
  });

  test('loadProbe successfully loads clean-code-001 probe with centralized pins', () => {
    const probeDir = path.join(REPO_ROOT, 'evolve', 'probes', 'clean-code', 'clean-code-001');
    const result = loadProbe(probeDir);

    assert.equal(result.ok, true);
    assert.equal(result.probe.id, 'clean-code-001');
    assert.equal(result.probe.skill, 'clean-code');
    assert.ok(result.checkerPath && fs.existsSync(result.checkerPath));
    assert.ok(result.expectedPath && fs.existsSync(result.expectedPath));
    assert.ok(result.fixtureDir && fs.existsSync(result.fixtureDir));
  });

  test('enforces that checker and expected files must be basenames (review finding 6)', () => {
    const probeDir = path.join(tmpDir, 'traversal-probe');
    fs.mkdirSync(probeDir);
    fs.writeFileSync(path.join(probeDir, 'probe.json'), JSON.stringify({
      version: 1,
      id: 'traversal-001',
      skill: 'clean-code',
      task: 'Test path traversal',
      harness: 'agy',
      role: 'builder',
      seed: 1,
      repeats: 1,
      timeout_s: 10,
      max_tokens: 1000,
      checker: '../check.mjs', // invalid: not a basename
      origin: { kind: 'handwritten' },
    }), 'utf8');

    assert.throws(
      () => loadProbe(probeDir),
      /failed schema validation|must be a basename/,
      'Must reject checker containing directory traversal'
    );
  });

  test('fail closed when checksum pin is missing (review finding 7 & 8)', () => {
    const probeDir = path.join(tmpDir, 'unpinned-probe');
    fs.mkdirSync(probeDir);
    fs.writeFileSync(path.join(probeDir, 'probe.json'), JSON.stringify({
      version: 1,
      id: 'unpinned-probe-999',
      skill: 'clean-code',
      task: 'Test missing pin',
      harness: 'agy',
      role: 'builder',
      seed: 1,
      repeats: 1,
      timeout_s: 10,
      max_tokens: 1000,
      checker: 'check.mjs',
      origin: { kind: 'handwritten' },
    }), 'utf8');
    fs.writeFileSync(path.join(probeDir, 'check.mjs'), 'process.exit(0);\n', 'utf8');

    assert.throws(
      () => loadProbe(probeDir),
      /Missing checksum pins for probe 'unpinned-probe-999' in evolve\/pins\.json \(fail closed\)/,
      'Must fail closed when pins are missing in centralized pins file'
    );
  });

  test('anti-tampering: detects and rejects modified check.mjs', () => {
    const sourceDir = path.join(REPO_ROOT, 'evolve', 'probes', 'instinct-export', 'instinct-export-001');
    fs.cpSync(sourceDir, tmpDir, { recursive: true });

    // Tamper with check.mjs
    const checkerPath = path.join(tmpDir, 'check.mjs');
    fs.appendFileSync(checkerPath, '\n// injected malicious comment or modified logic\n');

    assert.throws(
      () => loadProbe(tmpDir),
      /Checksum mismatch for checker 'check.mjs'/,
      'Tampered check.mjs must trigger checksum mismatch error'
    );
  });

  test('anti-tampering: detects and rejects modified expected.json', () => {
    const sourceDir = path.join(REPO_ROOT, 'evolve', 'probes', 'clean-code', 'clean-code-001');
    fs.cpSync(sourceDir, tmpDir, { recursive: true });

    // Tamper with expected.json
    const expectedPath = path.join(tmpDir, 'expected.json');
    const data = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
    data.tampered = true;
    fs.writeFileSync(expectedPath, JSON.stringify(data, null, 2), 'utf8');

    assert.throws(
      () => loadProbe(tmpDir),
      /Checksum mismatch for expected file 'expected.json'/,
      'Tampered expected.json must trigger checksum mismatch error'
    );
  });

  test('rejects probe with missing probe.json or missing directory', () => {
    assert.throws(
      () => loadProbe('/path/that/does/not/exist'),
      /Probe directory does not exist/
    );

    const emptyDir = path.join(tmpDir, 'empty');
    fs.mkdirSync(emptyDir);
    assert.throws(
      () => loadProbe(emptyDir),
      /probe.json not found in probe directory/
    );
  });

  test('probe checkers execute deterministically and return valid JSON receipts', () => {
    const probes = [
      path.join(REPO_ROOT, 'evolve', 'probes', 'instinct-export', 'instinct-export-001'),
      path.join(REPO_ROOT, 'evolve', 'probes', 'skill-create', 'skill-create-001'),
      path.join(REPO_ROOT, 'evolve', 'probes', 'clean-code', 'clean-code-001'),
    ];

    for (const dir of probes) {
      const probeDef = loadProbe(dir);
      const out = execFileSync(process.execPath, [probeDef.checkerPath], {
        cwd: dir,
        encoding: 'utf8',
      });

      const parsed = JSON.parse(out);
      assert.equal(parsed.pass, true, `Probe in ${dir} must pass`);
      assert.equal(parsed.score, 1.0, `Probe in ${dir} must score 1.0 on golden fixture`);
      assert.ok(typeof parsed.notes === 'string', 'Probe output must include notes');
    }
  });
});
