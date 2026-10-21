import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * Pinned minimum set of immutable paths per Hard Safety Boundary B2
 * (proposal-harness2-recursive-evolution.md & plan-harness2-audit.md §3 B2).
 * Anti-shrink rule: Removing ANY of these entries causes a test failure.
 */
export const PINNED_MINIMUM_SET = [
  '.claude/hooks/**',
  'bin/aos-gate.mjs',
  'bin/aos-gate*.mjs',
  'bin/aos-gogate.mjs',
  'bin/go-check.mjs',
  'bin/guarded-patterns.json',
  'lib/gate-profile.mjs',
  'lib/destructive-rules.js',
  'config/allow-presets.json',
  'tests/*go-gate*.*',
  'AGENTS.md',
  'RULES.md',
  'CLAUDE.md',
  'CODEX.md',
  '.agents/rules/**',
  'installer.js',
  'lib/shipped-hashes.json',
  'lib/retired-skills.js',
  'lib/mcp-secrets.js',
  'lib/mcp-copy-marker.js',
  'lib/permissions-allow.js',
  'bin/aos-mcp-env.mjs',
  '.github/workflows/**',
  '.github/skillspector-baseline.json',
  'bin/aos-evolve.mjs',
  'lib/evolve/**',
  'evolve/**',
  'deny-list.json',
  'package.json',
];

/**
 * Checks whether a given relative path matches a deny-list glob pattern.
 */
export function matchesPattern(relPath, pattern) {
  const normPath = relPath.replace(/^\.\//, '').replace(/\\/g, '/');
  const normPattern = pattern.replace(/^\.\//, '').replace(/\\/g, '/');

  if (normPattern.endsWith('/**')) {
    const prefix = normPattern.slice(0, -3);
    return normPath === prefix || normPath.startsWith(prefix + '/');
  }

  const escaped = normPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*');
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(normPath);
}

/**
 * Checks if a relative path is denied by any pattern in the deny-list.
 */
export function isPathDenied(relPath, patterns) {
  return patterns.some((p) => matchesPattern(relPath, p));
}

describe('AOS Evolve Deny-List & Anti-Shrink (WP1 / B2)', () => {
  const rootDenyListPath = path.join(REPO_ROOT, 'deny-list.json');
  const evolveDenyListPath = path.join(REPO_ROOT, 'evolve', 'deny-list.json');

  test('deny-list.json exists and loads valid JSON schema', () => {
    assert.ok(fs.existsSync(rootDenyListPath), 'root deny-list.json must exist');
    const raw = fs.readFileSync(rootDenyListPath, 'utf8');
    const parsed = JSON.parse(raw);

    assert.equal(parsed.version, 1, 'deny-list version must be 1');
    assert.ok(Array.isArray(parsed.paths), 'deny-list must contain paths array');
    assert.ok(parsed.paths.length > 0, 'deny-list paths must not be empty');
  });

  test('evolve/deny-list.json matches root deny-list.json', () => {
    assert.ok(fs.existsSync(evolveDenyListPath), 'evolve/deny-list.json must exist');
    const rootData = JSON.parse(fs.readFileSync(rootDenyListPath, 'utf8'));
    const evolveData = JSON.parse(fs.readFileSync(evolveDenyListPath, 'utf8'));

    assert.deepEqual(evolveData.paths, rootData.paths, 'evolve/deny-list.json paths must match root deny-list.json');
  });

  test('anti-shrink verification: all pinned minimum paths must be present in deny-list.json', () => {
    const raw = fs.readFileSync(rootDenyListPath, 'utf8');
    const { paths } = JSON.parse(raw);

    for (const requiredPath of PINNED_MINIMUM_SET) {
      assert.ok(
        paths.includes(requiredPath),
        `Deny-list anti-shrink violation: required path '${requiredPath}' was removed or altered in deny-list.json`
      );
    }
  });

  test('anti-shrink simulation: removing any entry from minimum set causes verification failure', () => {
    const raw = fs.readFileSync(rootDenyListPath, 'utf8');
    const { paths } = JSON.parse(raw);

    // Verify each removal triggers detection
    for (const sample of ['AGENTS.md', '.claude/hooks/**', 'installer.js', 'package.json']) {
      const reduced = paths.filter((p) => p !== sample);
      const missing = PINNED_MINIMUM_SET.filter((p) => !reduced.includes(p));
      assert.ok(missing.includes(sample), `Removal of '${sample}' must be detected`);
    }
  });

  test('repository path validation: deny-list patterns match real repository files or payload directories', () => {
    // Known files generated during packaging or prepack
    const prepackGenerated = new Set(['lib/shipped-hashes.json']);

    for (const pattern of PINNED_MINIMUM_SET) {
      if (prepackGenerated.has(pattern)) {
        continue;
      }

      if (pattern.includes('*')) {
        // Find parent directory
        const parts = pattern.split('/');
        const firstWildcardIdx = parts.findIndex((p) => p.includes('*'));
        const parentDir = path.join(REPO_ROOT, ...parts.slice(0, firstWildcardIdx));
        assert.ok(
          fs.existsSync(parentDir),
          `Parent directory '${parentDir}' for pattern '${pattern}' must exist`
        );

        // Check if any file/dir under parent matches
        const entries = fs.readdirSync(parentDir, { recursive: true });
        const hasMatch = entries.some((entry) => {
          const relPath = path.join(...parts.slice(0, firstWildcardIdx), entry);
          return matchesPattern(relPath, pattern);
        });
        assert.ok(
          hasMatch,
          `Deny-list pattern '${pattern}' must match at least one real file or folder in repo`
        );
      } else {
        const fullPath = path.join(REPO_ROOT, pattern);
        assert.ok(
          fs.existsSync(fullPath),
          `Deny-list exact entry '${pattern}' must exist in repo`
        );
      }
    }
  });

  test('path denial enforcement correctly identifies forbidden targets', () => {
    const { paths } = JSON.parse(fs.readFileSync(rootDenyListPath, 'utf8'));

    // Critical security and gatekeeper files
    assert.ok(isPathDenied('.claude/hooks/go-gate.mjs', paths), 'hooks/go-gate.mjs must be denied');
    assert.ok(isPathDenied('bin/aos-gate.mjs', paths), 'bin/aos-gate.mjs must be denied');
    assert.ok(isPathDenied('bin/aos-gogate.mjs', paths), 'bin/aos-gogate.mjs must be denied');
    assert.ok(isPathDenied('bin/go-check.mjs', paths), 'bin/go-check.mjs must be denied');
    assert.ok(isPathDenied('AGENTS.md', paths), 'AGENTS.md must be denied');
    assert.ok(isPathDenied('RULES.md', paths), 'RULES.md must be denied');
    assert.ok(isPathDenied('CLAUDE.md', paths), 'CLAUDE.md must be denied');
    assert.ok(isPathDenied('CODEX.md', paths), 'CODEX.md must be denied');
    assert.ok(isPathDenied('installer.js', paths), 'installer.js must be denied');
    assert.ok(isPathDenied('package.json', paths), 'package.json must be denied');
    assert.ok(isPathDenied('bin/aos-evolve.mjs', paths), 'evolver CLI must be denied');
    assert.ok(isPathDenied('lib/evolve/validate.mjs', paths), 'evolver lib must be denied');
    assert.ok(isPathDenied('evolve/schema/probe.schema.json', paths), 'evolve schema must be denied');
    assert.ok(isPathDenied('deny-list.json', paths), 'deny-list.json itself must be denied');
  });

  test('path denial permits valid skill evolution targets', () => {
    const { paths } = JSON.parse(fs.readFileSync(rootDenyListPath, 'utf8'));

    // Allowed targets in v1 (SKILL.md and skill references)
    assert.ok(!isPathDenied('skills/clean-code/SKILL.md', paths), 'skills/clean-code/SKILL.md must be allowed');
    assert.ok(!isPathDenied('skills/instinct-export/SKILL.md', paths), 'skills/instinct-export/SKILL.md must be allowed');
    assert.ok(!isPathDenied('skills/domain/references/notes.md', paths), 'skill references must be allowed');
  });
});
