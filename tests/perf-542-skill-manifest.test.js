'use strict';
// Tests for skill manifest optimization: unchanged skills are skipped
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const skillManifest = require('../lib/skill-manifest');

// Helper: write test files
function writeTestFile(dir, name, content) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
}

// Helper: compute dir hash manually
function dirHash(dir) {
    return skillManifest.computeDirContentHash(dir);
}

test('manifest: unchanged skill -> skip', async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-test-'));
    try {
        const source = path.join(tmpDir, 'source');
        const target = path.join(tmpDir, 'target');

        // Create source skill
        writeTestFile(source, 'SKILL.md', '# Test Skill');
        writeTestFile(source, 'index.js', 'module.exports = {};');

        // Create target with same content and manifest
        writeTestFile(target, 'SKILL.md', '# Test Skill');
        writeTestFile(target, 'index.js', 'module.exports = {};');

        const sourceHash = dirHash(source);
        const targetHash = dirHash(target);
        skillManifest.writeManifest(target, sourceHash, targetHash);

        // Now check: should skip
        const result = skillManifest.shouldSkipSkillSync(source, target);
        assert.strictEqual(result.skip, true, 'unchanged skill should be skipped');
    } finally {
        fs.rmSync(tmpDir, { recursive: true });
    }
});

test('manifest: source changed -> no skip', async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-test-'));
    try {
        const source = path.join(tmpDir, 'source');
        const target = path.join(tmpDir, 'target');

        // Create initial source skill
        writeTestFile(source, 'SKILL.md', '# Test Skill');
        writeTestFile(source, 'index.js', 'module.exports = {};');

        // Create target with same content
        writeTestFile(target, 'SKILL.md', '# Test Skill');
        writeTestFile(target, 'index.js', 'module.exports = {};');

        const sourceHash = dirHash(source);
        const targetHash = dirHash(target);
        skillManifest.writeManifest(target, sourceHash, targetHash);

        // Modify source
        writeTestFile(source, 'new-file.js', 'console.log("new");');

        // Now check: should NOT skip (source changed)
        const result = skillManifest.shouldSkipSkillSync(source, target);
        assert.strictEqual(result.skip, false, 'changed source should not be skipped');
    } finally {
        fs.rmSync(tmpDir, { recursive: true });
    }
});

test('manifest: target edited -> no skip', async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-test-'));
    try {
        const source = path.join(tmpDir, 'source');
        const target = path.join(tmpDir, 'target');

        // Create source skill
        writeTestFile(source, 'SKILL.md', '# Test Skill');
        writeTestFile(source, 'index.js', 'module.exports = {};');

        // Create target with same content
        writeTestFile(target, 'SKILL.md', '# Test Skill');
        writeTestFile(target, 'index.js', 'module.exports = {};');

        const sourceHash = dirHash(source);
        const targetHash = dirHash(target);
        skillManifest.writeManifest(target, sourceHash, targetHash);

        // User edits target
        writeTestFile(target, 'user-config.json', '{"custom": true}');

        // Now check: should NOT skip (target edited)
        const result = skillManifest.shouldSkipSkillSync(source, target);
        assert.strictEqual(result.skip, false, 'edited target should be detected');
    } finally {
        fs.rmSync(tmpDir, { recursive: true });
    }
});

test('manifest: no manifest -> no skip', async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-test-'));
    try {
        const source = path.join(tmpDir, 'source');
        const target = path.join(tmpDir, 'target');

        // Create source skill
        writeTestFile(source, 'SKILL.md', '# Test Skill');

        // No manifest on target

        // Should not skip (no manifest to compare)
        const result = skillManifest.shouldSkipSkillSync(source, target);
        assert.strictEqual(result.skip, false, 'missing manifest should not skip');
    } finally {
        fs.rmSync(tmpDir, { recursive: true });
    }
});

test('manifest: read and write roundtrip', async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-test-'));
    try {
        const dir = path.join(tmpDir, 'skill');
        const sourceHash = 'abc123';
        const targetHash = 'def456';

        skillManifest.writeManifest(dir, sourceHash, targetHash);
        const manifest = skillManifest.readManifest(dir);

        assert.strictEqual(manifest.sourceHash, sourceHash, 'source hash should be persisted');
        assert.strictEqual(manifest.targetHash, targetHash, 'target hash should be persisted');
        assert.ok(manifest.savedAt, 'savedAt timestamp should exist');
    } finally {
        fs.rmSync(tmpDir, { recursive: true });
    }
});
