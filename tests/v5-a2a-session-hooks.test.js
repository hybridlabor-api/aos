// V34: the A2A sidecar starter ships for Codex (SessionStart in config.toml). agy has no session-start
// event (PreToolUse, PostToolUse, PreInvocation, PostInvocation, Stop only), so it gets none.
// Temp HOME only; nothing here spawns a process.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const installer = require('../installer.js');
const uninstallRecords = require('../lib/uninstall-records.js');

const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-v34-'));
const count = (text) => (text.match(/a2a-session\.mjs/g) || []).length;
const FOREIGN = '[[hooks.SessionStart]]\n[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = "node /mine/foreign-start.js"\n';

test('Codex config.toml holds exactly one a2a-session SessionStart entry after two merges', () => {
    const file = path.join(mk(), '.codex', 'config.toml');
    installer.mergeCodexTomlHooks(file);
    const first = fs.readFileSync(file, 'utf8');
    installer.mergeCodexTomlHooks(file);
    const second = fs.readFileSync(file, 'utf8');
    assert.strictEqual(second, first);
    assert.strictEqual(count(second), 1);
    assert.match(second, /\[\[hooks\.SessionStart\.hooks\]\]\ntype = "command"\ncommand = "node \\"[^\n]*a2a-session\.mjs\\" --harness codex"/);
});

test('foreign Codex hooks stay and the AOS entry is replaced, not cloned', () => {
    const file = path.join(mk(), '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, FOREIGN);
    installer.mergeCodexTomlHooks(file);
    installer.mergeCodexTomlHooks(file);
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /foreign-start\.js/);
    assert.strictEqual(count(text), 1);
});

test('agy hooks.json has no a2a-session entry: agy has no session-start event', () => {
    const file = path.join(mk(), 'hooks.json');
    installer.mergeAntigravityHooks(file, { selfCheck: () => ({ status: 0, stderr: '' }) });
    assert.strictEqual(count(fs.readFileSync(file, 'utf8')), 0);
});

test('uninstall removes the AOS Codex entry and keeps the foreign one', () => {
    const home = mk();
    const file = path.join(home, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, FOREIGN);
    installer.mergeCodexTomlHooks(file);
    assert.strictEqual(count(fs.readFileSync(file, 'utf8')), 1);
    uninstallRecords.reverseRegistrations({ home });
    const text = fs.readFileSync(file, 'utf8');
    assert.strictEqual(count(text), 0);
    assert.match(text, /foreign-start\.js/);
});

// agy: the PreInvocation inbox hook (aos-a2a-inbox), same merge, idempotent, foreign names kept.
const agyA2aEntries = (data) => (data['aos-a2a-inbox'] && data['aos-a2a-inbox'].PreInvocation || [])
    .filter((h) => typeof h?.command === 'string' && h.command.includes('a2a-inbox.mjs'));

test('agy hooks.json has exactly one aos-a2a-inbox PreInvocation entry after two merges', () => {
    const file = path.join(mk(), 'hooks.json');
    installer.mergeAntigravityHooks(file, { selfCheck: () => ({ status: 0, stderr: '' }) });
    const first = fs.readFileSync(file, 'utf8');
    installer.mergeAntigravityHooks(file, { selfCheck: () => ({ status: 0, stderr: '' }) });
    assert.strictEqual(fs.readFileSync(file, 'utf8'), first);
    const data = JSON.parse(first);
    assert.strictEqual(agyA2aEntries(data).length, 1);
    assert.match(agyA2aEntries(data)[0].command, /node hooks\/a2a-inbox\.mjs \|\| exit 0/);
    // still no session-start event wired for agy
    assert.strictEqual(count(first), 0);
});

test('uninstall removes the agy inbox entry by name and keeps foreign named hooks', () => {
    const home = mk();
    const file = path.join(home, '.gemini', 'config', 'hooks.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ 'a2a-foreign': { PreInvocation: [{ type: 'command', command: 'node /mine/foreign-inject.js' }] } }));
    installer.mergeAntigravityHooks(file, { selfCheck: () => ({ status: 0, stderr: '' }) });
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(agyA2aEntries(data).length, 1, 'our entry wired');
    assert.ok(data['a2a-foreign'], 'foreign named hook kept');
    uninstallRecords.reverseRegistrations({ home });
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(agyA2aEntries(after).length, 0, 'our inbox entry removed');
    assert.strictEqual(JSON.stringify(after).includes('a2a-inbox.mjs'), false);
    assert.ok(after['a2a-foreign'], 'foreign named hook survives');
});
