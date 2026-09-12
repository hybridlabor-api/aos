const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { mergeBdbSettingsHooks } = require('../installer.js');

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
