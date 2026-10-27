'use strict';
// Tests for gateway npm install optimization: skip when package.json + lockfile unchanged
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const gatewayNpmCache = require('../lib/gateway-npm-cache');

test('gateway npm cache: skip when unchanged', async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-test-'));
    try {
        const dir = path.join(tmpDir, 'gateway');
        fs.mkdirSync(dir, { recursive: true });

        // Create package.json
        const pkg = { name: 'test', version: '1.0.0', dependencies: { foo: '1.0.0' } };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg) + '\n');

        // Create package-lock.json
        const lock = { lockfileVersion: 2, packages: { '': { dependencies: { foo: '1.0.0' } } } };
        fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lock) + '\n');

        // Compute hash and write cache
        const hash = gatewayNpmCache.computePackageHash(dir);
        gatewayNpmCache.writeCache(dir, hash);

        // Create fake node_modules
        fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });

        // Now check: should skip
        const result = gatewayNpmCache.canSkipGatewayInstall(dir);
        assert.strictEqual(result.skip, true, 'unchanged packages should skip install');
    } finally {
        fs.rmSync(tmpDir, { recursive: true });
    }
});

test('gateway npm cache: do not skip when packages changed', async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-test-'));
    try {
        const dir = path.join(tmpDir, 'gateway');
        fs.mkdirSync(dir, { recursive: true });

        // Create initial package.json
        let pkg = { name: 'test', version: '1.0.0', dependencies: { foo: '1.0.0' } };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg) + '\n');

        const lock = { lockfileVersion: 2 };
        fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lock) + '\n');

        // Compute hash and write cache
        const hash = gatewayNpmCache.computePackageHash(dir);
        gatewayNpmCache.writeCache(dir, hash);

        // Create fake node_modules
        fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });

        // Modify package.json
        pkg.dependencies.bar = '2.0.0';
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg) + '\n');

        // Now check: should NOT skip (packages changed)
        const result = gatewayNpmCache.canSkipGatewayInstall(dir);
        assert.strictEqual(result.skip, false, 'changed packages should not skip install');
    } finally {
        fs.rmSync(tmpDir, { recursive: true });
    }
});

test('gateway npm cache: do not skip when node_modules missing', async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-test-'));
    try {
        const dir = path.join(tmpDir, 'gateway');
        fs.mkdirSync(dir, { recursive: true });

        // Create package files
        const pkg = { name: 'test', version: '1.0.0', dependencies: { foo: '1.0.0' } };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg) + '\n');

        const lock = { lockfileVersion: 2 };
        fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lock) + '\n');

        // Compute hash and write cache
        const hash = gatewayNpmCache.computePackageHash(dir);
        gatewayNpmCache.writeCache(dir, hash);

        // Don't create node_modules

        // Now check: should NOT skip (node_modules missing)
        const result = gatewayNpmCache.canSkipGatewayInstall(dir);
        assert.strictEqual(result.skip, false, 'missing node_modules should not skip install');
    } finally {
        fs.rmSync(tmpDir, { recursive: true });
    }
});

test('gateway npm cache: compute hash with only package.json', async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-test-'));
    try {
        const dir = path.join(tmpDir, 'gateway');
        fs.mkdirSync(dir, { recursive: true });

        // Only package.json, no lockfile
        const pkg = { name: 'test', version: '1.0.0' };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg) + '\n');

        const hash = gatewayNpmCache.computePackageHash(dir);
        assert.ok(hash, 'hash should be computed with just package.json');
        assert.strictEqual(typeof hash, 'string', 'hash should be a string');
    } finally {
        fs.rmSync(tmpDir, { recursive: true });
    }
});

test('gateway npm cache: read and write roundtrip', async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-test-'));
    try {
        const dir = path.join(tmpDir, 'gateway');
        fs.mkdirSync(dir, { recursive: true });

        const packageHash = 'abc123def456';
        gatewayNpmCache.writeCache(dir, packageHash);

        const cache = gatewayNpmCache.readCache(dir);
        assert.strictEqual(cache.packageHash, packageHash, 'package hash should be persisted');
        assert.ok(cache.savedAt, 'savedAt timestamp should exist');
    } finally {
        fs.rmSync(tmpDir, { recursive: true });
    }
});
