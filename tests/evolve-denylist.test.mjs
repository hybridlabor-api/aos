import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDenied, assertNotDenied, matchesPattern, loadDenyList } from '../lib/evolve/deny.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

describe('AOS Evolve Deny-List & Production Path Guard (Hard Safety Boundary B2)', () => {
  const rootDenyListPath = path.join(REPO_ROOT, 'deny-list.json');
  const evolveDenyListPath = path.join(REPO_ROOT, 'evolve', 'deny-list.json');
  const pinnedFixturePath = path.join(REPO_ROOT, 'tests', 'fixtures', 'pinned-denylist.json');

  test('deny-list.json exists and contains required structure', () => {
    assert.ok(fs.existsSync(rootDenyListPath), 'root deny-list.json must exist');
    assert.ok(fs.existsSync(evolveDenyListPath), 'evolve/deny-list.json must exist');
    assert.ok(fs.existsSync(pinnedFixturePath), 'tests/fixtures/pinned-denylist.json must exist');

    const rootContent = JSON.parse(fs.readFileSync(rootDenyListPath, 'utf8'));
    assert.equal(rootContent.version, 1);
    assert.ok(Array.isArray(rootContent.paths));
    assert.ok(rootContent.paths.length > 25);
  });

  test('NF-7: pinned-denylist.json integrity matches pinned sha256 hash', () => {
    const raw = fs.readFileSync(pinnedFixturePath);
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const EXPECTED_HASH = '1a273f4e53c65ec41dec6b28f9c087b883f9d333af35742deb0dcfd04bd20fcd';
    assert.equal(hash, EXPECTED_HASH, 'tests/fixtures/pinned-denylist.json sha256 must match pinned hash');
  });

  test('equality test: deny-list.json and evolve/deny-list.json are strictly identical', () => {
    const rootRaw = fs.readFileSync(rootDenyListPath, 'utf8');
    const evolveRaw = fs.readFileSync(evolveDenyListPath, 'utf8');
    assert.equal(rootRaw, evolveRaw, 'deny-list.json and evolve/deny-list.json must be identical byte-for-byte');

    const rootPaths = loadDenyList(rootDenyListPath);
    const evolvePaths = loadDenyList(evolveDenyListPath);
    assert.deepEqual(rootPaths, evolvePaths, 'parsed paths from both deny lists must match');
  });

  test('loadDenyList fails closed on missing or corrupt file', () => {
    assert.throws(
      () => loadDenyList(path.join(REPO_ROOT, 'nonexistent-deny-list.json')),
      /Deny-list file not found/,
      'must throw error when deny-list file does not exist'
    );

    const tmpCorrupt = path.join(os.tmpdir(), `corrupt-denylist-${Date.now()}.json`);
    fs.writeFileSync(tmpCorrupt, '{ invalid json: [', 'utf8');
    try {
      assert.throws(
        () => loadDenyList(tmpCorrupt),
        /Failed to parse deny-list/,
        'must throw error on invalid JSON'
      );
    } finally {
      try { fs.unlinkSync(tmpCorrupt); } catch {}
    }
  });

  test('anti-shrink verification: loadDenyList contains all entries in pinned fixture', () => {
    const rootPaths = loadDenyList(rootDenyListPath);
    const fixtureData = JSON.parse(fs.readFileSync(pinnedFixturePath, 'utf8'));

    const currentSet = new Set(rootPaths);
    for (const requiredPath of fixtureData.minimumPaths) {
      assert.ok(
        currentSet.has(requiredPath),
        `Deny-list anti-shrink violation: pinned path '${requiredPath}' was removed or altered in deny-list.json`
      );
    }
  });

  test('anti-shrink mutation test: removing pinned entries directly flips production isDenied/assertNotDenied', () => {
    const fixtureData = JSON.parse(fs.readFileSync(pinnedFixturePath, 'utf8'));
    const samples = [
      { pattern: 'AGENTS.md', target: 'AGENTS.md' },
      { pattern: 'RULES.md', target: 'RULES.md' },
      { pattern: 'CLAUDE.md', target: 'CLAUDE.md' },
      { pattern: 'installer.js', target: 'installer.js' },
      { pattern: 'package.json', target: 'package.json' },
      { pattern: 'deny-list.json', target: 'deny-list.json' },
      { pattern: '.claude/hooks/**', target: '.claude/hooks/go-gate.mjs' },
    ];

    for (const { pattern, target } of samples) {
      // With full list, the path must be denied
      assert.equal(isDenied(target, REPO_ROOT, fixtureData.minimumPaths), true);
      assert.throws(
        () => assertNotDenied(target, REPO_ROOT, fixtureData.minimumPaths),
        /Access denied/
      );

      // Mutate list by removing the required entry
      const mutatedList = fixtureData.minimumPaths.filter((p) => p !== pattern);
      // The path should now become permitted under mutatedList
      const allowedAfterRemoval = !isDenied(target, REPO_ROOT, mutatedList);
      assert.ok(
        allowedAfterRemoval,
        `Target '${target}' must become permitted when '${pattern}' is removed from deny patterns`
      );
    }
  });

  test('production matcher isDenied blocks immutable files (review finding 9 & 10)', () => {
    // Critical gate and rule files
    assert.equal(isDenied('AGENTS.md', REPO_ROOT), true);
    assert.equal(isDenied('RULES.md', REPO_ROOT), true);
    assert.equal(isDenied('CLAUDE.md', REPO_ROOT), true);
    assert.equal(isDenied('CODEX.md', REPO_ROOT), true);
    assert.equal(isDenied('.claude/settings.json', REPO_ROOT), true);
    assert.equal(isDenied('config/claude-hooks.json', REPO_ROOT), true);
    assert.equal(isDenied('bin/aos-gate.mjs', REPO_ROOT), true);
    assert.equal(isDenied('bin/aos-gogate.mjs', REPO_ROOT), true);
    assert.equal(isDenied('installer.js', REPO_ROOT), true);
    assert.equal(isDenied('package.json', REPO_ROOT), true);
    assert.equal(isDenied('deny-list.json', REPO_ROOT), true);
    assert.equal(isDenied('evolve/pins.json', REPO_ROOT), true);
    assert.equal(isDenied('scripts/build-cli-reference.mjs', REPO_ROOT), true);
    assert.equal(isDenied('tests/evolve-schema.test.mjs', REPO_ROOT), true);

    // Newly added protected core paths
    assert.equal(isDenied('lib/router/route.mjs', REPO_ROOT), true);
    assert.equal(isDenied('config/router.json', REPO_ROOT), true);
    assert.equal(isDenied('lib/sandbox.mjs', REPO_ROOT), true);
    assert.equal(isDenied('bin/aos-acp.mjs', REPO_ROOT), true);
    assert.equal(isDenied('bin/aos-acp-client.mjs', REPO_ROOT), true);
    assert.equal(isDenied('lib/cli-specs/agents.mjs', REPO_ROOT), true);
    assert.equal(isDenied('.aos/briefs/test.md', REPO_ROOT), true);

    // NF-6 newly protected core paths
    assert.equal(isDenied('.claude/workflows/deploy.yml', REPO_ROOT), true);
    assert.equal(isDenied('.claude/agents/architect.md', REPO_ROOT), true);
    assert.equal(isDenied('.agents/graph.md', REPO_ROOT), true);
    assert.equal(isDenied('.agents/nodes.json', REPO_ROOT), true);
    assert.equal(isDenied('lib/a2a-permissions.mjs', REPO_ROOT), true);
    assert.equal(isDenied('lib/a2a-spawn.mjs', REPO_ROOT), true);
    assert.equal(isDenied('docs/gate-profile.md', REPO_ROOT), true);
  });

  test('production matcher isDenied permits non-core skill body files', () => {
    assert.equal(isDenied('skills/clean-code/SKILL.md', REPO_ROOT), false);
    assert.equal(isDenied('skills/domain-modeling/SKILL.md', REPO_ROOT), false);
  });

  test('production matcher blocks path traversal outside repo root', () => {
    assert.equal(isDenied('../outside-repo/file.txt', REPO_ROOT), true);
    assert.equal(isDenied('/etc/passwd', REPO_ROOT), true);

    assert.throws(
      () => assertNotDenied('../outside-repo/file.txt', REPO_ROOT),
      /Access denied/
    );
  });

  test('symlink and non-existent child traversal is resolved and blocked', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-symlink-test-'));
    const linkPath = path.join(REPO_ROOT, 'tmp-test-symlink-dir');
    try {
      fs.symlinkSync(tmpDir, linkPath, 'dir');
      // Target does not exist, but parent is a symlink pointing outside REPO_ROOT
      const nonExistentDeepTarget = path.join(linkPath, 'nested', 'deep', 'file.txt');
      assert.equal(isDenied(nonExistentDeepTarget, REPO_ROOT), true);
      assert.throws(
        () => assertNotDenied(nonExistentDeepTarget, REPO_ROOT),
        /Access denied/
      );
    } finally {
      try { fs.unlinkSync(linkPath); } catch {}
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('case-insensitivity on darwin and win32 protects home paths and deny patterns', () => {
    if (process.platform === 'darwin' || process.platform === 'win32') {
      assert.equal(isDenied('agents.md', REPO_ROOT), true);
      assert.equal(isDenied('Agents.MD', REPO_ROOT), true);
      assert.equal(isDenied('RULES.MD', REPO_ROOT), true);
      assert.equal(isDenied('Package.JSON', REPO_ROOT), true);
    }
  });

  test('NF-5: home guard protects resolved and unresolved home directory paths', () => {
    const rawHome = os.homedir();
    assert.equal(isDenied(path.join(rawHome, '.claude', 'settings.json'), REPO_ROOT), true);
    assert.equal(isDenied(path.join(rawHome, '.agents', 'custom.md'), REPO_ROOT), true);
    assert.equal(isDenied(path.join(rawHome, '.aos', 'gate', 'config.json'), REPO_ROOT), true);

    try {
      const realHome = fs.realpathSync(rawHome);
      assert.equal(isDenied(path.join(realHome, '.claude', 'settings.json'), REPO_ROOT), true);
      assert.equal(isDenied(path.join(realHome, '.agents', 'custom.md'), REPO_ROOT), true);
      assert.equal(isDenied(path.join(realHome, '.aos', 'gate', 'config.json'), REPO_ROOT), true);
    } catch {}
  });

  test('matchesPattern handles exact, wildcard, and recursive globs', () => {
    assert.equal(matchesPattern('.claude/hooks/go-gate.mjs', '.claude/hooks/**'), true);
    assert.equal(matchesPattern('.claude/hooks/sub/nested.js', '.claude/hooks/**'), true);
    assert.equal(matchesPattern('tests/go-gate-test.js', 'tests/*go-gate*.*'), true);
    assert.equal(matchesPattern('AGENTS.md', 'AGENTS.md'), true);
    assert.equal(matchesPattern('skills/foo/SKILL.md', 'AGENTS.md'), false);
    assert.equal(matchesPattern('bin/aos-acp.mjs', 'bin/aos-acp*.mjs'), true);
    assert.equal(matchesPattern('bin/aos-acp-client.mjs', 'bin/aos-acp*.mjs'), true);
  });
});
