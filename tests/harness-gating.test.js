// Only harnesses that are really present (or explicitly chosen) receive files. Sandbox HOME and cwd
// are set before installer.js is loaded; PATH holds a stub `claude` and nothing else.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gating-'));
const bin = path.join(tmp, 'bin');
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
process.env.PATH = bin;
delete process.env.CLAUDE_CONFIG_DIR;
process.chdir(tmp);
const inst = require('../installer.js');
const exists = (...p) => fs.existsSync(path.join(tmp, ...p));
const skip = process.platform === 'win32' ? 'POSIX PATH stub' : false;

// Real app bundles under /Applications can make another harness look installed on a dev machine.
const onlyClaude = () => inst.detectPlatforms().every((d) => d.key === 'claudecode');

test('claude only: other harnesses get nothing', { skip }, (t) => {
    if (!onlyClaude()) return t.skip('another harness is installed on this machine');
    assert.deepStrictEqual([...inst.activeHarnessKeys()], ['claudecode']);
    assert.strictEqual(inst.defaultPlatformValue(), '2');
    inst.injectHarnessRules();
    assert.ok(exists('.claude', 'agents'), '~/.claude/agents');
    for (const p of [['.gemini'], ['.codex'], ['.config', 'opencode'], ['.roomodes'], ['.cursor'], ['.roo'], ['.codex-plugin']]) {
        assert.ok(!exists(...p), `${p.join('/')} must not exist`);
    }
    assert.match(inst.harnessSummaryLine(), /^Installed for: Claude Code {2}Skipped \(not found\): .*Codex/);
});

test('plugin steps are no-ops without agy and codex', { skip }, (t) => {
    if (!onlyClaude()) return t.skip('another harness is installed on this machine');
    assert.strictEqual(inst.runAgyPluginStep(), null);
    inst.runCodexPluginStep();
    assert.ok(!exists('.gemini') && !exists('.codex'));
});

test('explicitly chosen codex is honoured although not detected', { skip }, (t) => {
    if (!onlyClaude()) return t.skip('another harness is installed on this machine');
    inst.markPlatformsExplicit(['5']);
    assert.ok(inst.activeHarnessKeys().has('codex'));
    inst.injectHarnessRules();
    assert.ok(exists('.codex', 'agents'), '~/.codex/agents');
    assert.ok(!exists('.gemini') && !exists('.config', 'opencode'));
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
