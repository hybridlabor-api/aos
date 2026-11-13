'use strict';
// winPreflight is pure given env, run and fs: no process is spawned and no registry is read here.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { winPreflight, reportWinPreflight, parsePyList, uvOffPath } = require('../lib/win-preflight');

const ENV = { USERPROFILE: 'C:\\Users\\u', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', APPDATA: 'C:\\Users\\u\\AppData\\Roaming', SystemRoot: 'C:\\Windows', PATH: 'C:\\bin', PATHEXT: '.EXE;.CMD' };
const UV_ON_PATH = 'C:\\bin\\uv.exe';

// Case-insensitive like NTFS; `dirs` maps a folder to its entries for readdirSync.
function fakeFs(files = [], dirs = {}) {
    const set = new Set(files.map((f) => f.toLowerCase()));
    const stat = (f) => { if (!set.has(String(f).toLowerCase())) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return { isFile: () => true, isSymbolicLink: () => false }; };
    return {
        statSync: stat,
        lstatSync: stat,
        accessSync: () => {},
        readdirSync: (d) => { const hit = Object.keys(dirs).find((k) => k.toLowerCase() === String(d).toLowerCase()); if (!hit) throw new Error('ENOENT'); return dirs[hit]; },
    };
}

// Answers by executable base name; anything not listed is "command not found".
function fakeRun(answers) {
    const calls = [];
    const run = (file, args) => {
        calls.push([file, args]);
        const a = answers[path.win32.basename(file).toLowerCase()];
        if (a === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return { status: 0, stdout: '', stderr: '', ...a };
    };
    run.calls = calls;
    return run;
}

const HEALTHY = {
    py: { stdout: ' -V:3.13 *        C:\\Python313\\python.exe\r\n -V:3.15          C:\\Python315\\python.exe\r\n' },
    python: { stdout: 'Python 3.15.0\r\n' },
    'chcp.com': { stdout: 'Active code page: 65001\r\n' },
    'reg.exe': { stdout: '\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\FileSystem\r\n    LongPathsEnabled    REG_DWORD    0x1\r\n' },
};
const ids = (f) => f.map((x) => x.id);
const check = (run, extra = {}) => winPreflight({ platform: 'win32', env: ENV, run, fs: fakeFs([UV_ON_PATH]), nodeVersion: 'v24.1.0', ...extra });

describe('winPreflight', () => {
    test('does nothing off Windows and never calls a probe', () => {
        const run = fakeRun({});
        assert.deepEqual(winPreflight({ platform: 'linux', env: {}, run }), []);
        assert.deepEqual(winPreflight({ platform: 'darwin', env: {}, run }), []);
        assert.equal(run.calls.length, 0);
    });

    test('a healthy machine yields no finding', () => {
        assert.deepEqual(check(fakeRun(HEALTHY)), []);
    });

    test('system tools are called by absolute System32 path', () => {
        const run = fakeRun(HEALTHY);
        check(run);
        const files = run.calls.map((c) => c[0]);
        assert.ok(files.includes('C:\\Windows\\System32\\chcp.com'), files.join());
        assert.ok(files.includes('C:\\Windows\\System32\\reg.exe'), files.join());
    });

    test('parsePyList reads both launcher formats and skips lines without a version', () => {
        assert.deepEqual(parsePyList(' -V:3.13 *        C:\\P\\python.exe\n -V:3.15          C:\\Q\\python.exe\n'), [[3, 13], [3, 15]]);
        assert.deepEqual(parsePyList(' -3.12-64        C:\\P\\python.exe\n'), [[3, 12]]);
        assert.deepEqual(parsePyList('No installed Pythons found!'), []);
    });

    test('only a too-new Python: warns with the supported range and the versions seen', () => {
        const f = check(fakeRun({ ...HEALTHY, py: { stdout: ' -V:3.15 *  C:\\Python315\\python.exe\r\n' } }));
        assert.deepEqual(ids(f), ['python']);
        assert.match(f[0].message, /Python 3\.15 found, but memB needs Python 3\.10-3\.14/);
        assert.match(f[0].message, /uv is installed/);
        assert.match(f[0].fix, /winget install --id Python\.Python\.3\.12/);
    });

    test('python that prints its version on stderr counts', () => {
        const run = fakeRun({ 'chcp.com': HEALTHY['chcp.com'], 'reg.exe': HEALTHY['reg.exe'], python: { stdout: '', stderr: 'Python 3.12.4' } });
        assert.deepEqual(check(run), []);
    });

    test('no Python at all, Store alias on PATH: names the alias', () => {
        const alias = 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe';
        const env = { ...ENV, PATH: 'C:\\bin;C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps' };
        const run = fakeRun({ 'chcp.com': HEALTHY['chcp.com'], 'reg.exe': HEALTHY['reg.exe'], python: { status: 9009, stderr: 'Python was not found' } });
        const f = winPreflight({ platform: 'win32', env, run, fs: fakeFs([UV_ON_PATH, alias]), nodeVersion: 'v24.1.0' });
        assert.deepEqual(ids(f), ['python']);
        assert.match(f[0].message, /Microsoft Store alias/);
    });

    test('no Python and no uv: both are reported, without the uv reassurance', () => {
        const run = fakeRun({ 'chcp.com': HEALTHY['chcp.com'], 'reg.exe': HEALTHY['reg.exe'] });
        const f = winPreflight({ platform: 'win32', env: ENV, run, fs: fakeFs([]), nodeVersion: 'v24.1.0' });
        assert.deepEqual(ids(f), ['python', 'uv']);
        assert.match(f[0].message, /No Python reachable/);
        assert.doesNotMatch(f[0].message, /uv is installed/);
        assert.match(f[1].fix, /winget install --id astral-sh\.uv/);
    });

    test('uv installed by winget but missing from PATH: says where it is and to open a new terminal', () => {
        const pk = 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Packages';
        const exe = `${pk}\\astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe\\uv.exe`;
        const fsImpl = fakeFs([exe], { [pk]: ['Git.Git_x', 'astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe'] });
        const f = winPreflight({ platform: 'win32', env: ENV, run: fakeRun(HEALTHY), fs: fsImpl, nodeVersion: 'v24.1.0' });
        assert.deepEqual(ids(f), ['uv-path']);
        assert.ok(f[0].message.includes(exe), f[0].message);
        assert.match(f[0].fix, /new terminal/);
        assert.equal(uvOffPath(ENV, fsImpl), exe);
        const link = 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\uv.exe';
        assert.equal(uvOffPath(ENV, fakeFs([link])), link);
    });

    test('long paths off or value missing: warns with the registry fix; mentions a long profile path', () => {
        const off = check(fakeRun({ ...HEALTHY, 'reg.exe': { stdout: '    LongPathsEnabled    REG_DWORD    0x0\r\n' } }));
        assert.deepEqual(ids(off), ['longpaths']);
        assert.match(off[0].fix, /LongPathsEnabled -Value 1/);
        assert.doesNotMatch(off[0].message, /characters long/);
        const missing = check(fakeRun({ ...HEALTHY, 'reg.exe': { status: 1, stderr: 'ERROR: The system was unable to find the specified registry key or value.' } }));
        assert.deepEqual(ids(missing), ['longpaths']);
        const longHome = 'C:\\Users\\' + 'n'.repeat(40);
        const f = winPreflight({ platform: 'win32', env: { ...ENV, USERPROFILE: longHome }, run: fakeRun({ ...HEALTHY, 'reg.exe': { stdout: 'LongPathsEnabled    REG_DWORD    0x0' } }), fs: fakeFs([UV_ON_PATH]), nodeVersion: 'v24.1.0' });
        assert.match(f.find((x) => x.id === 'longpaths').message, /49 characters long/);
    });

    test('a probe that cannot run or times out is skipped, not reported', () => {
        assert.deepEqual(check(fakeRun({ py: HEALTHY.py, python: HEALTHY.python })), []);
        assert.deepEqual(check(fakeRun({ ...HEALTHY, 'reg.exe': { status: null }, 'chcp.com': { status: 1, stdout: '' } })), []);
    });

    test('non-UTF-8 code page: warns in any console language', () => {
        const f = check(fakeRun({ ...HEALTHY, 'chcp.com': { stdout: 'Aktive Codepage: 850.\r\n' } }));
        assert.deepEqual(ids(f), ['codepage']);
        assert.match(f[0].message, /code page is 850/);
        assert.match(f[0].fix, /chcp 65001/);
    });

    test('Node below the aos-cli minimum is reported; the minimum itself is not', () => {
        assert.deepEqual(ids(check(fakeRun(HEALTHY), { nodeVersion: 'v20.11.1' })), ['node']);
        assert.deepEqual(ids(check(fakeRun(HEALTHY), { nodeVersion: 'v22.18.0' })), ['node']);
        assert.deepEqual(check(fakeRun(HEALTHY), { nodeVersion: 'v22.19.0' }), []);
    });

    test('one throwing check does not hide the others', () => {
        const inner = fakeRun({ ...HEALTHY, 'chcp.com': { stdout: 'Active code page: 437' } });
        const run = (file, args) => {
            if (/reg\.exe$/i.test(file)) throw new TypeError('boom');
            return inner(file, args);
        };
        assert.deepEqual(ids(check(run)), ['codepage']);
    });

    test('reportWinPreflight prints one warning with every fix, and nothing when clean', () => {
        const warned = [];
        const logger = { warn: (m) => warned.push(m) };
        assert.deepEqual(reportWinPreflight({ platform: 'win32', env: ENV, run: fakeRun(HEALTHY), fs: fakeFs([UV_ON_PATH]), nodeVersion: 'v24.1.0' }, logger), []);
        assert.equal(warned.length, 0);
        const run = fakeRun({ 'chcp.com': { stdout: 'Active code page: 437' }, 'reg.exe': { stdout: 'LongPathsEnabled REG_DWORD 0x0' } });
        const f = reportWinPreflight({ platform: 'win32', env: ENV, run, fs: fakeFs([]), nodeVersion: 'v24.1.0' }, logger);
        assert.equal(f.length, 4);
        assert.equal(warned.length, 1);
        assert.match(warned[0], /Windows preflight: 4 thing\(s\)/);
        assert.match(warned[0], /the install continues/);
        assert.equal((warned[0].match(/\n {2}Fix: /g) || []).length, 4);
    });
});

test('the installer runs the preflight once, after the installed-menu branch and before the first write step', () => {
    const src = require('node:fs').readFileSync(path.join(__dirname, '..', 'installer.js'), 'utf8');
    const call = "require('./lib/win-preflight').reportWinPreflight({}, log);";
    assert.equal(src.split(call).length - 1, 1);
    const at = src.indexOf(call);
    assert.ok(src.indexOf("require('./lib/v5/menu').menu(module.exports, v5Options(true, true))") < at);
    assert.ok(at < src.indexOf('await gateReenableStep({ ask: gateReenableAsk() });', at));
});
