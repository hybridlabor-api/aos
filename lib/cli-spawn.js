'use strict';
// Runs another CLI (claude, codex, agy) without a shell string. POSIX: argv array. Windows: the
// command is resolved through PATH/PATHEXT to its real file; npm's .cmd/.bat shims go through
// `cmd.exe /d /s /c "<line>"` with every argument escaped (same scheme as cross-spawn), because a
// shim cannot be spawned directly and a shell:true string breaks on spaces and & in paths.
const nodeFs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const WIN_DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';
const META = /([()\][%!^"`<>&|;, *?])/g;
const isShim = (file) => /\.(cmd|bat)$/i.test(file);

function pathModule(platform) { return platform === 'win32' ? path.win32 : path.posix; }

function isRunnable(file, platform, fsImpl) {
    try {
        const st = fsImpl.statSync(file);
        if (!st.isFile()) return false;
        if (platform !== 'win32') fsImpl.accessSync(file, nodeFs.constants.X_OK);
        return true;
    } catch { return false; }
}

// Resolves `cmd` to the file that would run. Returns null when it is not found.
function resolveCommand(cmd, { platform = process.platform, env = process.env, fs: fsImpl = nodeFs } = {}) {
    const p = pathModule(platform);
    const win = platform === 'win32';
    const envGet = (k) => (win ? env[Object.keys(env).find((x) => x.toLowerCase() === k.toLowerCase())] : env[k]);
    const exts = win ? String(envGet('PATHEXT') || WIN_DEFAULT_PATHEXT).split(';').filter(Boolean) : [''];
    const hasExt = win && p.extname(cmd) !== '' && exts.some((e) => e.toLowerCase() === p.extname(cmd).toLowerCase());
    const variants = (base) => (win ? (hasExt ? [base] : exts.map((e) => base + e)) : [base]);
    const dirs = /[\\/]/.test(cmd) ? [''] : String(envGet('PATH') || '').split(win ? ';' : ':').map((d) => d.replace(/^"(.*)"$/, '$1')).filter(Boolean);
    for (const dir of dirs) {
        for (const c of variants(dir ? p.join(dir, cmd) : cmd)) {
            if (isRunnable(c, platform, fsImpl)) return c;
        }
    }
    return null;
}

const onPath = (cmd, opts) => resolveCommand(cmd, opts) !== null;

// One argument for a cmd.exe command line: argv-quote (CommandLineToArgvW rules), wrap in quotes,
// then caret-escape every cmd metacharacter. A batch file that forwards %* re-parses the line, so its
// carets must be doubled; a batch file that never mentions %* gets single carets. When the file cannot
// be read, doubling is the conservative choice (same as before; npm shims always forward %*).
function quoteCmdArg(arg, doubleEscape = true) {
    let a = String(arg);
    a = a.replace(/(\\*)"/g, '$1$1\\"');
    a = a.replace(/(\\+)$/, '$1$1');
    a = `"${a}"`;
    a = a.replace(META, '^$1');
    return doubleEscape ? a.replace(META, '^$1') : a;
}
const quoteCmdCommand = (file) => path.win32.normalize(file).replace(META, '^$1');

// What to spawn for a resolved file: { file, args, options }.
const winEnv = (env, k) => env[Object.keys(env).find((x) => x.toLowerCase() === k.toLowerCase())];
const forwardsArgs = (file, fsImpl) => { try { return /%\*/.test(fsImpl.readFileSync(file, 'latin1')); } catch { return true; } };

function buildInvocation(file, args, { platform = process.platform, env = process.env, fs: fsImpl = nodeFs } = {}) {
    const bad = args.findIndex((a) => /[\r\n]/.test(String(a)));
    if (bad >= 0) throw new Error(`argument ${bad + 1} contains a CR or LF; refusing to pass it through a command line`);
    if (platform === 'win32' && isShim(file)) {
        const dbl = forwardsArgs(file, fsImpl);
        const line = [quoteCmdCommand(file), ...args.map((a) => quoteCmdArg(a, dbl))].join(' ');
        const root = winEnv(env, 'SystemRoot') || 'C:\\Windows';
        const comspec = winEnv(env, 'ComSpec') || path.win32.join(root, 'System32', 'cmd.exe');
        return { file: comspec, args: ['/d', '/s', '/c', `"${line}"`], options: { windowsVerbatimArguments: true } };
    }
    return { file, args: [...args], options: {} };
}

// Result: { status, stdout, stderr, missing, timedOut, error }. Never throws.
function run(cmd, args = [], { timeout = 120000, env = process.env, cwd, platform = process.platform, fs: fsImpl = nodeFs, spawn = spawnSync } = {}) {
    const file = resolveCommand(cmd, { platform, env, fs: fsImpl });
    if (!file) {
        const e = Object.assign(new Error(`${cmd} not found on PATH`), { code: 'ENOENT' });
        return { status: null, stdout: '', stderr: e.message, missing: true, timedOut: false, error: e };
    }
    let inv;
    let r;
    try {
        inv = buildInvocation(file, args, { platform, env, fs: fsImpl });
        r = spawn(inv.file, inv.args, { encoding: 'utf8', timeout, env, cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'], ...inv.options });
    } catch (e) {
        return { status: null, stdout: '', stderr: e.message, missing: e.code === 'ENOENT', timedOut: false, error: e };
    }
    const timedOut = !!(r.error && r.error.code === 'ETIMEDOUT');
    return {
        status: r.error ? null : r.status,
        stdout: r.stdout || '',
        stderr: (r.stderr || '') + (r.error ? r.error.message : ''),
        missing: !!(r.error && r.error.code === 'ENOENT'),
        timedOut,
        error: r.error || null,
    };
}

module.exports = { resolveCommand, onPath, quoteCmdArg, quoteCmdCommand, buildInvocation, run };
