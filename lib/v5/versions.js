'use strict';
// One parallel `npm view` per package, cached 24 h. Offline = remote 'unknown'; never throws.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DAY = 24 * 3600 * 1000;
const cachePath = (home) => path.join(home, '.aos', 'cache', 'versions.json');

const npmView = (name) => new Promise((resolve, reject) => {
    execFile(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['view', name, 'version'], { timeout: 8000, encoding: 'utf8', shell: process.platform === 'win32' }, (e, out) => (e ? reject(e) : resolve(String(out).trim())));
});

function readCache(home) {
    try { return JSON.parse(fs.readFileSync(cachePath(home), 'utf8')); } catch { return {}; }
}

// pkgs: [{ id, npm, local }]; opts.isNewer(local, remote) is installer.isNewerVersion.
async function checkAll(pkgs, { home, now = Date.now(), npmView: view = npmView, isNewer = (l, r) => l !== r } = {}) {
    const cache = readCache(home);
    const fresh = {};
    const rows = await Promise.all(pkgs.map(async (p) => {
        let remote = 'unknown';
        const hit = cache[p.npm];
        if (hit && now - hit.t < DAY) remote = hit.v;
        else {
            try {
                const v = await view(p.npm);
                if (v) { remote = v; fresh[p.npm] = { v, t: now }; }
            } catch { /* offline or registry down */ }
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
