// The pinned versions have one home (lib/v5/pins.js); a pin older than the installed copy is not an update.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pins = require('../lib/v5/pins.js');
const installer = require('../installer.js');
const pkgGateway = require('../lib/v5/pkg-gateway.js');
const { registry } = require('../lib/v5/packages.js');

test('pins are semver and 1mcp is a scoped name at a version', () => {
    assert.match(pins.DEJA_VERSION, /^\d+\.\d+\.\d+$/);
    assert.match(pins.GATEWAY_1MCP_PIN, /^@1mcp\/agent@\d+\.\d+\.\d+$/);
});

test('installer, packages and the gateway all read the same pins', () => {
    assert.strictEqual(installer.DEJA_VERSION, pins.DEJA_VERSION);
    assert.strictEqual(pkgGateway.PIN, pins.GATEWAY_1MCP_PIN);
    assert.strictEqual(registry.find((p) => p.id === 'deja').pin(), pins.DEJA_VERSION);
});

test('checkModuleUpdate: an older pin than the installed copy is not an update', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-pins-'));
    const fakeBin = path.join(dir, 'bin');
    fs.mkdirSync(fakeBin);
    const npm = path.join(fakeBin, 'npm');
    fs.writeFileSync(npm, '#!/bin/sh\necho 0.21.1\n', { mode: 0o755 });
    const mod = path.join(dir, 'mod');
    fs.mkdirSync(mod);
    const writeLocal = (version) => fs.writeFileSync(path.join(mod, 'package.json'), JSON.stringify({ version }));
    const realPath = process.env.PATH;
    process.env.PATH = fakeBin;
    try {
        writeLocal('0.22.1');
        assert.strictEqual(installer.checkModuleUpdate('@x/mod', mod).updateAvailable, false, 'installed newer than remote');
        writeLocal('0.21.0');
        assert.strictEqual(installer.checkModuleUpdate('@x/mod', mod).updateAvailable, true, 'installed older than remote');
    } finally {
        process.env.PATH = realPath;
    }
});
