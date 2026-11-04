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
            assert.ok(!fs.existsSync(path.join(args[2], 'skills')), 'plugin carries no skills: ~/.gemini/config/skills is the single source');
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

test('a disabled plugin stays disabled, even when the version differs', () => {
    const home = mk('h4'); const { runner, calls } = fakeRunner(home, { installedVersion: '0.9.0', enabled: false }); const { l, log } = logs();
    const r = agy.run({ srcDir: fakePkg(), home, runner, log });
    assert.strictEqual(r.status, 'disabled');
    assert.deepStrictEqual(calls, ['plugin list']);
    assert.strictEqual(l.length, 1);
    assert.match(l[0], /disabled in agy; leaving it disabled/);
});

test('npx package root: hints point at the GitHub repo, not the cache path', () => {
    const home = mk('h4n'); const { runner } = fakeRunner(home, { missing: true }); const { l, log } = logs();
    const src = path.join(mk('npxroot'), '_npx', 'abc', 'node_modules', 'aos');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'plugin.json'), JSON.stringify({ name: 'bdb-aos', version: '1.0.0' }));
    agy.run({ srcDir: src, home, runner, log });
    assert.match(l[0], /git clone https:\/\/github\.com\/hybridlabor-api\/aos\.git/);
    assert.ok(!l[0].includes('_npx'));
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

test('real package stages commands and agents but no skills', () => {
    const dest = mk('stage');
    agy.stagePlugin(ROOT, dest);
    assert.ok(!fs.existsSync(path.join(dest, 'skills')));
    assert.ok(fs.existsSync(path.join(dest, 'agents')));
});

function oldPluginSkills(home) {
    const sk = path.join(home, '.gemini', 'config', 'plugins', 'bdb-aos', 'skills');
    fs.mkdirSync(path.join(sk, 'alpha'), { recursive: true });
    fs.writeFileSync(path.join(sk, 'alpha', 'SKILL.md'), 'old');
    return sk;
}

test('update moves bundled plugin skills to a backup and keeps user skills in config/skills', () => {
    const home = mk('h-mig');
    const user = path.join(home, '.gemini', 'config', 'skills', 'my-own');
    fs.mkdirSync(user, { recursive: true });
    fs.writeFileSync(path.join(user, 'SKILL.md'), 'mine');
    const { runner } = fakeRunner(home, { installedVersion: '1.0.0' });
    const sk = oldPluginSkills(home);
    const out = logs();
    agy.run({ srcDir: fakePkg('1.0.0'), home, runner, log: out.log });
    assert.ok(!fs.existsSync(sk));
    const bk = fs.readdirSync(path.join(home, '.agents', 'backups')).find((n) => n.startsWith('agy-plugin-skills-'));
    assert.strictEqual(fs.readFileSync(path.join(home, '.agents', 'backups', bk, 'skills', 'alpha', 'SKILL.md'), 'utf8'), 'old');
    assert.strictEqual(fs.readFileSync(path.join(user, 'SKILL.md'), 'utf8'), 'mine');
    assert.ok(out.l.some((m) => /moved the bundled skills/.test(m)));
});

test('check mode leaves bundled plugin skills in place; a symlinked skills dir is never followed', () => {
    const home = mk('h-chk');
    const { runner } = fakeRunner(home, { installedVersion: '1.0.0' });
    const sk = oldPluginSkills(home);
    agy.run({ srcDir: fakePkg('1.0.0'), home, runner, mode: 'check', log: logs().log });
    assert.ok(fs.existsSync(sk));
    const home2 = mk('h-link');
    fakeRunner(home2, { installedVersion: '1.0.0' });
    const real = mk('elsewhere'); fs.writeFileSync(path.join(real, 'keep'), 'x');
    fs.symlinkSync(real, path.join(home2, '.gemini', 'config', 'plugins', 'bdb-aos', 'skills'));
    assert.strictEqual(agy.retirePluginSkills({ home: home2 }).status, 'refused');
    assert.ok(fs.existsSync(path.join(real, 'keep')));
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
    assert.ok(!fs.existsSync(path.join(home, '.gemini', 'config', 'plugins', 'bdb-aos', 'skills')));
    spawnSync('agy', ['plugin', 'disable', 'bdb-aos'], { env });
    assert.match(go().stdout, /enabled bdb-aos/);
    assert.strictEqual(agy.uninstall({ home, runner: (a) => spawnSync('agy', a, { env, encoding: 'utf8' }), log: logs().log }).status, 'uninstalled');
    assert.ok(!fs.existsSync(path.join(home, '.gemini', 'config', 'plugins', 'bdb-aos')));
});
