'use strict';
// Gateway npm install optimization: skip npm install when package.json + lockfile
// haven't changed since the last successful install.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

// Write the npm install cache
function writeCache(dir, packageHash) {
    try {
        fs.mkdirSync(dir, { recursive: true });
        const cache = {
            packageHash,
            savedAt: new Date().toISOString(),
        };
        fs.writeFileSync(path.join(dir, CACHE_FILE), JSON.stringify(cache, null, 2) + '\n');
    } catch {
        // Cache write failure is non-fatal
    }
}

// Check if npm install can be skipped
function canSkipGatewayInstall(dir) {
    const currentHash = computePackageHash(dir);
    if (!currentHash) return { skip: false, reason: 'hash unavailable' };

    const cache = readCache(dir);
    if (!cache) return { skip: false, reason: 'no cache' };

    if (cache.packageHash !== currentHash) return { skip: false, reason: 'packages changed' };

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
