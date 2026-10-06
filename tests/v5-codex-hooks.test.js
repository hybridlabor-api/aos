// V30: Codex hooks live in ~/.codex/config.toml only. AOS entries found in hooks.json are moved out
// (foreign ones stay, the original is kept as a backup), and a second run changes nothing.
// Temp dirs only; the one test that spawns a process runs in a container.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mergeCodexTomlHooks } = require('../installer.js');

const DOCTOR = path.join(__dirname, '..', 'bin', 'aos-doctor.mjs');
const CONTAINER = process.env.AOS_TEST_SANDBOX === 'container';
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-v30-'));
const entry = (command, matcher) => ({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command }] });
const AOS_GATE = 'node "/h/.codex/hooks/go-gate.mjs"';
const FOREIGN = 'node /mine/foreign-hook.js';
const baks = (dir) => fs.readdirSync(dir).filter((n) => n.startsWith('hooks.json.aos-bak-'));

test('install writes the hooks to config.toml and creates no hooks.json', () => {
    const dir = path.join(mk(), '.codex');
    mergeCodexTomlHooks(path.join(dir, 'config.toml'));
    const toml = fs.readFileSync(path.join(dir, 'config.toml'), 'utf8');
    assert.match(toml, /\[features\]\nhooks = true/);
    assert.match(toml, /go-gate\.mjs/);
    assert.strictEqual(fs.existsSync(path.join(dir, 'hooks.json')), false);
});

test('AOS entries in hooks.json are migrated: foreign entries stay, the original is backed up', () => {
    const dir = path.join(mk(), '.codex');
    fs.mkdirSync(dir, { recursive: true });
    const original = JSON.stringify({ hooks: {
        PreToolUse: [entry(AOS_GATE, '^Bash$'), entry(FOREIGN, '*')],
        Stop: [entry('node "/h/.codex/hooks/graph-gate.mjs"')],
    } }, null, 2) + '\n';
    fs.writeFileSync(path.join(dir, 'hooks.json'), original);
    mergeCodexTomlHooks(path.join(dir, 'config.toml'));
    const after = JSON.parse(fs.readFileSync(path.join(dir, 'hooks.json'), 'utf8'));
    assert.deepStrictEqual(after, { hooks: { PreToolUse: [entry(FOREIGN, '*')] } });
    const found = baks(dir);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(fs.readFileSync(path.join(dir, found[0]), 'utf8'), original);
    assert.match(fs.readFileSync(path.join(dir, 'config.toml'), 'utf8'), /go-gate\.mjs/);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'config.toml'), 'utf8'), /foreign-hook/);
});

test('hooks.json with only AOS entries is renamed to a backup, not removed', () => {
    const dir = path.join(mk(), '.codex');
    fs.mkdirSync(dir, { recursive: true });
    const original = JSON.stringify({ hooks: { PreToolUse: [entry(AOS_GATE, '^Bash$')] } });
    fs.writeFileSync(path.join(dir, 'hooks.json'), original);
    mergeCodexTomlHooks(path.join(dir, 'config.toml'));
    assert.strictEqual(fs.existsSync(path.join(dir, 'hooks.json')), false);
    const found = baks(dir);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(fs.readFileSync(path.join(dir, found[0]), 'utf8'), original);
});

test('a second run is byte-identical and makes no new backup', () => {
    const dir = path.join(mk(), '.codex');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.toml'), '[model]\nname = "x"\n\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "node /mine/foreign-hook.js"\n');
    fs.writeFileSync(path.join(dir, 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [entry(AOS_GATE), entry(FOREIGN)] } }));
    mergeCodexTomlHooks(path.join(dir, 'config.toml'));
    const read = () => [fs.readFileSync(path.join(dir, 'config.toml'), 'utf8'), fs.readFileSync(path.join(dir, 'hooks.json'), 'utf8')];
    const first = read();
    const before = baks(dir);
    const mtime = fs.statSync(path.join(dir, 'config.toml')).mtimeMs;
    mergeCodexTomlHooks(path.join(dir, 'config.toml'));
    mergeCodexTomlHooks(path.join(dir, 'config.toml'));
    assert.deepStrictEqual(read(), first);
    assert.deepStrictEqual(baks(dir), before);
    assert.strictEqual(fs.statSync(path.join(dir, 'config.toml')).mtimeMs, mtime);
    assert.match(first[0], /foreign-hook\.js/);
});

test('a block that Codex moved ahead of other tables does not grow on re-runs', () => {
    const dir = path.join(mk(), '.codex');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'config.toml');
    mergeCodexTomlHooks(f);
    const block = fs.readFileSync(f, 'utf8');
    fs.writeFileSync(f, `${block}\n[projects."/x"]\ntrust_level = "trusted"\n`);
    mergeCodexTomlHooks(f);
    const settled = fs.readFileSync(f, 'utf8');
    mergeCodexTomlHooks(f);
    assert.strictEqual(fs.readFileSync(f, 'utf8'), settled);
    assert.match(settled, /trust_level = "trusted"/);
});

test('the doctor source carries the one-time review notice and the both-files report', () => {
    const src = fs.readFileSync(DOCTOR, 'utf8');
    assert.match(src, /run \/hooks/);
    assert.match(src, /hooks in both hooks\.json and config\.toml/);
});

test('doctor warns about the /hooks review and about hooks in both files', { skip: !CONTAINER && 'needs AOS_TEST_SANDBOX=container (spawns the doctor)' }, () => {
    const home = mk();
    const dir = path.join(home, '.codex');
    mergeCodexTomlHooks(path.join(dir, 'config.toml'));
    fs.writeFileSync(path.join(dir, 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [entry(AOS_GATE)] } }));
    const r = spawnSync(process.execPath, [DOCTOR, '--json'], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8', timeout: 120000 });
    const rows = JSON.parse(r.stdout).results;
    const review = rows.find((x) => x.name === 'Codex hook review');
    const both = rows.find((x) => x.name === 'Codex hooks in two files');
    assert.ok(review && review.warningOnly && /\/hooks/.test(review.detail));
    assert.ok(both && both.warningOnly && /hooks in both hooks\.json and config\.toml/.test(both.detail));
});
