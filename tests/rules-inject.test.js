'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, '.claude', 'hooks', 'rules-inject.mjs');
const { BLOCK, START, END, CLAUDE_DENY_RULES } = require('../lib/destructive-rules.js');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-inject-'));
test.after(() => fs.rmSync(base, { recursive: true, force: true }));
const tmp = (n) => fs.mkdtempSync(path.join(base, `${n}-`));

const runHook = (hook, home, input) => spawnSync(process.execPath, [hook], { input, env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home }, encoding: 'utf8' });
const bullets = (text) => text.split('\n').filter((l) => l.startsWith('- ')).length;

test('Claude Code / Codex: additionalContext carries the five rules from the single source', () => {
    const r = runHook(HOOK, tmp('h'), JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' }));
    assert.strictEqual(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    const text = out.hookSpecificOutput.additionalContext;
    assert.strictEqual(text, BLOCK.replace(START, '').replace(END, '').trim());
    assert.strictEqual(bullets(text), 5);
});

test('agy gets injectSteps; garbage or empty stdin still injects; never blocks', () => {
    const agy = JSON.parse(runHook(HOOK, tmp('h'), JSON.stringify({ conversationId: 'c1', workspacePaths: ['/x'] })).stdout);
    assert.strictEqual(bullets(agy.injectSteps[0].ephemeralMessage), 5);
    for (const input of ['', 'not json']) {
        const r = runHook(HOOK, tmp('h'), input);
        assert.strictEqual(r.status, 0);
        assert.strictEqual(bullets(JSON.parse(r.stdout).hookSpecificOutput.additionalContext), 5);
    }
});

test('installed layout: reads ~/.agents/lib, and fails open (no output, exit 0) when the text is missing', () => {
    const dir = tmp('inst');
    const hooks = path.join(dir, 'claude', 'hooks');
    fs.mkdirSync(hooks, { recursive: true });
    fs.copyFileSync(HOOK, path.join(hooks, 'rules-inject.mjs'));
    const missing = runHook(path.join(hooks, 'rules-inject.mjs'), dir, '{}');
    assert.strictEqual(missing.status, 0);
    assert.strictEqual(missing.stdout, '');
    fs.mkdirSync(path.join(dir, '.agents', 'lib'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'lib', 'destructive-rules.js'), path.join(dir, '.agents', 'lib', 'destructive-rules.js'));
    assert.strictEqual(bullets(JSON.parse(runHook(path.join(hooks, 'rules-inject.mjs'), dir, '{}').stdout).hookSpecificOutput.additionalContext), 5);
});

test('deny rules are home-level only, never a broad rm -rf prefix', () => {
    assert.ok(CLAUDE_DENY_RULES.includes('Bash(rm * ~)') && CLAUDE_DENY_RULES.includes('Bash(rm * "$HOME")'));
    for (const r of CLAUDE_DENY_RULES) {
        assert.match(r, /^Bash\(rm \* ("?)(~|\$HOME|\$\{HOME\})\/?\1\/?\)$/, r);
        assert.ok(!r.includes(':*'));
    }
});

// Runs the real installGlobalHooks against a throwaway HOME in a child process.
function install(home, steps = 'i.installGlobalHooks({ targetHome: process.env.HOME, targetGemini: require("path").join(process.env.HOME, ".gemini") });') {
    const code = `const i = require(${JSON.stringify(path.join(ROOT, 'installer.js'))}); ${steps}`;
    const r = spawnSync(process.execPath, ['-e', code], { env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home }, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
}

test('installer wires the hook on every harness, adds deny rules idempotently, records only what it added; uninstall keeps user rules', () => {
    const home = tmp('home');
    const settings = path.join(home, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.writeFileSync(settings, JSON.stringify({ permissions: { deny: ['Bash(curl *)', 'Bash(rm * ~)'], allow: ['Bash(ls *)'] }, theme: 'dark' }));
    install(home);
    install(home);

    const s = JSON.parse(fs.readFileSync(settings, 'utf8'));
    assert.strictEqual(s.theme, 'dark');
    assert.deepStrictEqual(s.permissions.allow, ['Bash(ls *)']);
    assert.deepStrictEqual([...s.permissions.deny].sort(), ['Bash(curl *)', ...CLAUDE_DENY_RULES].sort(), 'no duplicates, user rules kept');
    const cmds = s.hooks.UserPromptSubmit.flatMap((e) => e.hooks.map((h) => h.command));
    assert.strictEqual(cmds.filter((c) => c.includes('rules-inject.mjs')).length, 1);
    assert.ok(fs.existsSync(path.join(home, '.claude', 'hooks', 'rules-inject.mjs')));
    assert.ok(fs.existsSync(path.join(home, '.agents', 'lib', 'destructive-rules.js')));

    assert.match(fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8'), /command = .*rules-inject\.mjs/);
    const agy = JSON.parse(fs.readFileSync(path.join(home, '.gemini', 'config', 'hooks.json'), 'utf8'));
    assert.ok(agy['aos-context'].PreInvocation.some((h) => h.command.includes('rules-inject.mjs')));

    const rec = JSON.parse(fs.readFileSync(path.join(home, '.agents', '.bdb-uninstall-records.json'), 'utf8')).claudeDeny;
    assert.ok(!rec.rules.includes('Bash(rm * ~)'), 'a rule the user already had is not AOS-owned');
    assert.strictEqual(rec.rules.length, CLAUDE_DENY_RULES.length - 1);

    const lines = spawnSync(process.execPath, ['-e', `console.log(JSON.stringify(require(${JSON.stringify(path.join(ROOT, 'lib', 'uninstall-records.js'))}).reverseClaudeDeny({ home: process.env.HOME, dryRun: false })))`],
        { env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf8' });
    assert.strictEqual(lines.status, 0, lines.stderr);
    const after = JSON.parse(fs.readFileSync(settings, 'utf8'));
    assert.deepStrictEqual([...after.permissions.deny].sort(), ['Bash(curl *)', 'Bash(rm * ~)']);
});

test('a settings.json that cannot be parsed or has a non-array deny is left untouched', () => {
    const ur = require('../lib/uninstall-records.js');
    const home = tmp('bad');
    const f = path.join(home, 'settings.json');
    for (const raw of ['{ nope', JSON.stringify({ permissions: { deny: 'x' } }), JSON.stringify({ permissions: 'x' })]) {
        fs.writeFileSync(f, raw);
        assert.deepStrictEqual(ur.addClaudeDeny({ home, settingsPath: f, rules: CLAUDE_DENY_RULES }), []);
        assert.strictEqual(fs.readFileSync(f, 'utf8'), raw);
    }
});
