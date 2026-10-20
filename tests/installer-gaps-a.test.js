const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gaps-a-'));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
test.after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

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

test('G6: update re-syncs shipped MCP entries already in a harness config, leaves user entries', () => {
    const inst = require('../installer.js');
    const shipped = inst.resolveShippedMcpServers();
    const name = Object.keys(shipped)[0];
    assert.ok(name, 'at least one shipped server resolves');
    assert.ok(!JSON.stringify(shipped).includes('__MCPS_DIR__'));
    const file = path.join(tmpHome, '.claude.json');
    const mine = { command: 'my-tool', args: ['--x'] };
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { mine, [name]: { command: 'stale-owner-cmd' } } }));
    inst.refreshHarnessMcpEntries();
    const after = JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers;
    assert.deepStrictEqual(after.mine, mine);
    assert.deepStrictEqual(Object.keys(after).sort(), ['mine', name].sort());
});

test('G7: a registered Plan Canvas unit is rewritten without the opt-in flag', () => {
    const { installPlanCanvasAutostart } = require('../installer.js');
    const home = fs.mkdtempSync(path.join(tmpHome, 'pc-'));
    const base = { homeDir: home, platform: 'darwin', skipLaunchctl: true, nodeBin: '/usr/bin/node', argv: ['node', 'i.js'], dryRun: false };
    assert.equal(installPlanCanvasAutostart(base), false);
    installPlanCanvasAutostart({ ...base, argv: ['node', 'i.js', '--autostart-plan-canvas'] });
    const plist = path.join(home, 'Library', 'LaunchAgents', 'com.bdb.plan-canvas.plist');
    fs.writeFileSync(plist, 'stale');
    assert.equal(installPlanCanvasAutostart(base), true);
    assert.notStrictEqual(fs.readFileSync(plist, 'utf8'), 'stale');
});

test('G15: aos-go-ref is a package bin and an installed launcher', () => {
    const { LAUNCHERS } = require('../lib/uninstall-records.js');
    assert.strictEqual(pkg.bin['aos-go-ref'], 'bin/aos-go-ref.mjs');
    assert.ok(LAUNCHERS.includes('aos-go-ref'));
});

test('G18: Codex wires the conventional-commits and env-file-protection safety hooks', () => {
    const { mergeCodexTomlHooks } = require('../installer.js');
    const { HARNESS_HOOKS } = require('../lib/v5/profile.js');
    const toml = path.join(fs.mkdtempSync(path.join(tmpHome, 'cx-')), 'config.toml');
    mergeCodexTomlHooks(toml);
    const text = fs.readFileSync(toml, 'utf8');
    for (const n of ['conventional-commits.mjs', 'env-file-protection.mjs']) {
        assert.ok(text.includes(n), n);
        assert.ok(HARNESS_HOOKS.codex.includes(n), n);
    }
});

test('G20: context-profile percentage uses the baseline the savings use', () => {
    const src = fs.readFileSync(path.join(root, 'lib', 'v5', 'context-profiles.js'), 'utf8');
    assert.ok(!src.includes('62020'));
    assert.strictEqual((src.match(/68950/g) || []).length, 1);
});
