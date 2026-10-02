'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const agy = require('../lib/agy-plugin-install.js');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-agytest-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const mk = (name) => { const d = path.join(tmp, name); fs.mkdirSync(d, { recursive: true }); return d; };

// Minimal package: nested skills, commands, persona.
function fakePkg(version = '1.0.0') {
    const d = mk(`pkg-${Math.random().toString(36).slice(2)}`);
    for (const s of ['basic/alpha', 'beta']) {
        fs.mkdirSync(path.join(d, 'skills', s), { recursive: true });
        fs.writeFileSync(path.join(d, 'skills', s, 'SKILL.md'), '---\nname: x\n---\n');
    }
    fs.mkdirSync(path.join(d, 'commands'));
    fs.writeFileSync(path.join(d, 'commands', 'setup.md'), 'x');
    fs.mkdirSync(path.join(d, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(d, '.claude', 'agents', 'reviewer.md'), 'x');
    fs.writeFileSync(path.join(d, 'plugin.json'), JSON.stringify({ name: 'bdb-aos', version }));
    return d;
}

// Fake agy: records calls, models list/install/enable against a fake HOME.
function fakeRunner(home, { installedVersion = null, enabled = true, missing = false, failOn = null } = {}) {
    const calls = [];
    const pdir = path.join(home, '.gemini', 'config', 'plugins', 'bdb-aos');
    const cfg = path.join(home, '.gemini', 'config', 'config.json');
    if (installedVersion) {
        fs.mkdirSync(pdir, { recursive: true });
        fs.writeFileSync(path.join(pdir, 'plugin.json'), JSON.stringify({ version: installedVersion }));
        fs.writeFileSync(cfg, JSON.stringify({ plugins: { 'bdb-aos': { enabled } } }));
    }
    const runner = (args) => {
        calls.push(args.join(' ').replace(/install \S*aos-agy-\S+/, 'install STAGE'));
        if (missing) return { status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawn agy ENOENT'), { code: 'ENOENT' }) };
        if (failOn === args[1]) return { status: 1, stdout: '', stderr: 'boom', error: null };
        if (args[1] === 'list') return { status: 0, stdout: installedVersion ? JSON.stringify({ imports: [{ name: 'bdb-aos' }] }) : 'No imported plugins.\n', stderr: '' };
        if (args[1] === 'install') {
            const staged = JSON.parse(fs.readFileSync(path.join(args[2], 'plugin.json'), 'utf8'));
            assert.ok(fs.existsSync(path.join(args[2], 'skills', 'alpha', 'SKILL.md')), 'nested skill flattened');
            assert.ok(fs.existsSync(path.join(args[2], 'skills', 'beta', 'SKILL.md')));
            assert.ok(fs.existsSync(path.join(args[2], 'agents', 'reviewer.md')));
            assert.ok(fs.existsSync(path.join(args[2], 'commands', 'setup.md')));
            fs.mkdirSync(pdir, { recursive: true });
            fs.writeFileSync(path.join(pdir, 'plugin.json'), JSON.stringify({ version: staged.version }));
        }
        return { status: 0, stdout: '', stderr: '' };
    };
    return { runner, calls };
}

const logs = () => { const l = []; return { l, log: { step: (m) => l.push(`S ${m}`), warn: (m) => l.push(`W ${m}`) } }; };
const stateOf = (home) => fs.existsSync(agy.stateFile(home));

test('installs when missing, records state, removes its staging dir', () => {
    const home = mk('h1'); const srcDir = fakePkg();
    const { runner, calls } = fakeRunner(home); const { l, log } = logs();
    const r = agy.run({ srcDir, home, runner, log });
    assert.strictEqual(r.status, 'installed');
    assert.deepStrictEqual(calls, ['plugin list', 'plugin install STAGE']);
    assert.ok(stateOf(home));
    assert.strictEqual(l.length, 1);
});

test('updates when the version differs', () => {
    const home = mk('h2'); const { runner, calls } = fakeRunner(home, { installedVersion: '0.9.0' });
    assert.strictEqual(agy.run({ srcDir: fakePkg('1.0.0'), home, runner, log: logs().log }).status, 'updated');
    assert.deepStrictEqual(calls, ['plugin list', 'plugin install STAGE']);
});

test('no-op when current and enabled; no state written', () => {
    const home = mk('h3'); const { runner, calls } = fakeRunner(home, { installedVersion: '1.0.0' });
    assert.strictEqual(agy.run({ srcDir: fakePkg(), home, runner, log: logs().log }).status, 'current');
    assert.deepStrictEqual(calls, ['plugin list']);
    assert.ok(!stateOf(home));
});

test('enables a disabled plugin', () => {
    const home = mk('h4'); const { runner, calls } = fakeRunner(home, { installedVersion: '1.0.0', enabled: false });
    agy.run({ srcDir: fakePkg(), home, runner, log: logs().log });
    assert.deepStrictEqual(calls, ['plugin list', 'plugin enable bdb-aos']);
});

test('agy missing: skipped with the manual commands, no throw', () => {
    const home = mk('h5'); const { runner } = fakeRunner(home, { missing: true }); const { l, log } = logs();
    const r = agy.run({ srcDir: fakePkg(), home, runner, log });
    assert.strictEqual(r.status, 'skipped');
    assert.match(l[0], /agy-plugin-install\.js/);
    assert.match(l[0], /agy plugin enable bdb-aos/);
});

test('failed install: warns with manual commands, no state, never throws', () => {
    const home = mk('h6'); const { runner } = fakeRunner(home, { failOn: 'install' }); const { l, log } = logs();
    const r = agy.run({ srcDir: fakePkg(), home, runner, log });
    assert.strictEqual(r.status, 'failed');
    assert.match(l[0], /^W .*failed.*Run manually/);
    assert.ok(!stateOf(home));
});

test('failed list and a broken package both degrade to a warning', () => {
    const home = mk('h7');
    assert.strictEqual(agy.run({ srcDir: fakePkg(), home, runner: fakeRunner(home, { failOn: 'list' }).runner, log: logs().log }).status, 'failed');
    assert.strictEqual(agy.run({ srcDir: mk('empty'), home, runner: fakeRunner(home).runner, log: logs().log }).status, 'failed');
});

test('mode off does nothing, mode check mutates nothing', () => {
    const home = mk('h8'); const { runner, calls } = fakeRunner(home);
    assert.strictEqual(agy.run({ srcDir: fakePkg(), home, runner, mode: 'off', log: logs().log }).status, 'skipped');
    assert.deepStrictEqual(calls, []);
    const r = agy.run({ srcDir: fakePkg(), home, runner, mode: 'check', log: logs().log });
    assert.strictEqual(r.status, 'would-install');
    assert.deepStrictEqual(calls, ['plugin list']);
    assert.ok(!stateOf(home));
    const d = fakeRunner(mk('h8b'), { installedVersion: '1.0.0', enabled: false });
    agy.run({ srcDir: fakePkg(), home: mk('h8b'), runner: d.runner, mode: 'check', log: logs().log });
    assert.ok(!d.calls.includes('plugin enable bdb-aos'));
});

test('uninstall removes only what was recorded', () => {
    const home = mk('h9'); const { runner, calls } = fakeRunner(home);
    assert.strictEqual(agy.uninstall({ home, runner, log: logs().log }).status, 'none');
    assert.deepStrictEqual(calls, []);
    agy.run({ srcDir: fakePkg(), home, runner, log: logs().log });
    assert.strictEqual(agy.uninstall({ home, runner, dryRun: true, log: logs().log }).status, 'would-uninstall');
    assert.ok(stateOf(home));
    assert.strictEqual(agy.uninstall({ home, runner, log: logs().log }).status, 'uninstalled');
    assert.ok(calls.includes('plugin uninstall bdb-aos'));
    assert.ok(!stateOf(home));
});

test('uninstall failure keeps the record and warns', () => {
    const home = mk('h10'); const { runner } = fakeRunner(home, { failOn: 'uninstall' });
    agy.run({ srcDir: fakePkg(), home, runner, log: logs().log });
    assert.strictEqual(agy.uninstall({ home, runner, log: logs().log }).status, 'failed');
    assert.ok(stateOf(home));
});

test('real package stages all skills flat with unique names', () => {
    const dest = mk('stage');
    const n = agy.stagePlugin(ROOT, dest);
    let total = 0;
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(path.join(d, e.name)); else if (e.name === 'SKILL.md') total++; } };
    walk(path.join(ROOT, 'skills'));
    assert.strictEqual(n, total);
});

test('E2E with the real agy CLI in a sandbox HOME (AOS_E2E_CLI=1)', { skip: process.env.AOS_E2E_CLI !== '1' }, () => {
    const home = mk('e2e');
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    const go = (flag) => spawnSync(process.execPath, [path.join(ROOT, 'lib', 'agy-plugin-install.js'), ...(flag ? [flag] : [])], { env, encoding: 'utf8' });
    assert.match(go('--dry-run').stdout, /would install/);
    assert.ok(!fs.existsSync(path.join(home, '.gemini', 'config', 'plugins', 'bdb-aos')));
    assert.match(go().stdout, /installed bdb-aos/);
    assert.match(go().stdout, /already installed/);
    const list = spawnSync('agy', ['plugin', 'list'], { env, encoding: 'utf8' });
    assert.match(list.stdout, /bdb-aos/);
    const skills = fs.readdirSync(path.join(home, '.gemini', 'config', 'plugins', 'bdb-aos', 'skills'));
    assert.ok(skills.length > 200, `skills: ${skills.length}`);
    spawnSync('agy', ['plugin', 'disable', 'bdb-aos'], { env });
    assert.match(go().stdout, /enabled bdb-aos/);
    assert.strictEqual(agy.uninstall({ home, runner: (a) => spawnSync('agy', a, { env, encoding: 'utf8' }), log: logs().log }).status, 'uninstalled');
    assert.ok(!fs.existsSync(path.join(home, '.gemini', 'config', 'plugins', 'bdb-aos')));
});
