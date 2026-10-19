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

// --- user feedback: an update must never re-enable a gate the user disabled ---

// A Claude settings.json that still wires AOS context/backstop hooks but no gate hook any more.
function wireClaudeWithoutGate(home) {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
        hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'node $HOME/.claude/hooks/conventional-commits.mjs', timeout: 10 }] }] },
    }));
}

test('update keeps gate off: setting off, step does nothing, hooks stay unregistered', async () => {
    const home = mkHome();
    wireClaudeWithoutGate(home);
    p.writeSettings(home, { disabled: [], gate: 'off' });
    installer.applyInstallOptions(home);
    let asked = false;
    await installer.gateReenableStep({ home, ask: async () => { asked = true; return true; }, write: () => {} });
    assert.strictEqual(asked, false, 'a gate off by setting is never asked about');
    assert.strictEqual(p.readSettings(home).gate, 'off');
    installer.mergeBdbSettingsHooks(path.join(home, '.claude', 'settings.json'));
    const cmdsTxt = cmds(JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8')));
    for (const g of GATE_NAMES) assert.ok(!cmdsTxt.includes(g), `${g} must stay unregistered`);
});

test('non-TTY update: gate hooks removed by hand stay absent, setting untouched, one line says so', async () => {
    const home = mkHome();
    wireClaudeWithoutGate(home);
    p.writeSettings(home, { disabled: [], gate: 'on' });
    installer.applyInstallOptions(home);
    const out = [];
    await installer.gateReenableStep({ home, ask: null, write: (s) => out.push(s) });
    assert.match(out.join(''), /not re-registered in Claude Code/);
    assert.match(out.join(''), /gogate|Settings/);
    assert.strictEqual(p.readSettings(home).gate, 'on', 'the setting itself is unchanged');
    assert.ok(installer.gateHoldKeys.has('claudecode'), 'this run holds the gate for claudecode');
    // The merge that the update would run now keeps the gate hooks out of exactly that harness.
    installer.mergeBdbSettingsHooks(path.join(home, '.claude', 'settings.json'));
    const kept = cmds(JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8')));
    for (const g of GATE_NAMES) assert.ok(!kept.includes(g), `${g} must not be re-added`);
    assert.ok(kept.includes('conventional-commits.mjs'));

    // Per-harness: a harness whose config still has the gate keeps it, even while claudecode is held.
    p.writeSettings(home, { disabled: [], gate: 'on' });
    installer.applyInstallOptions(home); // fresh run: clears the hold
    await installer.gateReenableStep({ home, ask: null, write: () => {} });
    const agyFile = path.join(home, '.gemini', 'config', 'hooks.json');
    fs.mkdirSync(path.dirname(agyFile), { recursive: true });
    fs.writeFileSync(agyFile, JSON.stringify({ 'aos-conventional-commits': { PreToolUse: [] }, 'aos-go-gate': { PreToolUse: [] } }));
    installer.mergeAntigravityHooks(agyFile, { selfCheck: () => ({ status: 0, stdout: '', stderr: '' }) });
    const agy = JSON.parse(fs.readFileSync(agyFile, 'utf8'));
    assert.ok(agy['aos-go-gate'], 'Antigravity still registers the gate: the hold is per harness');
});

test('TTY update: asking stores the answer in the gate setting', async () => {
    // No: stored as gate off, hooks stay absent, message says how to turn it back on.
    const home = mkHome();
    wireClaudeWithoutGate(home);
    p.writeSettings(home, { disabled: [], gate: 'on' });
    installer.applyInstallOptions(home);
    const out = [];
    await installer.gateReenableStep({ home, ask: async (m) => { assert.match(m, /^The go-gate is off in Claude Code\. Turn it back on\? \(y\/N\)$/); return false; }, write: (s) => out.push(s) });
    assert.strictEqual(p.readSettings(home).gate, 'off');
    assert.match(out.join(''), /Go-gate stays off in Claude Code/);
    installer.mergeBdbSettingsHooks(path.join(home, '.claude', 'settings.json'));
    const off = cmds(JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8')));
    for (const g of GATE_NAMES) assert.ok(!off.includes(g), `${g} stays absent after the answer no`);

    // Yes: the setting stays on and the merge re-registers the hooks.
    const home2 = mkHome();
    wireClaudeWithoutGate(home2);
    p.writeSettings(home2, { disabled: [], gate: 'on' });
    installer.applyInstallOptions(home2);
    await installer.gateReenableStep({ home: home2, ask: async () => true, write: () => {} });
    assert.ok(!installer.gateHoldKeys.has('claudecode'));
    installer.mergeBdbSettingsHooks(path.join(home2, '.claude', 'settings.json'));
    const on = cmds(JSON.parse(fs.readFileSync(path.join(home2, '.claude', 'settings.json'), 'utf8')));
    for (const g of GATE_NAMES) assert.ok(on.includes(g), `${g} is registered again`);
});

test('help text: 3-5 lines and only gogate modes that exist in the hook code', () => {
    const menu = require('../lib/v5/menu');
    const help = menu.GATE_HELP;
    const lines = help.split('\n').filter((l) => l.trim());
    assert.ok(lines.length >= 3 && lines.length <= 5, `help block is 3-5 lines, got ${lines.length}`);

    // The real command surface, read from the hook code: the subcommand list in go-gate.mjs plus `grant` in go-grant.mjs.
    const gateSrc = fs.readFileSync(path.join(__dirname, '..', '.claude', 'hooks', 'go-gate.mjs'), 'utf8');
    const grantSrc = fs.readFileSync(path.join(__dirname, '..', '.claude', 'hooks', 'go-grant.mjs'), 'utf8');
    const parseList = /\["hard", "soft", "off", "status"\]/.test(gateSrc) ? ['hard', 'soft', 'off', 'status'] : null;
    assert.ok(parseList, 'go-gate.mjs no longer parses [hard, soft, off, status] as gogate subcommands - update this test');
    assert.ok(/gogate grant <scope/.test(grantSrc), 'go-grant.mjs no longer documents `gogate grant <scope...>` - update this test');
    const real = new Set([...parseList, 'grant']);

    const used = [...help.matchAll(/gogate (\w+)/g)].map((m) => m[1]);
    assert.ok(used.length >= 3, 'the help names how to control the gate');
    for (const m of used) assert.ok(real.has(m), `help names "gogate ${m}", which is not a real gogate command`);
    assert.ok(!/\bwork\b/.test(help), '"work" is a gate-profile config value, not a gogate command: never name it here');
});

test('help block: shown under the Settings row question, and after update when the gate is off', async () => {
    const home = mkHome();
    const host = fakeHost(home);
    const out = [];
    await menu.settings(host, { home, write: (s) => out.push(s), ui: { select: async (msg, options) => (msg === 'Settings:' ? 'gate' : (options.some((o) => o.value === 'on') ? 'on' : 'back')) } });
    assert.match(out.join(''), /gogate soft/, 'the Settings gate row prints the mode help under the question');

    // (b) after update: the helper update() calls prints the block only when the setting is off.
    const silent = [];
    p.writeSettings(home, { disabled: [], gate: 'on' });
    menu.printGateHelpIfOff(home, (s) => silent.push(s));
    assert.strictEqual(silent.join(''), '');
    p.writeSettings(home, { disabled: [], gate: 'off' });
    menu.printGateHelpIfOff(home, (s) => silent.push(s));
    assert.match(silent.join(''), /gogate hard/);
});
