'use strict';
// Skill sync optimization: skip unchanged skill directories by comparing content hashes.
// Each synced skill stores a manifest recording the source content hash; on next sync,
// if the source hash matches the saved manifest, the entire skill directory is skipped.
// Edited-copy detection still works: the manifest also records the target hash, so a
// user-edited copy is detected even when the source hasn't changed.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MANIFEST_FILE = '.aos-skill-manifest.json';

// Compute hash of a directory's content (file names, sizes, mtimes)
function computeDirContentHash(dir) {
    if (!fs.existsSync(dir)) return null;
    const hashes = [];
    const walk = (d) => {
        try {
            const files = fs.readdirSync(d);
            files.sort().forEach((f) => {
                const fp = path.join(d, f);
                try {
                    const stat = fs.lstatSync(fp);
                    if (stat.isSymbolicLink()) {
                        const target = fs.readlinkSync(fp);
                        hashes.push(`link:${f}:${target}`);
                    } else if (stat.isDirectory()) {
                        walk(fp);
                    } else {
                        const h = crypto.createHash('sha256');
                        h.update(fs.readFileSync(fp));
                        hashes.push(`${f}:${h.digest('hex')}`);
                    }
                } catch (e) {
                    // Skip files that can't be read
                }
            });
        } catch (e) {
            return null;
        }
    };
    walk(dir);
    if (hashes.length === 0) return null;
    const h = crypto.createHash('sha256');
    h.update(hashes.join('\n'));
    return h.digest('hex');
}

// Read manifest from target skill directory
function readManifest(targetDir) {
    const manifestPath = path.join(targetDir, MANIFEST_FILE);
    if (!fs.existsSync(manifestPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
        return null;
    }
}

// Write manifest to target skill directory
function writeManifest(targetDir, sourceHash, targetHash) {
    fs.mkdirSync(targetDir, { recursive: true });
    const manifestPath = path.join(targetDir, MANIFEST_FILE);
    const manifest = {
        sourceHash,
        targetHash,
        savedAt: new Date().toISOString(),
    };
    try {
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    } catch {
        // Manifest write failure is non-fatal
    }
}

// Check if skill needs syncing: returns { skip: boolean, reason?: string }
function shouldSkipSkillSync(sourceDir, targetDir) {
    const sourceHash = computeDirContentHash(sourceDir);
    if (!sourceHash) return { skip: false, reason: 'source hash unavailable' };

    const manifest = readManifest(targetDir);
    if (!manifest) return { skip: false, reason: 'no manifest' };

    if (manifest.sourceHash !== sourceHash) return { skip: false, reason: 'source changed' };

    // Source hasn't changed, but check if target was edited
    const targetHash = computeDirContentHash(targetDir);
    if (targetHash && targetHash !== manifest.targetHash) {
        return { skip: false, reason: 'target edited' };
    }

    return { skip: true, reason: 'unchanged' };
}

module.exports = {
    MANIFEST_FILE,
    computeDirContentHash,
    readManifest,
    writeManifest,
    shouldSkipSkillSync,
};
