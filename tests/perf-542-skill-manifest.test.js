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

test('manifest: hash keys files by path relative to the skill dir, not basename', async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-test-'));
    try {
        const skillA = path.join(tmpDir, 'skill-a');
        const skillB = path.join(tmpDir, 'skill-b');
        writeTestFile(path.join(skillA, 'a'), 'x.md', 'same');
        writeTestFile(path.join(skillB, 'b'), 'x.md', 'same');
        assert.notStrictEqual(dirHash(skillA), dirHash(skillB), 'same basename and content in another subdir must change the hash');
    } finally {
        fs.rmSync(tmpDir, { recursive: true });
    }
});

test('manifest via installer sync: unchanged skipped, edit detected, corrupt manifest falls back', async (t) => {
    const installer = require('../installer');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-test-'));
    try {
        const source = path.join(tmpDir, 'src', 'my-skill');
        const skillsDir = path.join(tmpDir, 'skills');
        const target = path.join(skillsDir, 'my-skill');
        writeTestFile(source, 'SKILL.md', '# Test Skill');
        writeTestFile(source, 'index.js', 'module.exports = {};');

        installer.syncSkillEntry(source, 'my-skill', skillsDir, []);
        assert.ok(skillManifest.readManifest(target), 'first sync records a manifest');

        const past = new Date('2001-01-01T00:00:00Z');
        fs.utimesSync(path.join(target, 'index.js'), past, past);
        installer.syncSkillEntry(source, 'my-skill', skillsDir, []);
        assert.strictEqual(fs.statSync(path.join(target, 'index.js')).mtimeMs, past.getTime(), 'second sync of unchanged skill is skipped');

        writeTestFile(target, 'index.js', 'user edit');
        assert.strictEqual(skillManifest.shouldSkipSkillSync(source, target).reason, 'target edited', 'edit is detected');
        installer.syncSkillEntry(source, 'my-skill', skillsDir, []);
        assert.strictEqual(skillManifest.shouldSkipSkillSync(source, target).skip, true, 'resync records the new target state');

        fs.writeFileSync(path.join(target, skillManifest.MANIFEST_FILE), '{not json');
        assert.strictEqual(skillManifest.shouldSkipSkillSync(source, target).reason, 'no manifest', 'corrupt manifest is treated as missing');
        installer.syncSkillEntry(source, 'my-skill', skillsDir, []);
        assert.strictEqual(skillManifest.readManifest(target).sourceHash, dirHash(source), 'corrupt manifest is rewritten');
        assert.strictEqual(fs.readFileSync(path.join(target, 'index.js'), 'utf8'), 'module.exports = {};', 'source content is present');
    } finally {
        fs.rmSync(tmpDir, { recursive: true });
    }
});

test('synced skill copy with a manifest is removed completely by the uninstall helper', async () => {
    const { pathToFileURL } = require('url');
    const { removeSyncedSkillCopies } = await import(pathToFileURL(path.join(__dirname, '..', 'bin', 'aos-uninstall.mjs')).href);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-skillmf-'));
    try {
        const copy = path.join(home, '.claude', 'skills', 'memb-ingest');
        writeTestFile(copy, 'SKILL.md', '# memb-ingest');
        writeTestFile(path.join(copy, 'scripts'), 'run.js', 'module.exports = {};');
        skillManifest.writeManifest(copy, dirHash(copy), dirHash(copy));

        const done = removeSyncedSkillCopies({ home });
        assert.deepStrictEqual(done, [{ copy, result: 'removed' }]);
        assert.strictEqual(fs.existsSync(copy), false, 'copy and its manifest are gone');
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
    }
});
