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

const loadUninstall = () => import(require('url').pathToFileURL(path.join(__dirname, '..', 'bin', 'aos-uninstall.mjs')).href);
const record = (dir) => skillManifest.writeManifest(dir, 'source-hash', 'target-hash');
const has = (...p) => fs.existsSync(path.join(...p));

test('uninstall pass removes the AOS record and then-empty dirs only; user files, user skills and the roots stay', async () => {
    const { removeSyncedSkillCopies } = await loadUninstall();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-skillmf-'));
    try {
        const root = path.join(home, '.claude', 'skills');
        const emptied = path.join(root, 'memb-ingest'); // the file pass took its files: the record and an empty subdir are left
        fs.mkdirSync(path.join(emptied, 'scripts'), { recursive: true });
        record(emptied);
        const withBackup = path.join(root, 'bdbrainstorm'); // an edited file's .bak and a user note keep their copy
        writeTestFile(withBackup, 'SKILL.md.20261027T090000.bak', 'my edit');
        writeTestFile(path.join(withBackup, 'refs'), 'notes.md', 'mine');
        record(withBackup);
        const unremoved = path.join(root, 'github-repo'); // a file nothing removed: this pass deletes no content
        writeTestFile(unremoved, 'SKILL.md', '# github-repo');
        record(unremoved);
        const own = path.join(root, 'my-own'); // a user skill has no record
        writeTestFile(own, 'SKILL.md', '# mine');
        const corrupt = path.join(root, 'corrupt'); // a record that does not parse proves nothing
        writeTestFile(corrupt, skillManifest.MANIFEST_FILE, '{not json');
        const dirNamedLikeRecord = path.join(root, 'dir-record');
        writeTestFile(path.join(dirNamedLikeRecord, skillManifest.MANIFEST_FILE), 'inner.txt', 'x');
        writeTestFile(root, 'stray.txt', 'a file in the root');
        const agents = path.join(home, '.agents', 'skills', 'codebase-memory');
        fs.mkdirSync(agents, { recursive: true });
        record(agents);

        const rel = (d) => `${path.relative(home, d.copy)}=${d.result}`;
        assert.deepStrictEqual(removeSyncedSkillCopies({ home }).map(rel).sort(), [
            `${path.join('.agents', 'skills', 'codebase-memory')}=removed`,
            `${path.join('.claude', 'skills', 'bdbrainstorm')}=kept`,
            `${path.join('.claude', 'skills', 'github-repo')}=kept`,
            `${path.join('.claude', 'skills', 'memb-ingest')}=removed`,
        ].sort());

        assert.ok(!has(emptied) && !has(agents), 'a copy left with only its record goes whole');
        assert.ok(!has(withBackup, skillManifest.MANIFEST_FILE) && !has(unremoved, skillManifest.MANIFEST_FILE), 'the record goes from a copy that still holds files');
        assert.strictEqual(fs.readFileSync(path.join(withBackup, 'SKILL.md.20261027T090000.bak'), 'utf8'), 'my edit');
        assert.strictEqual(fs.readFileSync(path.join(withBackup, 'refs', 'notes.md'), 'utf8'), 'mine');
        assert.ok(has(unremoved, 'SKILL.md'));
        assert.ok(has(own, 'SKILL.md') && has(corrupt, skillManifest.MANIFEST_FILE) && has(dirNamedLikeRecord, skillManifest.MANIFEST_FILE, 'inner.txt'), 'nothing unproven is touched');
        assert.ok(has(root, 'stray.txt'));
        for (const keep of [home, path.join(home, '.claude'), root, path.join(home, '.agents'), path.join(home, '.agents', 'skills')]) {
            assert.ok(fs.statSync(keep).isDirectory(), `${path.relative(home, keep) || 'home'} stays`);
        }
        assert.deepStrictEqual(removeSyncedSkillCopies({ home }), [], 'a second pass finds nothing left to do');
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
    }
});

test('uninstall pass never follows a symlinked copy or record and refuses a root that is $HOME', { skip: process.platform === 'win32' }, async () => {
    const { removeSyncedSkillCopies } = await loadUninstall();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-skillmf-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-skillmf-out-'));
    try {
        const root = path.join(home, '.claude', 'skills');
        fs.mkdirSync(root, { recursive: true });
        const target = path.join(outside, 'elsewhere'); // a symlinked copy points at a real copy outside the root
        writeTestFile(target, 'keep.txt', 'x');
        record(target);
        fs.symlinkSync(target, path.join(root, 'linked'));
        const linkedRecord = path.join(root, 'linked-record'); // a real copy whose record is a symlink
        writeTestFile(linkedRecord, 'SKILL.md', '# x');
        const realRecord = path.join(outside, 'record.json');
        fs.writeFileSync(realRecord, JSON.stringify({ sourceHash: 'a', targetHash: 'b' }));
        fs.symlinkSync(realRecord, path.join(linkedRecord, skillManifest.MANIFEST_FILE));
        const victim = path.join(home, 'victim'); // child of HOME, with a valid record
        record(victim);
        fs.mkdirSync(path.join(home, '.codex'));
        fs.symlinkSync(home, path.join(home, '.codex', 'skills')); // a skill root that resolves to HOME

        assert.deepStrictEqual(removeSyncedSkillCopies({ home }), []);
        assert.ok(has(target, skillManifest.MANIFEST_FILE) && has(target, 'keep.txt'), 'the symlink target is untouched');
        assert.ok(fs.lstatSync(path.join(linkedRecord, skillManifest.MANIFEST_FILE)).isSymbolicLink() && fs.existsSync(realRecord));
        assert.ok(has(victim, skillManifest.MANIFEST_FILE), 'nothing under a root that is HOME is touched');
        assert.strictEqual(skillManifest.removeSyncedRecord(path.join(root, 'linked')), false, 'the library refuses a symlinked copy on its own');
        assert.strictEqual(skillManifest.removeSyncedRecord(linkedRecord), false, 'and a symlinked record');
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});

test('uninstall pass follows a skill root that is a symlink to a real dir, as the file pass did', { skip: process.platform === 'win32' }, async () => {
    const { removeSyncedSkillCopies } = await loadUninstall();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-skillmf-'));
    const dotfiles = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-skillmf-dot-'));
    try {
        fs.mkdirSync(path.join(home, '.agents'));
        fs.symlinkSync(dotfiles, path.join(home, '.agents', 'skills'));
        const emptied = path.join(dotfiles, 'foo');
        fs.mkdirSync(emptied);
        record(emptied);
        writeTestFile(path.join(dotfiles, 'mine'), 'SKILL.md', '# mine');

        assert.deepStrictEqual(removeSyncedSkillCopies({ home }), [{ copy: path.join(home, '.agents', 'skills', 'foo'), result: 'removed' }]);
        assert.ok(!has(emptied) && has(dotfiles, 'mine', 'SKILL.md') && fs.lstatSync(path.join(home, '.agents', 'skills')).isSymbolicLink(), 'the root link and its target dir stay');
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(dotfiles, { recursive: true, force: true });
    }
});
