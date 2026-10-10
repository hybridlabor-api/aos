'use strict';
// The codebase-memory-mcp MCP server is third-party, not an @hybridlabor-api module:
// a single self-contained stdio binary with a local SQLite DB (~/.cache/codebase-memory-mcp)
// and no network calls of its own. The AOS installer never downloads it — the user installs
// the binary (docs/codebase-memory.md), and the MCP entry is registered by the ordinary
// one-MCP-per-app pick mechanism (mcp_picks.json) only where the binary is present.
// Same shape and fs-only-probe discipline as lib/hardware-apps.js: every path derives from
// `home`/env, fs access is injectable (fsImpl) and tests never spawn a shell.
const fs = require('fs');
const path = require('path');

const CMB_BINARY = 'codebase-memory-mcp';

// Extra candidates beyond the PATH scan: the places the upstream install methods place it
// (upstream `install script`, Homebrew, npm/pip global installs resolved through PATH itself).
const CMB_DEFAULT_DIRS = (home) => [
    path.join('/', 'usr', 'local', 'bin'),
    path.join('/', 'opt', 'homebrew', 'bin'),
    path.join(home, '.local', 'bin'),
];

// PATH probe done with plain fs existsSync (Windows extension rules), never a spawn —
// a probe must not cost a shell or a child process per check.
function exePath(dirs, name, { platform = process.platform, fsImpl = fs } = {}) {
    const exts = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
    // Same join discipline as hardware-apps' bundledPaths: the win32 branches build win32
    // paths explicitly, so a test on any host platform produces the host-accurate path.
    const join = platform === 'win32' ? (a, b) => path.win32.join(a, b) : path.join;
    for (const dir of dirs) {
        if (!dir) continue;
        for (const ext of exts) {
            const p = join(dir, name + ext);
            try { if (fsImpl.existsSync(p)) return p; } catch { /* unreadable dir -> next */ }
        }
    }
    return null;
}

// Returns { found, path|null, label } for the codebase-memory MCP binary.
// Injectability contract mirrors hwAppStatus so tests run it without a shell.
function cmbAppStatus(opts = {}) {
    const o = { platform: process.platform, env: process.env, home: '', fsImpl: null, ...opts };
    const fsImpl = o.fsImpl || fs;
    const env = o.env || {};
    const home = o.home || env.HOME || env.USERPROFILE || '';
    const pathDirs = typeof env.PATH === 'string' ? env.PATH.split(o.platform === 'win32' ? ';' : ':') : [];
    const p = exePath([...pathDirs, ...CMB_DEFAULT_DIRS(home)], CMB_BINARY, { platform: o.platform, fsImpl });
    return { found: Boolean(p), path: p, label: CMB_BINARY };
}

// Message the doctor and the installer print for an absent binary. Same style as the
// kicad/openscad "app missing" line; the phrase "app missing" is a contract keyed by tests.
function cmbMissingMessage(opts = {}) {
    const status = opts.status || cmbAppStatus(opts);
    return `app missing: ${status.label}`;
}

// Pinned npm release (MIT, github.com/DeusData/codebase-memory-mcp). Its postinstall fetches the binary.
const CMB_VERSION = '0.11.0';
const CMB_INSTALL_CMD = `npm install -g ${CMB_BINARY}@${CMB_VERSION}`;

// --coding -> true, --no-coding -> false, neither -> undefined (the last flag wins).
function parseCodingFlag(argv = process.argv) {
    let v;
    for (const a of argv) { if (a === '--coding') v = true; else if (a === '--no-coding') v = false; }
    return v;
}

// The "Do you use AOS for coding?" preference (settings.codingMode in ~/.aos/v5-settings.json).
// undefined = never asked. A flag stores its value; the prompt runs only when nothing is stored and
// the run is interactive; non-interactive runs never prompt and leave the stored value untouched
// (so it stays undefined = off). `true` with the binary missing runs the pinned npm install through
// `run` (failures warn, never throw). `false` does nothing and never uninstalls.
async function applyCodingMode({ settings, save, flag, interactive, ask, run, status = cmbAppStatus, warn = () => {}, step = () => {} }) {
    let mode = flag !== undefined ? flag : settings.codingMode;
    if (typeof mode !== 'boolean') mode = undefined;
    if (mode === undefined && interactive) {
        const a = await ask('Do you use AOS for coding? (enables the Codebase Memory MCP code knowledge graph)');
        // A cancelled prompt is not an answer: keep it unasked so the next run asks again.
        if (typeof a === 'boolean') mode = a;
    }
    if (mode !== undefined && mode !== settings.codingMode) save({ ...settings, codingMode: mode });
    // Never skip the question silently: a run that could not ask says how to opt in.
    if (mode === undefined) step('Codebase Memory MCP is off (not asked: no interactive terminal). Use AOS for coding? Re-run with --coding to enable it.');
    if (mode !== true) return mode;
    if (status().found) return mode;
    let ok = false;
    try { ok = (await run(CMB_INSTALL_CMD)) !== false; } catch (e) { warn(`Codebase Memory install failed: ${e.message}`); }
    if (ok && status().found) step('Codebase Memory MCP installed.');
    else warn(`Codebase Memory MCP is not available; install it manually: ${CMB_INSTALL_CMD}`);
    return mode;
}

module.exports = { CMB_BINARY, CMB_VERSION, CMB_INSTALL_CMD, cmbAppStatus, cmbMissingMessage, parseCodingFlag, applyCodingMode };
