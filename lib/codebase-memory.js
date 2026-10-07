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

module.exports = { CMB_BINARY, cmbAppStatus, cmbMissingMessage };
