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
