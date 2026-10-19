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
const { BLOCK: ROUTING_BLOCK, START: ROUTING_START, END: ROUTING_END } = require('../lib/routing-rules.js');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-inject-'));
test.after(() => fs.rmSync(base, { recursive: true, force: true }));
const tmp = (n) => fs.mkdtempSync(path.join(base, `${n}-`));

const runHook = (hook, home, input) => spawnSync(process.execPath, [hook], { input, env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home }, encoding: 'utf8' });
const bullets = (text) => text.split('\n').filter((l) => l.startsWith('- ')).length;
const stripped = (block, start, end) => block.replace(start, '').replace(end, '').trim();
const expectedRulesText = () => [stripped(BLOCK, START, END), stripped(ROUTING_BLOCK, ROUTING_START, ROUTING_END)].join('\n\n');
const ruleCount = bullets(stripped(BLOCK, START, END));

test('Claude Code / Codex: additionalContext carries the destructive rules from the single source', () => {
    const r = runHook(HOOK, tmp('h'), JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' }));
    assert.strictEqual(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    const text = out.hookSpecificOutput.additionalContext;
    assert.strictEqual(text, expectedRulesText());
    assert.strictEqual(bullets(text), ruleCount);
    assert.ok(text.includes('plan-canvas'), 'routing block must mention plan-canvas');
    assert.ok(text.includes('## Tool routing (automatic)'), 'routing block heading must be present');
});

test('agy gets injectSteps; garbage or empty stdin still injects; never blocks', () => {
    const agy = JSON.parse(runHook(HOOK, tmp('h'), JSON.stringify({ conversationId: 'c1', workspacePaths: ['/x'] })).stdout);
    const text = agy.injectSteps[0].ephemeralMessage;
    assert.strictEqual(bullets(text), ruleCount);
    assert.ok(text.includes('## Tool routing (automatic)'), 'agy routing block heading must be present');
    for (const input of ['', 'not json']) {
        const r = runHook(HOOK, tmp('h'), input);
        assert.strictEqual(r.status, 0);
        assert.strictEqual(bullets(JSON.parse(r.stdout).hookSpecificOutput.additionalContext), ruleCount);
    }
});

test('rules-inject output contains the routing block with plan-canvas and agenttrail triggers', () => {
    const r = runHook(HOOK, tmp('h'), JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'plan' }));
    assert.strictEqual(r.status, 0);
    const text = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    assert.ok(text.includes('<!-- aos:routing:start -->') === false, 'markers should be stripped');
    assert.ok(text.includes('## Tool routing (automatic)'));
    assert.ok(text.includes('plan-canvas'));
    assert.ok(text.includes('agenttrail'));
    assert.ok(text.includes('Never a GO by side channel'));
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
    fs.copyFileSync(path.join(ROOT, 'lib', 'routing-rules.js'), path.join(dir, '.agents', 'lib', 'routing-rules.js'));
    const text = JSON.parse(runHook(path.join(hooks, 'rules-inject.mjs'), dir, '{}').stdout).hookSpecificOutput.additionalContext;
    assert.strictEqual(bullets(text), ruleCount);
    assert.ok(text.includes('## Tool routing (automatic)'), 'installed hook must inject routing block');
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
    assert.ok(fs.existsSync(path.join(home, '.agents', 'lib', 'routing-rules.js')));

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

test('rules-inject: does not inject when AGENTS.md in cwd already holds the block', () => {
    const dir = tmp('proj-agents');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Repo\n\n' + BLOCK);
    const r = runHook(HOOK, tmp('h'), JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'hi', cwd: dir }));
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
});

test('rules-inject: does not inject when CLAUDE.md in cwd already holds the block', () => {
    const dir = tmp('proj-claude');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Repo\n\n' + BLOCK);
    const r = runHook(HOOK, tmp('h'), JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'hi', cwd: dir }));
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
});

test('rules-inject: does not inject when RULES.md in cwd already holds the block (agy)', () => {
    const dir = tmp('proj-rules');
    fs.writeFileSync(path.join(dir, 'RULES.md'), '# Repo\n\n' + BLOCK);
    const r = runHook(HOOK, tmp('h'), JSON.stringify({ conversationId: 'c1', workspacePaths: [dir] }));
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
});

test('rules-inject: does not inject when home AGENTS.md holds the block and cwd is home', () => {
    const home = tmp('home-agents');
    fs.writeFileSync(path.join(home, 'AGENTS.md'), '# Home\n\n' + BLOCK);
    const r = runHook(HOOK, home, JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'hi', cwd: home }));
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
});

test('rules-inject: does not inject when ancestor project root AGENTS.md holds the block', () => {
    const rootDir = tmp('proj-root');
    fs.writeFileSync(path.join(rootDir, 'AGENTS.md'), '# Root\n\n' + BLOCK);
    const subDir = path.join(rootDir, 'src', 'deep');
    fs.mkdirSync(subDir, { recursive: true });
    const r = runHook(HOOK, tmp('h'), JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'hi', cwd: subDir }));
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
});
