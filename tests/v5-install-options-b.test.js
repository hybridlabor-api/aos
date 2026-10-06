// Install options, installer runs (S4, S5, R2, T1, T3). Every test runs the real installer.js, so all of them are
// container only (AOS_TEST_SANDBOX=container) and use an inline temp HOME. The full installs also need AOS_TEST_FULL_INSTALL=1.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const p = require('../lib/v5/profile');

const skip = process.env.AOS_TEST_SANDBOX !== 'container';
const skipFull = skip || process.env.AOS_TEST_FULL_INSTALL !== '1';
const INSTALLER = path.join(__dirname, '..', 'installer.js');

function run(args, { env = {}, timeout = 180000, home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-opt-run-')) } = {}) {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-opt-npm-'));
    const { CLAUDE_CONFIG_DIR, CODEX_HOME, AOS_PROFILE, AOS_DISABLED_MCPS, ...clean } = process.env;
    const r = spawnSync(process.execPath, [INSTALLER, ...args], {
        env: { ...clean, HOME: home, USERPROFILE: home, AOS_PLUGIN_CLI: 'off', npm_config_cache: cache, ...env },
        encoding: 'utf8', timeout,
    });
    return { home, r };
}

const commandsOf = (value) => {
    const out = [];
    const walk = (v) => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') {
            if (typeof v.command === 'string') out[out.length] = v.command;
            Object.values(v).forEach(walk);
        }
    };
    walk(value);
    return out.join('\n');
};

// What each harness wires: Claude all six gate hooks, Antigravity four, Codex two (lib/v5/profile.js lists the names).
const WIRED = {
    claude: p.ALWAYS_HOOKS,
    agy: ['go-gate.mjs', 'graph-gate.mjs', 'conventional-commits.mjs', 'env-file-protection.mjs'],
    codex: ['go-gate.mjs', 'graph-gate.mjs'],
};

function readWired(home) {
    const claude = commandsOf(JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8')));
    const agy = commandsOf(JSON.parse(fs.readFileSync(path.join(home, '.gemini', 'config', 'hooks.json'), 'utf8')));
    const codex = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
    return { claude, agy, codex };
}

function assertGatesOnly(home) {
    const wired = readWired(home);
    for (const [harness, names] of Object.entries(WIRED)) {
        for (const n of names) assert.ok(wired[harness].includes(n), `${harness} keeps ${n}`);
        for (const n of p.CONTEXT_HOOKS) assert.ok(!wired[harness].includes(n), `${harness} has no ${n}`);
    }
}

function assertContextToo(home) {
    const wired = readWired(home);
    for (const n of ['memb-inject.mjs', 'trail-relay.mjs']) assert.ok(wired.claude.includes(n), `claude wires ${n}`);
}

test('T1: --hooks-only --no-hooks wires the gates and no context hook (container only)', { skip }, () => {
    const { home, r } = run(['--hooks-only', '--no-hooks', '-y', '--no-intro']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('Hooks refreshed'));
    assert.ok(!r.stdout.includes('N O D E F O R G E'), 'no banner: it runs before the intro');
    assertGatesOnly(home);
    assert.strictEqual(p.readSettings(home).noHooks, true);
    assert.strictEqual(p.readSettings(home).profile, undefined);
});

test('T1: AOS_PROFILE=minimal with --hooks-only wires the gates only and is not saved (container only)', { skip }, () => {
    const { home, r } = run(['--hooks-only', '-y', '--no-intro'], { env: { AOS_PROFILE: 'minimal' } });
    assert.strictEqual(r.status, 0, r.stderr);
    assertGatesOnly(home);
    assert.ok(!fs.existsSync(p.settingsFile(home)), 'an env profile is never saved');
});

test('T1: plain --hooks-only wires the context hooks as well (container only)', { skip }, () => {
    const { home, r } = run(['--hooks-only', '-y', '--no-intro']);
    assert.strictEqual(r.status, 0, r.stderr);
    for (const n of p.ALWAYS_HOOKS) assert.ok(readWired(home).claude.includes(n), n);
    assertContextToo(home);
});

test('T1: a later --no-hooks run removes the context entries again (container only)', { skip }, () => {
    const first = run(['--hooks-only', '-y', '--no-intro']);
    assert.strictEqual(first.r.status, 0, first.r.stderr);
    assertContextToo(first.home);
    const second = run(['--hooks-only', '--no-hooks', '-y', '--no-intro'], { home: first.home });
    assert.strictEqual(second.r.status, 0, second.r.stderr);
    assertGatesOnly(first.home);
});

test('S4: --help, --version and status save nothing, even with options given (container only)', { skip }, () => {
    for (const args of [['--help', '--profile=minimal', '--without=memb', '--no-hooks'], ['-V', '--profile=minimal'], ['--version', '--no-hooks'], ['status', '--profile=minimal', '--no-hooks']]) {
        const { home, r } = run(args);
        assert.ok(r.status === 0 || args[0] === 'status', `${args[0]}: ${r.stderr}`);
        assert.ok(!fs.existsSync(p.settingsFile(home)), `${args[0]} wrote the settings file`);
    }
});

test('S4: --dry-run saves nothing (container only)', { skip }, () => {
    const { home, r } = run(['--hooks-only', '--no-hooks', '--dry-run', '-y', '--no-intro']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(fs.readdirSync(home), []);
});

test('S5: --hooks-only with update, or with --profile, fails at once with a clear message (container only)', { skip }, () => {
    const a = run(['update', '--hooks-only']);
    assert.notStrictEqual(a.r.status, 0);
    assert.match(a.r.stderr, /--hooks-only belongs to the install/);
    const b = run(['--hooks-only', '--profile=minimal']);
    assert.notStrictEqual(b.r.status, 0);
    assert.match(b.r.stderr, /cannot be combined/);
    assert.deepStrictEqual(fs.readdirSync(b.home), []);
    const c = run(['--no-hooks=false']);
    assert.notStrictEqual(c.r.status, 0);
    assert.match(c.r.stderr, /takes no value/);
});

test('R2: a full dry run (not hooks-only) writes nothing under HOME (container only)', { skip }, () => {
    const { home, r } = run(['--dry-run', '--profile=minimal', '-y', '--no-intro', '--platforms=2', '--plugin-migration=check'], { timeout: 300000 });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(fs.readdirSync(home), []);
});

for (const [name, args, env] of [
    ['--no-hooks', ['--no-hooks'], {}],
    ['--profile=minimal', ['--profile=minimal'], {}],
]) {
    test(`R2/T3: a full install with ${name} keeps the gate hooks in Claude, agy and Codex (container only, AOS_TEST_FULL_INSTALL=1)`, { skip: skipFull }, () => {
        const { home, r } = run([...args, '-y', '--no-intro', '--platforms=2', '--mcps=none'], { env, timeout: 590000 });
        assert.strictEqual(r.status, 0, r.stderr);
        assertGatesOnly(home);
    });
}
