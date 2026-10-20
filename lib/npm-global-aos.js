'use strict';
// A leftover `npm i -g @hybridlabor-api/aos` puts an `aos` shim into npm's global bin dir. When that
// dir precedes ~/.local/bin on PATH, the user's `aos` runs the stale global copy while updates only
// refresh the launcher (audit P0-1). Detection is read-only (`npm root -g` + one package.json read);
// the removal command is always printed for the user to run by hand — AOS never removes the package
// itself. Nothing here depends on installer state, so doctor and `aos update` share it.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PKG = '@hybridlabor-api/aos';
const REMOVE_CMD = `npm uninstall -g ${PKG}`;

const semver = (v) => { const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || '')); return m ? m.slice(1).map(Number) : null; };
const isOlderVersion = (a, b) => {
    const x = semver(a), y = semver(b);
    if (!x || !y) return false;
    for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] < y[i]; }
    return false;
};

// `{ checked: false }` when npm is missing or the probe fails — "could not check" is never
// "checked, fine". `run(cmd, args)` (tests) returns the root path or `{ stdout }`.
function detectGlobalAos({ run, readText = (f) => fs.readFileSync(f, 'utf8') } = {}) {
    let root = null;
    try {
        const r = run ? run('npm', ['root', '-g'])
            : execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], {
                encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32',
            });
        root = String((r && typeof r === 'object' && 'stdout' in r ? r.stdout : r) || '').trim();
    } catch { return { checked: false }; }
    if (!root) return { checked: false };
    let version = null;
    try { version = JSON.parse(readText(path.join(root, ...PKG.split('/'), 'package.json'))).version || null; } catch { /* not installed there */ }
    return version ? { checked: true, found: true, root, version } : { checked: true, found: false, root };
}

// The lines doctor / `aos update` print when a global npm copy of the package exists.
function globalAosWarning({ version, root, installedVersion } = {}) {
    const rel = isOlderVersion(version, installedVersion) ? `, older than the installed v${installedVersion}` : '';
    return [
        `A global npm install of ${PKG} (v${version || 'unknown'}${rel}) exists in ${root}: its 'aos' binary can shadow the AOS launcher in ~/.local/bin, so 'aos' may run a stale version.`,
        `Remove it by hand if you no longer need it: ${REMOVE_CMD} — AOS never removes a globally installed package on its own.`,
    ];
}

module.exports = { PKG, REMOVE_CMD, detectGlobalAos, globalAosWarning, isOlderVersion };
