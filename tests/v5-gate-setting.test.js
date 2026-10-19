// `gate` setting: validation, Settings menu row + apply, hook registration with the gate on and off. Temp HOME.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gate-'));
process.env.HOME = root;
process.env.USERPROFILE = root;
process.env.AOS_TEST_SANDBOX = '1';
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const p = require('../lib/v5/profile');
const menu = require('../lib/v5/menu');
const installer = require('../installer.js');

const GATE_NAMES = ['go-gate.mjs', 'go-token.mjs', 'go-grant.mjs', 'graph-gate.mjs'];
let n = 0;
const mkHome = () => fs.mkdtempSync(path.join(root, `h${n++}-`));
const cmds = (s) => Object.values(s.hooks).flat().flatMap((e) => (e.hooks || []).map((h) => h.command)).join('\n');

test('validation: on/off kept, anything else is a problem and falls back to on', () => {
    assert.strictEqual(p.sanitizeSettings({ gate: 'off' }, null).settings.gate, 'off');
    assert.strictEqual(p.sanitizeSettings({ gate: 'on' }, null).settings.gate, 'on');
    for (const bad of ['maybe', true, null, 1]) {
        const r = p.sanitizeSettings({ gate: bad }, null);
        assert.strictEqual(r.settings.gate, undefined);
        assert.ok(r.problems.some((x) => x.includes('"gate"')));
    }
    assert.strictEqual(p.gateOf({}), 'on');
    assert.strictEqual(p.gateOf({ gate: 'off' }), 'off');
    assert.strictEqual(p.resolve({ profileGiven: false, noHooks: false, without: [] }, { gate: 'off' }).gateOn, false);
    assert.strictEqual(p.resolve({ profileGiven: false, noHooks: false, without: [] }, {}).gateOn, true);
});

test('only the four gate hooks are switchable', () => {
    assert.deepStrictEqual(p.GATE_HOOKS, GATE_NAMES);
    assert.ok(!p.GATE_HOOKS.includes('conventional-commits.mjs') && !p.GATE_HOOKS.includes('env-file-protection.mjs'));
});

function fakeHost(home, extra = {}) {
    const calls = [];
    return {
        calls,
        detectInstallState: () => ({ isInstalled: true, localVersion: '4.0.0', installedModules: [] }),
        resolveTargetPaths: () => ({ targetSkillDir: path.join(home, 'skills'), targetMcpDir: path.join(home, 'mcp') }),
        moduleBasePath: () => path.join(home, '.agents'),
        isNewerVersion: (l, r) => l !== r,
        loadExistingEnv: () => ({}),
        PROVIDER_KEY_ENV_NAMES: {},
        applyInstallOptions: (h) => calls.push(`apply ${p.readSettings(h).gate || 'on'}`),
        activeHarnessKeys: () => new Set(['claudecode']),
        installGlobalHooks: () => calls.push('hooks'),
        ...extra,
    };
}

test('menu: row shows the state, choosing off writes the setting and applies it', async () => {
    const home = mkHome();
    const host = fakeHost(home);
    const out = [];
    let rowLabel; let warning;
    const ui = {
        select: async (msg, options) => {
            if (msg === 'Settings:') { rowLabel = options.find((o) => o.value === 'gate').label; return 'gate'; }
            warning = msg;
            return 'off';
        },
    };
    assert.strictEqual(await menu.settings(host, { home, write: (s) => out.push(s), ui }), 0);
    assert.strictEqual(rowLabel, 'Go-gate (now: on)');
    assert.match(warning, /push, publish, version and recursive rm/);
    assert.strictEqual(p.readSettings(home).gate, 'off');
    assert.deepStrictEqual(host.calls, ['apply off', 'hooks']);

    let label2;
    await menu.settings(host, { home, write: () => {}, ui: { select: async (msg, options) => { label2 = options.find((o) => o.value === 'gate').label; return 'back'; } } });
    assert.strictEqual(label2, 'Go-gate (now: off)');
});

test('menu: unchanged choice writes nothing; host without apply machinery says next update/repair', async () => {
    const home = mkHome();
    const host = fakeHost(home);
    await menu.settings(host, { home, write: () => {}, ui: { select: async (msg) => (msg === 'Settings:' ? 'gate' : 'on') } });
    assert.deepStrictEqual(host.calls, []);
    assert.ok(!fs.existsSync(p.settingsFile(home)) || p.readSettings(home).gate === undefined);

    const bare = fakeHost(home, { installGlobalHooks: undefined });
    const out = [];
    await menu.settings(bare, { home, write: (s) => out.push(s), ui: { select: async (msg) => (msg === 'Settings:' ? 'gate' : 'off') } });
    assert.match(out.join(''), /applied on the next aos update or aos repair/);
    assert.strictEqual(p.readSettings(home).gate, 'off');
});

test('Claude settings.json: gate hooks absent when off, present when on, others stay', () => {
    const home = mkHome();
    const file = path.join(home, 'claude-settings.json');
    p.writeSettings(home, { disabled: [], gate: 'off' });
    installer.applyInstallOptions(home);
    installer.mergeBdbSettingsHooks(file);
    const off = cmds(JSON.parse(fs.readFileSync(file, 'utf8')));
    for (const g of GATE_NAMES) assert.ok(!off.includes(g), `${g} must not be registered`);
    assert.ok(off.includes('conventional-commits.mjs') && off.includes('env-file-protection.mjs'));

    p.writeSettings(home, { disabled: [], gate: 'on' });
    installer.applyInstallOptions(home);
    installer.mergeBdbSettingsHooks(file);
    const on = cmds(JSON.parse(fs.readFileSync(file, 'utf8')));
    for (const g of GATE_NAMES) assert.ok(on.includes(g), `${g} must be registered again`);
});

test('Codex config.toml: go-gate stanza follows the setting', () => {
    const home = mkHome();
    const file = path.join(home, '.codex', 'config.toml');
    p.writeSettings(home, { disabled: [], gate: 'off' });
    installer.applyInstallOptions(home);
    installer.mergeCodexTomlHooks(file);
    assert.ok(!/go-gate\.mjs|graph-gate\.mjs/.test(fs.readFileSync(file, 'utf8')));
    p.writeSettings(home, { disabled: [], gate: 'on' });
    installer.applyInstallOptions(home);
    installer.mergeCodexTomlHooks(file);
    assert.match(fs.readFileSync(file, 'utf8'), /go-gate\.mjs/);
});

test('agy hooks.json: aos-go-gate and aos-graph-gate follow the setting', () => {
    const home = mkHome();
    const file = path.join(home, '.gemini', 'config', 'hooks.json');
    const run = (gate) => {
        p.writeSettings(home, { disabled: [], gate });
        installer.applyInstallOptions(home);
        installer.mergeAntigravityHooks(file, { selfCheck: () => ({ status: 0, stdout: '', stderr: '' }) });
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    };
    const off = run('off');
    assert.ok(!off['aos-go-gate'] && !off['aos-graph-gate']);
    assert.ok(off['aos-conventional-commits'] && off['aos-env-protection']);
    const on = run('on');
    assert.ok(on['aos-go-gate'] && on['aos-graph-gate']);
});
