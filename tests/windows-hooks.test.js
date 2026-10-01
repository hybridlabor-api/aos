// Windows-safe hook wiring: agy hands the hook command to `sh -c` / `cmd /c` with
// cwd = the hooks.json folder, and cmd cannot parse the \" Go emits for quotes.
// Runs on every OS (CI job `windows` runs it on windows-latest).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const INSTALLER = path.join(REPO, 'installer.js');
const HOOKS_SRC = path.join(REPO, '.claude', 'hooks');
const WORKFLOWS_SRC = path.join(REPO, '.claude', 'workflows');
const installer = require(INSTALLER);

const mkHome = (name = 'aos-win-') => fs.mkdtempSync(path.join(os.tmpdir(), name));
const copyDir = (src, dest) => {
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dest, f));
};
const runLikeAgy = (command, cwd, home, input = '{}') => {
    const [shell, flag] = process.platform === 'win32' ? ['cmd', '/c'] : ['sh', '-c'];
    return spawnSync(shell, [flag, command], {
        cwd, input, encoding: 'utf8', timeout: 20000,
        env: { ...process.env, HOME: home, USERPROFILE: home, AGENTTRAIL_PORT: '1' },
    });
};
const commandsOf = (file) => [...JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')).hooks).matchAll(/"command":("(?:[^"\\]|\\.)*")/g)].map((m) => JSON.parse(m[1]));
const withHome = (home, fn) => {
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = process.env.USERPROFILE = home;
    try { return fn(); } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
};

function assertWritesRunnableHooks(home) {
    // Child process: installer.js resolves the home directory once at load time.
    execFileSync(process.execPath, ['-e', `require(${JSON.stringify(INSTALLER)}).installGlobalHooks()`], {
        env: { ...process.env, HOME: home, USERPROFILE: home, AGENTTRAIL_PORT: '1' }, stdio: 'pipe',
    });
    const hooksJson = path.join(home, '.gemini', 'config', 'hooks.json');
    assert.ok(fs.existsSync(hooksJson), 'hooks.json must exist (self-check must not have rolled it back)');
    const cmds = commandsOf(hooksJson);
    assert.ok(cmds.length >= 7, `expected the AOS commands, got ${cmds.length}`);
    for (const c of cmds) {
        assert.ok(!c.includes('"'), `no double quote allowed in an agy command: ${c}`);
        const r = runLikeAgy(c, path.dirname(hooksJson), home);
        assert.strictEqual(r.status, 0, `${c} -> exit ${r.status}\n${r.stderr}`);
        assert.ok(!/MODULE_NOT_FOUND|Cannot find module/.test(r.stderr), `${c}\n${r.stderr}`);
    }
}

test('installGlobalHooks writes agy commands that run via the platform shell', () => {
    assertWritesRunnableHooks(mkHome());
});

test('a home directory containing a space (user name with space) still works', () => {
    assertWritesRunnableHooks(path.join(mkHome('aos-win-sp-'), 'Yola Test'));
});

test('installer --dry-run in a temp home and cwd exits 0 and writes nothing', () => {
    const home = mkHome();
    const cwd = mkHome();
    const r = spawnSync(process.execPath, [INSTALLER, '--dry-run', '-y', '--project-harness'], {
        cwd, encoding: 'utf8', timeout: 90000, stdin: 'ignore',
        env: { ...process.env, HOME: home, USERPROFILE: home, CI: '1' },
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.deepStrictEqual(fs.readdirSync(cwd), []);
    assert.deepStrictEqual(fs.readdirSync(home), []);
});

test('self-check failure removes a fresh hooks.json and restores a previous one byte for byte', () => {
    const dir = mkHome();
    const fresh = path.join(dir, 'fresh', 'hooks.json');
    const failing = () => ({ status: 1, stderr: 'boom' });
    installer.mergeAntigravityHooks(fresh, { selfCheck: failing });
    assert.ok(!fs.existsSync(fresh), 'no previous file: the failed one is removed');

    const prev = path.join(dir, 'prev', 'hooks.json');
    fs.mkdirSync(path.dirname(prev), { recursive: true });
    const original = JSON.stringify({ hooks: { Stop: [{ type: 'command', command: './mine.sh' }] } }, null, 4);
    fs.writeFileSync(prev, original);
    installer.mergeAntigravityHooks(prev, { selfCheck: failing });
    assert.strictEqual(fs.readFileSync(prev, 'utf8'), original);
    assert.deepStrictEqual(fs.readdirSync(path.dirname(prev)).filter((f) => f.endsWith('.tmp')), []);
});

test('real self-check rolls back when the scripts are missing, keeps the file when present', () => {
    const home = mkHome();
    const hooksJson = path.join(home, 'config', 'hooks.json');
    withHome(home, () => installer.mergeAntigravityHooks(hooksJson));
    assert.ok(!fs.existsSync(hooksJson), 'MODULE_NOT_FOUND/exit != 0 must trigger the rollback');

    copyDir(HOOKS_SRC, path.join(home, 'config', 'hooks'));
    copyDir(WORKFLOWS_SRC, path.join(home, 'config', 'workflows'));
    withHome(home, () => installer.mergeAntigravityHooks(hooksJson));
    assert.ok(fs.existsSync(hooksJson));
});

test('self-check passes {} through the platform shell, cwd = hooks.json folder; stderr MODULE_NOT_FOUND fails', () => {
    const dir = mkHome();
    const hooksJson = path.join(dir, 'hooks.json');
    const calls = [];
    installer.mergeAntigravityHooks(hooksJson, { selfCheck: (shell, args, opts) => { calls.push({ shell, args, opts }); return { status: 0, stderr: '' }; } });
    assert.ok(calls.length >= 7);
    const [shell, flag] = process.platform === 'win32' ? ['cmd', '/c'] : ['sh', '-c'];
    for (const c of calls) {
        assert.strictEqual(c.shell, shell);
        assert.strictEqual(c.args[0], flag);
        assert.strictEqual(c.opts.input, '{}');
        assert.strictEqual(c.opts.cwd, dir);
        assert.ok(c.opts.timeout > 0 && c.opts.timeout <= 20000);
    }
    const bad = installer.selfCheckAgyHooks(hooksJson, () => ({ status: 0, stderr: 'Error: Cannot find module x' }));
    assert.ok(bad.length > 0 && /module not found/.test(bad[0].reason));
});

test('a self-check timeout on a slow machine is not a failure, a missing module still is', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-selfcheck-timeout-'));
    const hooksJson = path.join(dir, 'hooks.json');
    installer.mergeAntigravityHooks(hooksJson, { selfCheck: () => ({ status: 0, stderr: '' }) });
    assert.ok(fs.existsSync(hooksJson));
    const slow = installer.selfCheckAgyHooks(hooksJson, () => ({ error: { code: 'ETIMEDOUT', message: 'spawnSync sh ETIMEDOUT' }, status: null, stderr: '' }));
    assert.deepStrictEqual(slow, []);
    const missing = installer.selfCheckAgyHooks(hooksJson, () => ({ status: 1, stderr: 'Error: Cannot find module x' }));
    assert.ok(missing.length > 0);
});

const BROKEN = {
    hooks: {
        PreToolUse: [
            { matcher: 'run_command|Bash', hooks: [{ type: 'command', command: 'node \\"C:\\\\Users\\\\Yola\\\\.gemini\\\\config\\\\hooks\\\\go-gate.mjs\\"', timeout: 10 }] },
            { matcher: '*', hooks: [{ type: 'command', command: 'node \\"C:\\\\Users\\\\Yola\\\\.gemini\\\\config\\\\hooks\\\\trail-relay.mjs\\" --agent agy --event PreToolUse', timeout: 2 }] },
        ],
        Stop: [{ type: 'command', command: 'node C:\\Users\\Yola\\.gemini\\config\\hooks\\graph-gate.mjs' }, { type: 'command', command: './mine.sh' }],
    },
};
const isOk = () => ({ status: 0, stderr: '' });

for (const [label, rel, opts] of [
    ['global config', ['.gemini', 'config', 'hooks.json'], {}],
    ['antigravity-cli', ['.gemini', 'antigravity-cli', 'hooks.json'], {}],
    ['project-local', ['.agents', 'hooks.json'], { projectLocal: true }],
]) {
    test(`migrates broken quoted/absolute commands in ${label}, keeps the foreign hook`, () => {
        const p = path.join(mkHome(), ...rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(BROKEN));
        installer.mergeAntigravityHooks(p, { ...opts, selfCheck: isOk });
        const cmds = commandsOf(p);
        assert.ok(cmds.includes('./mine.sh'), 'foreign hook survives');
        assert.ok(cmds.includes('node hooks/go-gate.mjs'));
        assert.ok(cmds.includes('node hooks/trail-relay.mjs --agent agy --event PreToolUse || exit 0'));
        for (const c of cmds) assert.ok(!c.includes('"') && !c.includes('C:'), c);
        assert.strictEqual(cmds.filter((c) => c.includes('graph-gate')).length, 1);
    });
}

test('observability hooks exit 0 on any stdin, gates exit 0 on {}', () => {
    const home = mkHome();
    for (const script of ['trail-relay.mjs', 'memb-inject.mjs', 'trail-autostart.mjs']) {
        for (const input of ['', '{}', 'null', '[]', '42', 'garbage', '{"tool_name":']) {
            const r = runLikeAgy(`node ${path.join(HOOKS_SRC, script).split(path.sep).join('/')}`, REPO, home, input);
            assert.strictEqual(r.status, 0, `${script} <${input}> -> ${r.status}\n${r.stderr}`);
        }
    }
    for (const script of ['go-gate.mjs', 'graph-gate.mjs', 'conventional-commits.mjs', 'env-file-protection.mjs']) {
        const r = runLikeAgy(`node ${path.join(HOOKS_SRC, script).split(path.sep).join('/')}`, REPO, home, '{}');
        assert.strictEqual(r.status, 0, `${script} <{}> -> ${r.status}\n${r.stderr}`);
    }
});

test('Claude project-local settings use ${CLAUDE_PROJECT_DIR} and replace old no-brace entries', () => {
    const p = path.join(mkHome(), '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const mine = { type: 'command', command: 'node /my/own/hook.mjs' };
    fs.writeFileSync(p, JSON.stringify({
        hooks: { PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/go-gate.mjs"' }] },
            { matcher: 'Bash', hooks: [mine] },
        ] },
    }));
    installer.mergeBdbSettingsHooks(p, { projectLocal: true });
    const cmds = Object.values(JSON.parse(fs.readFileSync(p, 'utf8')).hooks).flat().flatMap((e) => e.hooks.map((h) => h.command));
    assert.ok(cmds.includes(mine.command));
    const gateCmds = cmds.filter((c) => c.includes('go-gate.mjs'));
    assert.strictEqual(gateCmds.length, 1);
    assert.ok(gateCmds[0].includes('${CLAUDE_PROJECT_DIR}/.claude/hooks/'), gateCmds[0]);
    assert.ok(!cmds.some((c) => /\$CLAUDE_PROJECT_DIR/.test(c)), 'no no-brace form remains');
    assert.ok(cmds.some((c) => c.includes('memb-inject.mjs') && c.includes('$HOME')), 'machine-global hooks stay $HOME-anchored');
});
