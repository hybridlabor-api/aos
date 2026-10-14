const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cliSpawn = require('../lib/cli-spawn');
const pk = require('../lib/v5/packages');
const { failedEngines, optionalOnlyWarning } = require('../lib/v5/creator-failures');

const withPlatform = (p, fn) => {
    const d = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: p });
    try { return fn(); } finally { Object.defineProperty(process, 'platform', d); }
};

const OUT = (names) => `\u001b[31m\u001b[1m❌ Setup finished with ${names.length} failure(s):\u001b[0m\n${names.map((n) => `  - ${n}: boom\n    Fix: install uv\n`).join('')}`;

test('creator: only optional engines failing gives a warning', () => {
    assert.deepStrictEqual(failedEngines(OUT(['TripoSR venv', 'Palmier Pro clone'])), ['TripoSR venv', 'Palmier Pro clone']);
    assert.match(optionalOnlyWarning(OUT(['TripoSR venv', 'OpenMontage venv'])), /TripoSR venv, OpenMontage venv/);
});

test('creator: a non-optional failure or unparsable output stays a failure', () => {
    assert.strictEqual(optionalOnlyWarning(OUT(['TripoSR venv', 'Text-to-CAD venv'])), null);
    assert.strictEqual(optionalOnlyWarning('crashed with no summary'), null);
    assert.strictEqual(optionalOnlyWarning(''), null);
});

test('codenotch: win32 reads the registry through the injected runner', () => {
    const key = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Codenotch';
    const reg = (args) => {
        if (args[1].endsWith('\\Codenotch')) return `\r\n${key}\r\n    DisplayVersion    REG_SZ    1.2.0\r\n`;
        throw new Error('not found');
    };
    withPlatform('win32', () => assert.strictEqual(pk.codenotchVersion(reg), '1.2.0'));
    withPlatform('win32', () => assert.strictEqual(pk.codenotchVersion(() => { throw new Error('nope'); }), null));
    withPlatform('linux', () => assert.strictEqual(pk.codenotchVersion(reg), null));
});

test('token saver verify: message names the real CLI path; python fallback is ok', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-verify-'));
    const cli = path.join(home, '.token-saver', 'src', 'cli.py');
    const orig = cliSpawn.run;
    try {
        cliSpawn.run = () => ({ error: Object.assign(new Error('x'), { code: 'ENOENT' }) });
        const miss = pk.tokenSaverVerify({ home, env: { ...process.env, CLAUDE_CONFIG_DIR: home } });
        assert.strictEqual(miss.ok, false);
        assert.ok(miss.detail.includes(cli), miss.detail);

        fs.mkdirSync(path.dirname(cli), { recursive: true });
        fs.writeFileSync(cli, '');
        fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ enabledPlugins: { 'token-saver@token-saver-marketplace': true } }));
        const calls = [];
        cliSpawn.run = (cmd, args) => { calls.push(cmd); return cmd === 'token-saver' ? { error: Object.assign(new Error('x'), { code: 'ENOENT' }) } : { status: 0 }; };
        const ok = pk.tokenSaverVerify({ home, env: { ...process.env, CLAUDE_CONFIG_DIR: home } });
        assert.strictEqual(ok.ok, true, ok.detail);
        assert.match(ok.detail, /not on PATH/);
    } finally { cliSpawn.run = orig; }
});

test('token saver: Store Python virtualized cli.py is found', () => {
    const want = path.join('L', 'Packages', 'PythonSoftwareFoundation.Python.3.11_x', 'LocalCache', 'Roaming', 'token-saver', 'src', 'cli.py');
    const fsx = { readdirSync: () => ['Other', 'PythonSoftwareFoundation.Python.3.11_x'], existsSync: (f) => f === want };
    assert.strictEqual(pk.storePythonCli({ LOCALAPPDATA: 'L' }, fsx), want);
    assert.strictEqual(pk.storePythonCli({ LOCALAPPDATA: 'L' }, { readdirSync: () => { throw new Error('x'); } }), null);
});

test('token saver: Store Python enumerates packages newest first', () => {
    const p10 = path.join('L', 'Packages', 'PythonSoftwareFoundation.Python.3.10_x', 'LocalCache', 'Roaming', 'token-saver', 'src', 'cli.py');
    const p12 = path.join('L', 'Packages', 'PythonSoftwareFoundation.Python.3.12_y', 'LocalCache', 'Roaming', 'token-saver', 'src', 'cli.py');

    // Newer mtime on 3.12: picks 3.12
    const fsxMtime = {
        readdirSync: () => ['PythonSoftwareFoundation.Python.3.10_x', 'PythonSoftwareFoundation.Python.3.12_y'],
        statSync: (p) => ({ mtimeMs: p.includes('3.12') ? 2000 : 1000 }),
        existsSync: (f) => f === p10 || f === p12,
    };
    assert.strictEqual(pk.storePythonCli({ LOCALAPPDATA: 'L' }, fsxMtime), p12);

    // Newer mtime on 3.10: picks 3.10
    const fsxMtimeRev = {
        readdirSync: () => ['PythonSoftwareFoundation.Python.3.10_x', 'PythonSoftwareFoundation.Python.3.12_y'],
        statSync: (p) => ({ mtimeMs: p.includes('3.10') ? 3000 : 1000 }),
        existsSync: (f) => f === p10 || f === p12,
    };
    assert.strictEqual(pk.storePythonCli({ LOCALAPPDATA: 'L' }, fsxMtimeRev), p10);

    // No statSync: numeric sort puts 3.12 before 3.10
    const fsxNoStat = {
        readdirSync: () => ['PythonSoftwareFoundation.Python.3.10_x', 'PythonSoftwareFoundation.Python.3.12_y'],
        existsSync: (f) => f === p10 || f === p12,
    };
    assert.strictEqual(pk.storePythonCli({ LOCALAPPDATA: 'L' }, fsxNoStat), p12);

    // Newest package lacks cli.py: falls back to older package that has it
    const fsxFallback = {
        readdirSync: () => ['PythonSoftwareFoundation.Python.3.10_x', 'PythonSoftwareFoundation.Python.3.12_y'],
        existsSync: (f) => f === p10,
    };
    assert.strictEqual(pk.storePythonCli({ LOCALAPPDATA: 'L' }, fsxFallback), p10);
});

test('token saver detect: on win32 checks both normal APPDATA and Store Python location', () => {
    const normalCli = path.join('A', 'token-saver', 'src', 'cli.py');
    const storeCli = path.join('L', 'Packages', 'PythonSoftwareFoundation.Python.3.11_x', 'LocalCache', 'Roaming', 'token-saver', 'src', 'cli.py');

    // Case 1: Normal APPDATA exists
    const fsxNormal = {
        existsSync: (f) => f === normalCli,
        readFileSync: () => { throw new Error('no settings'); },
    };
    assert.strictEqual(
        pk.tokenSaverDetect({
            platform: 'win32',
            env: { APPDATA: 'A', LOCALAPPDATA: 'L' },
            fs: fsxNormal,
        }).installed,
        true
    );

    // Case 2: Normal APPDATA missing, Store Python exists
    const fsxStore = {
        readdirSync: () => ['PythonSoftwareFoundation.Python.3.11_x'],
        existsSync: (f) => f === storeCli,
        readFileSync: () => { throw new Error('no settings'); },
    };
    assert.strictEqual(
        pk.tokenSaverDetect({
            platform: 'win32',
            env: { APPDATA: 'A', LOCALAPPDATA: 'L' },
            fs: fsxStore,
        }).installed,
        true
    );

    // Case 3: Missing everywhere
    const fsxMissing = {
        readdirSync: () => [],
        existsSync: () => false,
        readFileSync: () => { throw new Error('no settings'); },
    };
    assert.strictEqual(
        pk.tokenSaverDetect({
            platform: 'win32',
            env: { APPDATA: 'A', LOCALAPPDATA: 'L' },
            fs: fsxMissing,
        }).installed,
        false
    );

    // Case 4: Non-win32 platform ignores Store Python
    assert.strictEqual(
        pk.tokenSaverDetect({
            platform: 'linux',
            home: '/fake/home',
            env: { APPDATA: 'A', LOCALAPPDATA: 'L' },
            fs: fsxStore,
        }).installed,
        false
    );
});

test('token saver verify: on win32 finds Store Python when APPDATA is redirected and avoids "CLI missing"', () => {
    const storeCli = path.join('L', 'Packages', 'PythonSoftwareFoundation.Python.3.11_x', 'LocalCache', 'Roaming', 'token-saver', 'src', 'cli.py');
    const settingsPath = path.join('H', '.claude', 'settings.json');
    const orig = cliSpawn.run;
    try {
        const calls = [];
        cliSpawn.run = (cmd, args) => {
            calls.push({ cmd, args });
            return cmd === 'token-saver' ? { error: Object.assign(new Error('x'), { code: 'ENOENT' }) } : { status: 0 };
        };

        const fsx = {
            readdirSync: () => ['PythonSoftwareFoundation.Python.3.11_x'],
            existsSync: (f) => f === storeCli,
            readFileSync: (f) => {
                if (f === settingsPath) return JSON.stringify({ enabledPlugins: { 'token-saver@token-saver-marketplace': true } });
                throw new Error('not found');
            },
        };

        const r = pk.tokenSaverVerify({
            home: 'H',
            platform: 'win32',
            env: { APPDATA: 'A', LOCALAPPDATA: 'L' },
            fs: fsx,
        });

        assert.strictEqual(r.ok, true, r.detail);
        assert.ok(r.detail.includes(storeCli), r.detail);
        assert.ok(!r.detail.includes('CLI missing'), 'must not report CLI missing');
        assert.deepStrictEqual(calls[1], { cmd: 'python', args: [storeCli, 'stats'] });
    } finally { cliSpawn.run = orig; }
});

