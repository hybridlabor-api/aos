import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadProbe, computeFileSha256 } from '../lib/evolve/probe-load.mjs';

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

  test('loadProbe successfully loads instinct-export-001 probe with checksum verification', () => {
    const probeDir = path.join(REPO_ROOT, 'evolve', 'probes', 'instinct-export', 'instinct-export-001');
    const result = loadProbe(probeDir);

    assert.equal(result.ok, true);
    assert.equal(result.probe.id, 'instinct-export-001');
    assert.equal(result.probe.skill, 'instinct-export');
    assert.ok(result.checkerPath && fs.existsSync(result.checkerPath));
    assert.ok(result.expectedPath && fs.existsSync(result.expectedPath));
    assert.ok(result.fixtureDir && fs.existsSync(result.fixtureDir));
  });

  test('loadProbe successfully loads skill-create-001 probe with checksum verification', () => {
    const probeDir = path.join(REPO_ROOT, 'evolve', 'probes', 'skill-create', 'skill-create-001');
    const result = loadProbe(probeDir);

    assert.equal(result.ok, true);
    assert.equal(result.probe.id, 'skill-create-001');
    assert.equal(result.probe.skill, 'skill-create');
    assert.ok(result.checkerPath && fs.existsSync(result.checkerPath));
    assert.ok(result.expectedPath && fs.existsSync(result.expectedPath));
    assert.ok(result.fixtureDir && fs.existsSync(result.fixtureDir));
  });

  test('loadProbe successfully loads clean-code-001 probe with checksum verification', () => {
    const probeDir = path.join(REPO_ROOT, 'evolve', 'probes', 'clean-code', 'clean-code-001');
    const result = loadProbe(probeDir);

    assert.equal(result.ok, true);
    assert.equal(result.probe.id, 'clean-code-001');
    assert.equal(result.probe.skill, 'clean-code');
    assert.ok(result.checkerPath && fs.existsSync(result.checkerPath));
    assert.ok(result.expectedPath && fs.existsSync(result.expectedPath));
    assert.ok(result.fixtureDir && fs.existsSync(result.fixtureDir));
  });

  test('anti-tampering: detects and rejects modified check.mjs', () => {
    // Clone instinct-export-001 to tmpDir
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

  test('rejects probe with invalid schema structure', () => {
    const badProbeDir = path.join(tmpDir, 'bad-probe');
    fs.mkdirSync(badProbeDir);
    fs.writeFileSync(path.join(badProbeDir, 'probe.json'), JSON.stringify({
      version: 999, // invalid version
      id: 'bad-001',
    }), 'utf8');

    assert.throws(
      () => loadProbe(badProbeDir),
      /probe.json failed schema validation/,
      'Schema violations must be rejected'
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
