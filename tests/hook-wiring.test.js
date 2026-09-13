const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { execFileSync } = require('child_process');

const { mergeBdbSettingsHooks } = require('../installer.js');

const REPO = path.resolve(__dirname, '..');

const commandsFor = (settings, event) =>
    (settings.hooks[event] || []).flatMap((entry) => entry.hooks.map((h) => h.command));

const readSettings = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

describe('mergeBdbSettingsHooks', () => {
    let tmp;
    const settingsPath = (name) => path.join(tmp, name);

    test.beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bdb-hook-wiring-')); });
    test.afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

    test('wires all three BDB hooks into a fresh settings.json', () => {
        const p = settingsPath('fresh.json');
        mergeBdbSettingsHooks(p);
        const s = readSettings(p);

        assert.ok(commandsFor(s, 'PreToolUse').some((c) => c.includes('go-gate.mjs')));
        assert.ok(commandsFor(s, 'Stop').some((c) => c.includes('graph-gate.mjs')));
        assert.ok(commandsFor(s, 'UserPromptSubmit').some((c) => c.includes('memb-inject.mjs')));
    });

    test('preserves user-owned keys and foreign hook entries', () => {
        const p = settingsPath('populated.json');
        fs.writeFileSync(p, JSON.stringify({
            theme: 'dark',
            enabledPlugins: ['something'],
            hooks: {
                UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node /my/own/hook.mjs' }] }],
            },
        }));

        mergeBdbSettingsHooks(p);
        const s = readSettings(p);

        assert.equal(s.theme, 'dark');
        assert.deepEqual(s.enabledPlugins, ['something']);
        assert.ok(commandsFor(s, 'UserPromptSubmit').includes('node /my/own/hook.mjs'));
        assert.ok(commandsFor(s, 'UserPromptSubmit').some((c) => c.includes('memb-inject.mjs')));
    });

    test('is idempotent — a re-run replaces rather than duplicates', () => {
        const p = settingsPath('rerun.json');
        fs.writeFileSync(p, JSON.stringify({
            hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node /my/own/hook.mjs' }] }] },
        }));

        mergeBdbSettingsHooks(p);
        mergeBdbSettingsHooks(p);
        const cmds = commandsFor(readSettings(p), 'UserPromptSubmit');

        assert.equal(cmds.filter((c) => c.includes('memb-inject.mjs')).length, 1);
        assert.equal(cmds.filter((c) => c === 'node /my/own/hook.mjs').length, 1);
    });

    // The memB store is machine-global. Rewriting this one hook to
    // $CLAUDE_PROJECT_DIR the way the gates are rewritten would point it at a
    // file that does not exist in any project the harness was never installed
    // into, and it would then fail on every single prompt there.
    test('keeps memb-inject $HOME-anchored in a project harness', () => {
        const p = settingsPath('project.json');
        mergeBdbSettingsHooks(p, { projectLocal: true });
        const s = readSettings(p);

        const memb = commandsFor(s, 'UserPromptSubmit').find((c) => c.includes('memb-inject.mjs'));
        assert.ok(memb.includes('$HOME'), `expected $HOME-anchored path, got: ${memb}`);
        assert.ok(!memb.includes('$CLAUDE_PROJECT_DIR'));

        const gate = commandsFor(s, 'PreToolUse').find((c) => c.includes('go-gate.mjs'));
        assert.ok(gate.includes('$CLAUDE_PROJECT_DIR'), 'gates stay project-local');
    });

    test('never overwrites a settings.json that is not valid JSON', () => {
        const p = settingsPath('corrupt.json');
        fs.writeFileSync(p, '{ this is not json');

        mergeBdbSettingsHooks(p);

        assert.equal(fs.readFileSync(p, 'utf8'), '{ this is not json');
        assert.ok(fs.existsSync(`${p}.bdb-new.json`), 'merged result goes to a sidecar');
    });
});

// installGlobalHooks() writes to $HOME, which installer.js resolves once at
// module load — so this runs in a child process with HOME pointed at a temp
// dir. That also exercises the real delivery path end to end rather than just
// the settings merge.
describe('installGlobalHooks (Quick Update delivery path)', () => {
    let home;

    test.beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'bdb-hook-home-')); });
    test.afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

    const run = () => execFileSync(
        process.execPath,
        ['-e', `require(${JSON.stringify(path.join(REPO, 'installer.js'))}).installGlobalHooks()`],
        { env: { ...process.env, HOME: home }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );

    test('delivers every hook script into a fresh $HOME and wires them', () => {
        run();

        for (const f of ['go-gate.mjs', 'graph-gate.mjs', 'memb-inject.mjs']) {
            assert.ok(fs.existsSync(path.join(home, '.claude', 'hooks', f)), `${f} not delivered`);
        }
        const s = readSettings(path.join(home, '.claude', 'settings.json'));
        assert.ok(commandsFor(s, 'UserPromptSubmit').some((c) => c.includes('memb-inject.mjs')));
        assert.ok(commandsFor(s, 'PreToolUse').some((c) => c.includes('go-gate.mjs')));
    });

    // The regression this whole change exists for: Quick Update refreshed
    // skills but never hooks, so a machine that already had AOS kept running
    // an old hook after updating.
    test('replaces a stale hook left by an earlier install', () => {
        const dst = path.join(home, '.claude', 'hooks');
        fs.mkdirSync(dst, { recursive: true });
        fs.writeFileSync(path.join(dst, 'memb-inject.mjs'), '// aos-hook-version: 1\nprocess.exit(0);\n');

        run();

        const shipped = fs.readFileSync(path.join(REPO, '.claude', 'hooks', 'memb-inject.mjs'), 'utf8');
        const landed = fs.readFileSync(path.join(dst, 'memb-inject.mjs'), 'utf8');
        assert.equal(landed, shipped, 'stale hook was not replaced');
    });

    // aos-doctor.mjs reads this line to spot a stale hook; if the stamp ever
    // goes missing the doctor silently degrades to an existence check.
    test('the shipped hook carries a version stamp the doctor can read', () => {
        const shipped = fs.readFileSync(path.join(REPO, '.claude', 'hooks', 'memb-inject.mjs'), 'utf8');
        const m = /^\/\/\s*aos-hook-version:\s*(\d+)/m.exec(shipped);
        assert.ok(m, 'no aos-hook-version line in the shipped hook');

        const doctor = fs.readFileSync(
            path.join(REPO, 'skills/global_config/aos-setup/scripts/aos-doctor.mjs'), 'utf8');
        assert.ok(
            new RegExp(`'memb-inject\\.mjs':\\s*${m[1]}\\b`).test(doctor),
            `doctor expects a different version than the hook's v${m[1]}`,
        );
    });
});

// A module update used to unpack straight over the installed tree, so a file
// the new version had dropped stayed on disk while package.json claimed the
// module was current. Needs the network (npm pack), so it is skipped offline.
describe('downloadOrUpdateModule (module replacement)', () => {
    let dir;

    test.beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdb-module-')); });
    test.afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    const online = () => {
        try { execFileSync('npm', ['view', '@hybridlabor-api/bdb-synapse', 'version'], { timeout: 8000, stdio: 'ignore' }); return true; }
        catch { return false; }
    };

    test('replaces the tree instead of merging into it, and keeps local state', { skip: !online() && 'npm registry unreachable' }, () => {
        const mod = path.join(dir, 'mod');
        fs.mkdirSync(path.join(mod, '.venv'), { recursive: true });
        fs.writeFileSync(path.join(mod, 'package.json'), '{"name":"x","version":"0.0.1"}');
        fs.writeFileSync(path.join(mod, 'DROPPED-BY-NEW-VERSION.md'), 'stale');
        fs.writeFileSync(path.join(mod, '.venv', 'marker'), 'local state');

        const { downloadOrUpdateModule } = require('../installer.js');
        assert.equal(downloadOrUpdateModule('@hybridlabor-api/bdb-synapse', mod, 'test module'), true);

        assert.ok(!fs.existsSync(path.join(mod, 'DROPPED-BY-NEW-VERSION.md')), 'a file absent from the new version must be gone');
        assert.ok(fs.existsSync(path.join(mod, '.venv', 'marker')), 'local state outside the tarball must survive');
        assert.notEqual(JSON.parse(fs.readFileSync(path.join(mod, 'package.json'), 'utf8')).version, '0.0.1');
        assert.equal(fs.readdirSync(dir).filter((f) => /\.(incoming|previous)-/.test(f)).length, 0, 'no staging leftovers');
    });
});
