'use strict';
// Windows preflight: read-only checks that run before the installer writes anything. Every finding
// is a warning with the command that fixes it; nothing here blocks or changes the install.
// All probes are injectable (run, fs, env), so the tests never spawn a process or read the registry.
const nodeFs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveCommand } = require('./cli-spawn');

// memB's supported interpreters: >= 3.10 (installer.js MEMB_MIN_PYTHON); onnxruntime had no wheel for
// a newer Python than 3.14 on the audited machine (Python 3.15, AOS 5.4.8).
const PY_MIN = [3, 10];
const PY_MAX = [3, 14];
// packages/aos-cli/package.json engines.node.
const AOS_CLI_MIN_NODE = [22, 19];
const UTF8_CODE_PAGE = 65001;
// Deepest shipped path under ~/.gemini/config/mcps plus an npm-installed node_modules tree; with a
// home longer than this the 260-character limit is in reach.
const LONG_HOME = 40;

const envGet = (env, k) => env[Object.keys(env).find((x) => x.toLowerCase() === k.toLowerCase())];
const cmpVer = (a, b) => (a[0] - b[0]) || (a[1] - b[1]);
const inRange = (v) => cmpVer(v, PY_MIN) >= 0 && cmpVer(v, PY_MAX) <= 0;
const fmt = (v) => v.join('.');

function defaultRun(file, args) {
    const r = spawnSync(file, args, { encoding: 'utf8', shell: false, timeout: 5000, windowsHide: true });
    return { status: r.error ? null : r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
}

const sys32 = (env, exe) => path.win32.join(envGet(env, 'SystemRoot') || 'C:\\Windows', 'System32', exe);

// Versions in `py -0p` output (` -V:3.13 *  C:\...\python.exe`, older launchers ` -3.12-64  C:\...`).
function parsePyList(out) {
    const res = [];
    for (const line of String(out || '').split(/\r?\n/)) {
        const m = /^\s*-(?:V:)?(?:[A-Za-z]+\/)?(\d+)\.(\d+)/.exec(line);
        if (m) res.push([Number(m[1]), Number(m[2])]);
    }
    return res;
}

// uv outside PATH: the installers' own folders and winget's shim/package folders.
function uvOffPath(env, fsImpl) {
    const u = envGet(env, 'USERPROFILE');
    const la = envGet(env, 'LOCALAPPDATA');
    const dirs = [];
    if (u) dirs.push(path.win32.join(u, '.local', 'bin'), path.win32.join(u, '.cargo', 'bin'));
    if (la) {
        dirs.push(path.win32.join(la, 'Programs', 'uv'), path.win32.join(la, 'uv', 'bin'), path.win32.join(la, 'Microsoft', 'WinGet', 'Links'));
        const pk = path.win32.join(la, 'Microsoft', 'WinGet', 'Packages');
        try { for (const d of fsImpl.readdirSync(pk)) if (/^astral-sh[.]uv_/i.test(d)) dirs.push(path.win32.join(pk, d)); } catch { /* no winget packages */ }
    }
    for (const d of dirs) {
        const f = path.win32.join(d, 'uv.exe');
        try { if (fsImpl.statSync(f).isFile()) return f; } catch { /* not here */ }
    }
    return null;
}

function checkPython({ env, run, fsImpl, uvFound }) {
    const versions = [];
    let py = null;
    try { py = run('py', ['-0p']); } catch { /* no launcher */ }
    if (py && py.status === 0) versions.push(...parsePyList(py.stdout));
    let plain = null;
    try { plain = run('python', ['--version']); } catch { /* no python */ }
    const m = plain && plain.status === 0 && /Python (\d+)\.(\d+)/.exec(plain.stdout + plain.stderr);
    if (m) versions.push([Number(m[1]), Number(m[2])]);
    if (versions.some(inRange)) return null;
    const range = `${fmt(PY_MIN)}-${fmt(PY_MAX)}`;
    const viaUv = uvFound ? ' uv is installed, so memB can still get a managed Python 3.12.' : '';
    if (versions.length) {
        const seen = [...new Set(versions.map(fmt))].join(', ');
        return { id: 'python', message: `Python ${seen} found, but memB needs Python ${range}.${viaUv}`, fix: 'winget install --id Python.Python.3.12 -e' };
    }
    // The Store alias answers `python` with a Store prompt and exit code 9009, not with a version.
    const alias = /[\\/]WindowsApps[\\/]/i.test(String(resolveCommand('python', { platform: 'win32', env, fs: fsImpl }) || ''));
    const why = alias ? 'Only the Microsoft Store alias answers `python` in this shell; no Python is reachable.' : 'No Python reachable from this shell (neither `py` nor `python`).';
    return { id: 'python', message: `${why} memB needs Python ${range}.${viaUv}`, fix: 'winget install --id Python.Python.3.12 -e' };
}

function checkUv({ env, fsImpl, onPathUv }) {
    if (onPathUv) return null;
    const off = uvOffPath(env, fsImpl);
    if (off) return { id: 'uv-path', message: `uv is installed (${off}) but not on this shell's PATH; MCP servers started with \`uv\` will not find it.`, fix: 'Open a new terminal and run the installer again (a PATH change only reaches new terminals).' };
    return { id: 'uv', message: 'uv not found. The Python MCP servers (Blender, Resolume, grandMA3, RemoteOS, Windows computer use) start through `uv`.', fix: 'winget install --id astral-sh.uv -e   (then open a new terminal)' };
}

function checkCodePage({ env, run }) {
    let r = null;
    try { r = run(sys32(env, 'chcp.com'), []); } catch { return null; }
    const m = r && r.status === 0 && /(\d{3,5})/.exec(r.stdout);
    if (!m || Number(m[1]) === UTF8_CODE_PAGE) return null;
    return { id: 'codepage', message: `Console code page is ${m[1]}, not UTF-8: non-ASCII output of Python and other child tools can be garbled or fail to encode.`, fix: 'chcp 65001   (this terminal only), or set PYTHONUTF8=1 for the Python tools' };
}

function checkLongPaths({ env, run }) {
    let r = null;
    try { r = run(sys32(env, 'reg.exe'), ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', '/v', 'LongPathsEnabled']); } catch { return null; }
    if (!r || r.status === null) return null;
    if (r.status === 0 && /LongPathsEnabled\s+REG_DWORD\s+0x0*1\b/i.test(r.stdout)) return null;
    const home = String(envGet(env, 'USERPROFILE') || '');
    const tail = home.length > LONG_HOME ? ` This profile path is ${home.length} characters long, which makes the limit easy to hit.` : '';
    return {
        id: 'longpaths',
        message: `Windows long-path support is off: paths over 260 characters fail in npm installs and git clones under the profile folder.${tail}`,
        fix: "In an elevated PowerShell: New-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem' -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force",
    };
}

function checkNode({ nodeVersion }) {
    const m = /^v?(\d+)\.(\d+)/.exec(String(nodeVersion || ''));
    if (!m || cmpVer([Number(m[1]), Number(m[2])], AOS_CLI_MIN_NODE) >= 0) return null;
    return { id: 'node', message: `Node ${m[1]}.${m[2]} runs the installer, but the terminal chat (aos-cli) needs Node ${fmt(AOS_CLI_MIN_NODE)} or newer and will be skipped or fail.`, fix: 'winget install --id OpenJS.NodeJS.LTS -e' };
}

// -> [{ id, message, fix }]; empty when nothing needs attention or the platform is not Windows.
// One failing probe never hides the others: each check is isolated.
function winPreflight({ platform = process.platform, env = process.env, run = defaultRun, fs: fsImpl = nodeFs, nodeVersion = process.version } = {}) {
    if (platform !== 'win32') return [];
    const safe = (fn) => { try { return fn(); } catch { return null; } };
    const onPathUv = safe(() => resolveCommand('uv', { platform, env, fs: fsImpl }));
    const uvFinding = safe(() => checkUv({ env, fsImpl, onPathUv }));
    const uvFound = Boolean(onPathUv) || Boolean(uvFinding && uvFinding.id === 'uv-path');
    return [
        safe(() => checkNode({ nodeVersion })),
        safe(() => checkPython({ env, run, fsImpl, uvFound })),
        uvFinding,
        safe(() => checkLongPaths({ env, run })),
        safe(() => checkCodePage({ env, run })),
    ].filter(Boolean);
}

// Prints the findings through `logger.warn`; returns them so a caller can also record them.
function reportWinPreflight(opts = {}, logger = console) {
    const findings = winPreflight(opts);
    if (!findings.length) return findings;
    const lines = findings.map((f) => `- ${f.message}\n  Fix: ${f.fix}`);
    logger.warn(`Windows preflight: ${findings.length} thing(s) to check before installing (the install continues):\n${lines.join('\n')}`);
    return findings;
}

module.exports = { winPreflight, reportWinPreflight, parsePyList, uvOffPath, PY_MIN, PY_MAX };
