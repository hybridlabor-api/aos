'use strict';
// AOS update check & opt-in auto update engine.
// Checks the npm registry for @hybridlabor-api/aos, caches results for 24 h,
// rate-limits notification surfaces to once per 24 h, and governs opt-in auto-update.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const DAY = 24 * 3600 * 1000;
const AOS_PKG = '@hybridlabor-api/aos';
const DEFAULT_TIMEOUT_MS = 3000;

const versionsCachePath = (home) => path.join(home || os.homedir(), '.aos', 'cache', 'versions.json');
const notificationsCachePath = (home) => path.join(home || os.homedir(), '.aos', 'cache', 'notifications.json');

function isNewerVersion(local, remote) {
    if (!local || !remote || local === remote) return false;
    const parse = (v) => {
        const dashIdx = v.indexOf('-');
        if (dashIdx === -1) return { main: v.split('.').map(Number), pre: null };
        const main = v.slice(0, dashIdx).split('.').map(Number);
        const pre = v.slice(dashIdx + 1).split('.').map((part) => {
            const num = Number(part);
            return isNaN(num) ? part : num;
        });
        return { main, pre };
    };

    const l = parse(local);
    const r = parse(remote);

    for (let i = 0; i < Math.max(l.main.length, r.main.length); i++) {
        const lv = l.main[i] || 0;
        const rv = r.main[i] || 0;
        if (rv > lv) return true;
        if (lv > rv) return false;
    }

    if (l.pre === null && r.pre !== null) return false;
    if (l.pre !== null && r.pre === null) return true;
    if (l.pre === null && r.pre === null) return false;

    for (let i = 0; i < Math.max(l.pre.length, r.pre.length); i++) {
        const lp = l.pre[i];
        const rp = r.pre[i];

        if (rp === undefined) return false;
        if (lp === undefined) return true;

        if (typeof lp === 'number' && typeof rp === 'number') {
            if (rp > lp) return true;
            if (lp > rp) return false;
        } else if (typeof lp === 'string' && typeof rp === 'string') {
            if (rp > lp) return true;
            if (lp > rp) return false;
        } else {
            if (typeof rp === 'number') return false;
            return true;
        }
    }
    return false;
}

function prereleaseChannel(version) {
    if (typeof version !== 'string' || !version.includes('-')) return null;
    const pre = version.slice(version.indexOf('-') + 1);
    const m = pre.match(/^([a-zA-Z]+)/);
    return m ? m[1].toLowerCase() : pre.split('.')[0].toLowerCase();
}

function isNewer(installed, latest) {
    if (!installed || !latest || latest === 'unknown' || installed === latest) return false;
    const installedChannel = prereleaseChannel(installed);
    const latestChannel = prereleaseChannel(latest);

    if (installedChannel !== null && latestChannel === null) {
        const installedBase = installed.slice(0, installed.indexOf('-'));
        if (!isNewerVersion(latest, installedBase)) return true;
    }

    // A prerelease only counts for installs on the same channel
    if (latestChannel !== null && installedChannel !== latestChannel) return false;
    return isNewerVersion(installed, latest);
}

function readVersionsCache(home) {
    try {
        return JSON.parse(fs.readFileSync(versionsCachePath(home), 'utf8'));
    } catch {
        return {};
    }
}

function writeVersionsCache(home, data) {
    try {
        const file = versionsCachePath(home);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data));
    } catch {
        // Cache is optional
    }
}

function readNotificationCache(home) {
    try {
        return JSON.parse(fs.readFileSync(notificationsCachePath(home), 'utf8'));
    } catch {
        return {};
    }
}

function writeNotificationCache(home, data) {
    try {
        const file = notificationsCachePath(home);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data));
    } catch {
        // Cache is optional
    }
}

function shouldCheckUpdates({ home, env = process.env } = {}) {
    if (env.AOS_NO_UPDATE_CHECK === '1') return false;
    if (home) {
        try {
            const { readSettings } = require('./v5/profile');
            const st = readSettings(home);
            if (st && st.updates === 'off') return false;
        } catch {
            // Profile reading optional
        }
    }
    return true;
}

function npmViewVersion(name, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const inv = require('./cli-spawn').invocation('npm', ['view', name, 'version']);
        execFile(inv.file, inv.args, {
            timeout: timeoutMs,
            encoding: 'utf8',
            windowsHide: true,
            ...inv.options,
        }, (err, out) => {
            if (err) return reject(err);
            resolve(String(out).trim());
        });
    });
}

async function fetchRegistryVersion(name, { timeoutMs = DEFAULT_TIMEOUT_MS, fetch: fetchFn = globalThis.fetch } = {}) {
    if (typeof fetchFn !== 'function') throw new Error('fetch not available');
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        const url = `https://registry.npmjs.org/${name}/latest`;
        const res = await fetchFn(url, {
            signal: controller ? controller.signal : undefined,
            headers: { accept: 'application/json' },
        });
        if (!res || !res.ok) throw new Error(`HTTP ${res?.status}`);
        const data = await res.json();
        return typeof data?.version === 'string' ? data.version : 'unknown';
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function latestAosVersion({ home = os.homedir(), now = Date.now(), fetch: customFetch, npmView: customNpmView, npmViewFallback = npmViewVersion, force = false } = {}) {
    if (!shouldCheckUpdates({ home })) return 'unknown';

    const cache = readVersionsCache(home);
    const hit = cache[AOS_PKG];
    if (!force && hit && typeof hit.v === 'string' && (now - hit.t < DAY)) {
        return hit.v;
    }

    let remote = 'unknown';
    try {
        if (customFetch) {
            remote = await fetchRegistryVersion(AOS_PKG, { fetch: customFetch });
        } else if (customNpmView) {
            remote = await customNpmView(AOS_PKG);
        } else {
            // fetch ignores proxy env and .npmrc registry; `npm view` honours both
            try {
                remote = await fetchRegistryVersion(AOS_PKG, { timeoutMs: DEFAULT_TIMEOUT_MS });
            } catch {
                remote = await npmViewFallback(AOS_PKG, DEFAULT_TIMEOUT_MS);
            }
        }
    } catch {
        // Offline or registry error
        remote = 'unknown';
    }

    if (remote && remote !== 'unknown') {
        writeVersionsCache(home, { ...cache, [AOS_PKG]: { v: remote, t: now } });
    }

    return remote || 'unknown';
}

function shouldNotifySurface(surface, { home, now = Date.now() } = {}) {
    if (!shouldCheckUpdates({ home })) return false;
    const cache = readNotificationCache(home);
    const last = cache[surface];
    if (typeof last === 'number' && (now - last < DAY)) return false;
    return true;
}

function recordNotificationSurface(surface, { home, now = Date.now() } = {}) {
    const cache = readNotificationCache(home);
    cache[surface] = now;
    writeNotificationCache(home, cache);
}

function formatNotification(installed, latest) {
    return `AOS ${latest} is available (you have ${installed}). Update: npx -y @hybridlabor-api/aos@latest`;
}

function notifySurface(surface, { home, installed, latest, now = Date.now(), out = console.log } = {}) {
    if (!isNewer(installed, latest)) return null;
    if (!shouldNotifySurface(surface, { home, now })) return null;
    const msg = formatNotification(installed, latest);
    recordNotificationSurface(surface, { home, now });
    if (typeof out === 'function') out(msg);
    return msg;
}

function detectInstalledVersion(home = os.homedir()) {
    try {
        const rootJsonPath = path.join(home, '.agents', 'lib', '.aos-package-root.json');
        const root = JSON.parse(fs.readFileSync(rootJsonPath, 'utf8'))?.packageRoot;
        if (root) {
            const p = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
            if (typeof p?.version === 'string') return p.version;
        }
    } catch {}
    try {
        const manifestPath = path.join(home, '.agents', '.bdb-manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (typeof manifest?.version === 'string') return manifest.version;
    } catch {}
    try {
        const installManifestPath = path.join(home, '.agents', '.bdb-install-manifest.json');
        const installManifest = JSON.parse(fs.readFileSync(installManifestPath, 'utf8'));
        if (typeof installManifest?.version === 'string') return installManifest.version;
    } catch {}
    try {
        const v = require('../package.json').version;
        if (typeof v === 'string') return v;
    } catch {}
    return null;
}

function getCachedUpdateInfo({ home = os.homedir(), installed, now = Date.now() } = {}) {
    if (!shouldCheckUpdates({ home })) return { updateAvailable: false, latest: null };
    const inst = installed || detectInstalledVersion(home);
    const cache = readVersionsCache(home);
    const hit = cache[AOS_PKG];
    if (hit && typeof hit.v === 'string') {
        const newer = isNewer(inst, hit.v);
        return { updateAvailable: newer, latest: hit.v, installed: inst };
    }
    return { updateAvailable: false, latest: null, installed: inst };
}

function cachedUpdateNotice({ home = os.homedir(), installed, now = Date.now() } = {}) {
    if (!shouldNotifySurface('session-start', { home, now })) return null;
    const info = getCachedUpdateInfo({ home, installed, now });
    if (!info.updateAvailable || !info.latest) return null;
    recordNotificationSurface('session-start', { home, now });
    return formatNotification(info.installed, info.latest);
}

function canAutoUpdate({
    home,
    now = Date.now(),
    env = process.env,
    stdout = process.stdout,
    stdin = process.stdin,
    installed,
    latest,
    isHook = false,
    isDaemon = false,
} = {}) {
    if (env.AOS_NO_UPDATE_CHECK === '1') return { allowed: false, reason: 'AOS_NO_UPDATE_CHECK is set' };
    if (isHook || env.AOS_INSIDE_HOOK === '1') return { allowed: false, reason: 'cannot auto-update inside hook' };
    if (isDaemon || env.AOS_BACKGROUND === '1' || env.AOS_HUB_SERVE === '1') return { allowed: false, reason: 'cannot auto-update inside background daemon' };
    if (env.CI) return { allowed: false, reason: 'CI environment detected' };
    if (!stdout || !stdout.isTTY || !stdin || !stdin.isTTY) return { allowed: false, reason: 'terminal is not interactive (TTY required; stdout or stdin is not a TTY)' };

    let st = {};
    if (home) {
        try {
            const { readSettings, DEFAULT_UPDATES } = require('./v5/profile');
            st = readSettings(home);
            if (!st.updates) st.updates = DEFAULT_UPDATES;
        } catch {
            st = {};
        }
    }

    if (st.updates !== 'auto') {
        const { DEFAULT_UPDATES = 'notify' } = (() => { try { return require('./v5/profile'); } catch { return {}; } })();
        return { allowed: false, reason: `updates policy is "${st.updates || DEFAULT_UPDATES}", not "auto"` };
    }

    if (!installed || !latest || latest === 'unknown') {
        return { allowed: false, reason: 'latest version unknown' };
    }
    if (prereleaseChannel(latest) !== null) {
        return { allowed: false, reason: 'latest version is a prerelease' };
    }
    if (!isNewer(installed, latest)) {
        return { allowed: false, reason: `installed version (${installed}) is not older than ${latest}` };
    }

    const lastAt = typeof st.lastAutoUpdate === 'number'
        ? st.lastAutoUpdate
        : (st.lastAutoUpdate && typeof st.lastAutoUpdate.t === 'number'
            ? st.lastAutoUpdate.t
            : (st.lastAutoUpdate && typeof st.lastAutoUpdate.t === 'string'
                ? Date.parse(st.lastAutoUpdate.t) || 0
                : (typeof st.lastAutoUpdate === 'string' ? Date.parse(st.lastAutoUpdate) || 0 : 0)));
    const lastResult = st.lastAutoUpdateResult || (st.lastAutoUpdate && st.lastAutoUpdate.result);

    if (lastAt && (now - lastAt < DAY)) {
        if (lastResult === 'failed') {
            const why = (st.lastAutoUpdate && st.lastAutoUpdate.error) || 'previous auto update failed';
            return {
                allowed: false,
                reason: `previous auto update attempt failed within 24 h (${why})`,
                failedFallback: true,
                error: why,
            };
        }
        return { allowed: false, reason: 'auto update was already attempted within 24 h' };
    }

    return { allowed: true, installed, latest };
}

function recordAutoUpdateResult(home, { success, error = null, now = Date.now(), latest = null } = {}) {
    if (!home) return;
    try {
        const { readSettings, writeSettings } = require('./v5/profile');
        const st = readSettings(home);
        st.lastAutoUpdate = {
            t: now,
            result: success ? 'ok' : 'failed',
            ...(error ? { error: String(error) } : {}),
            ...(latest ? { version: latest } : {}),
        };
        st.lastAutoUpdateResult = success ? 'ok' : 'failed';
        writeSettings(home, st);
    } catch {}
}

module.exports = {
    DAY,
    AOS_PKG,
    DEFAULT_TIMEOUT_MS,
    versionsCachePath,
    notificationsCachePath,
    isNewerVersion,
    prereleaseChannel,
    isNewer,
    shouldCheckUpdates,
    latestAosVersion,
    shouldNotifySurface,
    recordNotificationSurface,
    formatNotification,
    notifySurface,
    getCachedUpdateInfo,
    cachedUpdateNotice,
    detectInstalledVersion,
    canAutoUpdate,
    recordAutoUpdateResult,
};
