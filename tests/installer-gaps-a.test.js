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

test('G4: every skill copy destination is also a prune root', () => {
    const inst = require('../installer.js');
    const roots = inst.globalSkillDestRoots();
    for (const { dir } of inst.globalSkillDestinations({ ignorePluginCoverage: true })) assert.ok(roots.includes(dir), dir);
    assert.ok(roots.some((r) => r.endsWith(path.join('opencode', 'skills'))));
});

test('G5: fresh install targets for Roo, Windsurf and Aider are the dirs update refreshes', () => {
    const inst = require('../installer.js');
    const dests = inst.globalSkillDestinations({ ignorePluginCoverage: true }).map((d) => d.dir);
    const roots = inst.globalSkillDestRoots();
    for (const p of ['6', '7', '8']) {
        const dir = inst.resolveTargetPaths(p, null).targetSkillDir;
        assert.ok(roots.includes(dir), `${p}: ${dir} not a prune root`);
    }
    assert.ok(roots.includes(inst.resolveTargetPaths('7', null).targetSkillDir));
    assert.ok(dests.every((d) => roots.includes(d)));
});
