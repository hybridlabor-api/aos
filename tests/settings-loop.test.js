// Settings stays open after each change; Back or cancel (null) returns. Temp HOME.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-sloop-'));
process.env.HOME = root;
process.env.USERPROFILE = root;
process.env.AOS_TEST_SANDBOX = '1';
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const p = require('../lib/v5/profile');
const menu = require('../lib/v5/menu');

function host(home) {
    return {
        detectInstallState: () => ({ isInstalled: true, localVersion: '4.0.0', installedModules: [] }),
        resolveTargetPaths: () => ({ targetSkillDir: path.join(home, 'skills'), targetMcpDir: path.join(home, 'mcp') }),
        moduleBasePath: () => path.join(home, '.agents'),
        isNewerVersion: (l, r) => l !== r,
        loadExistingEnv: () => ({}),
        PROVIDER_KEY_ENV_NAMES: {},
        applyInstallOptions: () => {},
        activeHarnessKeys: () => new Set(['claudecode']),
        installGlobalHooks: () => {},
    };
}

test('two settings changed in one session, then cancel returns', async () => {
    const home = fs.mkdtempSync(path.join(root, 'h-'));
    const script = [['Settings:', 'gate'], ['Go-gate', 'off'], ['Settings:', 'updates'], ['Updates policy', 'auto'], ['Settings:', null]];
    const labels = [];
    const ui = {
        select: async (msg, options) => {
            const [prefix, answer] = script.shift();
            assert.ok(msg.startsWith(prefix), `expected ${prefix}, got ${msg}`);
            if (msg === 'Settings:') labels.push(options.filter((o) => ['gate', 'updates'].includes(o.value)).map((o) => o.label).join('|'));
            return answer;
        },
    };
    assert.strictEqual(await menu.settingsLoop(host(home), { home, write: () => {}, ui }), 0);
    assert.strictEqual(script.length, 0);
    assert.strictEqual(p.readSettings(home).gate, 'off');
    assert.strictEqual(p.readSettings(home).updates, 'auto');
    assert.match(labels[0], /Go-gate \(now: on\)/);
    assert.match(labels[2], /Go-gate \(now: off\).*Updates \(now: auto\)|Updates \(now: auto\).*Go-gate \(now: off\)/);
});

test('cancel inside a setting returns to Settings, Back returns to the main menu', async () => {
    const home = fs.mkdtempSync(path.join(root, 'h-'));
    const script = [['Settings:', 'updates'], ['Updates policy', null], ['Settings:', 'back']];
    let seen = 0;
    const ui = { select: async () => { seen++; return script.shift()[1]; } };
    await menu.settingsLoop(host(home), { home, write: () => {}, ui });
    assert.strictEqual(seen, 3);
    assert.strictEqual(p.readSettings(home).updates, undefined);
});
