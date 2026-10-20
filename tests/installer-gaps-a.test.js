const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('G1: config/ is shipped in the npm package', () => {
    assert.ok(pkg.files.includes('config/'));
});

test('G2: stored Basic tier survives update', () => {
    const { storedTierOpts } = require('../installer.js');
    assert.deepStrictEqual(storedTierOpts({ manifest: { tier: '2', isUniversal: false } }), { tier: '2', isUniversal: false });
    assert.deepStrictEqual(storedTierOpts({ manifest: null }), { tier: '1', isUniversal: true });
});
