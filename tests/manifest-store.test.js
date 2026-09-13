const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
    computeFileHash,
    getInstallManifestPath,
    loadInstallManifest,
    saveInstallManifest,
    resolveFileConflict,
    buildKnownSourceHashes,
    initSessionManifest,
    flushSessionManifest,
    copyDirRecursiveSync,
} = require('../installer.js');

// Backups carry the run's timestamp (installer.js), so a second run cannot
// overwrite the first one's copy. Tests match on the shape, not a fixed name.
function findBackup(file) {
    const dir = path.dirname(file);
    const base = path.basename(file);
    const hit = fs.readdirSync(dir).find((f) => f.startsWith(base + '.') && f.endsWith('.bak'));
    return hit ? path.join(dir, hit) : null;
}

function createIsolatedEnv() {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'bdb-manifest-test-'));
    const fakeHome = path.join(tmpBase, 'home');
    const fakeSrc = path.join(tmpBase, 'src');
    fs.mkdirSync(fakeHome, { recursive: true });
    fs.mkdirSync(fakeSrc, { recursive: true });
    const manifestPath = path.join(fakeHome, '.agents', '.bdb-install-manifest.json');
    return { tmpBase, fakeHome, fakeSrc, manifestPath };
}

function cleanup(tmpBase) {
    try {
        fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch (e) { /* ignore */ }
}

describe('BDB Install Manifest & Conflict Resolution', () => {

    test('(a) fresh install populates the manifest correctly', () => {
        const { tmpBase, fakeHome, fakeSrc, manifestPath } = createIsolatedEnv();
        try {
            // Setup source files
            const skillDir = path.join(fakeSrc, 'skills', 'my-skill');
            fs.mkdirSync(skillDir, { recursive: true });
            const skillFile = path.join(skillDir, 'SKILL.md');
            fs.writeFileSync(skillFile, '# My Skill v1.0\nInitial content\n');

            const targetDir = path.join(fakeHome, '.gemini', 'config', 'skills', 'my-skill');
            const targetFile = path.join(targetDir, 'SKILL.md');

            const knownHashes = buildKnownSourceHashes([fakeSrc]);
            const manifest = {};

            // Perform copy with conflict resolution
            copyDirRecursiveSync(skillDir, targetDir, [], manifest, knownHashes);
            saveInstallManifest(manifest, manifestPath);

            // Assertions
            assert.strictEqual(fs.existsSync(targetFile), true, 'Target file should exist');
            assert.strictEqual(fs.readFileSync(targetFile, 'utf8'), '# My Skill v1.0\nInitial content\n');

            const loadedManifest = loadInstallManifest(manifestPath);
            assert.ok(loadedManifest[targetFile], 'Manifest should contain entry for target file');
            assert.strictEqual(loadedManifest[targetFile].path, targetFile);
            assert.strictEqual(loadedManifest[targetFile].sha256, computeFileHash(skillFile));
            assert.ok(loadedManifest[targetFile].installedAt, 'installedAt should be present');
            assert.ok(loadedManifest[targetFile].version, 'version should be present');
        } finally {
            cleanup(tmpBase);
        }
    });

    // Contract changed deliberately: unrecognised content at a path the payload
    // owns is now updated with a .bak, not skipped. Skipping meant a skill
    // installed before manifest tracking -- whose content no longer matches the
    // current payload, so bootstrap adoption never catches it -- stayed frozen
    // through every future update. The protection moved into the backup.
    test('(b) unrecognised content at an owned path is updated, with a backup', () => {
        const { tmpBase, fakeHome, fakeSrc, manifestPath } = createIsolatedEnv();
        try {
            // Setup target with an existing foreign file (not in manifest, not in known hashes)
            const targetDir = path.join(fakeHome, '.gemini', 'config', 'skills', 'foreign-skill');
            fs.mkdirSync(targetDir, { recursive: true });
            const foreignFile = path.join(targetDir, 'custom.txt');
            const foreignContent = 'An older release of this file, or a local edit';
            fs.writeFileSync(foreignFile, foreignContent);
            const foreignHashBefore = computeFileHash(foreignFile);

            // Shipped source contains a file with the same name but different content
            const srcDir = path.join(fakeSrc, 'skills', 'foreign-skill');
            fs.mkdirSync(srcDir, { recursive: true });
            const srcFile = path.join(srcDir, 'custom.txt');
            fs.writeFileSync(srcFile, 'Shipped file trying to overwrite custom.txt');

            const knownHashes = buildKnownSourceHashes([fakeSrc]);
            const manifest = {}; // No record of foreignFile in manifest

            // Attempt to copy source over foreign file
            const warnings = [];
            const origWarn = console.warn;
            console.warn = (msg) => warnings.push(msg);
            try {
                copyDirRecursiveSync(srcDir, targetDir, [], manifest, knownHashes);
            } finally {
                console.warn = origWarn;
            }

            // The shipped version must win...
            assert.strictEqual(
                fs.readFileSync(foreignFile, 'utf8'),
                'Shipped file trying to overwrite custom.txt',
                'shipped content must replace the unrecognised file',
            );
            assert.notStrictEqual(computeFileHash(foreignFile), foreignHashBefore, 'file must actually change');
            assert.ok(manifest[foreignFile], 'the file is now tracked, so the next update is a clean overwrite');

            // ...and nothing may be lost doing it.
            const backup = findBackup(foreignFile);
            assert.ok(backup, 'previous content must be backed up');
            assert.strictEqual(fs.readFileSync(backup, 'utf8'), foreignContent, 'backup must hold the original bytes');
            // Not asserted here: that the user is told. log.warn() goes through
            // clack to stdout, which this console.warn intercept cannot see.
        } finally {
            cleanup(tmpBase);
        }
    });

    test('(c) an unmodified ours-file updates cleanly on a re-run', () => {
        const { tmpBase, fakeHome, fakeSrc, manifestPath } = createIsolatedEnv();
        try {
            const skillDir = path.join(fakeSrc, 'skills', 'clean-skill');
            fs.mkdirSync(skillDir, { recursive: true });
            const skillFile = path.join(skillDir, 'SKILL.md');
            fs.writeFileSync(skillFile, '# Clean Skill v1.0\n');

            const targetDir = path.join(fakeHome, '.gemini', 'config', 'skills', 'clean-skill');
            const targetFile = path.join(targetDir, 'SKILL.md');

            let knownHashes = buildKnownSourceHashes([fakeSrc]);
            const manifest = {};

            // First install
            copyDirRecursiveSync(skillDir, targetDir, [], manifest, knownHashes);
            saveInstallManifest(manifest, manifestPath);

            assert.strictEqual(fs.readFileSync(targetFile, 'utf8'), '# Clean Skill v1.0\n');

            // Now update the source (simulating package upgrade v1 -> v2)
            fs.writeFileSync(skillFile, '# Clean Skill v2.0 - Updated\n');
            knownHashes = buildKnownSourceHashes([fakeSrc]);

            // Re-run update: disk file has not been touched by user
            copyDirRecursiveSync(skillDir, targetDir, [], manifest, knownHashes);
            saveInstallManifest(manifest, manifestPath);

            // Target file should now have the updated content
            assert.strictEqual(fs.readFileSync(targetFile, 'utf8'), '# Clean Skill v2.0 - Updated\n');
            assert.strictEqual(manifest[targetFile].sha256, computeFileHash(skillFile));
            assert.strictEqual(findBackup(targetFile), null, 'No .bak should be created when ours was unmodified');
        } finally {
            cleanup(tmpBase);
        }
    });

    test('(d) a hand-edited ours-file is backed up to a timestamped .bak, NOT silently overwritten', () => {
        const { tmpBase, fakeHome, fakeSrc, manifestPath } = createIsolatedEnv();
        try {
            const skillDir = path.join(fakeSrc, 'skills', 'edited-skill');
            fs.mkdirSync(skillDir, { recursive: true });
            const skillFile = path.join(skillDir, 'SKILL.md');
            fs.writeFileSync(skillFile, '# Original Shipped Content\n');

            const targetDir = path.join(fakeHome, '.gemini', 'config', 'skills', 'edited-skill');
            const targetFile = path.join(targetDir, 'SKILL.md');

            let knownHashes = buildKnownSourceHashes([fakeSrc]);
            const manifest = {};

            // Initial install
            copyDirRecursiveSync(skillDir, targetDir, [], manifest, knownHashes);
            saveInstallManifest(manifest, manifestPath);

            // User modifies target file on disk by hand
            const userCustomContent = '# User Hand-Edited Custom Changes\nDo not lose this!\n';
            fs.writeFileSync(targetFile, userCustomContent);
            assert.notStrictEqual(computeFileHash(targetFile), manifest[targetFile].sha256);

            // Update arrives from package
            fs.writeFileSync(skillFile, '# New Upstream Content v2.0\n');
            knownHashes = buildKnownSourceHashes([fakeSrc]);

            // Re-run update
            const result = resolveFileConflict(skillFile, targetFile, manifest, knownHashes);

            // Assertions
            assert.strictEqual(result, 'bak', 'Conflict resolution should return bak');
            const bakFile = findBackup(targetFile);
            assert.ok(bakFile, '.bak file must exist');
            assert.strictEqual(fs.readFileSync(bakFile, 'utf8'), userCustomContent, 'User modifications must be preserved in .bak');
            assert.strictEqual(fs.readFileSync(targetFile, 'utf8'), '# New Upstream Content v2.0\n', 'New version should be written to target');
            assert.strictEqual(manifest[targetFile].sha256, computeFileHash(skillFile), 'Manifest should be updated to new hash');
        } finally {
            cleanup(tmpBase);
        }
    });

    test('first-run bootstrap adopts pre-existing matching files into manifest', () => {
        const { tmpBase, fakeHome, fakeSrc, manifestPath } = createIsolatedEnv();
        try {
            const skillDir = path.join(fakeSrc, 'skills', 'bootstrap-skill');
            fs.mkdirSync(skillDir, { recursive: true });
            const skillFile = path.join(skillDir, 'SKILL.md');
            const content = '# Bootstrap Content\n';
            fs.writeFileSync(skillFile, content);

            // Pre-existing file on disk with identical content (from an older install without manifest)
            const targetDir = path.join(fakeHome, '.gemini', 'config', 'skills', 'bootstrap-skill');
            fs.mkdirSync(targetDir, { recursive: true });
            const targetFile = path.join(targetDir, 'SKILL.md');
            fs.writeFileSync(targetFile, content);

            const knownHashes = buildKnownSourceHashes([fakeSrc]);
            const manifest = {}; // empty manifest (first run)

            const result = resolveFileConflict(skillFile, targetFile, manifest, knownHashes);

            assert.strictEqual(result, 'wrote', 'Should adopt pre-existing matching file');
            assert.ok(manifest[targetFile], 'Manifest should now have entry for adopted file');
            assert.strictEqual(manifest[targetFile].sha256, computeFileHash(skillFile));
            assert.strictEqual(findBackup(targetFile), null, 'No .bak should be created');
        } finally {
            cleanup(tmpBase);
        }
    });

    test('session lifecycle: initSessionManifest + copyDirRecursiveSync + flushSessionManifest writes to .bdb-install-manifest.json', () => {
        const { tmpBase, fakeHome, fakeSrc, manifestPath } = createIsolatedEnv();
        const origHome = process.env.HOME;
        process.env.HOME = fakeHome;
        try {
            const skillDir = path.join(fakeSrc, 'skills', 'session-skill');
            fs.mkdirSync(skillDir, { recursive: true });
            const skillFile = path.join(skillDir, 'SKILL.md');
            fs.writeFileSync(skillFile, '# Session Skill Content\n');

            const targetDir = path.join(fakeHome, '.gemini', 'config', 'skills', 'session-skill');
            const targetFile = path.join(targetDir, 'SKILL.md');

            // Initialize session manifest
            initSessionManifest({}, [fakeSrc]);

            // Call copyDirRecursiveSync without explicit manifest (uses session state)
            copyDirRecursiveSync(skillDir, targetDir);

            // Flush session manifest to disk
            flushSessionManifest();

            // Verify disk manifest at ~/.agents/.bdb-install-manifest.json
            assert.strictEqual(fs.existsSync(manifestPath), true, 'Manifest file must be created at fake HOME');
            const saved = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            assert.ok(saved[targetFile], 'Entry for targetFile must exist');
            assert.strictEqual(saved[targetFile].path, targetFile);
            assert.strictEqual(saved[targetFile].sha256, computeFileHash(skillFile));
            assert.ok(saved[targetFile].version, 'version must be present');
            assert.ok(saved[targetFile].installedAt, 'installedAt must be present');
        } finally {
            process.env.HOME = origHome;
            cleanup(tmpBase);
        }
    });
});
