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

test('G3: pack agents follow the stored pack selection', () => {
    const { loadPackAgents } = require('../installer.js');
    const dir = path.join(root, '.agents', 'packs');
    const names = (sel) => loadPackAgents(dir, undefined, sel).map(a => a.name.toLowerCase().replace(/_/g, '-'));
    assert.ok(names(null).includes('pcb-design-assistant'));
    assert.deepStrictEqual(names(['hardware']), ['pcb-design-assistant']);
    assert.ok(names(['live-show']).includes('event-manager-assistant'));
    assert.ok(!names(['live-show']).includes('pcb-design-assistant'));
    assert.deepStrictEqual(names([]), []);
});
