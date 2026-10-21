import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

  test('anti-shrink verification: all entries in pinned fixture are present in deny-list.json (review finding 11)', () => {
    const rootData = JSON.parse(fs.readFileSync(rootDenyListPath, 'utf8'));
    const fixtureData = JSON.parse(fs.readFileSync(pinnedFixturePath, 'utf8'));

    const currentPaths = new Set(rootData.paths);

    for (const requiredPath of fixtureData.minimumPaths) {
      assert.ok(
        currentPaths.has(requiredPath),
        `Deny-list anti-shrink violation: pinned path '${requiredPath}' was removed or altered in deny-list.json`
      );
    }
  });

  test('anti-shrink mutation test: removing any entry from fixture causes check to fail', () => {
    const fixtureData = JSON.parse(fs.readFileSync(pinnedFixturePath, 'utf8'));

    function verifyAntiShrink(candidatePaths, requiredPaths) {
      const set = new Set(candidatePaths);
      for (const p of requiredPaths) {
        if (!set.has(p)) {
          throw new Error(`Anti-shrink check failed: missing '${p}'`);
        }
      }
      return true;
    }

    // Verify valid passes
    assert.equal(verifyAntiShrink(fixtureData.minimumPaths, fixtureData.minimumPaths), true);

    // Mutate by removing each entry one by one and assert failure
    for (const sample of ['AGENTS.md', '.claude/hooks/**', 'installer.js', 'package.json', 'evolve/pins.json', 'deny-list.json']) {
      const mutated = fixtureData.minimumPaths.filter((p) => p !== sample);
      assert.throws(
        () => verifyAntiShrink(mutated, fixtureData.minimumPaths),
        /Anti-shrink check failed/,
        `Removal of '${sample}' must be detected and rejected`
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

  test('matchesPattern handles exact, wildcard, and recursive globs', () => {
    assert.equal(matchesPattern('.claude/hooks/go-gate.mjs', '.claude/hooks/**'), true);
    assert.equal(matchesPattern('.claude/hooks/sub/nested.js', '.claude/hooks/**'), true);
    assert.equal(matchesPattern('tests/go-gate-test.js', 'tests/*go-gate*.*'), true);
    assert.equal(matchesPattern('AGENTS.md', 'AGENTS.md'), true);
    assert.equal(matchesPattern('skills/foo/SKILL.md', 'AGENTS.md'), false);
  });
});
