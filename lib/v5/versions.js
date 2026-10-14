'use strict';
// One parallel `npm view` per package, cached 24 h. Offline = remote 'unknown'; never throws.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DAY = 24 * 3600 * 1000;
const cachePath = (home) => path.join(home, '.aos', 'cache', 'versions.json');

const npmView = (name) => new Promise((resolve, reject) => {
    execFile(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['view', name, 'version'], { timeout: 8000, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true }, (e, out) => (e ? reject(e) : resolve(String(out).trim())));
});

function readCache(home) {
    try { return JSON.parse(fs.readFileSync(cachePath(home), 'utf8')); } catch { return {}; }
}

// pkgs: [{ id, npm, local, pin? }]; a pin replaces the registry lookup (the installer installs exactly that version); opts.isNewer(local, remote) is installer.isNewerVersion.
// opts.floor: { npmName: version } of packages known to exist at least that new (the running kernel). A cache entry
// older than its floor is stale, so a release made after the last lookup is never reported as the latest.
async function checkAll(pkgs, { home, now = Date.now(), npmView: view = npmView, isNewer = (l, r) => l !== r, floor = {} } = {}) {
    const cache = readCache(home);
    const fresh = {};
    const rows = await Promise.all(pkgs.map(async (p) => {
        let remote = 'unknown';
        if (p.pin) return { id: p.id, local: p.local || null, remote: p.pin, outdated: Boolean(p.local) && isNewer(p.local, p.pin) };
        const hit = cache[p.npm];
        const stale = hit && floor[p.npm] && isNewer(hit.v, floor[p.npm]);
        if (hit && !stale && now - hit.t < DAY) remote = hit.v;
        else {
            try {
                const v = await view(p.npm);
                if (v) { remote = v; fresh[p.npm] = { v, t: now }; }
            } catch { /* offline or registry down */ }
            if (remote === 'unknown' && floor[p.npm]) remote = floor[p.npm];
        }
        const outdated = remote !== 'unknown' && Boolean(p.local) && isNewer(p.local, remote);
        return { id: p.id, local: p.local || null, remote, outdated };
    }));
    if (Object.keys(fresh).length) {
        try {
            fs.mkdirSync(path.dirname(cachePath(home)), { recursive: true });
            fs.writeFileSync(cachePath(home), JSON.stringify({ ...cache, ...fresh }));
        } catch { /* cache is optional */ }
    }
    return rows;
}

module.exports = { checkAll, cachePath };
