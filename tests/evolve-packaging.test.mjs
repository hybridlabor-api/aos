import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadSchema, KNOWN_SCHEMAS } from '../lib/evolve/validate.mjs';
import { loadDenyList, isDenied, getTrustRootDenyListPath } from '../lib/evolve/deny.mjs';
import { loadPins, getTrustRootPinsPath } from '../lib/evolve/probe-load.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

describe('AOS Evolve Packaging & Trust Roots (Blocking 1-3: NF-0, NF-1, NF-2)', () => {
  const packageJsonPath = path.join(REPO_ROOT, 'package.json');
  const packageData = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  test('NF-0 packaging: package.json "files" includes deny-list.json and evolve/', () => {
    assert.ok(Array.isArray(packageData.files), 'package.json must specify files array');
    assert.ok(packageData.files.includes('deny-list.json'), 'package.json "files" must include deny-list.json');
    assert.ok(packageData.files.includes('evolve/'), 'package.json "files" must include evolve/');
  });

  test('NF-0 packaging: all evolve schemas are packaged and loadable', () => {
    for (const schemaName of KNOWN_SCHEMAS) {
      const schemaPath = path.join(REPO_ROOT, 'evolve', 'schema', `${schemaName}.schema.json`);
      assert.ok(fs.existsSync(schemaPath), `Schema file ${schemaPath} must exist`);
      const schema = loadSchema(schemaName);
      assert.ok(schema && typeof schema === 'object', `Loaded schema '${schemaName}' must be an object`);
    }
  });

  test('NF-1 trust root: deny-list defaults to REPO_ROOT and ignores candidate worktree cwd', () => {
    const trustRootPath = getTrustRootDenyListPath();
    assert.ok(fs.existsSync(trustRootPath), 'Trust root deny-list must exist');
    assert.ok(trustRootPath.startsWith(REPO_ROOT), 'Trust root deny-list must resolve inside REPO_ROOT');

    const loaded = loadDenyList();
    assert.ok(Array.isArray(loaded));
    assert.ok(loaded.includes('RULES.md'));
    assert.ok(loaded.includes('installer.js'));

    // Simulate candidate worktree with empty/corrupt deny-list.json in a temp directory
    const tmpCandidate = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-candidate-worktree-'));
    try {
      fs.writeFileSync(path.join(tmpCandidate, 'deny-list.json'), JSON.stringify({ version: 1, paths: [] }));
      const prevCwd = process.cwd();
      try {
        process.chdir(tmpCandidate);
        // Even when cwd is the candidate worktree, loadDenyList() and isDenied() load from REPO_ROOT
        const pathsFromCwd = loadDenyList();
        assert.ok(pathsFromCwd.includes('RULES.md'), 'loadDenyList must load REPO_ROOT trust root, not candidate cwd');

        // isDenied called on candidate root must still protect immutable files using REPO_ROOT deny list
        assert.equal(isDenied('RULES.md', tmpCandidate), true, 'Candidate worktree cannot shrink deny-list to allow RULES.md');
        assert.equal(isDenied('installer.js', tmpCandidate), true, 'Candidate worktree cannot shrink deny-list to allow installer.js');
      } finally {
        process.chdir(prevCwd);
      }
    } finally {
      try { fs.rmSync(tmpCandidate, { recursive: true, force: true }); } catch {}
    }
  });

  test('NF-2 pins trust root: probe pins default to REPO_ROOT and fail closed on missing file', () => {
    const trustRootPins = getTrustRootPinsPath();
    assert.ok(fs.existsSync(trustRootPins), 'Trust root pins.json must exist');
    assert.ok(trustRootPins.startsWith(REPO_ROOT), 'Trust root pins must resolve inside REPO_ROOT');

    const pins = loadPins();
    assert.ok(typeof pins === 'object' && pins !== null);
    assert.ok(pins['clean-code-001'], 'Must contain pin for clean-code-001');

    // Simulate candidate worktree with altered pins.json
    const tmpCandidate = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-candidate-pins-'));
    try {
      const candidateEvolve = path.join(tmpCandidate, 'evolve');
      fs.mkdirSync(candidateEvolve, { recursive: true });
      fs.writeFileSync(path.join(candidateEvolve, 'pins.json'), JSON.stringify({ pins: { 'fake-probe': {} } }));

      const prevCwd = process.cwd();
      try {
        process.chdir(tmpCandidate);
        const pinsFromCwd = loadPins();
        assert.ok(pinsFromCwd['clean-code-001'], 'loadPins must load from REPO_ROOT trust root, not candidate cwd');
        assert.equal(pinsFromCwd['fake-probe'], undefined, 'Candidate pins must not override trust root pins');
      } finally {
        process.chdir(prevCwd);
      }
    } finally {
      try { fs.rmSync(tmpCandidate, { recursive: true, force: true }); } catch {}
    }

    // Fail closed on nonexistent custom pins path
    assert.throws(
      () => loadPins('/nonexistent/path/to/pins.json'),
      /Pins file not found/,
      'Must fail closed when pins file is missing'
    );
  });

  test('NF-0 packaging: npm pack --dry-run --json includes evolve/ and deny-list.json in tarball', () => {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    // The --json file listing of this package is several MB; the default
    // spawnSync maxBuffer (1 MB) kills the child with ENOBUFS and status null.
    const r = spawnSync(npmCmd, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, npm_config_ignore_scripts: 'true' },
    });
    assert.equal(r.error, undefined, `npm pack could not run: ${r.error && r.error.message}`);
    assert.equal(r.status, 0, `npm pack failed: ${r.stderr || r.stdout}`);
    const packInfo = JSON.parse(r.stdout);
    const files = (packInfo[0]?.files || []).map((f) => f.path);
    assert.ok(
      files.includes('deny-list.json'),
      'pack contents must include deny-list.json'
    );
    assert.ok(
      files.some((f) => f.startsWith('evolve/')),
      'pack contents must include evolve/ directory files'
    );
  });
});
