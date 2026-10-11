'use strict';
// App-presence detection for the @hybridlabor-api/bdb-hardware-pcb MCP servers.
// Pure of installer state: every path derives from `home`/env, fs access is injectable
// (fsImpl) and the PATH probe is injectable (executableProbe) so tests never spawn a shell.
// The @hybridlabor-api/bdb-hardware-pcb module registers kicad + openscad unconditionally;
// the AOS installer uses the gate here to skip/undo a registration whose backing app is
// absent, and aos doctor reports it as "app missing".
const fs = require('fs');
const path = require('path');

const HW_APPS = {
    kicad: { label: 'KiCad.app', probe: 'kicad-cli' },
    openscad: { label: 'OpenSCAD.app', probe: 'openscad' },
};

function bundledPaths(appId, { platform, env }) {
    const progFiles = (env && env.ProgramFiles) || 'C:\\Program Files';
    if (appId === 'kicad') {
        if (platform === 'darwin') return [path.join('/', 'Applications', 'KiCad', 'KiCad.app')];
        if (platform === 'win32') return [path.win32.join(progFiles, 'KiCad')];
        return [path.join('/', 'usr', 'bin', 'kicad-cli'), path.join('/', 'usr', 'local', 'bin', 'kicad-cli')];
    }
    if (appId === 'openscad') {
        if (platform === 'darwin') return [path.join('/', 'Applications', 'OpenSCAD.app')];
        if (platform === 'win32') return [path.win32.join(progFiles, 'OpenSCAD')];
        return [path.join('/', 'usr', 'bin', 'openscad'), path.join('/', 'usr', 'local', 'bin', 'openscad')];
    }
    return [];
}

// PATH probe done with plain fs existsSync (Windows extension rules), never a spawn —
// a probe must not cost a shell or a child process per association.
function exePathFromPathDirs(appId, { platform = process.platform, env = process.env, dirs, fsImpl = fs }) {
    const meta = HW_APPS[appId];
    if (!meta) return null;
    const searchDirs = Array.isArray(dirs) ? dirs
        : typeof env.PATH === 'string' ? env.PATH.split(path.delimiter) : [];
    const exts = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
    for (const ext of exts) {
        for (const dir of searchDirs) {
            if (!dir) continue;
            const p = path.join(dir, meta.probe + ext);
            try { if (fsImpl.existsSync(p)) return p; } catch { /* unreadable dir -> next */ }
        }
    }
    return null;
}

// Returns for a known app id: { found, path|null, label } — `null` only for an unknown
// app id, so callers cannot mistake it for a "present" verdict.
function hwAppStatus(appId, opts = {}) {
    const meta = HW_APPS[appId];
    if (!meta) return null;
    const o = { platform: process.platform, env: process.env, home: '', ...opts };
    const fsImpl = o.fsImpl || fs;
    const exists = (p) => { try { return fsImpl.existsSync(p); } catch { return false; } };
    for (const p of bundledPaths(appId, o)) {
        if (exists(p)) return { found: true, path: p, label: meta.label };
    }
    if (o.executableProbe) {
        const p = o.executableProbe(meta.probe);
        if (p) return { found: true, path: p, label: meta.label };
        return { found: false, path: null, label: meta.label };
    }
    // A PATH scan must reflect the exact PATH entries passed in; with the default process
    // env it uses the same PATH a launcher would see.
    const searchDirs = Array.isArray(o.dirs) ? o.dirs : (typeof o.env.PATH === 'string' ? o.env.PATH.split(path.delimiter) : []);
    const p = exePathFromPathDirs(appId, { ...o, dirs: searchDirs });
    return { found: Boolean(p), path: p, label: meta.label };
}

// Message the doctor and the installer print for an absent app. The phrase "app missing"
// is a contract: the doctor's output and tests key on it.
function appMissingMessage(appId, opts = {}) {
    const status = opts.status || hwAppStatus(appId, opts);
    return `app missing: ${status.label}`;
}

// Given { appId: status }, split the hw MCP servers into register/skip lists.
function hwAppGate(statuses) {
    const register = [];
    const skip = [];
    for (const [appId, status] of Object.entries(statuses || {})) {
        if (!status) continue;
        (status.found ? register : skip).push(appId);
    }
    return { register, skip };
}

// mcp_servers/* subdirectories that need `uv sync` (shipped prebuilt venvs carry an
// interpreter shebang/symlink that does not resolve on the target machine; fs.existsSync
// is false for that dangling link). A dir without pyproject.toml is not touched.
function hwServerDirsNeedingSync(hwDir, opts = {}) {
    const fsImpl = opts.fsImpl || fs;
    const readDir = (p) => { try { return fsImpl.readdirSync(p); } catch { return []; } };
    const exists = (p) => { try { return fsImpl.existsSync(p); } catch { return false; } };
    const isDir = (p) => { try { return fsImpl.statSync(p).isDirectory(); } catch { return false; } };
    // win32 venvs use Scripts\python.exe; both separators are probed so a path recorded
    // by the real installer (backslashes) and a fixture-style POSIX path both resolve.
    const venvPy = (dir) => (opts.platform === 'win32'
        ? [path.join(dir, '.venv', 'Scripts', 'python.exe'), path.win32.join(dir, '.venv', 'Scripts', 'python.exe')]
        : [path.join(dir, '.venv', 'bin', 'python')]);
    const mcpServersDir = path.join(hwDir, 'mcp_servers');
    const found = [];
    for (const entry of readDir(mcpServersDir).sort()) {
        const serverDir = path.join(mcpServersDir, entry);
        if (!isDir(serverDir)) continue;
        if (!exists(path.join(serverDir, 'pyproject.toml'))) continue;
        if (venvPy(serverDir).some((p) => exists(p))) continue;
        found.push(serverDir);
    }
    return found;
}

module.exports = { HW_APPS, hwAppStatus, appMissingMessage, hwAppGate, bundledPaths, exePathFromPathDirs, hwServerDirsNeedingSync };
