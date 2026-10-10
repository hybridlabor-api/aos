const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
    computeFileHash,
    loadInstallManifest,
    saveInstallManifest,
    resolveFileConflict,
    installOpencodeCommands,
    setShippedHashes,
    getInstallManifestPath,
} = require('../installer.js');

function createIsolatedEnv() {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'bdb-shipped-hashes-test-'));
    const fakeHome = path.join(tmpBase, 'home');
    const fakeSrc = path.join(tmpBase, 'src');
    fs.mkdirSync(fakeHome, { recursive: true });
    fs.mkdirSync(fakeSrc, { recursive: true });
    return { tmpBase, fakeHome, fakeSrc };
}

function cleanup(tmpBase) {
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

describe('Shipped-hash ownership rule', () => {

    // (a) Disk holds an older AOS release: its hash is in the shipped set but
    // differs from both the manifest hash and the source → overwritten, no .new.
    test('(a) older shipped release is overwritten without .new', () => {
        const { tmpBase, fakeSrc } = createIsolatedEnv();
        try {
            const srcFile = path.join(fakeSrc, 'skills', 'demo', 'SKILL.md');
            fs.mkdirSync(path.dirname(srcFile), { recursive: true });
            fs.writeFileSync(srcFile, '# Demo v3 current\n');

            const targetFile = path.join(tmpBase, 'home', 'skills', 'demo', 'SKILL.md');
            fs.mkdirSync(path.dirname(targetFile), { recursive: true });
            fs.writeFileSync(targetFile, '# Demo v1 old release\n');
            const oldHash = computeFileHash(targetFile);

            const manifest = {};
            const shipped = new Set([oldHash]);

            const result = resolveFileConflict(srcFile, targetFile, manifest, new Set(), shipped);

            assert.strictEqual(result, 'wrote');
            assert.strictEqual(fs.readFileSync(targetFile, 'utf8'), '# Demo v3 current\n');
            assert.ok(manifest[targetFile], 'manifest entry recorded');
            assert.strictEqual(fs.readdirSync(path.dirname(targetFile)).filter((f) => f.endsWith('.new')).length, 0, 'no .new written');
        } finally {
            cleanup(tmpBase);
        }
    });

    // (b) Disk holds a user edit of an AOS file: manifest entry exists, hash
    // not shipped → kept, shipped copy written as .new.
    test('(b) user edit of an AOS file is kept, .new written', () => {
        const { tmpBase, fakeSrc } = createIsolatedEnv();
        try {
            const srcFile = path.join(fakeSrc, 'skills', 'demo', 'SKILL.md');
            fs.mkdirSync(path.dirname(srcFile), { recursive: true });
            fs.writeFileSync(srcFile, '# Demo v3 current\n');

            const targetFile = path.join(tmpBase, 'home', 'skills', 'demo', 'SKILL.md');
            fs.mkdirSync(path.dirname(targetFile), { recursive: true });
            fs.writeFileSync(targetFile, '# Demo v1\n# my local edits\n');

            // The manifest records what AOS installed last; the disk now differs from it.
            const manifest = { [targetFile]: { path: targetFile, sha256: 'ab'.repeat(32), version: '4.9.0' } };
            const shipped = new Set(['deadbeef'.repeat(8)]); // does not match the edit

            const result = resolveFileConflict(srcFile, targetFile, manifest, new Set(), shipped);

            assert.strictEqual(result, 'kept');
            assert.strictEqual(fs.readFileSync(targetFile, 'utf8'), '# Demo v1\n# my local edits\n', 'user edit untouched');
            assert.strictEqual(fs.readFileSync(targetFile + '.new', 'utf8'), '# Demo v3 current\n');
        } finally {
            cleanup(tmpBase);
        }
    });

    // (c) Disk holds an unknown file: no manifest entry, hash not shipped and
    // not in the current payload → kept, shipped copy written as .new.
    test('(c) unknown content at an owned path is kept, .new written', () => {
        const { tmpBase, fakeSrc } = createIsolatedEnv();
        try {
            const srcFile = path.join(fakeSrc, 'skills', 'demo', 'SKILL.md');
            fs.mkdirSync(path.dirname(srcFile), { recursive: true });
            fs.writeFileSync(srcFile, '# Demo v3 current\n');

            const targetFile = path.join(tmpBase, 'home', 'skills', 'demo', 'SKILL.md');
            fs.mkdirSync(path.dirname(targetFile), { recursive: true });
            fs.writeFileSync(targetFile, 'some foreign or pre-manifest content\n');

            const manifest = {};
            const shipped = new Set(['deadbeef'.repeat(8)]);
            const knownSourceHashes = new Set([computeFileHash(srcFile)]); // disk hash is NOT this

            const result = resolveFileConflict(srcFile, targetFile, manifest, knownSourceHashes, shipped);

            assert.strictEqual(result, 'kept');
            assert.strictEqual(fs.readFileSync(targetFile, 'utf8'), 'some foreign or pre-manifest content\n');
            assert.strictEqual(fs.readFileSync(targetFile + '.new', 'utf8'), '# Demo v3 current\n');
        } finally {
            cleanup(tmpBase);
        }
    });

    test('installOpencodeCommands overwrites a hash in the shipped set', () => {
        const { tmpBase, fakeSrc } = createIsolatedEnv();
        try {
            // Route the manifest into the temp home so the real one is untouched.
            const origHome = process.env.HOME, origProfile = process.env.USERPROFILE; // Windows: os.homedir() reads USERPROFILE
            process.env.HOME = process.env.USERPROFILE = path.join(tmpBase, 'home');
            try {
                const srcDir = path.join(fakeSrc, 'opencode', 'command');
                fs.mkdirSync(srcDir, { recursive: true });
                fs.writeFileSync(path.join(srcDir, 'aos.md'), 'current command\n');

                const destDir = path.join(tmpBase, 'home', '.config', 'opencode', 'command');
                fs.mkdirSync(destDir, { recursive: true });
                const dest = path.join(destDir, 'aos.md');
                fs.writeFileSync(dest, 'older release command\n');
                const oldHash = computeFileHash(dest);

                setShippedHashes(new Set([oldHash]));
                try {
                    installOpencodeCommands(srcDir, destDir);
                } finally {
                    setShippedHashes(new Set());
                }

                assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'current command\n');
                assert.strictEqual(fs.readdirSync(destDir).filter((f) => f.endsWith('.new')).length, 0, 'no .new written');
                assert.notStrictEqual(oldHash, computeFileHash(dest));
            } finally {
                process.env.HOME = origHome; if (origProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = origProfile;
            }
        } finally {
            cleanup(tmpBase);
        }
    });

    test('loadShippedHashes survives a missing or broken file (empty set)', () => {
        const { loadShippedHashes } = require('../installer.js');
        // Real repo may or may not have lib/shipped-hashes.json yet; both
        // outcomes must be a Set, never a throw.
        const s = loadShippedHashes();
        assert.ok(s instanceof Set);
    });

    test('manifest round-trips through the temp home only', () => {
        const { tmpBase } = createIsolatedEnv();
        const origHome = process.env.HOME, origProfile = process.env.USERPROFILE; // Windows: os.homedir() reads USERPROFILE
        process.env.HOME = process.env.USERPROFILE = path.join(tmpBase, 'home');
        try {
            const manifestPath = getInstallManifestPath();
            assert.ok(manifestPath.startsWith(tmpBase), 'manifest stays inside the test home');
            saveInstallManifest({ a: 1 }, manifestPath);
            assert.deepStrictEqual(loadInstallManifest(manifestPath), { a: 1 });
        } finally {
            process.env.HOME = origHome; if (origProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = origProfile;
            cleanup(tmpBase);
        }
    });
});
