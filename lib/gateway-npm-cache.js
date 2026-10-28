'use strict';
// Gateway npm install optimization: skip npm install when package.json + lockfile
// haven't changed since the last successful install.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FAILED_RETRY_MS = 24 * 3600 * 1000;
const CACHE_FILE = '.aos-gateway-npm-cache.json';

// Compute combined hash of package.json and package-lock.json
function computePackageHash(dir) {
    const h = crypto.createHash('sha256');
    const packageJson = path.join(dir, 'package.json');
    const lockfile = path.join(dir, 'package-lock.json');

    try {
        if (fs.existsSync(packageJson)) {
            h.update(fs.readFileSync(packageJson));
        }
        if (fs.existsSync(lockfile)) {
            h.update(fs.readFileSync(lockfile));
        }
    } catch {
        return null;
    }

    return h.digest('hex');
}

// Read the cached npm install hash
function readCache(dir) {
    const cachePath = path.join(dir, CACHE_FILE);
    if (!fs.existsSync(cachePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    } catch {
        return null;
    }
}

// Write the npm install cache. `unresolved`: the specs that were still not runnable after this install.
function writeCache(dir, packageHash, unresolved = [], extra = {}) {
    try {
        fs.mkdirSync(dir, { recursive: true });
        const cache = {
            packageHash,
            unresolved,
            ...extra,
            savedAt: new Date().toISOString(),
        };
        fs.writeFileSync(path.join(dir, CACHE_FILE), JSON.stringify(cache, null, 2) + '\n');
    } catch {
        // Cache write failure is non-fatal
    }
}

// Check if npm install can be skipped. `missing`: the specs that are not runnable now. A repeat install helps only
// for a spec that went missing since the last one (deleted, corrupted); one npm already left unresolved stays so.
function canSkipGatewayInstall(dir, missing = null) {
    const currentHash = computePackageHash(dir);
    if (!currentHash) return { skip: false, reason: 'hash unavailable' };

    const cache = readCache(dir);
    if (!cache) return { skip: false, reason: 'no cache' };

    if (cache.packageHash !== currentHash) return { skip: false, reason: 'packages changed' };

    // A failed install for these exact packages is not repeated on every update (it cost minutes each time); retry after a day.
    if (cache.failed && Date.now() - Date.parse(cache.savedAt) < FAILED_RETRY_MS) return { skip: true, reason: 'recent failure' };

    if (missing) {
        const known = new Set(Array.isArray(cache.unresolved) ? cache.unresolved : []);
        if (!missing.every((spec) => known.has(spec))) return { skip: false, reason: 'package no longer runnable' };
    }

    // Check if node_modules exists
    const nodeModules = path.join(dir, 'node_modules');
    if (!fs.existsSync(nodeModules)) return { skip: false, reason: 'node_modules missing' };

    return { skip: true, reason: 'unchanged' };
}

module.exports = {
    CACHE_FILE,
    computePackageHash,
    readCache,
    writeCache,
    canSkipGatewayInstall,
};
