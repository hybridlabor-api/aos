// V35a: each harness gets only the hook scripts it wires (plus their same-dir imports).
// Temp dirs only; nothing here spawns a process (the agy self-check is stubbed).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installHarnessHookCopies, mergeBdbSettingsHooks, mergeAntigravityHooks, mergeCodexTomlHooks } = require('../installer.js');
const { HARNESS_HOOKS } = require('../lib/v5/profile.js');

const HOOKS_SRC = path.join(__dirname, '..', '.claude', 'hooks');
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-v35a-'));
const sorted = (xs) => [...xs].sort();
const ls = (dir) => sorted(fs.readdirSync(dir));
// agy writes `node hooks/x.mjs` (relative to hooks.json), Claude and Codex write `<dir>/hooks/x.mjs`.
const wiredIn = (text) => new Set([...text.matchAll(/(?:^|[\s"'\\/])hooks(?:\\\\|[\\/])([\w.-]+\.mjs)/g)].map((m) => m[1]));

function install() {
    const home = mk();
    const gemini = path.join(home, '.gemini');
    fs.mkdirSync(path.join(gemini, 'antigravity-cli'), { recursive: true });
    installHarnessHookCopies({ targetHome: home, targetGemini: gemini });
    return { home, gemini };
}

test('each harness dir holds exactly its list, no more', () => {
    const { home, gemini } = install();
    assert.deepStrictEqual(ls(path.join(home, '.claude', 'hooks')), sorted(HARNESS_HOOKS.claude));
    assert.deepStrictEqual(ls(path.join(gemini, 'config', 'hooks')), sorted(HARNESS_HOOKS.agy));
    assert.deepStrictEqual(ls(path.join(gemini, 'antigravity-cli', 'hooks')), sorted(HARNESS_HOOKS.agy));
    assert.deepStrictEqual(ls(path.join(home, '.codex', 'hooks')), sorted(HARNESS_HOOKS.codex));
});

test('go-token only where it is wired, aos-bus only in the Claude dir (the launcher points there)', () => {
    const { home, gemini } = install();
    for (const dir of [path.join(gemini, 'config', 'hooks'), path.join(gemini, 'antigravity-cli', 'hooks'), path.join(home, '.codex', 'hooks')]) {
        assert.strictEqual(fs.existsSync(path.join(dir, 'go-token.mjs')), false, dir);
        assert.strictEqual(fs.existsSync(path.join(dir, 'go-grant.mjs')), false, dir);
    }
    for (const dir of [path.join(gemini, 'config', 'hooks'), path.join(gemini, 'antigravity-cli', 'hooks'), path.join(home, '.codex', 'hooks')]) {
        assert.strictEqual(fs.existsSync(path.join(dir, 'aos-bus.mjs')), false, dir);
    }
    assert.ok(fs.existsSync(path.join(home, '.claude', 'hooks', 'aos-bus.mjs')));
    assert.ok(fs.existsSync(path.join(home, '.claude', 'hooks', 'go-token.mjs')));
});

// The installer reads agy-hooks/ and mcp_picks.json from the package; a path missing from package.json "files" is not in the tarball.
test('package.json files lists every top-level path the installer reads from the package', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const src = fs.readFileSync(path.join(__dirname, '..', 'installer.js'), 'utf8');
    const read = new Set([...src.matchAll(/path\.join\(srcDir,\s*'([\w.-]+)'/g)].map((m) => m[1]).filter((n) => n !== '..' && n !== '.'));
    for (const top of read) {
        const covered = pkg.files.some((f) => !f.startsWith('!') && (f === top || f.replace(/\/\*?\*?$/, '') === top || f.startsWith(`${top}/`)));
        assert.ok(covered, `${top} is read by the installer but is not in package.json "files"`);
    }
    assert.ok(pkg.files.includes('agy-hooks/'));
});

test('every list is closed under same-dir imports', () => {
    for (const [harness, names] of Object.entries(HARNESS_HOOKS)) {
        for (const name of names) {
            const text = fs.readFileSync(path.join(HOOKS_SRC, name), 'utf8');
            for (const m of text.matchAll(/(?:from|import\()\s*['"]\.\/([\w.-]+\.mjs)['"]/g)) {
                assert.ok(names.includes(m[1]), `${harness}: ${name} imports ${m[1]}`);
            }
        }
    }
});

test('every script a merger wires is in that harness list (no wired-but-not-copied hook)', () => {
    const dir = mk();
    const claude = path.join(dir, 'claude', 'settings.json');
    mergeBdbSettingsHooks(claude);
    const agy = path.join(dir, 'agy', 'hooks.json');
    mergeAntigravityHooks(agy, { selfCheck: () => ({ status: 0, stderr: '' }) });
    const codex = path.join(dir, 'codex', 'config.toml');
    mergeCodexTomlHooks(codex);
    for (const [harness, file] of [['claude', claude], ['agy', agy], ['codex', codex]]) {
        const wired = wiredIn(fs.readFileSync(file, 'utf8'));
        assert.ok(wired.size > 0, `${harness}: nothing wired`);
        for (const name of wired) assert.ok(HARNESS_HOOKS[harness].includes(name), `${harness} wires ${name} but does not copy it`);
    }
});

test('scripts from an older install stay; new copies never delete anything', () => {
    const home = mk();
    const stale = path.join(home, '.codex', 'hooks', 'go-token.mjs');
    fs.mkdirSync(path.dirname(stale), { recursive: true });
    fs.writeFileSync(stale, '// from an older install\n');
    installHarnessHookCopies({ targetHome: home, targetGemini: path.join(home, '.gemini') });
    assert.strictEqual(fs.readFileSync(stale, 'utf8'), '// from an older install\n');
});

test('the installer no longer copies the whole hooks dir anywhere', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'installer.js'), 'utf8');
    const whole = [...src.matchAll(/copyDirRecursiveSync\(\s*hooksSrc\s*,[^)]*\)/g)].map((m) => m[0]);
    // the OpenCode plugin copy (aos-hooks) is owned elsewhere
    assert.deepStrictEqual(whole.filter((c) => !/aos-hooks|opencode/i.test(c)), []);
});

test('agy gets the agy-hooks a2a-inbox variant, not the Claude one (existing Claude dir copy untouched)', () => {
    const { home, gemini } = install();
    const codex = path.join(home, '.codex', 'hooks');
    assert.ok(!fs.existsSync(path.join(codex, 'a2a-inbox.mjs')), 'Codex dir stays without a2a-inbox.mjs');
    const claudeSrc = fs.readFileSync(path.join(HOOKS_SRC, 'a2a-inbox.mjs'), 'utf8');
    const agySrc = fs.readFileSync(path.join(__dirname, '..', 'agy-hooks', 'a2a-inbox.mjs'), 'utf8');
    assert.notStrictEqual(claudeSrc, agySrc);
    for (const dir of [path.join(gemini, 'config', 'hooks'), path.join(gemini, 'antigravity-cli', 'hooks')]) {
        assert.strictEqual(fs.readFileSync(path.join(dir, 'a2a-inbox.mjs'), 'utf8'), agySrc, dir);
    }
});
