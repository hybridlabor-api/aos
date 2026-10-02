'use strict';
// macOS-only opt-in install of BDB AO Codenotch from the public releases repo.
// Every side effect (network, hdiutil, xattr, plutil, copy, prompts, roots) is injectable.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// The list endpoint, not /releases/latest: the newest release may lack this platform's assets.
const RELEASES_URL = 'https://api.github.com/repos/hybridlabor-api/bdb-ao-codenotch/releases?per_page=30';
const stateFilePath = (home = os.homedir()) => path.join(home, '.agents', '.bdb-codenotch.json');

// 'off' wins over 'force'; otherwise macOS installs default on.
function codenotchMode(argv = process.argv, env = process.env) {
    if (argv.includes('--no-codenotch') || env.AOS_CODENOTCH === '0') return 'off';
    if (argv.includes('--codenotch') || env.AOS_CODENOTCH === '1') return 'force';
    return 'default';
}

function compareVersions(a, b) {
    const parts = (v) => String(v).replace(/^v/i, '').split(/[^0-9]+/).filter(Boolean).map(Number);
    const x = parts(a), y = parts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] || 0) - (y[i] || 0);
        if (d) return d < 0 ? -1 : 1;
    }
    return 0;
}

const run = (cmd) => (args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const defaultDeps = () => ({
    fetch: (...a) => fetch(...a),
    hdiutil: run('hdiutil'),
    xattr: run('xattr'),
    plutil: run('plutil'),
    copyApp: (src, dest) => execFileSync('ditto', [src, dest]),
    reg: run('reg'),
    runInstaller: (exe, args, timeoutMs) => runWinProgram(require('child_process').spawnSync, exe, args, timeoutMs),
});

function readPlist(plutil, appPath) {
    const plist = path.join(appPath, 'Contents', 'Info.plist');
    if (!fs.existsSync(plist)) return null;
    const get = (key) => {
        try { return String(plutil(['-extract', key, 'raw', '-o', '-', plist])).trim() || null; } catch { return null; }
    };
    const version = get('CFBundleShortVersionString');
    return version ? { version, bundleId: get('CFBundleIdentifier') } : null;
}

const readState = (file) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};

const isWritableDir = (dir) => {
    try { if (!fs.statSync(dir).isDirectory()) return false; fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; }
};

async function fetchLatestRelease(fetchFn, platform) {
    let res;
    try {
        res = await fetchFn(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'aos-installer' } });
    } catch (e) {
        return { error: `could not reach GitHub (${e.message}); try again later` };
    }
    if (res.status === 404) return { error: 'no public Codenotch release found yet (hybridlabor-api/bdb-ao-codenotch); try again later' };
    const remaining = res.headers && res.headers.get && res.headers.get('x-ratelimit-remaining');
    if (res.status === 429 || (res.status === 403 && remaining === '0')) return { error: 'GitHub API rate limit reached for unauthenticated requests; try again in about an hour' };
    if (!res.ok) return { error: `GitHub releases API answered HTTP ${res.status}` };
    const data = await res.json();
    const release = selectRelease(Array.isArray(data) ? data : [data], platform);
    return release ? { release } : { error: `no public Codenotch release found yet with a ${platform === 'win32' ? 'Windows Setup .exe' : '.dmg'} and a .sha256 asset; try again later` };
}

function pickMacAssets(assets) {
    const dmg = assets.find((a) => /\.dmg$/i.test(a.name));
    const sha = dmg && (assets.find((a) => a.name === `${dmg.name}.sha256`) || assets.find((a) => /\.sha256$/i.test(a.name)));
    return dmg && sha ? { dmg, sha } : null;
}

// First (newest) non-draft, non-prerelease release that carries this platform's asset and a checksum.
function selectRelease(releases, platform) {
    return releases.find((r) => {
        if (!r || r.draft || r.prerelease) return false;
        const tag = String(r.tag_name || '').replace(/^v/i, '');
        return tag && !(platform === 'win32' ? pickWinAssets(r.assets || [], tag).error : !pickMacAssets(r.assets || []));
    }) || null;
}

async function download(fetchFn, url) {
    const res = await fetchFn(url, { headers: { 'User-Agent': 'aos-installer' }, redirect: 'follow' });
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

function findInstalled(state, roots, plutil) {
    const candidates = [state && state.path, ...[roots.applications, roots.userApplications].map((r) => path.join(r, 'Codenotch.app'))].filter(Boolean);
    for (const appPath of candidates) {
        if (!fs.existsSync(appPath)) continue;
        const info = readPlist(plutil, appPath);
        const ours = !!(state && state.path === appPath && info && info.bundleId === state.bundleId && info.version === state.version);
        return { appPath, info, ours };
    }
    return null;
}

const UNINSTALL_ROOT = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
// UNVERIFIED: key name, DisplayVersion and UninstallString come from Tauri's stock NSIS template, not a real
// build; check on Windows with the first CI-built installer. The DisplayName scan is the fallback.
const NSIS_KEY = 'Codenotch';
const INSTALLER_TIMEOUT_MS = 5 * 60 * 1000;

function regValues(out) {
    const vals = {};
    for (const line of String(out).split(/\r?\n/)) {
        const m = line.match(/^\s+(\S+)\s+REG_\w+\s+(.*?)\s*$/);
        if (m) vals[m[1]] = m[2];
    }
    return vals;
}

function uninstallExeFrom(vals) {
    const cmd = vals.QuietUninstallString || vals.UninstallString || '';
    const m = cmd.match(/^\s*"([^"]+)"/) || cmd.match(/^\s*(.+?\.exe)/i);
    if (m) return m[1];
    return vals.InstallLocation ? path.win32.join(vals.InstallLocation, 'uninstall.exe') : null;
}

// Returns { version, uninstallPath } or null (not installed, key missing, or reg failing).
function readWinInstall(reg) {
    const read = (key) => { try { return regValues(reg(['query', key])); } catch { return null; } };
    let vals = read(`${UNINSTALL_ROOT}\\${NSIS_KEY}`);
    if (!vals || !vals.DisplayVersion) {
        vals = null;
        let listing = '';
        try { listing = reg(['query', UNINSTALL_ROOT]); } catch { return null; }
        for (const sub of String(listing).split(/\r?\n/).map((l) => l.trim()).filter((l) => /^HKEY_/i.test(l))) {
            const v = read(sub);
            if (v && /^codenotch$/i.test(v.DisplayName || '') && v.DisplayVersion) { vals = v; break; }
        }
    }
    return vals ? { version: vals.DisplayVersion, uninstallPath: uninstallExeFrom(vals) } : null;
}

function runWinProgram(spawnSyncFn, exe, args, timeoutMs) {
    const r = spawnSyncFn(exe, args, { timeout: timeoutMs, windowsHide: true, stdio: 'ignore' });
    if (r.error) throw new Error(r.error.code === 'ETIMEDOUT' ? `timed out after ${Math.round(timeoutMs / 1000)}s` : r.error.message);
    if (r.status !== 0) throw new Error(`exited with code ${r.status}`);
}

function pickWinAssets(assets, latest) {
    const exact = assets.find((a) => a.name === `Codenotch-Setup-${latest}.exe`);
    const exes = exact ? [exact] : assets.filter((a) => /Setup.*\.exe$/i.test(a.name));
    if (exes.length !== 1) return { error: exes.length ? 'latest release has several Setup .exe assets; cannot pick one' : 'latest release has no Windows Setup .exe asset' };
    const sha = assets.find((a) => a.name === `${exes[0].name}.sha256`);
    return sha ? { exe: exes[0], sha } : { error: 'latest release has no matching .sha256 asset; refusing to run an unverified installer' };
}

const WIN_START = 'Start menu > Codenotch (or %LOCALAPPDATA%\\Codenotch\\codenotch.exe)';
const macStart = (appPath) => `open -a "${path.basename(appPath, '.app')}"`;

async function installCodenotchWin(o, log) {
    const home = o.home || os.homedir();
    const tmp = (o.roots && o.roots.tmp) || os.tmpdir();
    const stateFile = o.stateFile || stateFilePath(home);
    const interactive = !!o.interactive;
    const confirm = o.confirm || (async () => false);
    const fail = (status, message) => { if (status !== 'not-found') log.warn(`Codenotch: ${message}`); return { status, message }; };

    const { release, error } = await fetchLatestRelease(o.fetch, 'win32');
    if (error) return fail(/rate limit/.test(error) ? 'rate-limited' : /no public/.test(error) ? 'not-found' : 'error', error);
    const latest = String(release.tag_name || '').replace(/^v/i, '');
    const picked = pickWinAssets(release.assets || [], latest);
    if (!latest || picked.error) return fail('error', picked.error || 'latest release has no tag');

    const state = readState(stateFile);
    const installed = readWinInstall(o.reg);
    let replacing = false;
    if (installed) {
        if (compareVersions(installed.version, latest) >= 0) {
            const message = `already installed (${installed.version})${installed.uninstallPath ? ` at ${installed.uninstallPath}` : ''}`;
            log.info(`Codenotch: ${message}`);
            return { status: 'up-to-date', message, start: WIN_START };
        }
        const ours = !!(state && state.platform === 'win32' && state.version === installed.version && state.uninstallPath === installed.uninstallPath);
        if (!ours && !interactive) {
            const message = `an existing Codenotch ${installed.version} was not installed by AOS; keeping it (latest ${latest})`;
            log.info(`Codenotch: ${message}`);
            return { status: 'kept-foreign', message };
        }
        if (interactive && !(await confirm(`Replace Codenotch ${installed.version} with ${latest}?`))) {
            return { status: 'declined', message: 'kept the installed Codenotch' };
        }
        replacing = true;
    }

    const work = fs.mkdtempSync(path.join(tmp, 'aos-codenotch-'));
    try {
        const buf = await download(o.fetch, picked.exe.browser_download_url);
        const expected = ((await download(o.fetch, picked.sha.browser_download_url)).toString('utf8').match(/[0-9a-f]{64}/i) || [])[0];
        if (!expected || expected.toLowerCase() !== crypto.createHash('sha256').update(buf).digest('hex')) {
            return fail('checksum-mismatch', `sha256 mismatch for ${picked.exe.name}; refusing to run it`);
        }
        const exePath = path.join(work, picked.exe.name);
        fs.writeFileSync(exePath, buf);

        try { o.runInstaller(exePath, ['/S'], o.timeoutMs || INSTALLER_TIMEOUT_MS); }
        catch (e) { return fail('error', `silent installer failed: ${e.message}`); }

        const after = readWinInstall(o.reg);
        if (!after || compareVersions(after.version, latest) < 0) return fail('error', `installer finished but the registry shows ${after ? after.version : 'no Codenotch'}; not recorded`);
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        fs.writeFileSync(stateFile, JSON.stringify({ platform: 'win32', uninstallPath: after.uninstallPath, version: after.version, installedAt: new Date().toISOString() }, null, 2));
        const message = `${replacing ? 'updated' : 'installed'} Codenotch ${after.version}${after.uninstallPath ? ` (uninstaller: ${after.uninstallPath})` : ''}`;
        log.success(`Codenotch: ${message}`);
        return { status: replacing ? 'updated' : 'installed', message, path: after.uninstallPath, version: after.version, start: WIN_START };
    } catch (e) {
        return fail('error', e.message);
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
}

// Returns { status, message }. Never throws, never elevates.
async function installCodenotch(opts = {}) {
    const o = { ...defaultDeps(), ...opts };
    const platform = o.platform || process.platform;
    const log = { info() {}, warn() {}, success() {}, ...(o.log || {}) };
    if (platform === 'win32') return installCodenotchWin(o, log);
    if (platform !== 'darwin') return { status: 'skipped-platform' };

    const home = o.home || os.homedir();
    const roots = { applications: '/Applications', userApplications: path.join(home, 'Applications'), tmp: os.tmpdir(), ...(o.roots || {}) };
    const stateFile = o.stateFile || stateFilePath(home);
    const interactive = !!o.interactive;
    const confirm = o.confirm || (async () => false);
    const fail = (status, message) => { if (status !== 'not-found') log.warn(`Codenotch: ${message}`); return { status, message }; };

    const { release, error } = await fetchLatestRelease(o.fetch, 'darwin');
    if (error) return fail(/rate limit/.test(error) ? 'rate-limited' : /no public/.test(error) ? 'not-found' : 'error', error);

    const latest = String(release.tag_name || '').replace(/^v/i, '');
    const { dmg, sha: shaAsset } = pickMacAssets(release.assets || []);

    const state = readState(stateFile);
    const installed = findInstalled(state, roots, o.plutil);
    let destDir = null, replacing = null;
    if (installed) {
        const cur = installed.info && installed.info.version;
        if (cur && compareVersions(cur, latest) >= 0) {
            const message = `already installed (${cur}) at ${installed.appPath}`;
            log.info(`Codenotch: ${message}`);
            return { status: 'up-to-date', message, start: macStart(installed.appPath) };
        }
        if (!installed.ours && !interactive) {
            const message = `${installed.appPath} was not installed by AOS; keeping it (installed ${cur || 'unknown version'}, latest ${latest})`;
            log.info(`Codenotch: ${message}`);
            return { status: 'kept-foreign', message };
        }
        if (interactive && !(await confirm(`Replace Codenotch ${cur || '(unknown version)'} at ${installed.appPath} with ${latest}?`))) {
            return { status: 'declined', message: 'kept the installed Codenotch' };
        }
        replacing = installed.appPath;
        destDir = path.dirname(replacing);
        if (!isWritableDir(destDir)) return fail('error', `${destDir} is not writable; update Codenotch manually`);
    }

    const work = fs.mkdtempSync(path.join(roots.tmp, 'aos-codenotch-'));
    const mountPoint = path.join(work, 'mnt');
    let mounted = false;
    try {
        const dmgBuf = await download(o.fetch, dmg.browser_download_url);
        const expected = ((await download(o.fetch, shaAsset.browser_download_url)).toString('utf8').match(/[0-9a-f]{64}/i) || [])[0];
        const actual = crypto.createHash('sha256').update(dmgBuf).digest('hex');
        if (!expected || expected.toLowerCase() !== actual) return fail('checksum-mismatch', `sha256 mismatch for ${dmg.name}; refusing to mount it`);
        const dmgPath = path.join(work, dmg.name);
        fs.writeFileSync(dmgPath, dmgBuf);

        fs.mkdirSync(mountPoint);
        o.hdiutil(['attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, dmgPath]);
        mounted = true;

        const apps = fs.readdirSync(mountPoint, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.endsWith('.app'));
        if (apps.length !== 1) return fail('error', `expected exactly one .app in the DMG, found ${apps.length}`);
        const appName = apps[0].name;
        const src = path.join(mountPoint, appName);

        let dest;
        if (replacing) dest = replacing;
        else {
            destDir = isWritableDir(roots.applications) ? roots.applications : roots.userApplications;
            fs.mkdirSync(destDir, { recursive: true });
            dest = path.join(destDir, appName);
            if (fs.existsSync(dest)) {
                const cur = readPlist(o.plutil, dest);
                if (!interactive || !(cur && compareVersions(cur.version, latest) < 0) || !(await confirm(`Replace ${dest} (not installed by AOS) with Codenotch ${latest}?`))) {
                    return { status: 'kept-foreign', message: `${dest} exists and was not installed by AOS; keeping it` };
                }
                replacing = dest;
            }
        }

        const backup = replacing ? `${dest}.aos-old` : null;
        if (backup) fs.renameSync(dest, backup);
        try {
            o.copyApp(src, dest);
            o.xattr(['-dr', 'com.apple.quarantine', dest]);
        } catch (e) {
            fs.rmSync(dest, { recursive: true, force: true });
            if (backup) fs.renameSync(backup, dest);
            throw e;
        }
        if (backup) fs.rmSync(backup, { recursive: true, force: true });

        const info = readPlist(o.plutil, dest) || { version: latest, bundleId: null };
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        fs.writeFileSync(stateFile, JSON.stringify({ path: dest, version: info.version, bundleId: info.bundleId, installedAt: new Date().toISOString() }, null, 2));
        const message = `${replacing ? 'updated' : 'installed'} Codenotch ${info.version} at ${dest} (ad-hoc signed; quarantine removed)`;
        log.success(`Codenotch: ${message}`);
        return { status: replacing ? 'updated' : 'installed', message, path: dest, version: info.version, start: macStart(dest) };
    } catch (e) {
        return fail('error', e.message);
    } finally {
        if (mounted) {
            try { o.hdiutil(['detach', mountPoint]); } catch {
                try { o.hdiutil(['detach', mountPoint, '-force']); } catch { /* leave to the OS */ }
            }
        }
        fs.rmSync(work, { recursive: true, force: true });
    }
}

// Pure planning for aos-uninstall: only the recorded install, only if still the recorded build.
function planCodenotchUninstall({ stateFile = stateFilePath(), plutil = run('plutil'), reg = run('reg'), exists = fs.existsSync } = {}) {
    const state = readState(stateFile);
    if (!state) return null;
    if (state.platform === 'win32') {
        if (!state.uninstallPath) return null;
        if (!exists(state.uninstallPath)) return { state, action: 'gone' };
        const cur = readWinInstall(reg);
        return { state, action: cur && cur.version === state.version && cur.uninstallPath === state.uninstallPath ? 'remove' : 'keep' };
    }
    if (!state.path) return null;
    if (!fs.existsSync(state.path)) return { state, action: 'gone' };
    const info = readPlist(plutil, state.path);
    const same = info && info.bundleId === state.bundleId && info.version === state.version;
    return { state, action: same ? 'remove' : 'keep' };
}

function uninstallCodenotch(plan, { stateFile = stateFilePath(), runUninstaller = (exe, args, t) => runWinProgram(require('child_process').spawnSync, exe, args, t) } = {}) {
    if (!plan) return 'none';
    if (plan.action === 'remove') {
        if (plan.state.platform === 'win32') {
            try { runUninstaller(plan.state.uninstallPath, ['/S'], INSTALLER_TIMEOUT_MS); } catch { return 'error'; }
        } else fs.rmSync(plan.state.path, { recursive: true, force: true });
    }
    if (plan.action !== 'keep') fs.rmSync(stateFile, { force: true });
    return plan.action;
}

// Never throws and never affects the caller's exit code. Returns a result or null (not run).
async function runCodenotchStep({ platform = process.platform, argv = process.argv, env = process.env, interactive, dryRun, ask, log = {}, install = installCodenotch, ...rest } = {}) {
    if (platform !== 'darwin' && platform !== 'win32') return null;
    try {
        const mode = codenotchMode(argv, env);
        if (mode === 'off') return { status: 'opted-out' };
        if (interactive && mode === 'default' && ask && !(await ask('Install BDB AO Codenotch? (SHA-256 verified)'))) return { status: 'declined' };
        if (dryRun) { if (log.info) log.info('[dry-run] would install BDB AO Codenotch'); return null; }
        return await install({ platform, interactive, confirm: ask && ((m) => ask(m, false)), log, ...rest });
    } catch (e) {
        if (log.warn) log.warn(`Codenotch: ${e.message}`);
        return { status: 'error', message: e.message };
    }
}

function codenotchSummaryLine(r) {
    if (!r || r.status === 'skipped-platform') return null;
    const how = (p) => `remove with aos-uninstall${p ? ` (app: ${p})` : ''}`;
    const hint = r.start ? `; not started automatically, start it with: ${r.start}` : '';
    switch (r.status) {
        case 'installed': case 'updated': return `Codenotch: ${r.status} ${r.version || ''} (${r.path}); ${how(r.path)}${hint}`.replace('  ', ' ');
        case 'up-to-date': case 'kept-foreign': return `Codenotch: skipped (${r.message}); ${how()}${hint}`;
        case 'opted-out': return 'Codenotch: skipped (opted out)';
        case 'declined': return 'Codenotch: skipped (declined)';
        case 'not-found': return 'Codenotch: no release available yet, skipped';
        default: return `Codenotch: FAILED (${r.message || r.status}); AOS install is unaffected, rerun later or use --no-codenotch to opt out`;
    }
}

module.exports = {
    RELEASES_URL, selectRelease, stateFilePath, readWinInstall, runWinProgram, uninstallExeFrom, codenotchMode, runCodenotchStep, codenotchSummaryLine, compareVersions, readPlist,
    installCodenotch, planCodenotchUninstall, uninstallCodenotch,
};
