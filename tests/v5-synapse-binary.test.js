const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findSynapseBinary, describeMissingSynapseBinary } = require('../installer.js');

const SHIPPED = [
    'synapse-darwin-arm64',
    'synapse-darwin-amd64',
    'synapse-linux-amd64',
    'synapse-linux-arm64',
    'synapse-windows-amd64.exe',
];

function pkgDir(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-synapse-'));
    fs.mkdirSync(path.join(dir, 'bin'));
    for (const f of files) fs.writeFileSync(path.join(dir, 'bin', f), 'x');
    return dir;
}

const CASES = [
    ['darwin', 'arm64', 'synapse-darwin-arm64'],
    ['darwin', 'x64', 'synapse-darwin-amd64'],
    ['linux', 'x64', 'synapse-linux-amd64'],
    ['linux', 'arm64', 'synapse-linux-arm64'],
    ['win32', 'x64', 'synapse-windows-amd64.exe'],
];

for (const [platform, arch, expected] of CASES) {
    test(`findSynapseBinary finds ${expected} for ${platform}/${arch}`, () => {
        const dir = pkgDir(SHIPPED);
        assert.strictEqual(findSynapseBinary(dir, platform, arch), path.join(dir, 'bin', expected));
    });
}

test('findSynapseBinary ignores unrelated files', () => {
    const dir = pkgDir(['README.md', 'synapse-linux-arm64']);
    assert.strictEqual(findSynapseBinary(dir, 'darwin', 'arm64'), null);
});

test('findSynapseBinary returns null when bin/ is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-synapse-'));
    assert.strictEqual(findSynapseBinary(dir, 'linux', 'x64'), null);
});

test('describeMissingSynapseBinary names the platform', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-synapse-'));
    const msg = describeMissingSynapseBinary(dir, 'freebsd', 'x64');
    assert.match(msg, /freebsd\/x64/);
});
