#!/usr/bin/env node

// Node compatibility guard -- must run before any require() that could pull
// in a dependency using the `node:` built-in scheme (@clack/prompts ->
// @clack/core does `require('node:process')` internally), which only
// resolves on Node >=14.18/>=16. On an older Node this crashed deep inside
// that dependency with a bare "Cannot find module 'node:process'" -- no
// mention of Node version anywhere -- reported from a real Windows machine
// where the installer couldn't even start. Uses only process.version, a
// built-in global with no require() of its own, so this check itself runs
// on any Node version ever shipped.
const NODE_MAJOR = parseInt(process.version.slice(1).split('.')[0], 10);
if (Number.isFinite(NODE_MAJOR) && NODE_MAJOR < 20) {
    console.error(`\nAOS requires Node.js 20 or newer -- this machine has ${process.version}.\nInstall a current Node.js from https://nodejs.org and re-run.\n`);
    process.exit(1);
}

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const net = require('net');
const readline = require('readline');
const util = require('util');
const crypto = require('crypto');

function verifyDaemonListening(port, name, timeoutMs = 4000) {
    return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const tryConnect = () => {
            const socket = net.createConnection({ port, host: "127.0.0.1" }, () => {
                socket.destroy();
                resolve(true);
            });
            socket.on("error", () => {
                socket.destroy();
                if (Date.now() < deadline) setTimeout(tryConnect, 300);
                else resolve(false);
            });
        };
        tryConnect();
    });
}
const { execSync, spawn, spawnSync, exec, execFileSync } = require('child_process');
const clack = require('@clack/prompts');

const {
    intro,
    outro,
    note,
    text,
    password,
    select,
    multiselect,
    confirm: askConfirm,
    spinner,
    isCancel,
    cancel,
    log
} = clack;

// Defensive alias: @clack/prompts provides log.success, not log.ok.
// Ensure any legacy or third-party call to log.ok safely routes to log.success.
if (log && typeof log === 'object' && !log.ok) {
    log.ok = log.success;
}

const {
    renderKineticIntro,
    buildHeroHeader,
    buildTelemetryCard
} = require('./lib/startup-ui.js');

const pkgPath = path.join(__dirname, 'package.json');
let pkg = { name: '@hybridlabor-api/aos', version: '4.0.0' };
if (fs.existsSync(pkgPath)) {
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch (e) { logDebug(e, 'operation'); }
}

const colors = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    cyan: "\x1b[36m",
    purple: "\x1b[38;2;157;78;221m",
    purpleBold: "\x1b[1;\x1b[38;2;157;78;221m",
    amethyst: "\x1b[38;2;155;89;182m",
    beige: "\x1b[38;2;222;202;168m",
    bannerWhite: "\x1b[38;2;255;255;255m",
    gold: "\x1b[38;2;212;175;55m",
    forge: "\x1b[38;2;255;99;33m",
    emerald: "\x1b[38;2;46;204;113m",
    blue: "\x1b[34m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    magenta: "\x1b[35m",
    dim: "\x1b[2m"
};

const DRY_RUN = process.argv.includes('--dry-run');
const PROJECT_HARNESS_ARG = process.argv.includes('--project-harness');
const isAutoYes = process.argv.includes('-y') || process.argv.includes('--yes') || !process.stdout.isTTY;
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');

const mcpsArgRaw = process.argv.find(a => a === '--mcps' || a.startsWith('--mcps='));
const mcpsArg = (mcpsArgRaw && mcpsArgRaw.startsWith('--mcps=')) ? mcpsArgRaw.slice('--mcps='.length) : null;
if (mcpsArgRaw && mcpsArg === null) {
    console.warn(`${colors.yellow} -> Ignoring '--mcps' without a value. Use --mcps=<name,name>, --mcps=all or --mcps=none.${colors.reset}`);
}

// --platforms=<n[,n]> picks install targets without the interactive menu. The
// menu was previously the ONLY way to choose, so a non-interactive run was
// locked to one hardcoded shape (Antigravity primary + universal MCP fan-out).
// That is wrong for a mixed team -- someone who only uses Claude Code could
// not express that in a script or CI, and got Antigravity as their primary
// target instead. Values match the menu: 0 universal, 1 Antigravity,
// 2 Claude Desktop/Code, 3 Cursor, 4 custom, 5 Codex, 6 Windsurf, 7 Roo/Cline,
// 8 Aider, 10 AOS CLI (9 = project harness has its own --project-harness flag).
const VALID_PLATFORMS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '10'];
const platformsArgRaw = process.argv.find(a => a === '--platforms' || a.startsWith('--platforms='));
let PLATFORMS_ARG = null;
if (platformsArgRaw) {
    const rawValue = platformsArgRaw.startsWith('--platforms=')
        ? platformsArgRaw.slice('--platforms='.length)
        : null;
    if (rawValue === null || rawValue.trim() === '') {
        console.warn(`${colors.yellow} -> Ignoring '--platforms' without a value. Use --platforms=<n[,n]>, e.g. --platforms=2 for Claude.${colors.reset}`);
    } else {
        const requested = rawValue.split(',').map(v => v.trim()).filter(Boolean);
        const unknown = requested.filter(v => !VALID_PLATFORMS.includes(v));
        if (unknown.length > 0) {
            // Refuse rather than silently installing somewhere unintended: an
            // unrecognised value would otherwise fall through resolveTargetPaths
            // to the Antigravity default.
            console.error(`${colors.red} -> Unknown --platforms value(s): ${unknown.join(', ')}. Valid: ${VALID_PLATFORMS.join(', ')} (4 = custom paths needs the interactive menu).${colors.reset}`);
            process.exit(1);
        }
        if (requested.includes('4')) {
            console.error(`${colors.red} -> --platforms=4 (Custom Paths) needs the interactive menu; it has no non-interactive form.${colors.reset}`);
            process.exit(1);
        }
        PLATFORMS_ARG = requested;
    }
}

if (DRY_RUN) {
    const guardedFns = ['writeFileSync', 'mkdirSync', 'copyFileSync', 'renameSync', 'unlinkSync', 'symlinkSync', 'appendFileSync', 'chmodSync', 'rmdirSync', 'rmSync'];
    for (const fn of guardedFns) {
        const original = fs[fn];
        fs[fn] = (...args) => {
            log.message(`[dry-run] ${fn}: ${args[0]}`);
            return undefined;
        };
    }
}

function pick(value) {
    if (isCancel(value)) {
        cancel('Installation aborted.');
        process.exit(0);
    }
    return value;
}

function logDebug(err, context) {
    if (!VERBOSE) return;
    const msg = err && err.message ? err.message : String(err);
    try {
        log.message(`[debug] ${context}: ${msg}`);
    } catch (e) {
        console.log(`[debug] ${context}: ${msg}`);
    }
}

const BACK = Symbol('back');

function withBack(options) {
    return [...options, { value: BACK, label: '← Back', hint: 'one step back' }];
}

async function selectWithBack(config) {
    const value = pick(await select({ ...config, options: withBack(config.options) }));
    return value === BACK ? BACK : value;
}

async function multiselectWithBack(config) {
    while (true) {
        const res = pick(await multiselect({
            ...config,
            options: [...config.options, { value: '__BACK__', label: '← Back', hint: 'toggle & confirm to go one step back' }],
            required: false
        }));
        if (res.includes('__BACK__')) return BACK;
        if (!config.allowEmpty && res.length === 0) {
            log.warn('Select at least one entry (or choose ← Back).');
            continue;
        }
        return res;
    }
}

async function textWithBack(config) {
    const v = pick(await text(config));
    if ((v || '').trim() === '<') return BACK;
    return v;
}

async function passwordWithBack(config) {
    const v = pick(await password(config));
    if ((v || '') === '<') return BACK;
    return v;
}

const unsupportedMcpDirs = [
    'adobe_mcp',
    'davinci-mcp-professional',
    'davinci-resolve-mcp',
    'vectorworks-mcp',
    'blender-mcp-server'
];

const unsupportedMcpConfigKeys = [
    'adobe_mcp',
    'bdb_davinci_mcp_fallback',
    'bdb_davinci_mcp_studio',
    'bdb_vectorworks_mcp',
    'bdb_blender_mcp_fallback'
];

const conditionalMcpConfigKeys = [
    { key: 'bdb_after_effects_mcp_fallback', requires: 'go', hint: 'https://go.dev/dl/' }
];

function hasExecutable(binary) {
    try {
        if (process.platform === 'win32') {
            execFileSync('where.exe', [binary], { stdio: 'ignore' });
        } else {
            if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(binary)) return false;
            execSync(`command -v ${binary}`, { stdio: 'ignore' });
        }
        return true;
    } catch (e) {
        return false;
    }
}

// Windows installers launched from an existing terminal can inherit a stale
// PATH after Go was installed through winget or the official installer. The
// Synapse JS launcher shells out to Go on first run, so discover the standard
// install locations as well as PATH and persist the resolved bin directory in
// the generated startup wrapper.
function findWindowsGoBin() {
    if (process.platform !== 'win32') return null;
    const candidates = [];
    try {
        const found = execFileSync('where.exe', ['go'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
            .split(/\r?\n/).map(s => s.trim()).find(Boolean);
        if (found) candidates.push(path.dirname(found));
    } catch (_) { /* PATH can be stale immediately after installation */ }

    const roots = [
        process.env.GOROOT,
        process.env.ProgramW6432,
        process.env.ProgramFiles,
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : null,
    ].filter(Boolean);
    for (const root of roots) {
        candidates.push(path.join(root, 'Go', 'bin'));
        candidates.push(path.join(root, 'go', 'bin'));
    }
    return candidates.find(dir => fs.existsSync(path.join(dir, 'go.exe'))) || null;
}

function verifyPythonImports(pythonPath, cwd, importCode) {
    const result = spawnSync(pythonPath, ['-c', importCode], {
        cwd,
        stdio: 'ignore',
        timeout: 30000,
    });
    return !result.error && result.status === 0;
}

function resolveUnsupportedMcpConfigKeys() {
    const keys = unsupportedMcpConfigKeys.slice();
    conditionalMcpConfigKeys.forEach(entry => {
        if (hasExecutable(entry.requires)) return;
        log.warn(`Skipping MCP '${entry.key}': '${entry.requires}' not on PATH (${entry.hint})`);
        keys.push(entry.key);
    });
    return keys;
}

function readTextFile(filePath) {
    const buf = fs.readFileSync(filePath);
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return buf.toString('utf16le', 2);
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.toString('utf8', 3);
    return buf.toString('utf8');
}

function describeJsonParseError(filePath) {
    try {
        JSON.parse(readTextFile(filePath));
        return '';
    } catch (e) {
        return e.message;
    }
}

function readJsoncFile(filePath) {
    if (!fs.existsSync(filePath)) return null;
    let raw = fs.readFileSync(filePath, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    raw = raw.replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        .replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(raw); } catch (e) { return null; }
}

function readJsonFile(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(readTextFile(filePath));
    } catch (e) {
        try {
            return readJsoncFile(filePath);
        } catch (e2) {
            return null;
        }
    }
}

function isNewerVersion(local, remote) {
    const parse = (v) => {
        const dashIdx = v.indexOf('-');
        if (dashIdx === -1) return { main: v.split('.').map(Number), pre: null };
        const main = v.slice(0, dashIdx).split('.').map(Number);
        const pre = v.slice(dashIdx + 1).split('.').map(part => {
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

function checkForUpdates() {
    return new Promise((resolve) => {
        const req = https.get(`https://registry.npmjs.org/${pkg.name}/latest`, { timeout: 1500 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const latest = JSON.parse(data).version;
                    resolve(latest && isNewerVersion(pkg.version, latest) ? latest : null);
                } catch (e) {
                    resolve(null);
                }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

function cleanNpmCacheOnWindows() {
    if (process.platform !== 'win32' || DRY_RUN) return;
    try {
        execSync('npm cache clean --force', { stdio: 'ignore' });
    } catch (e) { logDebug(e, 'operation'); }
}

function tailOutput(e, maxLines = 12) {
    const raw = (e && (e.stderr || e.stdout) ? e.stderr || e.stdout : '').toString().trim();
    if (!raw) return '';
    const lines = raw.split(/\r?\n/).slice(-maxLines);
    return lines.map(l => `     ${l}`).join('\n');
}

function runNpmWithRetry(cmd, opts, label, attempts = 3) {
    if (DRY_RUN) {
        log.step(`[dry-run] would run: ${cmd}`);
        return true;
    }
    for (let i = 1; i <= attempts; i++) {
        try {
            execSync(cmd, { ...opts, stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 });
            return true;
        } catch (e) {
            if (i === attempts) {
                const firstLine = (e.message || '').split('\n')[0];
                log.warn(`Failed to ${label}.`);
                if (firstLine) log.warn(`└─ ${firstLine}`);
                const tail = tailOutput(e);
                if (tail) log.warn(`└─ Last output:\n${tail}`);
                if (opts && opts.cwd) log.warn(`└─ Re-run manually: cd "${opts.cwd}" && ${cmd}`);
                return false;
            }
            const waitMs = 1000 * i;
            log.warn(`${label} failed (attempt ${i}/${attempts}), retrying in ${waitMs / 1000}s...`);
            execSync(process.platform === 'win32' ? `powershell -NoProfile -Command "Start-Sleep -Seconds ${waitMs / 1000}"` : `sleep ${waitMs / 1000}`, { stdio: 'ignore' });
        }
    }
    return false;
}

function runPipWithRetry(cmd, opts, label, attempts = 2, timeoutMs = 900000) {
    if (DRY_RUN) {
        log.step(`[dry-run] would run: ${cmd}`);
        return true;
    }
    for (let i = 1; i <= attempts; i++) {
        try {
            execSync(cmd, { ...opts, timeout: timeoutMs });
            return true;
        } catch (e) {
            if (i === attempts) {
                log.warn(`Failed to ${label}: ${e.message}`);
                return false;
            }
            const waitMs = 1000 * i;
            log.warn(`${label} failed (attempt ${i}/${attempts}), retrying in ${waitMs / 1000}s...`);
            execSync(process.platform === 'win32' ? `powershell -NoProfile -Command "Start-Sleep -Seconds ${waitMs / 1000}"` : `sleep ${waitMs / 1000}`, { stdio: 'ignore' });
        }
    }
    return false;
}

const homeDir = os.homedir();
const currentDir = process.cwd();
const scriptDir = __dirname;

let srcDir = scriptDir;
if (!fs.existsSync(path.join(srcDir, 'skills')) && fs.existsSync(path.join(srcDir, '..', 'skills'))) {
    srcDir = path.join(scriptDir, '..');
} else if (!fs.existsSync(path.join(srcDir, 'skills'))) {
    console.error("Error: Cannot find skills payload directory.");
    process.exit(1);
}

const geminiDir = path.join(homeDir, '.gemini');
const globalConfigDir = path.join(geminiDir, 'config', 'skills');
const globalLegacyDir = path.join(geminiDir, 'skills');
const workspaceDir = path.join(currentDir, '.agents', 'skills');

const now = new Date();
const timestamp = now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0') + "_" +
    now.getHours().toString().padStart(2, '0') +
    now.getMinutes().toString().padStart(2, '0') +
    now.getSeconds().toString().padStart(2, '0');

const backupDir = path.join(geminiDir, `skills_backup_${timestamp}`);

const CORE_MCP = 'memb-mcp';

// ─── Install-Manifest Store ──────────────────────────────────────────────────
// Tracks every file this installer places. Stored at
// ~/.agents/.bdb-install-manifest.json with one entry per file:
//   { path, sha256, version, installedAt }
// Ground-truth hash = hash of the SOURCE file being copied (computed fresh
// each run from the actual bytes in this repo/package).  The on-disk hash is
// compared against: (a) the SOURCE hash (unmodified) and (b) the MANIFEST
// hash (last-installed value).  This gives us three cases:
//   ours + unmodified  → source_hash == disk_hash          → overwrite + update manifest
//   ours + user-edited → manifest_hash == source_hash,
//                        but disk_hash != source_hash       → .bak + warn + write
//   foreign            → no manifest record AND disk_hash
//                        not in any known source hash       → skip + warn

function getInstallManifestPath() {
    return path.join(os.homedir(), '.agents', '.bdb-install-manifest.json');
}
const INSTALL_MANIFEST_PATH = getInstallManifestPath();

function computeFileHash(filePath) {
    try {
        const buf = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(buf).digest('hex');
    } catch (e) {
        return null;
    }
}

function loadInstallManifest(customPath = null) {
    const manifestPath = customPath || getInstallManifestPath();
    try {
        if (fs.existsSync(manifestPath)) {
            return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        }
    } catch (e) { /* ignore parse errors – treat as empty */ }
    return {};
}

function saveInstallManifest(manifest, customPath = null) {
    if (DRY_RUN) return;
    const manifestPath = customPath || getInstallManifestPath();
    try {
        fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    } catch (e) {
        log.warn(`Could not write install manifest: ${e.message}`);
    }
}

// Adopt an already-present file into the manifest (first-run bootstrap):
// called when disk-hash == source-hash but there is no manifest entry yet.
function adoptFileIntoManifest(manifest, targetPath, sourceHash) {
    manifest[targetPath] = {
        path: targetPath,
        sha256: sourceHash,
        version: pkg.version,
        installedAt: new Date().toISOString()
    };
}

// Manifest-aware file writer implementing the three-way conflict policy.
// Returns 'wrote' | 'bak' | 'skipped'.
// knownSourceHashes: Set of sha256 hashes of all source files in the current
// payload (used to identify files we recognise even before manifest entry).
function resolveFileConflict(sourcePath, targetPath, manifest, knownSourceHashes) {
    const sourceHash = computeFileHash(sourcePath);
    if (!sourceHash) {
        // Every other branch of this function reports what it did; this one
        // used to return silently, so a file that failed to install left no
        // trace behind the enclosing "Synced BDB skills" success line.
        log.warn(`[manifest] Could not read ${sourcePath} from the payload — ${path.basename(targetPath)} not installed.`);
        return 'skipped';
    }

    const manifestEntry = manifest[targetPath];
    const diskExists = fs.existsSync(targetPath);

    if (!diskExists) {
        // Fresh install – write and record.
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(sourcePath, targetPath);
        manifest[targetPath] = { path: targetPath, sha256: sourceHash, version: pkg.version, installedAt: new Date().toISOString() };
        return 'wrote';
    }

    const diskHash = computeFileHash(targetPath);

    // Case: unrecognised content at a path this payload owns.
    //
    // This used to skip, on the reading that unknown content means a file the
    // installer did not place. But resolveFileConflict only ever sees paths the
    // payload is actively writing, so the path IS ours -- and the commonest
    // cause of unknown content is simply an older release of our own file,
    // installed before manifest tracking existed and therefore never adopted.
    // Skipping froze those permanently: v4.4.0 still found skills on disk
    // carrying pre-reorg ~/bdb-dev paths and a stale `category:`, untouched
    // across every update since, because bootstrap adoption only catches a file
    // that is byte-identical to the current payload.
    //
    // So update it, and keep the protection where it belongs -- in the backup,
    // not in refusing to write. A genuine local edit is recoverable from .bak
    // rather than silently outvoting the shipped version forever.
    if (!manifestEntry && !knownSourceHashes.has(diskHash)) {
        const bakPath = `${targetPath}.${timestamp}.bak`;
        try { fs.copyFileSync(targetPath, bakPath); } catch (e) {
            log.warn(`[manifest] Could not create backup ${bakPath}: ${e.message}`);
        }
        fs.copyFileSync(sourcePath, targetPath);
        manifest[targetPath] = { path: targetPath, sha256: sourceHash, version: pkg.version, installedAt: new Date().toISOString() };
        log.warn(`[manifest] Unrecognised ${path.basename(targetPath)} backed up to ${bakPath}, shipped version written.`);
        return 'bak';
    }

    // Case: first-run bootstrap – disk hash matches source hash but no manifest entry.
    if (!manifestEntry && diskHash === sourceHash) {
        adoptFileIntoManifest(manifest, targetPath, sourceHash);
        // File is already identical – no need to copy again, but update manifest.
        return 'wrote';
    }

    // Case: ours + unmodified on disk (disk == source).
    if (diskHash === sourceHash) {
        manifest[targetPath] = { path: targetPath, sha256: sourceHash, version: pkg.version, installedAt: new Date().toISOString() };
        return 'wrote';
    }

    // Case: ours + user-edited (manifest recorded our hash, but disk now differs).
    if (manifestEntry && diskHash !== manifestEntry.sha256) {
        const bakPath = `${targetPath}.${timestamp}.bak`;
        try { fs.copyFileSync(targetPath, bakPath); } catch (e) {
            log.warn(`[manifest] Could not create backup ${bakPath}: ${e.message}`);
        }
        fs.copyFileSync(sourcePath, targetPath);
        manifest[targetPath] = { path: targetPath, sha256: sourceHash, version: pkg.version, installedAt: new Date().toISOString() };
        log.warn(`[manifest] User-edited file backed up to ${bakPath}, new version written.`);
        return 'bak';
    }

    // Default: manifest entry present, disk matches manifest (no change needed) – overwrite.
    fs.copyFileSync(sourcePath, targetPath);
    manifest[targetPath] = { path: targetPath, sha256: sourceHash, version: pkg.version, installedAt: new Date().toISOString() };
    return 'wrote';
}

// Build a Set of all sha256 hashes for files under a source directory tree.
// Used as the "known shipped hashes" set so we can bootstrap-adopt files that
// were placed by a prior install that pre-dates the manifest.
function buildKnownSourceHashes(sourceDirs) {
    const hashes = new Set();
    const walk = (dir) => {
        let stat;
        try {
            stat = fs.lstatSync(dir);
        } catch {
            return; // doesn't exist
        }
        if (!stat.isDirectory()) return; // symlink-to-file or plain file passed in; nothing to scan
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile()) {
                const h = computeFileHash(full);
                if (h) hashes.add(h);
            }
        }
    };
    for (const d of sourceDirs) walk(d);
    return hashes;
}
// ─── End Install-Manifest Store ──────────────────────────────────────────────

// Session-level state: set once at install time, consumed by copyDirRecursiveSync.
// null = manifest-tracking disabled (project harness, test scaffolds, etc.)
let _sessionManifest = null;
let _sessionHashes = null;

function initSessionManifest(existingManifest, sourceDirs) {
    _sessionManifest = existingManifest || {};
    _sessionHashes = buildKnownSourceHashes(sourceDirs);
}

// Skills that left the package in 4.4.2 (Plan 02: migrated to the private
// aos-internal repo, per ~/dev/_plans/aos-2026-09-14/), by their flattened
// directory name at a sync destination.
//
// This is deliberately a fixed list, not a diff against what the current
// payload ships. A generic "anything on disk that is not in skills/ right
// now" pass was tried first and swept up two unrelated things: skill folders
// that MCP servers bundle inside their own package tree (e.g.
// mcps/tdmcp/.agents/skills/...), which happen to share the literal path
// segment "skills" but belong to a different install entirely; and skills
// under skills/workspace_agents/, which syncSkillsToGlobalHarnesses already
// deliberately excludes from the six global destinations, so a stray global
// copy of one says nothing about whether it is safe to delete. Both are real
// cleanup opportunities, but they are a separate investigation, not a side
// effect of this migration's beta test.
const SKILLS_REMOVED_IN_4_4_2 = new Set([
    'bdbsaastraining', 'bdb-dev-os-skill', 'bdbsaashost', 'bdb-ecosystem-health', 'bdbsaas-ops',
]);

// The exact roots syncSkillsToGlobalHarnesses and the Gemini/Antigravity
// config-skills path write into. Pruning only touches a manifest entry whose
// path starts under one of these -- never one that merely contains a
// "skills" segment somewhere deeper, which is what let the MCP-bundle and
// workspace_agents cases above leak in during testing.
function globalSkillDestRoots() {
    return [
        path.join(homeDir, '.agents', 'skills'),
        path.join(homeDir, '.claude', 'skills'),
        path.join(homeDir, '.codex', 'skills'),
        path.join(homeDir, '.cursor', 'skills'),
        path.join(homeDir, '.roo', 'skills'),
        path.join(geminiDir, 'config', 'skills'),
    ];
}

// syncSkillsToGlobalHarnesses (and its sibling copy loops) only ever add or
// update -- nothing in that path ever deletes a skill that the current
// payload no longer ships. That is fine for new skills and updated ones, but
// it means a skill removed from a release stays on every user's disk
// forever, through every future update, because nothing after the removal
// ever looks at what is on disk that no longer has a source. This walks the
// install manifest -- which already has one entry per file this installer
// has ever placed -- for the specific skills 4.4.2 removed, under the six
// known global skill roots, and deletes them. A user-modified file is backed
// up first, the same way resolveFileConflict backs up a user edit it is
// about to overwrite, rather than silently deleting local changes.
function pruneRemovedSkills(manifest) {
    if (!manifest) return;
    const roots = globalSkillDestRoots();

    const staleDirs = new Set();
    let removedFiles = 0;
    for (const targetPath of Object.keys(manifest)) {
        const root = roots.find((r) => targetPath.startsWith(r + path.sep));
        if (!root) continue;
        const skillDirName = targetPath.slice(root.length + 1).split(path.sep)[0];
        if (!SKILLS_REMOVED_IN_4_4_2.has(skillDirName)) continue;

        if (fs.existsSync(targetPath)) {
            const diskHash = computeFileHash(targetPath);
            const manifestEntry = manifest[targetPath];
            if (diskHash !== null && manifestEntry && diskHash !== manifestEntry.sha256) {
                const bakPath = `${targetPath}.${timestamp}.bak`;
                try { fs.copyFileSync(targetPath, bakPath); } catch (e) { logDebug(e, 'prune-removed-skill backup'); }
                log.warn(`[manifest] Retired skill left a user-edited file, backed up to ${bakPath} instead of deleting it.`);
            } else {
                try { fs.unlinkSync(targetPath); removedFiles++; } catch (e) { logDebug(e, 'prune-removed-skill unlink'); }
            }
            staleDirs.add(path.join(root, skillDirName));
        }
        delete manifest[targetPath];
    }

    for (const dir of staleDirs) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { logDebug(e, 'prune-removed-skill rmdir'); }
    }

    if (staleDirs.size > 0) {
        log.step(`Removed ${removedFiles} file(s) from ${staleDirs.size} retired skill install(s) no longer shipped.`);
    }
}

function flushSessionManifest() {
    if (_sessionManifest) saveInstallManifest(_sessionManifest);
}

// skills/global_legacy/ has not existed in the shipped payload for a long
// time -- the three `if (dir === 'global_legacy')` copy branches elsewhere in
// this file have been dead code ever since, since that name never appears in
// a fresh fs.readdirSync(skillsBase). Nothing populates a fresh
// targetLegacyDir any more, but nothing ever removed an OLD one either: a
// real Windows install this session still had 126 stale legacy skill copies
// sitting in .codex/skills/legacy, indexed alongside the current top-level
// copies of the same skills by the harness's own skill picker -- the
// "duplicate skills" a live test reported. Since the source category is
// permanently gone, an existing legacy dir is unconditionally obsolete, not
// merely unmanaged: retire it instead of recreating an eternally-empty
// placeholder for it.
function retireObsoleteLegacyDir(targetLegacyDir) {
    if (!targetLegacyDir || !fs.existsSync(targetLegacyDir)) return;
    if (fs.existsSync(path.join(srcDir, 'skills', 'global_legacy'))) {
        fs.mkdirSync(targetLegacyDir, { recursive: true });
        return;
    }
    try {
        fs.rmSync(targetLegacyDir, { recursive: true, force: true });
        log.step(`Removed retired legacy skill copies at ${targetLegacyDir} (global_legacy has not shipped in a long time).`);
    } catch (e) {
        logDebug(e, 'retire legacy dir');
    }
}

function resolveMcpsArg(availableMcps) {
    const requested = mcpsArg.split(',').map(s => s.trim()).filter(Boolean);
    const wantsNone = requested.some(r => ['none', 'core', 'core-only'].includes(r.toLowerCase()));
    const wantsAll = requested.some(r => r.toLowerCase() === 'all');

    if (wantsAll && !wantsNone) return availableMcps;

    const matched = [];
    const unknown = [];
    if (!wantsNone) {
        requested.forEach(name => {
            const hit = availableMcps.find(m => m.toLowerCase() === name.toLowerCase());
            if (hit) {
                if (!matched.includes(hit)) matched.push(hit);
            } else if (!['all', 'none', 'core', 'core-only'].includes(name.toLowerCase())) {
                unknown.push(name);
            }
        });
    }

    if (unknown.length > 0) {
        log.warn(`Unknown MCP name(s) in --mcps: ${unknown.join(', ')}`);
        log.warn(`Available for this tier: ${availableMcps.join(', ') || '(none)'}`);
    }

    if (availableMcps.includes(CORE_MCP) && !matched.includes(CORE_MCP)) matched.unshift(CORE_MCP);

    log.info(`--mcps selection: ${matched.join(', ') || '(none)'}`);
    return matched;
}

// Platforms the user explicitly asked for, by detection key. A harness the
// user names is installed as far as we are concerned, whether or not we can
// find its binary -- they know their machine better than a PATH lookup does.
const explicitPlatformKeys = new Set();
const PLATFORM_KEYS_BY_OPTION = {
    '1': 'antigravity',
    '2': ['claudecode', 'claudedesktop'],
    '3': 'cursor',
    '5': 'codex',
    '6': 'windsurf',
    '7': 'vscode',
    '8': 'aider',
};

function markPlatformsExplicit(optionValues) {
    for (const v of optionValues || []) {
        const keys = PLATFORM_KEYS_BY_OPTION[v];
        if (!keys) continue;
        for (const k of [].concat(keys)) explicitPlatformKeys.add(k);
    }
}

// Where an application itself lives, per OS. Presence of the app is proof;
// presence of a dot-directory is not.
function appBundle(name) {
    if (process.platform === 'darwin') return [`/Applications/${name}.app`, path.join(homeDir, 'Applications', `${name}.app`)];
    if (process.platform === 'win32') return [path.join(process.env.LOCALAPPDATA || homeDir, 'Programs', name)];
    return [`/usr/share/${name.toLowerCase()}`, `/opt/${name.toLowerCase()}`];
}

const anyExists = (paths) => paths.some((p) => fs.existsSync(p));
const globExists = (dir, re) => {
    try { return fs.readdirSync(dir).some((e) => re.test(e)); } catch { return false; }
};

// Detect installed agent harnesses.
//
// This used to test for a config *directory* and nothing else, which was
// circular: syncSkillsToGlobalHarnesses() creates ~/.claude, ~/.codex,
// ~/.cursor and ~/.roo unconditionally, so after one install the detector
// found evidence the installer had planted itself. A machine with neither
// Cursor nor VS Code nor Aider still reported all three, and skills were
// written into directories nothing would ever read.
//
// Evidence now means the application itself and nothing else: a binary on
// PATH, an installed app bundle, or an editor extension. Config files are
// deliberately NOT evidence -- the installer writes ~/.claude.json,
// ~/.cursor/mcp.json, ~/.roo/mcp_settings.json and the rest of them, so
// trusting those reintroduces the same circularity one level down. (Written
// after exactly that: an early cut of this fix still "found" Cursor and
// Windsurf on a machine with neither, via files AOS had planted.)
// The user's explicit choice counts too -- see markPlatformsExplicit().
function detectPlatforms() {
    const candidates = [
        {
            key: 'antigravity', name: 'Google Antigravity', path: geminiDir,
            evidence: () => hasExecutable('agy') || anyExists(appBundle('Antigravity')),
        },
        {
            key: 'codex', name: 'ChatGPT Codex CLI', path: path.join(homeDir, '.codex'),
            // Codex ships two ways: the standalone CLI binary, and embedded in
            // the ChatGPT desktop app. A machine can have either without the
            // other (e.g. ChatGPT desktop only, codex never put on PATH).
            evidence: () => hasExecutable('codex') || anyExists(appBundle('ChatGPT')),
        },
        {
            key: 'claudecode', name: 'Claude Code CLI', path: path.join(homeDir, '.claude'),
            evidence: () => hasExecutable('claude'),
        },
        {
            key: 'claudedesktop', name: 'Claude Desktop',
            path: process.platform === 'win32'
                ? path.join(process.env.APPDATA || homeDir, 'Claude')
                : path.join(homeDir, 'Library', 'Application Support', 'Claude'),
            evidence: () => anyExists(appBundle('Claude')),
        },
        {
            key: 'cursor', name: 'Cursor IDE',
            path: process.platform === 'win32'
                ? path.join(process.env.APPDATA || homeDir, 'Cursor')
                : path.join(homeDir, 'Library', 'Application Support', 'Cursor'),
            evidence: () => anyExists(appBundle('Cursor')) || hasExecutable('cursor'),
        },
        {
            key: 'windsurf', name: 'Windsurf IDE',
            path: process.platform === 'win32'
                ? path.join(process.env.APPDATA || homeDir, 'Windsurf')
                : path.join(homeDir, 'Library', 'Application Support', 'Windsurf'),
            evidence: () => anyExists(appBundle('Windsurf')) || hasExecutable('windsurf'),
        },
        {
            key: 'vscode', name: 'Roo Code / Cline / VS Code',
            path: process.platform === 'win32'
                ? path.join(process.env.APPDATA || homeDir, 'Code')
                : path.join(homeDir, 'Library', 'Application Support', 'Code'),
            evidence: () => anyExists(appBundle('Visual Studio Code'))
                || hasExecutable('code')
                || globExists(path.join(homeDir, '.vscode', 'extensions'), /roo|cline/i),
        },
        {
            key: 'aider', name: 'Aider CLI', path: homeDir,
            evidence: () => hasExecutable('aider'),
        },
        {
            key: 'opencode', name: 'OpenCode CLI',
            path: process.platform === 'win32'
                ? path.join(process.env.APPDATA || homeDir, 'opencode')
                : path.join(homeDir, '.config', 'opencode'),
            evidence: () => hasExecutable('opencode'),
        },
    ];

    const detections = [];
    for (const c of candidates) {
        let present = false;
        try { present = c.evidence(); } catch (e) { logDebug(e, `detect ${c.key}`); }
        if (present || explicitPlatformKeys.has(c.key)) {
            detections.push({ name: c.name, path: c.path, key: c.key, chosen: !present });
        }
    }
    return detections;
}

function detectInstallState() {
    const manifestPath = path.join(homeDir, '.agents', '.bdb-manifest.json');
    let isInstalled = false;
    let localVersion = null;
    let manifest = null;
    let installedModules = [];

    if (fs.existsSync(manifestPath)) {
        try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (manifest && manifest.version) {
                isInstalled = true;
                localVersion = manifest.version;
                installedModules = manifest.installedModules || [];
            }
        } catch (e) { logDebug(e, 'operation'); }
    }

    const legacyMarkers = [
        path.join(homeDir, '.agents', 'AGENTS.md'),
        path.join(geminiDir, 'config', 'skills', 'startcycle', 'SKILL.md'),
        path.join(homeDir, '.agents', 'skills', 'startcycle', 'SKILL.md'),
        path.join(homeDir, '.claude', 'skills', 'startcycle', 'SKILL.md')
    ];

    if (!isInstalled && legacyMarkers.some(p => fs.existsSync(p))) {
        isInstalled = true;
        const candidatePkgs = [
            path.join(homeDir, '.agents', 'bdb-dev-optimized-agent-skills', 'package.json'),
            path.join(homeDir, '.agents', 'package.json'),
            path.join(geminiDir, 'config', 'package.json')
        ];
        for (const cp of candidatePkgs) {
            if (fs.existsSync(cp)) {
                try {
                    const parsed = JSON.parse(fs.readFileSync(cp, 'utf8'));
                    if (parsed.version) {
                        localVersion = parsed.version;
                        break;
                    }
                } catch (e) { logDebug(e, 'operation'); }
            }
        }
        if (!localVersion) localVersion = '3.8.0';
    }

    const basePath = scriptDir.includes('_npx') ? path.join(homeDir, '.agents') : path.dirname(srcDir);
    const submodules = [
        { id: 'synapse', dir: path.join(basePath, 'bdb-synapse') },
        { id: 'memb', dir: path.join(basePath, 'memB') },
        { id: 'remote', dir: path.join(basePath, 'bdb-os-remote') },
        { id: 'ao', dir: path.join(basePath, 'bdb-agent-orchestrator') },
        // The archived predecessor is deliberately NOT detected: a copy of it
        // should be removed, not carried forward into another install.
        { id: 'creator', dir: path.join(basePath, 'bdb-dev-creator-extension') },
        { id: 'hardware', dir: path.join(basePath, 'bdb-hardware-pcb') },
        { id: 'installer', dir: path.join(basePath, 'bdb-dev-tool-installer') }
    ];

    for (const sub of submodules) {
        if (fs.existsSync(sub.dir) && !installedModules.includes(sub.id)) {
            installedModules.push(sub.id);
        }
    }

    const currentVersion = pkg.version || '3.9.6';
    // Was a bare !== -- any version string difference counted as "update
    // available", downgrade included. A real Windows session ran `@latest`
    // (resolving to the actual latest stable, 4.4.1) against a machine
    // already on 4.4.2-beta.3 and the installer silently treated dropping two
    // versions the same as a normal update -- no distinction, no warning.
    // isNewerVersion() already exists and already handles prerelease
    // ordering correctly; this just uses it in both directions instead of
    // only for the npm-registry freshness check it was written for.
    const versionChanged = isInstalled && localVersion !== currentVersion;
    const isDowngrade = versionChanged && isNewerVersion(currentVersion, localVersion);
    const updateAvailable = versionChanged && !isDowngrade;

    // Extend: also load the file-level install manifest so the caller can
    // seed manifest-aware writes during this same session.
    const installManifest = loadInstallManifest();

    return { isInstalled, localVersion, currentVersion, updateAvailable, isDowngrade, installedModules, manifest, installManifest };
}

function saveManifest(data = {}) {
    if (DRY_RUN) {
        log.step(`[dry-run] would save manifest: ${path.join(homeDir, '.agents', '.bdb-manifest.json')}`);
        return;
    }
    try {
        const manifestDir = path.join(homeDir, '.agents');
        fs.mkdirSync(manifestDir, { recursive: true });
        const manifestPath = path.join(manifestDir, '.bdb-manifest.json');
        let current = {};
        if (fs.existsSync(manifestPath)) {
            try { current = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) { logDebug(e, 'operation'); }
        }
        const updated = Object.assign({}, current, {
            version: pkg.version || '3.9.6',
            lastUpdated: new Date().toISOString(),
            platform: process.platform,
            ...data
        });
        fs.writeFileSync(manifestPath, JSON.stringify(updated, null, 2));
    } catch (e) { logDebug(e, 'manifest read/parse'); }
}

// Port to health-check per daemon name, where one is actually known. BDB Remote Gateway
// has no verified fixed port in this codebase (Tailscale-multiplexed) -- deliberately left
// unchecked rather than guessing one, per this file's own "load reloaded" != "daemon up" bug.
const DAEMON_PORTS = { 'Synapse 3D': 7781, 'memB WebUI': 8088, 'Agent Workspace (ao)': 3101 };

// Maps the module ids used by installedModules/promptOptionalModules to the daemon names
// above, so a caller that just ran installSynapse()/installMemB()/etc. this same pass can
// tell reloadDaemons() to skip them -- each individual installer already does its own
// register-and-verify; redoing that here was pure redundant relaunch + a second 12s wait.
const MODULE_ID_TO_DAEMON_NAME = { synapse: 'Synapse 3D', memb: 'memB WebUI', remote: 'BDB Remote Gateway', ao: 'Agent Workspace (ao)' };

async function reloadDaemons(skipNames = []) {
    if (DRY_RUN) {
        log.step('[dry-run] would reload background daemons (launchctl / windows startup)');
        return;
    }
    if (process.platform === 'darwin') {
        const daemons = [
            { name: 'Synapse 3D', plist: path.join(homeDir, 'Library', 'LaunchAgents', 'com.bdb.synapse.plist') },
            { name: 'BDB Remote Gateway', plist: path.join(homeDir, 'Library', 'LaunchAgents', 'com.hybridlabor.bdb-remote.plist') },
            { name: 'Agent Workspace (ao)', plist: path.join(homeDir, 'Library', 'LaunchAgents', 'com.bdb.ao.daemon.plist') },
            { name: 'memB WebUI', plist: path.join(homeDir, 'Library', 'LaunchAgents', 'com.bdb.memb.webui.plist') }
        ];
        for (const d of daemons) {
            if (skipNames.includes(d.name)) continue;
            if (fs.existsSync(d.plist)) {
                try {
                    execSync(`launchctl unload "${d.plist}" 2>/dev/null || true`, { stdio: 'ignore' });
                    execSync(`launchctl load "${d.plist}" 2>/dev/null || true`, { stdio: 'ignore' });
                    const port = DAEMON_PORTS[d.name];
                    if (port && !(await verifyDaemonListening(port, d.name))) {
                        log.warn(`${d.name} was reloaded but Port ${port} isn't responding — check its log under ~/.synapse or ~/Library/Logs.`);
                        continue;
                    }
                    log.success(`${d.name} daemon reloaded`);
                } catch (e) { logDebug(e, 'operation'); }
            }
        }
    } else if (process.platform === 'win32') {
        const startupDir = path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
        const winDaemons = [
            { name: 'memB WebUI', vbs: path.join(startupDir, 'com.bdb.memb.webui.vbs') },
            { name: 'Synapse 3D', vbs: path.join(startupDir, 'com.bdb.synapse.vbs') },
            { name: 'Agent Workspace (ao)', vbs: path.join(startupDir, 'com.bdb.agent-workspace.vbs') }
        ];
        for (const d of winDaemons) {
            if (skipNames.includes(d.name)) continue;
            if (fs.existsSync(d.vbs)) {
                try {
                    spawn('wscript.exe', [d.vbs], { detached: true, stdio: 'ignore' }).unref();
                    const port = DAEMON_PORTS[d.name];
                    if (port && !(await verifyDaemonListening(port, d.name))) {
                        log.warn(`${d.name} was relaunched but Port ${port} isn't responding — check ~/.synapse/daemon.stderr.log (or the module's own log) for the actual error.`);
                        continue;
                    }
                    log.success(`${d.name} background service started`);
                } catch (e) { logDebug(e, 'windows daemon reload'); }
            }
        }
    }
}

function moveIfExists(src, dest, label) {
    if (fs.existsSync(src)) {
        fs.renameSync(src, dest);
        log.step(`Backed up ${label}`);
    }
}

function safeRmDirSync(dirPath, maxRetries = 5, retryDelay = 200) {
    if (!dirPath || !fs.existsSync(dirPath)) return;
    try {
        fs.rmSync(dirPath, { recursive: true, force: true, maxRetries, retryDelay });
    } catch (err) {
        logDebug(err, `safeRmDirSync: ${dirPath}`);
    }
}

function copyDirRecursiveSync(source, target, excludeList = [], manifest = null, knownSourceHashes = null) {
    // Fall back to session-level state when no explicit manifest is passed.
    const mfst = manifest !== null ? manifest : _sessionManifest;
    const hashes = knownSourceHashes !== null ? knownSourceHashes : _sessionHashes;

    if (!fs.existsSync(source)) return;
    const sourceStat = fs.lstatSync(source);
    if (sourceStat.isFile()) {
        const targetDir = path.dirname(target);
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        if (mfst && hashes) {
            resolveFileConflict(source, target, mfst, hashes);
        } else {
            fs.copyFileSync(source, target);
        }
        return;
    }

    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });

    if (DRY_RUN) {
        let count = 0;
        const walk = (dir) => {
            for (const file of fs.readdirSync(dir)) {
                if (excludeList.includes(file)) continue;
                const cur = path.join(dir, file);
                const stat = fs.lstatSync(cur);
                if (stat.isDirectory()) walk(cur);
                else count++;
            }
        };
        walk(source);
        log.message(`[dry-run] copy ${count} files: ${source} -> ${target}`);
        return;
    }

    const files = fs.readdirSync(source);
    files.forEach(file => {
        if (excludeList.includes(file)) return;
        const curSource = path.join(source, file);
        const curTarget = path.join(target, file);
        try {
            const stat = fs.lstatSync(curSource);
            if (stat.isSymbolicLink()) {
                try {
                    const linkTarget = fs.readlinkSync(curSource);
                    if (fs.existsSync(curSource)) {
                        if (fs.existsSync(curTarget)) fs.unlinkSync(curTarget);
                        fs.symlinkSync(linkTarget, curTarget);
                    } else {
                        log.warn(`Skipping broken symlink ${curSource}`);
                    }
                } catch (e) {
                    log.warn(`Could not copy symlink ${curSource}: ${e.message}`);
                }
            } else if (stat.isDirectory()) {
                // excludeList must ride along: without it an exclusion only
                // held at the top level, so a nested file with an excluded
                // name got copied anyway.
                copyDirRecursiveSync(curSource, curTarget, excludeList, mfst, hashes);
            } else {
                if (mfst && hashes) {
                    resolveFileConflict(curSource, curTarget, mfst, hashes);
                } else {
                    fs.copyFileSync(curSource, curTarget);
                }
            }
        } catch (e) {
            log.warn(`Failed to copy ${curSource} -> ${curTarget}: ${e.message}`);
        }
    });
}

// A top-level entry under skills/ is either a leaf skill (its own SKILL.md
// directly inside -- e.g. skills/bdbrainstorm/) or a container of multiple
// leaf skills (e.g. skills/global_config/, skills/basic/,
// skills/workspace_agents/). copyDirRecursiveSync(source, target) copies
// source's CONTENTS into target -- it never nests under
// target/basename(source). That's correct for a container (its children are
// already properly-named skill dirs) but wrong for a leaf skill, whose
// SKILL.md needs to land at target/<dirName>/SKILL.md, not loose at
// target/SKILL.md. Getting this wrong doesn't just misplace one skill: every
// root-level leaf skill dumps into the same flat target, so each subsequent
// one silently overwrites the previous one's SKILL.md -- found by tracing
// why skills/bdbrainstorm/ and skills/global_config/bdbrainstorm/ both
// existed with different content; the root-level one (and 3 siblings:
// github-repo, memb-ingest, synapse-integration-skill) never survived a
// global sync intact.
function syncSkillEntry(fullPath, dirName, targetSkillDir, excludeSkills) {
    const isLeafSkill = fs.existsSync(path.join(fullPath, 'SKILL.md'));
    if (isLeafSkill) {
        copyDirRecursiveSync(fullPath, path.join(targetSkillDir, dirName), excludeSkills);
    } else {
        copyDirRecursiveSync(fullPath, targetSkillDir, excludeSkills);
    }
}

function installStep(what, fn, hint) {
    try {
        return { ok: true, value: fn() };
    } catch (e) {
        log.warn(`Could not ${what}: ${e.message}`);
        if (hint) log.warn(hint);
        return { ok: false, error: e };
    }
}

function reportFatal(stage, e) {
    log.error(`The installer stopped during ${stage}.`);
    log.error(`Reason: ${(e && e.stack) || e}`);
    log.error(`Nothing was rolled back; re-running the installer is safe.`);
    process.exitCode = 1;
}

function syncSkillsToGlobalHarnesses(excludeSkills = []) {
    const skillsBase = path.join(srcDir, 'skills');
    if (!fs.existsSync(skillsBase)) return;

    // Mirror only into harnesses that are actually present. This list used to
    // be unconditional, which both wrote skills nobody would read and planted
    // the very directories detectPlatforms() then read back as proof the
    // harness existed. ~/.agents is ours and always written.
    const detectedKeys = new Set(detectPlatforms().map((d) => d.key));
    // No `|| fs.existsSync(d.dir)` fallback here on purpose: that fallback
    // used to mean a directory AOS itself planted in a past run (before a
    // harness was ever really detected) kept being "detected" forever,
    // regardless of what detectPlatforms() found this run -- the exact
    // circularity the block comment above warns about, just one layer down.
    // A harness that stops being detected now simply stops receiving skill
    // updates instead of perpetuating a false positive.
    const extraSkillDestinations = [
        { dir: path.join(homeDir, '.agents', 'skills'), key: null },
        { dir: path.join(homeDir, '.claude', 'skills'), key: 'claudecode' },
        { dir: path.join(homeDir, '.codex', 'skills'), key: 'codex' },
        { dir: path.join(homeDir, '.cursor', 'skills'), key: 'cursor' },
        { dir: path.join(homeDir, '.roo', 'skills'), key: 'vscode' },
        { dir: process.platform === 'win32' ? path.join(process.env.APPDATA || homeDir, 'opencode', 'skills') : path.join(homeDir, '.config', 'opencode', 'skills'), key: 'opencode' },
    ].filter((d) => d.key === null || detectedKeys.has(d.key));

    for (const { dir: dest } of extraSkillDestinations) {
        try {
            fs.mkdirSync(dest, { recursive: true });
            const rawDirs = fs.readdirSync(skillsBase);
            const dirs = rawDirs.sort((a, b) => {
                const aIsLeaf = fs.existsSync(path.join(skillsBase, a, 'SKILL.md'));
                const bIsLeaf = fs.existsSync(path.join(skillsBase, b, 'SKILL.md'));
                if (aIsLeaf && !bIsLeaf) return 1;
                if (!aIsLeaf && bIsLeaf) return -1;
                return 0;
            });
            for (const dir of dirs) {
                if (dir === 'global_legacy' || dir === 'workspace_agents') continue;
                const fullPath = path.join(skillsBase, dir);
                if (!fs.statSync(fullPath).isDirectory()) continue;
                syncSkillEntry(fullPath, dir, dest, excludeSkills);
            }
            log.step(`Synced BDB skills to ${dest}`);
        } catch (e) {
            log.warn(`Could not sync skills to ${dest}: ${e.message}`);
        }
    }
}

function loadExistingEnv(targetMcpDir) {
    const envPaths = [
        targetMcpDir ? path.join(targetMcpDir, '.env') : null,
        path.join(geminiDir, 'config', '.env'),
        path.join(homeDir, '.agents', '.env')
    ].filter(Boolean);

    const envData = {};
    for (const ep of envPaths) {
        if (fs.existsSync(ep)) {
            try {
                const lines = fs.readFileSync(ep, 'utf8').split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                        const idx = trimmed.indexOf('=');
                        const k = trimmed.substring(0, idx).trim();
                        const v = trimmed.substring(idx + 1).trim();
                        if (k && v && !envData[k]) {
                            envData[k] = v;
                        }
                    }
                }
            } catch (e) { logDebug(e, 'operation'); }
        }
    }

    for (const k of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'GROQ_API_KEY', 'XAI_API_KEY', 'NVIDIA_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY']) {
        if (process.env[k] && !envData[k]) {
            envData[k] = process.env[k];
        }
    }

    return envData;
}

function maskApiKey(key) {
    if (!key) return '';
    if (key.length <= 8) return '****';
    return key.substring(0, 4) + '...' + key.substring(key.length - 4);
}

// Provider -> its own API key env var name. Used both to find a previously
// configured non-Google provider's key (loadExistingEnv only special-cased
// Gemini/GitHub, so a Groq/Grok/NVIDIA/OpenAI/OpenRouter setup was invisible
// to "keep existing" and silently looked unconfigured) and to build the
// isAutoYes default without re-deriving the same mapping twice.
const PROVIDER_KEY_ENV_NAMES = {
    google: 'GEMINI_API_KEY', groq: 'GROQ_API_KEY', grok: 'XAI_API_KEY',
    nvidia: 'NVIDIA_API_KEY', openrouter: 'OPENROUTER_API_KEY',
    openai: 'OPENAI_API_KEY', ollama: null, custom: 'OPENWIKI_API_KEY',
};

async function promptCredentials(referenceMcpDir) {
    const existingEnv = loadExistingEnv(referenceMcpDir);
    const existingGithub = existingEnv['GITHUB_PERSONAL_ACCESS_TOKEN'] || existingEnv['GITHUB_TOKEN'] || '';
    const existingProvider = existingEnv['OPENWIKI_PROVIDER'] || 'google';
    const existingModel = existingEnv['OPENWIKI_MODEL'] || '';
    const existingBaseUrl = existingEnv['OPENWIKI_BASE_URL'] || '';
    const existingKeyEnvName = PROVIDER_KEY_ENV_NAMES[existingProvider] || 'OPENWIKI_API_KEY';
    // Gemini/Google/OpenWiki-generic keys are also accepted as a fallback so
    // an old config written before OPENWIKI_PROVIDER existed still resolves.
    const existingGemini = existingEnv[existingKeyEnvName] || existingEnv['GEMINI_API_KEY'] || existingEnv['GOOGLE_API_KEY'] || existingEnv['OPENWIKI_API_KEY'] || '';

    if (isAutoYes) {
        // A non-interactive run (npx -y, or an --auto submodule install) must
        // never silently discard a provider already configured on this
        // machine -- this used to hard-reset to an empty Google/Gemini
        // default on every unattended re-run, wiping a previously-chosen
        // NVIDIA/Nemotron (or any other) provider and key each time.
        if (existingGemini || existingProvider === 'ollama') {
            return { gemini: existingGemini, github: existingGithub, openwikiProvider: existingProvider, openwikiModel: existingModel, openwikiBaseUrl: existingBaseUrl, keyEnvName: existingKeyEnvName };
        }
        // Nothing configured yet on this machine: default to NVIDIA NIM /
        // Nemotron. Google was only ever a placeholder default, never the
        // intended house default.
        return { gemini: "", github: existingGithub, openwikiProvider: "nvidia", openwikiModel: "nvidia/llama-3.1-nemotron-70b-instruct", openwikiBaseUrl: "https://integrate.api.nvidia.com/v1", keyEnvName: 'NVIDIA_API_KEY' };
    }

    const hasKeys = Boolean(existingGemini || existingGithub);

    if (hasKeys) {
        log.info('Integrations & Credentials');
        if (existingGemini) log.message(`GEMINI/OpenWiki Key: ${maskApiKey(existingGemini)}`);
        if (existingGithub) log.message(`GitHub MCP Token:    ${maskApiKey(existingGithub)}`);

        const credAction = await selectWithBack({
            message: 'Credentials Setup:',
            options: [
                { value: 'keep', label: 'Keep existing credentials & LLM provider settings (Recommended)' },
                { value: 'update', label: 'Re-configure API keys / LLM provider wizard' }
            ],
            initialValue: 'keep'
        });

        if (credAction === BACK) return BACK;

        if (credAction === 'keep') {
            return {
                gemini: existingGemini,
                github: existingGithub,
                openwikiProvider: existingProvider,
                openwikiModel: existingModel,
                openwikiBaseUrl: existingBaseUrl,
                keyEnvName: existingKeyEnvName
            };
        }
    }

    const provOptions = [
        { value: '1', label: 'Google AI Studio / Gemini – gemma-4-26b-a4b-it, gemini-2.5-pro, gemini-3.5-flash' },
        { value: '2', label: 'Groq – llama-3.3-70b-versatile, llama-3.1-8b-instant' },
        { value: '3', label: 'Grok / xAI – grok-2-latest, grok-3' },
        { value: '4', label: 'NVIDIA NIM – meta/llama-3.3-70b-instruct, nvidia/llama-3.1-nemotron-70b-instruct' },
        { value: '5', label: 'OpenRouter – anthropic/claude-3.5-sonnet, openai/gpt-4o' },
        { value: '6', label: 'OpenAI – gpt-4o-mini, gpt-4o, o1' },
        { value: '7', label: 'Ollama / LM Studio – Local LLM (no API key, no cost)' },
        { value: '8', label: 'Custom OpenAI API / Base URL + API Key + Model' }
    ];

    const defaultsFor = (c) => {
        let provider = "google", model = "", baseUrl = "", keyEnvName = "GEMINI_API_KEY";
        const v = (c || '1').trim();
        if (v === "2")      { provider = "groq";       model = "llama-3.3-70b-versatile";     keyEnvName = "GROQ_API_KEY"; }
        else if (v === "3") { provider = "grok";       model = "grok-2-latest";               keyEnvName = "XAI_API_KEY"; }
        else if (v === "4") { provider = "nvidia";     model = "meta/llama-3.3-70b-instruct"; keyEnvName = "NVIDIA_API_KEY"; baseUrl = "https://integrate.api.nvidia.com/v1"; }
        else if (v === "5") { provider = "openrouter"; model = "anthropic/claude-3.5-sonnet"; keyEnvName = "OPENROUTER_API_KEY"; }
        else if (v === "6") { provider = "openai";     model = "gpt-4o-mini";                 keyEnvName = "OPENAI_API_KEY"; }
        else if (v === "7") { provider = "ollama";     model = "llama3";                      baseUrl = "http://localhost:11434/v1"; }
        else if (v === "8") { provider = "custom";     keyEnvName = "OPENWIKI_API_KEY"; }
        return { provider, model, baseUrl, keyEnvName };
    };

    const defaultModelFor = (provider) => provider === "google"
        ? "gemma-4-26b-a4b-it"
        : provider === "groq"
            ? "llama-3.3-70b-versatile"
            : provider === "grok"
                ? "grok-2-latest"
                : provider === "nvidia"
                    ? "meta/llama-3.3-70b-instruct"
                    : provider === "openai"
                        ? "gpt-4o-mini"
                        : provider === "ollama"
                            ? "llama3"
                            : "gpt-4o-mini";

    let sub = 0;
    let choice = '1';
    let d = defaultsFor('1');
    let enteredModel = '', customBaseUrl = '', apiKey = '', github = '';

    while (true) {
        if (sub === 0) {
            choice = await selectWithBack({
                message: 'Choose OpenWiki LLM Provider:',
                options: provOptions,
                initialValue: choice
            });
            if (choice === BACK) return BACK;
            d = defaultsFor(choice);
            sub = 1;
            continue;
        }

        if (sub === 1) {
            if (choice.trim() === '8') {
                const u = await textWithBack({ message: 'Custom Base URL [e.g. https://integrate.api.nvidia.com/v1] (< = back):' });
                if (u === BACK) { sub = 0; continue; }
                customBaseUrl = ((u || '') + '').trim();
            } else if (choice.trim() === '7') {
                const u = await textWithBack({ message: 'Ollama Base URL [default: http://localhost:11434/v1] (< = back):' });
                if (u === BACK) { sub = 0; continue; }
                if (((u || '') + '').trim()) customBaseUrl = ((u || '') + '').trim();
            }

            const fallbackModel = d.model || defaultModelFor(d.provider);
            const m = await textWithBack({
                message: `Model name [default: ${fallbackModel}] (< = back):`,
                placeholder: fallbackModel
            });
            if (m === BACK) { sub = 0; continue; }
            enteredModel = ((m || '') + '').trim();
            sub = 2;
            continue;
        }

        if (sub === 2) {
            if (d.provider !== "ollama") {
                const existingKey = existingEnv[d.keyEnvName] || existingEnv['GEMINI_API_KEY'] || '';
                const entered = await passwordWithBack({
                    message: `${d.keyEnvName} for OpenWiki${existingKey ? ` (existing detected: ${maskApiKey(existingKey)}, leave blank to keep)` : ' (leave blank to skip)'} (< = back):`
                });
                if (entered === BACK) { sub = 1; continue; }
                apiKey = ((entered || '') + '').trim() || existingKey;
            } else {
                apiKey = '';
            }
            sub = 3;
            continue;
        }

        const ghExisting = existingEnv['GITHUB_PERSONAL_ACCESS_TOKEN'] || existingEnv['GITHUB_TOKEN'] || '';
        const enteredGithub = await passwordWithBack({
            message: `GITHUB_PERSONAL_ACCESS_TOKEN for GitHub MCP${ghExisting ? ` (existing detected: ${maskApiKey(ghExisting)}, leave blank to keep)` : ' (leave blank to skip)'} (< = back):`
        });
        if (enteredGithub === BACK) { sub = 2; continue; }
        github = ((enteredGithub || '') + '').trim() || ghExisting;
        break;
    }

    return {
        gemini: apiKey.trim(),
        github: github.trim(),
        openwikiProvider: d.provider,
        openwikiModel: enteredModel || d.model || defaultModelFor(d.provider),
        openwikiBaseUrl: customBaseUrl || d.baseUrl,
        keyEnvName: d.keyEnvName
    };
}

const DAEMON_LOGON_FALLBACK_EXIT_CODE = 10;

async function installOpenWikiDaemon(apiKey, targetSkillDir, openwikiEnv = {}) {
    const prov = openwikiEnv.provider || "google";
    if (!apiKey && !["ollama", "lmstudio"].includes(prov)) {
        log.step('Skipping OpenWiki Daemon background installation (no API key provided)');
        return;
    }
    if (DRY_RUN) {
        log.step('[dry-run] would install the OpenWiki Daemon (scheduled every 2 hours)');
        return;
    }
    const s = spinner();
    s.start('Installing OpenWiki Daemon...');

    const scriptBase = path.join(targetSkillDir, 'openwiki-skill', 'scripts');

    const daemonEnv = Object.assign({}, process.env, {
        OPENWIKI_PROVIDER:  prov,
        OPENWIKI_MODEL:     openwikiEnv.model   || '',
        OPENWIKI_BASE_URL:  openwikiEnv.baseUrl || '',
        OPENWIKI_API_KEY:   apiKey || '',
        GEMINI_API_KEY:     prov === 'google' ? apiKey : (process.env.GEMINI_API_KEY || ''),
        OPENAI_API_KEY:     prov === 'openai' ? apiKey : (process.env.OPENAI_API_KEY || ''),
        GROQ_API_KEY:       prov === 'groq'   ? apiKey : (process.env.GROQ_API_KEY   || ''),
        XAI_API_KEY:        ['grok', 'xai'].includes(prov) ? apiKey : (process.env.XAI_API_KEY || ''),
        NVIDIA_API_KEY:     prov === 'nvidia' ? apiKey : (process.env.NVIDIA_API_KEY || ''),
        OPENROUTER_API_KEY: prov === 'openrouter' ? apiKey : (process.env.OPENROUTER_API_KEY || ''),
    });

    await new Promise((resolve) => {
        let command, args;
        if (os.platform() === 'win32') {
            command = 'powershell.exe';
            args = ['-ExecutionPolicy', 'Bypass', '-File', path.join(scriptBase, 'install_daemon.ps1')];
        } else {
            command = 'sh';
            const scriptPath = path.join(scriptBase, 'install_daemon.sh');
            args = [scriptPath];
            try { fs.chmodSync(scriptPath, '755'); } catch (e) { logDebug(e, 'operation'); }
        }
        const child = spawn(command, args, { stdio: 'inherit', env: daemonEnv });
        child.on('close', (code) => {
            const usedLogonFallback = code === DAEMON_LOGON_FALLBACK_EXIT_CODE;
            if (code === 0 || usedLogonFallback) {
                if (usedLogonFallback) {
                    s.message('OpenWiki Daemon installed via logon-only fallback');
                } else {
                    s.message('OpenWiki Daemon installed (scheduled every 2 hours)');
                }
                try {
                    const pythonCmd = os.platform() === 'win32' ? 'python' : 'python3';
                    const daemonPath = path.join(scriptBase, 'openwiki_daemon.py');
                    spawn(pythonCmd, [daemonPath, '--one-shot'], { detached: true, stdio: 'ignore', env: daemonEnv }).unref();
                } catch (e) { logDebug(e, 'operation'); }
                s.stop('OpenWiki Daemon ready');
            } else {
                s.stop(`OpenWiki Daemon background install skipped/failed (exit ${code}). Run manually: python3 "${path.join(scriptBase, 'openwiki_daemon.py')}" --one-shot`);
            }
            resolve();
        });
        child.on('error', (err) => { s.stop(`Failed to start OpenWiki Daemon script: ${err.message}`); resolve(); });
    });
}

// Wordmark banner. Rendered after the kinetic intro finishes, before the
// hero header -- the user wanted both kept, not one replacing the other.
// Built programmatically rather than stored as an escaped string literal:
// the wordmark carries a per-column pink -> yellow -> amethyst gradient,
// which needs a truecolor escape emitted per character run.
const BANNER_WORDMARK = [
    "█████▄ ████▄  █████▄   ▄████▄  ▄████  ██████ ███  ██ ██████   ▄████▄ ▄█████ ",
    "██▄▄██ ██  ██ ██▄▄██   ██▄▄██ ██  ▄▄▄ ██▄▄   ██ ▀▄██   ██     ██  ██ ▀▀▀▄▄▄ ",
    "██▄▄█▀ ████▀  ██▄▄█▀   ██  ██  ▀███▀  ██▄▄▄▄ ██   ██   ██     ▀████▀ █████▀"
];

function buildWordmarkBanner() {
    const pink = [236, 72, 153];
    const yellow = [255, 208, 66];
    const amethystRgb = [155, 89, 182];
    const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    const gradientAt = (t) => (t < 0.5 ? lerp(pink, yellow, t * 2) : lerp(yellow, amethystRgb, (t - 0.5) * 2));

    const width = Math.max(...BANNER_WORDMARK.map((l) => l.length));
    const wordmark = BANNER_WORDMARK.map((line) => {
        let out = '';
        let lastCode = null;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === ' ') { out += ch; continue; }
            const [r, g, b] = gradientAt(i / (width - 1));
            const code = `\x1b[38;2;${r};${g};${b}m`;
            if (code !== lastCode) { out += code; lastCode = code; }
            out += ch;
        }
        return out + colors.reset;
    }).join('\n');

    const label = ' N O D E F O R G E ';
    const fill = width - label.length;
    const divider = '─'.repeat(Math.floor(fill / 2)) + label + '─'.repeat(fill - Math.floor(fill / 2));

    return `${colors.bold}\n${wordmark}\n\n${colors.beige}${divider}${colors.reset}`;
}

async function runTopologyAnimation(backgroundTask, label) {
    if (!process.stdout.isTTY || process.stdout.columns < 60 || process.stdout.rows < 15) {
        log.step(`${label}...`);
        return await backgroundTask;
    }

    let isDone = false;
    let frame = 0;
    
    const topologyTemplate = [
        "    [CORE] --- [MEM]    ",
        "      |          |      ",
        "    [EXT] -/    [DB]    ",
        "             \\          ",
        "              [SYS]     "
    ];

    try {
        process.stdout.write('\x1B[?25l');
        
        console.log(`\n${colors.gold}${colors.bold}>>> ${label}${colors.reset}\n`);
        for (let i = 0; i < topologyTemplate.length; i++) console.log('');
        console.log('');
        
        const lineCount = topologyTemplate.length + 4;

        backgroundTask.then(() => { isDone = true; }).catch(() => { isDone = true; });

        while (!isDone) {
            readline.moveCursor(process.stdout, 0, -lineCount);
            
            console.log(`\n${colors.gold}${colors.bold}>>> ${label} ${['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'][frame % 10]}${colors.reset}\n`);
            
            for (let line of topologyTemplate) {
                let out = '';
                for (let c of line) {
                    if (c === '-' || c === '|' || c === '\\' || c === '/') {
                        out += Math.random() < 0.25 ? `${colors.magenta}*${colors.reset}` : `${colors.forge}${c}${colors.reset}`;
                    } else if (c === '[' || c === ']') {
                        out += `${colors.gold}${c}${colors.reset}`;
                    } else if (c !== ' ') {
                        out += `${colors.emerald}${colors.bold}${c}${colors.reset}`;
                    } else {
                        out += c;
                    }
                }
                console.log(out);
            }
            console.log('');
            
            frame++;
            await new Promise(r => setTimeout(r, 100));
        }
        
        readline.moveCursor(process.stdout, 0, -lineCount);
        readline.clearScreenDown(process.stdout);
        
        return await backgroundTask;
    } finally {
        process.stdout.write('\x1B[?25h');
    }
}

async function installTokenSaver(platformTarget) {
    const tokenSaverDir = path.join(srcDir, 'vendor', 'token-saver');
    if (!fs.existsSync(tokenSaverDir)) return;
    if (DRY_RUN) {
        log.step('[dry-run] would run Heimdall Token Saver setup (--target all)');
        return;
    }
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    
    const { exec } = require('child_process');
    const execAsync = util.promisify(exec);
    
    const task = execAsync(`${pythonCmd} install.py --target all`, {
        cwd: tokenSaverDir,
        maxBuffer: 16 * 1024 * 1024,
        env: Object.assign({}, process.env, { PYTHONUTF8: '1' })
    });

    try {
        await runTopologyAnimation(task, 'Installing Heimdall Token Saver Context Optimizer');
        log.success('Heimdall Token Saver registered');
    } catch (err) {
        log.warn(`Heimdall Token Saver skipped/failed: ${err.message}`);
        logDebug(err, 'Token Saver install');
    }
}

function checkModuleUpdate(pkgName, targetDir) {
    const modulePkgPath = path.join(targetDir, 'package.json');
    if (!fs.existsSync(modulePkgPath)) {
        return { installed: false, updateAvailable: false, localVer: null, remoteVer: null };
    }
    try {
        const localVer = JSON.parse(fs.readFileSync(modulePkgPath, 'utf8')).version;
        let remoteVer = null;
        let checkFailed = false;
        try {
            const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
            if (process.platform === 'win32') {
                remoteVer = execSync(`"${npmCmd}" view ${pkgName} version`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 4000 }).trim();
            } else {
                remoteVer = execFileSync(npmCmd, ['view', pkgName, 'version'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 4000 }).trim();
            }
        } catch (e) {
            // Offline, a proxy, or a misconfigured registry. Swallowing this
            // made every module report "up to date" forever on such a machine,
            // indistinguishable from a real answer -- so say which one it is.
            checkFailed = true;
            logDebug(e, `npm view ${pkgName}`);
        }

        if (remoteVer && localVer !== remoteVer) {
            return { installed: true, updateAvailable: true, localVer, remoteVer, checkFailed };
        }
        return { installed: true, updateAvailable: false, localVer, remoteVer, checkFailed };
    } catch (e) {
        return { installed: true, updateAvailable: false, localVer: null, remoteVer: null, checkFailed: true };
    }
}

function downloadOrUpdateModule(pkgName, targetDir, displayName) {
    const status = checkModuleUpdate(pkgName, targetDir);
    if (status.installed && !status.updateAvailable) {
        if (status.checkFailed) {
            log.warn(`${displayName}: could not reach the npm registry — keeping the installed v${status.localVer}, which may be stale.`);
        } else {
            log.step(`${displayName} is up to date (v${status.localVer})`);
        }
        return true;
    }

    if (DRY_RUN) {
        log.step(`[dry-run] would download/update ${displayName} (${pkgName}@latest) -> ${targetDir}`);
        return true;
    }

    const s = spinner();
    s.start(`${status.installed ? `Updating ${displayName} (v${status.localVer} -> v${status.remoteVer})` : `Downloading ${displayName}`}...`);

    try {
        fs.mkdirSync(targetDir, { recursive: true });

        const staleTarballs = fs.readdirSync(targetDir).filter(f => f.endsWith('.tgz'));
        for (const stale of staleTarballs) {
            try {
                fs.unlinkSync(path.join(targetDir, stale));
                log.step(`Removed stale tarball: ${stale}`);
            } catch (e) {
                logDebug(e, `remove stale tarball ${stale}`);
            }
        }

        const ok = runNpmWithRetry(`npm pack ${pkgName}@latest`, { stdio: 'ignore', cwd: targetDir }, `${displayName} download`);
        cleanNpmCacheOnWindows();
        const tarball = ok ? fs.readdirSync(targetDir).find(f => f.endsWith('.tgz')) : null;
        if (!tarball) throw new Error("NPM pack returned no archive.");

        // Unpacking straight over targetDir made an update a MERGE: a file the
        // new version dropped stayed on disk forever, while package.json said
        // the module was current. Unpack beside it and swap, so the tree that
        // ends up installed is exactly the published one. The previous tree is
        // kept until the swap succeeds, and restored if it does not.
        const stagingDir = `${targetDir}.incoming-${timestamp}`;
        const retiredDir = `${targetDir}.previous-${timestamp}`;

        // Clean up any stale staging or retired directories left behind by earlier interrupted runs
        try {
            const parentDir = path.dirname(targetDir);
            const baseName = path.basename(targetDir);
            if (fs.existsSync(parentDir)) {
                for (const item of fs.readdirSync(parentDir)) {
                    if (item.startsWith(`${baseName}.incoming-`) || item.startsWith(`${baseName}.previous-`)) {
                        safeRmDirSync(path.join(parentDir, item));
                    }
                }
            }
        } catch (_) {}

        safeRmDirSync(stagingDir);
        fs.mkdirSync(stagingDir, { recursive: true });
        execSync(`tar -xzf "${path.join(targetDir, tarball)}" --strip-components=1 -C "${stagingDir}"`, { stdio: 'ignore' });
        fs.unlinkSync(path.join(targetDir, tarball));

        // Anything the module generated in place -- venvs, caches, local state
        // -- is not in the tarball and must survive the swap.
        const PRESERVE = ['.venv', 'venv', 'node_modules', '.env', 'data', 'logs'];
        for (const keep of PRESERVE) {
            const from = path.join(targetDir, keep);
            if (fs.existsSync(from) && !fs.existsSync(path.join(stagingDir, keep))) {
                try {
                    fs.renameSync(from, path.join(stagingDir, keep));
                } catch (preserveErr) {
                    logDebug(preserveErr, `preserve ${keep}`);
                }
            }
        }

        // Phase 1: retire the live tree. On Windows a running daemon holds open
        // file handles into targetDir — retry with brief backoff before failing.
        // ponytail: 3 retries × 600ms; escalate to process kill if this ceiling matters
        let phase1Done = false;
        for (let attempt = 0; attempt < 3 && !phase1Done; attempt++) {
            try {
                fs.renameSync(targetDir, retiredDir);
                phase1Done = true;
            } catch (retireError) {
                const retriable = retireError.code === 'EPERM' || retireError.code === 'EBUSY';
                if (retriable && attempt < 2) {
                    const delayMs = 600 * (attempt + 1);
                    try {
                        if (process.platform === 'win32') {
                            execSync(`powershell -NoProfile -Command "Start-Sleep -Milliseconds ${delayMs}"`, { stdio: 'ignore' });
                        } else {
                            execSync(`sleep ${delayMs / 1000}`, { stdio: 'ignore' });
                        }
                    } catch (_) {}
                    continue;
                }
                safeRmDirSync(stagingDir);
                throw retireError;
            }
        }

        // Phase 2: promote the staging tree. stagingDir was just unpacked and
        // has no open handles, so a single attempt is sufficient.
        try {
            fs.renameSync(stagingDir, targetDir);
        } catch (promoteError) {
            try { fs.renameSync(retiredDir, targetDir); } catch (_) {}
            safeRmDirSync(stagingDir);
            throw promoteError;
        }

        // On Windows especially, deleting a directory that was just renamed or contains
        // locked file handles can throw EPERM / EBUSY. Since targetDir already has the
        // new version in place, failure to clean up retiredDir must be non-fatal.
        safeRmDirSync(retiredDir);

        s.stop(`${displayName} ready (v${status.remoteVer || 'latest'})`);
        return true;
    } catch (e) {
        s.stop(`Failed downloading ${displayName}: ${e.message}`);
        return false;
    }
}

function moduleBasePath() {
    return scriptDir.includes('_npx') ? path.join(os.homedir(), '.agents') : path.dirname(srcDir);
}

// deja resolves its exclude file as $XDG_CONFIG_HOME/deja/exclude, falling
// back to $HOME/.config on ALL platforms including Windows -- do not switch
// this to os.UserConfigDir()/APPDATA, deja would never read that file there.
function ensureDejaExclude(excludePath) {
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    let existing = '';
    if (fs.existsSync(excludePath)) {
        existing = fs.readFileSync(excludePath, 'utf8');
    }
    // deja skips comment lines when matching, so a '# secret' line does not
    // count as the pattern being present. Only a line trimming to exactly
    // 'secret' counts -- never rewrite, reorder or deduplicate user lines.
    if (existing.split(/\r?\n/).some(line => line.trim() === 'secret')) return false;
    let content = existing;
    if (content.length > 0 && !content.endsWith('\n')) content += '\n';
    fs.writeFileSync(excludePath, `${content}secret\n`);
    return true;
}

async function installDeja() {
    if (DRY_RUN) {
        log.step('[dry-run] would install deja-vu 0.21.1 globally and add its exclude pattern');
        return;
    }
    try {
        log.step('Installing deja-vu session memory...');
        execSync('npm install -g @vshulcz/deja-vu@0.21.1', { stdio: 'ignore' });
    } catch (e) {
        log.warn('deja-vu install failed. Install later with: npm install -g @vshulcz/deja-vu@0.21.1');
    }
    if (!hasExecutable('deja')) {
        log.warn('deja is not on PATH. Install it with: npm install -g @vshulcz/deja-vu@0.21.1');
    }
    const base = process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config');
    const excludePath = path.join(base, 'deja', 'exclude');
    try {
        if (ensureDejaExclude(excludePath)) {
            log.step(`Added 'secret' to the deja exclude list at ${excludePath}`);
        }
    } catch (e) {
        log.warn(`Could not update the deja exclude list at ${excludePath}: ${e.message}. Add the line 'secret' to it by hand.`);
    }
}

async function installMemB(interactive) {
    let installWebUI = true;
    if (interactive && !isAutoYes) {
        installWebUI = pick(await askConfirm({
            message: "memB standalone WebUI daemon? (Select 'No' if you use the Obsidian plugin)",
            initialValue: true
        }));
    }
    const membDir = path.join(moduleBasePath(), 'memB');
    // A failed download used to fall through into venv setup and daemon
    // registration, each of which then failed on its own terms or, worse,
    // "succeeded" against a stale tree -- and the run still ended in a success
    // banner. Stop at the module that could not be fetched.
    if (!downloadOrUpdateModule('@hybridlabor-api/memb', membDir, 'memB Vector Engine')) {
        log.warn('Skipping memB setup: the module could not be downloaded.');
        return;
    }
    await installDeja();
    if (DRY_RUN) {
        log.step('[dry-run] would bootstrap memB venv + pip requirements');
        return;
    }

    const reqFile = path.join(membDir, 'requirements.txt');
    const serverPy = path.join(membDir, 'src', 'backend', 'server.py');
    if (fs.existsSync(reqFile)) {
        try {
            const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
            const venvPython = process.platform === 'win32'
                ? path.join(membDir, '.venv', 'Scripts', 'python.exe')
                : path.join(membDir, '.venv', 'bin', 'python');

            let createdViaUv = false;
            if (!fs.existsSync(venvPython)) {
                try {
                    execSync(`uv venv --seed .venv`, { cwd: membDir, stdio: 'ignore' });
                    createdViaUv = true;
                } catch (e1) {
                    execSync(`${pythonCmd} -m venv .venv`, { cwd: membDir, stdio: 'ignore' });
                }
            }

            // `uv venv --seed` is supposed to seed pip/setuptools/wheel into the venv, but
            // this has been observed to silently under-deliver (venv created, pip missing) --
            // when that happens every `-m pip install` call below fails with "No module named
            // pip". `uv pip install --python <venv>` never needs pip present in the venv at
            // all, so prefer it whenever uv itself is on PATH, regardless of which tool
            // actually created the venv -- it's a strictly more reliable install path.
            let hasUv = createdViaUv;
            if (!hasUv) {
                try { execSync('uv --version', { stdio: 'ignore' }); hasUv = true; } catch (e) { hasUv = false; }
            }
            if (!hasUv && fs.existsSync(venvPython)) {
                try {
                    execSync(`"${venvPython}" -m pip --version`, { stdio: 'ignore' });
                } catch (_) {
                    try {
                        execSync(`"${venvPython}" -m ensurepip --default-pip`, { cwd: membDir, stdio: 'ignore' });
                    } catch (ePip) {
                        logDebug(ePip, 'ensurepip bootstrap for memB');
                    }
                }
            }
            const uvInstall = (pkgsArg) => `uv pip install --python "${venvPython}" ${pkgsArg}`;
            const pipInstall = (pkgsArg) => `"${venvPython}" -m pip install ${pkgsArg} --timeout 30 --no-input`;
            const installCmd = (pkgsArg) => hasUv ? uvInstall(pkgsArg) : pipInstall(pkgsArg);

            runPipWithRetry(installCmd('--upgrade setuptools'), { cwd: membDir, stdio: 'ignore' }, 'pip setuptools for memB standalone', 2, 120000);
            runPipWithRetry(installCmd('-r requirements.txt'), { cwd: membDir, stdio: 'inherit' }, 'pip install for memB standalone', 2, 900000);

            if (installWebUI && fs.existsSync(serverPy)) {
                runPipWithRetry(installCmd('fastapi uvicorn'), { cwd: membDir, stdio: 'ignore' }, 'pip fastapi+uvicorn for memB WebUI', 2, 120000);
            }

            // A partially upgraded venv can contain pydantic while missing or
            // mismatching pydantic-core. That failure only appears later when
            // the WebUI imports its models, so validate the actual interpreter
            // before registering the daemon and repair the pair in place.
            const importCheck = installWebUI && fs.existsSync(serverPy)
                ? 'import pydantic, pydantic_core; from fastapi import FastAPI; import uvicorn'
                : 'import pydantic, pydantic_core';
            if (!verifyPythonImports(venvPython, membDir, importCheck)) {
                log.warn('memB Python dependencies are inconsistent; repairing pydantic and pydantic-core.');
                const repairPackages = installWebUI && fs.existsSync(serverPy)
                    ? '--force-reinstall "pydantic>=2.7.3" "pydantic-core>=2.18.4" fastapi uvicorn'
                    : '--force-reinstall "pydantic>=2.7.3" "pydantic-core>=2.18.4"';
                const repaired = runPipWithRetry(
                    installCmd(repairPackages),
                    { cwd: membDir, stdio: 'inherit' },
                    'repair memB Python dependencies',
                    2,
                    900000,
                );
                if (repaired && !verifyPythonImports(venvPython, membDir, importCheck)) {
                    log.warn('memB dependency repair did not pass the import check; inspect the venv before starting the daemon.');
                }
            }
        } catch (e) {
            log.warn(`Failed memB standalone venv setup: ${e.message}`);
        }
    }

    if (installWebUI && fs.existsSync(serverPy)) {
        if (process.platform === 'darwin') {
            const venvPython = path.join(membDir, '.venv', 'bin', 'python');
            const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', 'com.bdb.memb.webui.plist');
            const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bdb.memb.webui</string>
    <key>ProgramArguments</key>
    <array>
        <string>${venvPython}</string>
        <string>${serverPy}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${path.join(membDir, 'src', 'backend')}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${path.join(homeDir, '.memb', 'webui.stdout.log')}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(homeDir, '.memb', 'webui.stderr.log')}</string>
</dict>
</plist>`;
            try {
                fs.mkdirSync(path.join(homeDir, '.memb'), { recursive: true });
                fs.writeFileSync(plistPath, plistContent);
                execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`, { stdio: 'ignore' });
                execSync(`launchctl load -w "${plistPath}" 2>/dev/null || true`, { stdio: 'ignore' });
                const isListening = await verifyDaemonListening(8088, 'memB WebUI');
                if (isListening) {
                    log.success('memB WebUI LaunchAgent active (Port 8088)');
                } else {
                    log.warn('memB WebUI daemon did not respond on Port 8088 within timeout. You may need to start it manually or check for port conflicts.');
                }
            } catch (e) { logDebug(e, 'operation'); }
        } else if (process.platform === 'win32') {
            const venvPython = path.join(membDir, '.venv', 'Scripts', 'python.exe');
            const startupDir = path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
            const vbsPath = path.join(startupDir, 'com.bdb.memb.webui.vbs');
            const workingDir = path.join(membDir, 'src', 'backend');
            const vbsContent = `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.CurrentDirectory = "${workingDir}"\r\nWshShell.Run """${venvPython}"" ""${serverPy}""", 0, False\r\n`;
            try {
                fs.mkdirSync(startupDir, { recursive: true });
                fs.writeFileSync(vbsPath, vbsContent, 'utf-8');
                spawn('wscript.exe', [vbsPath], { detached: true, stdio: 'ignore' }).unref();
                const isListening = await verifyDaemonListening(8088, 'memB WebUI');
                if (isListening) {
                    log.success('memB WebUI Windows Background Service registered & started (Port 8088)');
                } else {
                    log.warn('memB WebUI Windows daemon did not respond on Port 8088 within timeout. You may need to start it manually or check for port conflicts.');
                }
            } catch (e) { logDebug(e, 'windows memb daemon setup'); }
        }
    }
}

async function installSynapse() {
    const synapseDir = path.join(moduleBasePath(), 'bdb-synapse');
    if (!downloadOrUpdateModule('@hybridlabor-api/bdb-synapse', synapseDir, 'BDB Synapse')) {
        log.warn('Skipping Synapse setup: the module could not be downloaded.');
        return;
    }
    if (DRY_RUN) {
        log.step('[dry-run] would link synapse binary into ~/.local/bin/synapse + setup background daemon');
        return;
    }

    const isWin = process.platform === 'win32';
    let binaryPath;
    if (isWin) {
        if (fs.existsSync(path.join(synapseDir, 'bin', 'synapse.exe'))) {
            binaryPath = path.join(synapseDir, 'bin', 'synapse.exe');
        } else if (fs.existsSync(path.join(synapseDir, 'bin', 'synapse-windows-amd64.exe'))) {
            binaryPath = path.join(synapseDir, 'bin', 'synapse-windows-amd64.exe');
        } else {
            binaryPath = path.join(synapseDir, 'bin', 'synapse.js');
        }
    } else {
        binaryPath = path.join(synapseDir, 'bin', 'synapse');
        if (!fs.existsSync(binaryPath)) {
            if (process.platform === 'darwin' && fs.existsSync(path.join(synapseDir, 'bin', 'synapse-darwin-arm64'))) {
                binaryPath = path.join(synapseDir, 'bin', 'synapse-darwin-arm64');
            } else if (process.platform === 'linux' && fs.existsSync(path.join(synapseDir, 'bin', 'synapse-linux-amd64'))) {
                binaryPath = path.join(synapseDir, 'bin', 'synapse-linux-amd64');
            }
        }
    }

    if (fs.existsSync(binaryPath)) {
        if (!isWin) {
            try { fs.chmodSync(binaryPath, 0o755); } catch (e) { logDebug(e, 'operation'); }
        }
        const localBin = path.join(homeDir, '.local', 'bin');
        if (!isWin && fs.existsSync(localBin)) {
            const symlinkPath = path.join(localBin, 'synapse');
            try { fs.unlinkSync(symlinkPath); } catch (e) { logDebug(e, 'synapse unlink'); }
            try {
                fs.symlinkSync(binaryPath, symlinkPath);
                log.success('Synapse binary linked to ~/.local/bin/synapse');
            } catch (e) {
                log.step(`Synapse binary available at ${binaryPath}`);
            }
        } else {
            log.step(`Synapse binary available at ${binaryPath}`);
        }

        if (process.platform === 'darwin') {
            const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', 'com.bdb.synapse.plist');
            const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bdb.synapse</string>
    <key>ProgramArguments</key>
    <array>
        ${binaryPath.endsWith('.js') ? `<string>/usr/local/bin/node</string>\n        <string>${binaryPath}</string>` : `<string>${binaryPath}</string>`}
        <string>serve</string>
        <string>--port</string>
        <string>7781</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${synapseDir}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${path.join(homeDir, '.synapse', 'daemon.stdout.log')}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(homeDir, '.synapse', 'daemon.stderr.log')}</string>
</dict>
</plist>`;
            try {
                fs.mkdirSync(path.join(homeDir, '.synapse'), { recursive: true });
                fs.writeFileSync(plistPath, plistContent);
                execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`, { stdio: 'ignore' });
                execSync(`launchctl load -w "${plistPath}" 2>/dev/null || true`, { stdio: 'ignore' });
                const isListening = await verifyDaemonListening(7781, 'Synapse 3D');
                if (isListening) {
                    log.success('Synapse 3D LaunchAgent active (Port 7781)');
                } else {
                    log.warn('Synapse 3D daemon did not respond on Port 7781 within timeout. You may need to start it manually or check for port conflicts.');
                }
            } catch (e) { logDebug(e, 'synapse plist setup'); }
        } else if (process.platform === 'win32') {
            const startupDir = path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
            fs.mkdirSync(startupDir, { recursive: true });
            const synapseLogDir = path.join(homeDir, '.synapse');
            fs.mkdirSync(synapseLogDir, { recursive: true });
            const stdoutLog = path.join(synapseLogDir, 'daemon.stdout.log');
            const stderrLog = path.join(synapseLogDir, 'daemon.stderr.log');
            const batPath = path.join(synapseLogDir, 'run-synapse.bat');
            const runCmd = binaryPath.endsWith('.js') ? `node "${binaryPath}" serve --port 7781` : `"${binaryPath}" serve --port 7781`;
            const goBin = binaryPath.endsWith('.js') ? findWindowsGoBin() : null;
            if (binaryPath.endsWith('.js') && goBin) {
                log.step(`Synapse Windows wrapper will use Go from ${goBin}`);
            } else if (binaryPath.endsWith('.js')) {
                log.warn('Synapse Windows launcher requires Go on first run; install Go from https://go.dev/dl/ before starting the daemon.');
            }
            // WshShell.Run has no stdout/stderr redirection of its own, so a crash on launch
            // (e.g. a missing dependency the binary shells out to) used to die silently with
            // nothing to diagnose short of reading source — route through a .bat wrapper that
            // redirects to the same ~/.synapse log files the macOS launchd plist already writes.
            const goSetup = goBin
                ? `set "PATH=${goBin.replace(/%/g, '%%')};%PATH%"\r\n`
                : `where.exe go >nul 2>&1 || (echo Go is required by the Synapse launcher. Install it from https://go.dev/dl/ and restart this daemon. >> "${stderrLog}" & exit /b 1)\r\n`;
            const batContent = `@echo off\r\n${goSetup}cd /d "${synapseDir}"\r\n${runCmd} >> "${stdoutLog}" 2>> "${stderrLog}"\r\n`;
            const vbsPath = path.join(startupDir, 'com.bdb.synapse.vbs');
            const vbsContent = `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.CurrentDirectory = "${synapseDir}"\r\nWshShell.Run """${batPath}""", 0, False\r\n`;
            try {
                fs.writeFileSync(batPath, batContent, 'utf-8');
                fs.writeFileSync(vbsPath, vbsContent, 'utf-8');
                spawn('wscript.exe', [vbsPath], { detached: true, stdio: 'ignore' }).unref();
                // wscript -> WshShell.Run -> node.exe is three layers of indirection plus a cold
                // interpreter start (macOS/Linux launch a pre-built native binary instead), and a
                // freshly-downloaded synapse.js can get held up by Defender's first-run scan —
                // the default 4s budget used by every other verifyDaemonListening() call is too
                // tight for this specific path and produced false "did not respond" warnings.
                const isListening = await verifyDaemonListening(7781, 'Synapse 3D', 12000);
                if (isListening) {
                    log.success('Synapse 3D Windows Background Service registered & started (Port 7781)');
                } else {
                    log.warn(`Synapse 3D Windows daemon did not respond on Port 7781 within timeout. Check ${stderrLog} for the actual error before assuming it's just slow to start.`);
                }
            } catch (e) { logDebug(e, 'windows synapse daemon setup'); }
        }
    } else {
        log.warn(`No pre-built binary for this platform. Compile with: cd "${synapseDir}" && go build -o ${binaryName} ./cmd/synapse/`);
    }
}

async function installOpenWikiVisualizer() {
    if (DRY_RUN) {
        log.step('[dry-run] would register the OpenWiki Visualizer background daemon (Port 4321)');
        return;
    }
    if (!hasExecutable('openwiki')) {
        // Fresh machines always land here -- skipping leaves :4321 dead with
        // only a warn line. Offer the global install instead.
        let installCli = isAutoYes;
        if (!isAutoYes) {
            const answer = await askConfirm({
                message: 'OpenWiki CLI not found. Install it globally (npm install -g openwiki@latest) so the :4321 visualizer daemon can run?',
                initialValue: true,
            });
            installCli = !isCancel(answer) && !!answer;
        }
        if (installCli) {
            try {
                log.step('Installing OpenWiki CLI globally (npm install -g openwiki@latest)...');
                execSync('npm install -g openwiki@latest', { stdio: 'ignore' });
            } catch (e) { logDebug(e, 'openwiki cli install'); }
        }
        if (!hasExecutable('openwiki')) {
            log.warn('Skipping OpenWiki Visualizer setup: the openwiki CLI is not on PATH. Install it with: npm install -g openwiki@latest');
            return;
        }
        log.success('OpenWiki CLI installed.');
    }
    // launchd starts agents with a minimal PATH that never includes npm's global
    // bin dir, so resolve the absolute binary path now instead of relying on PATH at boot.
    let openwikiBin = 'openwiki';
    try {
        if (process.platform === 'win32') {
            openwikiBin = execFileSync('where.exe', ['openwiki'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)[0].trim() || 'openwiki';
        } else {
            openwikiBin = execSync('command -v openwiki', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)[0].trim() || 'openwiki';
        }
    } catch (e) { logDebug(e, 'openwiki path lookup'); }

    // The openwiki CLI is a Node script (#!/usr/bin/env node shebang). Under
    // launchd's minimal PATH there is no node either, so the agent died with
    // "env: node: No such file or directory" (exit 127) on every boot until
    // the interpreter itself is baked in as an absolute path.
    let nodeBin = 'node';
    try {
        if (process.platform === 'win32') {
            nodeBin = execFileSync('where.exe', ['node'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)[0].trim() || 'node';
        } else {
            nodeBin = execSync('command -v node', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)[0].trim() || 'node';
        }
    } catch (e) { logDebug(e, 'node path lookup'); }

    // Which wiki :4321 serves is per-machine setup configuration, not a
    // hardcoded path: every computer tracks different projects, and bare
    // `openwiki visualize` only serves ~/openwiki, which never exists (the
    // agent then exits 1 with "Wiki directory not found"). The choice is
    // persisted in ~/.openwiki/visualizer.json so Quick Update reuses it
    // without asking again; the bundled ecosystem aggregate is only the
    // first-run default.
    const visualizerConfigPath = path.join(homeDir, '.openwiki', 'visualizer.json');
    const looksLikeWiki = (dir) => fs.existsSync(path.join(dir, 'index.md'))
        || fs.existsSync(path.join(dir, 'openwiki'))
        || fs.existsSync(path.join(dir, '.openwiki'));
    const readVisualizerConfig = () => {
        try {
            const raw = JSON.parse(fs.readFileSync(visualizerConfigPath, 'utf8'));
            if (raw && typeof raw.wikiPath === 'string' && fs.existsSync(raw.wikiPath)) return raw.wikiPath;
        } catch (e) { logDebug(e, 'visualizer config read'); }
        return null;
    };
    const writeVisualizerConfig = (wikiPath) => {
        try {
            fs.mkdirSync(path.dirname(visualizerConfigPath), { recursive: true });
            fs.writeFileSync(visualizerConfigPath, JSON.stringify({ wikiPath, updatedAt: new Date().toISOString() }, null, 2));
        } catch (e) { logDebug(e, 'visualizer config write'); }
    };
    let wikiPath = readVisualizerConfig();
    const ecosystemWiki = path.join(homeDir, '.openwiki', 'ecosystem-wiki');
    const syncScript = path.join(srcDir, 'skills', 'global_config', 'openwiki-skill', 'scripts', 'sync_ecosystem_wiki.py');
    if (!wikiPath) {
        const pyBin = hasExecutable('python3') ? 'python3' : hasExecutable('python') ? 'python' : null;
        if (looksLikeWiki(ecosystemWiki)) {
            wikiPath = ecosystemWiki;
        } else if (fs.existsSync(syncScript) && pyBin) {
            try {
                execSync(`"${pyBin}" "${syncScript}"`, { stdio: 'ignore' });
                if (looksLikeWiki(ecosystemWiki)) wikiPath = ecosystemWiki;
            } catch (e) { logDebug(e, 'ecosystem wiki sync'); }
        }
        if (!wikiPath && !isAutoYes) {
            const answer = await text({
                message: `Which wiki should the :4321 visualizer serve? (directory) [default: ${ecosystemWiki}]`,
                placeholder: ecosystemWiki,
            });
            if (!isCancel(answer) && answer && answer.trim()) {
                const candidate = answer.trim().replace(/^~(?=$|\/|\\)/, homeDir);
                if (!fs.existsSync(candidate)) {
                    try { fs.mkdirSync(candidate, { recursive: true }); } catch (_) {}
                }
                if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
                    wikiPath = candidate;
                    if (!looksLikeWiki(candidate)) {
                        log.warn(`No wiki markers found in ${candidate} — the daemon may exit until a wiki is generated there.`);
                    }
                } else {
                    log.warn(`Directory not found: ${candidate} — continuing without a visualizer path.`);
                }
            }
        }
    }
    if (wikiPath) {
        writeVisualizerConfig(wikiPath);
    } else {
        log.warn('OpenWiki Visualizer: no servable wiki configured — registering without a path, the daemon will exit until a wiki exists.');
    }
    const visualizeArgs = wikiPath
        ? `<string>${nodeBin}</string>\n        <string>${openwikiBin}</string>\n        <string>visualize</string>\n        <string>${wikiPath}</string>\n        <string>--port</string>`
        : `<string>${nodeBin}</string>\n        <string>${openwikiBin}</string>\n        <string>visualize</string>\n        <string>--port</string>`;

    if (process.platform === 'darwin') {
        const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', 'com.bdb.openwiki-visualize.plist');
        const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bdb.openwiki-visualize</string>
    <key>ProgramArguments</key>
    <array>
        ${visualizeArgs}
        <string>4321</string>
        <string>--no-open</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${homeDir}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${path.join(homeDir, '.openwiki', 'visualize.stdout.log')}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(homeDir, '.openwiki', 'visualize.stderr.log')}</string>
</dict>
</plist>`;
        try {
            fs.mkdirSync(path.join(homeDir, '.openwiki'), { recursive: true });
            fs.writeFileSync(plistPath, plistContent);
            execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`, { stdio: 'ignore' });
            execSync(`launchctl load -w "${plistPath}" 2>/dev/null || true`, { stdio: 'ignore' });
            const isListening = await verifyDaemonListening(4321, 'OpenWiki Visualizer');
            if (isListening) {
                log.success('OpenWiki Visualizer LaunchAgent active (Port 4321)');
            } else {
                log.warn('OpenWiki Visualizer daemon did not respond on Port 4321 within timeout. You may need to start it manually or check for port conflicts.');
            }
        } catch (e) { logDebug(e, 'openwiki visualizer plist setup'); }
    } else if (process.platform === 'win32') {
        const startupDir = path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
        fs.mkdirSync(startupDir, { recursive: true });
        const visualizerLogDir = path.join(homeDir, '.openwiki');
        fs.mkdirSync(visualizerLogDir, { recursive: true });
        const stdoutLog = path.join(visualizerLogDir, 'visualize.stdout.log');
        const stderrLog = path.join(visualizerLogDir, 'visualize.stderr.log');
        const batPath = path.join(visualizerLogDir, 'run-openwiki-visualize.bat');
        const targetWikiArg = wikiPath ? `"${wikiPath}" ` : '';
        const runCmd = `"${openwikiBin}" visualize ${targetWikiArg}--port 4321 --no-open`;
        const batContent = `@echo off\r\ncd /d "${homeDir}"\r\n${runCmd} >> "${stdoutLog}" 2>> "${stderrLog}"\r\n`;
        const vbsPath = path.join(startupDir, 'com.bdb.openwiki-visualize.vbs');
        const vbsContent = `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.CurrentDirectory = "${homeDir}"\r\nWshShell.Run """${batPath}""", 0, False\r\n`;
        try {
            fs.writeFileSync(batPath, batContent, 'utf-8');
            fs.writeFileSync(vbsPath, vbsContent, 'utf-8');
            spawn('wscript.exe', [vbsPath], { detached: true, stdio: 'ignore' }).unref();
            // Same reasoning as the Synapse Windows path: wscript -> WshShell.Run is
            // multiple layers of indirection, so allow the generous 12s budget here too.
            const isListening = await verifyDaemonListening(4321, 'OpenWiki Visualizer', 12000);
            if (isListening) {
                log.success('OpenWiki Visualizer Windows Background Service registered & started (Port 4321)');
            } else {
                log.warn(`OpenWiki Visualizer Windows daemon did not respond on Port 4321 within timeout. Check ${stderrLog} for the actual error before assuming it's just slow to start.`);
            }
        } catch (e) { logDebug(e, 'windows openwiki visualizer daemon setup'); }
    }
}

async function installCreatorExtension() {
    const creatorDir = path.join(moduleBasePath(), 'bdb-dev-creator-extension');
    if (!downloadOrUpdateModule('@hybridlabor-api/bdb-dev-creator-extension', creatorDir, 'BDB Creator Extension')) {
        log.warn('Skipping Creator Extension setup: the module could not be downloaded.');
        return;
    }
    if (DRY_RUN) {
        log.step('[dry-run] would run BDB Creator Extension setup');
        return;
    }
    const installerScript = path.join(creatorDir, 'installer.js');
    if (fs.existsSync(installerScript)) {
        const setupResult = DRY_RUN
            ? { status: 0 }
            : spawnSync('node', [installerScript, '--auto'], { stdio: 'inherit', cwd: creatorDir });
        if (setupResult.status !== 0) {
            log.warn(`Creator Extension setup note: exit code ${setupResult.status}`);
        }
    }
}

async function installHardwarePcb() {
    const hwDir = path.join(moduleBasePath(), 'bdb-hardware-pcb');
    if (!downloadOrUpdateModule('@hybridlabor-api/bdb-hardware-pcb', hwDir, 'BDB Hardware & PCB (KiCad + OpenSCAD)')) {
        log.warn('Skipping Hardware & PCB setup: the module could not be downloaded.');
        return;
    }
    if (DRY_RUN) {
        log.step('[dry-run] would run BDB Hardware & PCB setup');
        return;
    }
    const installerScript = path.join(hwDir, 'installer.js');
    if (fs.existsSync(installerScript)) {
        const setupResult = spawnSync('node', [installerScript, '--auto'], { stdio: 'inherit', cwd: hwDir });
        if (setupResult.status !== 0) {
            log.warn(`Hardware & PCB setup note: exit code ${setupResult.status}`);
        }
    }
}

async function installOSRemoteGateway() {
    const remoteDir = path.join(moduleBasePath(), 'bdb-os-remote');
    if (!downloadOrUpdateModule('@hybridlabor-api/bdb-os-remote', remoteDir, 'BDB OS Remote Gateway')) {
        log.warn('Skipping OS Remote Gateway setup: the module could not be downloaded.');
        return;
    }
}

async function installDevToolInstaller() {
    const toolInstallerDir = path.join(moduleBasePath(), 'bdb-dev-tool-installer');
    if (!downloadOrUpdateModule('@hybridlabor-api/bdb-dev-tool-installer', toolInstallerDir, 'BDB Dev Tool Installer')) {
        log.warn('Skipping Dev Tool Installer setup: the module could not be downloaded.');
        return;
    }
}

// AO is fully supported across macOS (arm64, amd64), Linux (amd64, arm64), and Windows (amd64).
function aoSupportedHere() {
    return ['darwin', 'linux', 'win32'].includes(process.platform);
}

async function installOSAgentWorkspace() {
    if (!aoSupportedHere()) {
        log.warn(`AO is not supported on ${process.platform}/${process.arch}.`);
        return;
    }

    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const isLinux = process.platform === 'linux';

    // Discover AO directory: check local development checkouts first, then moduleBasePath
    const candidateDirs = [
        path.join(homeDir, 'dev', 'agents', 'bdb-agent-orchestrator'),
        path.join(homeDir, 'dev', 'bdb-dev', 'bdb-agent-orchestrator'),
        path.join(moduleBasePath(), 'bdb-agent-orchestrator')
    ];
    const osAgentDir = candidateDirs.find(d => fs.existsSync(d)) || candidateDirs[candidateDirs.length - 1];
    const isLocalGitRepo = fs.existsSync(path.join(osAgentDir, '.git'));

    if (isLocalGitRepo) {
        log.step(`Using local development workspace for AO: ${osAgentDir}`);
    } else {
        if (!downloadOrUpdateModule('@hybridlabor-api/bdb-agent-orchestrator', osAgentDir, 'BDB Agent Orchestrator')) {
            log.warn('Skipping AO setup: the module could not be downloaded.');
            return;
        }
    }
    if (DRY_RUN) {
        log.step('[dry-run] would link ao binary and run `ao service install`');
        return;
    }

    const localBinDir = isWin
        ? path.join(process.env.LOCALAPPDATA || homeDir, 'Programs', 'ao')
        : path.join(homeDir, '.local', 'bin');
    const binTarget = path.join(localBinDir, isWin ? 'ao.exe' : 'ao');

    // Platform-specific binary lookup
    const candidateBinaries = [];
    if (isWin) {
        candidateBinaries.push(
            path.join(osAgentDir, 'backend', 'bin', 'ao-windows-amd64.exe'),
            path.join(osAgentDir, 'backend', 'bin', 'ao.exe'),
            path.join(osAgentDir, 'backend', 'ao.exe')
        );
    } else if (isMac) {
        if (process.arch === 'arm64') {
            candidateBinaries.push(path.join(osAgentDir, 'backend', 'bin', 'ao-darwin-arm64'));
        } else {
            candidateBinaries.push(path.join(osAgentDir, 'backend', 'bin', 'ao-darwin-amd64'));
        }
        candidateBinaries.push(
            path.join(osAgentDir, 'backend', 'ao-daemon'),
            path.join(osAgentDir, 'backend', 'bin', 'ao'),
            path.join(osAgentDir, 'backend', 'ao')
        );
    } else if (isLinux) {
        if (process.arch === 'arm64') {
            candidateBinaries.push(path.join(osAgentDir, 'backend', 'bin', 'ao-linux-arm64'));
        } else {
            candidateBinaries.push(path.join(osAgentDir, 'backend', 'bin', 'ao-linux-amd64'));
        }
        candidateBinaries.push(
            path.join(osAgentDir, 'backend', 'ao-daemon'),
            path.join(osAgentDir, 'backend', 'bin', 'ao'),
            path.join(osAgentDir, 'backend', 'ao')
        );
    }
    let daemonBin = candidateBinaries.find(p => fs.existsSync(p));

    // Fallback: compile from Go source if Go is installed and binary is not pre-built
    if (!daemonBin && hasExecutable('go') && fs.existsSync(path.join(osAgentDir, 'backend', 'cmd', 'ao'))) {
        const s = spinner();
        s.start('Compiling AO daemon binary from Go source...');
        try {
            const buildTarget = path.join(osAgentDir, 'backend', 'bin', isWin ? 'ao.exe' : 'ao');
            fs.mkdirSync(path.dirname(buildTarget), { recursive: true });
            execFileSync('go', ['build', '-ldflags=-s -w', '-o', buildTarget, './cmd/ao'], {
                cwd: path.join(osAgentDir, 'backend'),
                stdio: 'ignore'
            });
            daemonBin = buildTarget;
            s.stop('Compiled AO daemon binary successfully.');
        } catch (e) {
            s.stop(`Failed to compile AO from source: ${e.message}`);
        }
    }

    // Fallback: if already installed and functional, keep it
    if (!daemonBin && fs.existsSync(binTarget)) {
        try {
            execFileSync(binTarget, ['--version'], { stdio: 'ignore' });
            log.step(`Keeping existing working AO binary at ${binTarget}`);
            daemonBin = binTarget;
        } catch (_) {}
    }

    if (!daemonBin) {
        log.warn(`AO binary missing in ${osAgentDir} — package layout changed or Go build needed.`);
        return;
    }

    if (daemonBin !== binTarget) {
        installStep('place the ao binary', () => {
            fs.mkdirSync(localBinDir, { recursive: true });
            fs.copyFileSync(daemonBin, binTarget);
            if (!isWin) {
                fs.chmodSync(binTarget, 0o755);
            }
            log.step(`Installed ao to ${binTarget}`);
        }, 'AO cannot be started without its binary.');
    }

    // macOS only: code-sign ad-hoc to prevent AMFI SIGKILL
    if (isMac) {
        try {
            execFileSync('codesign', ['-v', binTarget], { stdio: 'ignore' });
        } catch {
            log.warn('The ao binary is not code-signed — AMFI will kill it at launch.');
            try {
                execFileSync('codesign', ['-s', '-', '-f', binTarget], { stdio: 'ignore' });
                log.step('Signed it ad-hoc.');
            } catch (e) { log.warn(`Could not sign it: ${e.message}`); }
        }
    }

    // AO installs its own service, and does it for macOS, Windows and Linux.
    if (isMac) {
        const legacyPlist = path.join(homeDir, 'Library', 'LaunchAgents', 'com.bdb.agent-workspace.plist');
        if (fs.existsSync(legacyPlist)) {
            try { execFileSync('launchctl', ['unload', legacyPlist], { stdio: 'ignore' }); } catch (e) { logDebug(e, 'unload legacy ao agent'); }
            try { fs.unlinkSync(legacyPlist); log.step('Removed the old com.bdb.agent-workspace service.'); } catch (e) { logDebug(e, 'remove legacy plist'); }
        }
    }

    installStep('register the AO service', () => {
        execFileSync(binTarget, ['service', 'install'], { stdio: 'ignore' });
    }, 'Start it by hand with: ao service install');

    // Windows startup entries fire asynchronously — give the service more time
    const aoTimeout = process.platform === 'win32' ? 20000 : 8000;
    if (await verifyDaemonListening(3101, 'AO Orchestrator', aoTimeout)) {
        log.success('AO Orchestrator running on http://localhost:3101');
    } else {
        const hint = process.platform === 'win32'
            ? 'Run `ao service install` again or log out and back in, then check `ao service status`.'
            : 'Check `ao service status` and `ao service logs`.';
        log.warn(`AO did not answer on :3101 — ${hint}`);
    }
}
async function promptMemBIngestion(mcpCodeTarget) {
    if (isAutoYes || DRY_RUN) return;

    const doIngest = pick(await askConfirm({
        message: 'Scan & ingest a project directory into memB memory?',
        initialValue: false
    }));
    if (!doIngest) return;

    const answerDir = pick(await text({ message: 'Project directory path to scan [default: current workspace]' }));
    const targetDir = (answerDir || '').trim() || process.cwd();

    const includeTranscripts = pick(await askConfirm({
        message: 'Include past conversation logs/transcripts?',
        initialValue: false
    }));

    const pythonBin = process.platform === 'win32'
        ? path.join(mcpCodeTarget, 'memb-mcp', '.venv', 'Scripts', 'python.exe')
        : path.join(mcpCodeTarget, 'memb-mcp', '.venv', 'bin', 'python');

    const ingestScript = path.join(mcpCodeTarget, 'memb-mcp', 'memb_ingest.py');

    if (fs.existsSync(ingestScript) && fs.existsSync(pythonBin)) {
        const s = spinner();
        s.start(`Running memB deep ingestion on: ${targetDir}...`);
        try {
            const ingestArgs = [ingestScript, targetDir];
            if (includeTranscripts) ingestArgs.push('--transcripts');
            const ingestResult = DRY_RUN
                ? { status: 0 }
                : spawnSync(pythonBin, ingestArgs, { stdio: 'inherit' });
            if (ingestResult.status !== 0) throw new Error(`exit code ${ingestResult.status}`);
            s.stop('memB ingestion completed');
        } catch (e) {
            s.stop(`Failed to run ingestion script: ${e.message}`);
        }
    } else {
        log.warn('Ingestion script or python environment not found.');
    }
}

function verifyEcosystemInstallation() {
    const modules = [
        { name: '1. bdb-synapse', pkg: '@hybridlabor-api/bdb-synapse', paths: [path.join(moduleBasePath(), 'bdb-synapse')] },
        { name: '2. memB', pkg: '@hybridlabor-api/memb', paths: [path.join(moduleBasePath(), 'memB'), path.join(geminiDir, 'config', 'mcps', 'memb-mcp')] },
        { name: '3. heimdall-token-saver', pkg: '@hybridlabor-api/heimdall-token-saver', paths: [path.join(moduleBasePath(), 'heimdall-token-saver'), path.join(srcDir, 'vendor', 'token-saver')] },
        { name: '4. AO Agent Orchestrator', pkg: '@hybridlabor-api/bdb-agent-orchestrator', paths: [path.join(homeDir, 'dev', 'agents', 'bdb-agent-orchestrator'), path.join(moduleBasePath(), 'bdb-agent-orchestrator')] },
        { name: '5. bdb-dev-creator-extension', pkg: '@hybridlabor-api/bdb-dev-creator-extension', paths: [path.join(moduleBasePath(), 'bdb-dev-creator-extension')] },
        { name: '6. bdb-hardware-pcb', pkg: '@hybridlabor-api/bdb-hardware-pcb', paths: [path.join(moduleBasePath(), 'bdb-hardware-pcb')] },
        { name: '7. bdb-os-remote', pkg: '@hybridlabor-api/bdb-os-remote', paths: [path.join(moduleBasePath(), 'bdb-os-remote')] },
        { name: '8. bdb-dev-tool-installer', pkg: '@hybridlabor-api/bdb-dev-tool-installer', paths: [path.join(moduleBasePath(), 'bdb-dev-tool-installer')] },
        { name: '9. aos (bdb agent os)', pkg: '@hybridlabor-api/aos', paths: [srcDir] }
    ];

    for (const mod of modules) {
        let modulePkgPath = null;
        for (const p of mod.paths) {
            const candidate = path.join(p, 'package.json');
            if (fs.existsSync(candidate)) {
                modulePkgPath = candidate;
                break;
            }
        }

        if (modulePkgPath) {
            try {
                const localVer = JSON.parse(fs.readFileSync(modulePkgPath, 'utf8')).version || '1.0.0';
                let newerVersion = null;
                let newerTag = null;
                try {
                    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
                    const distTagsJson = process.platform === 'win32'
                        ? execSync(`"${npmCmd}" view ${mod.pkg} dist-tags --json`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 4000 }).trim()
                        : execFileSync(npmCmd, ['view', mod.pkg, 'dist-tags', '--json'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 4000 }).trim();
                    const distTags = JSON.parse(distTagsJson);
                    for (const [tag, ver] of Object.entries(distTags)) {
                        if (isNewerVersion(localVer, ver)) {
                            if (!newerVersion || isNewerVersion(newerVersion, ver)) {
                                newerVersion = ver;
                                newerTag = tag;
                            }
                        }
                    }
                } catch (e) { logDebug(e, 'operation'); }

                // `npm view <pkg> dist-tags --json` fetches all tags.
                // We compare every tag's version against localVer with the fixed
                // isNewerVersion(), and report an update if ANY tag is ahead.
                if (newerVersion) {
                    console.log(`  • ${colors.bold}${mod.name.padEnd(35)}${colors.reset} ➔ ${colors.yellow}⚠️  Update available (v${localVer} ➔ v${newerVersion} (${newerTag}))${colors.reset}`);
                } else {
                    console.log(`  • ${colors.bold}${mod.name.padEnd(35)}${colors.reset} ➔ ${colors.green}✅ v${localVer} (Up to date)${colors.reset}`);
                }
            } catch (e) {
                console.log(`  • ${colors.bold}${mod.name.padEnd(35)}${colors.reset} ➔ ${colors.green}✅ Installed${colors.reset}`);
            }
        } else if (mod.name.includes('token-saver') && fs.existsSync(path.join(srcDir, 'vendor', 'token-saver'))) {
            // Was a hardcoded "v2.6.3", which stopped being true the moment the
            // vendored copy moved. Read it, and say so when it cannot be read.
            let vendored = null;
            for (const f of ['package.json', 'pyproject.toml', 'VERSION']) {
                const vp = path.join(srcDir, 'vendor', 'token-saver', f);
                if (!fs.existsSync(vp)) continue;
                try {
                    const raw = fs.readFileSync(vp, 'utf8');
                    vendored = f === 'package.json'
                        ? JSON.parse(raw).version
                        : (raw.match(/^\s*version\s*=\s*["']?([\w.\-+]+)/m) || [])[1] || raw.trim().split('\n')[0];
                } catch (e) { logDebug(e, `token-saver version from ${f}`); }
                if (vendored) break;
            }
            console.log(`  • ${colors.bold}${mod.name.padEnd(35)}${colors.reset} ➔ ${colors.green}✅ ${vendored ? `v${vendored} ` : ''}(Integrated)${colors.reset}`);
        } else {
            console.log(`  • ${colors.bold}${mod.name.padEnd(35)}${colors.reset} ➔ ${colors.dim}⚪ Optional / Not downloaded${colors.reset}`);
        }
    }

    console.log('');
    console.log(`  ${colors.bold}━━━ BDB Agent OS Dashboard ━━━${colors.reset}`);
    console.log(`  Interactive Control Center: npx aos-dashboard`);
    console.log(`  ${colors.dim}(Live status & service control at http://127.0.0.1:7900)${colors.reset}`);
}

function resolveTargetPaths(platformValue, customPaths) {
    let targetSkillDir = globalConfigDir;
    let targetLegacyDir = globalLegacyDir;
    // NOT the module-level `workspaceDir` (process.cwd()-based) -- that default
    // is only correct for the Cursor branch below and the explicit Local
    // Project Harness selection (platformValue '4' with customPaths), both of
    // which are genuinely project-scoped by design. For every other platform,
    // including this function's own top-level default used by the universal
    // tier ('1'), a global Quick Update inherited a directory relative to
    // whatever the current working directory happened to be -- silently
    // harmless when cwd sat under the user's own home dir, but a hard EPERM
    // crash the one time a Windows user ran npx from C:\Windows\System32
    // (PowerShell's default start directory, unwritable for a normal user).
    let targetWorkspaceDir = path.join(homeDir, '.agents', 'workspace_skills');
    let targetMcpDir = path.join(geminiDir, 'config');
    let mcpConfigPath = path.join(targetMcpDir, 'mcp_config.json');
    // Secondary MCP stores that must receive the same servers as mcpConfigPath
    // (a harness whose CLI and GUI read different files -- see platform '2').
    let extraMcpConfigPaths = [];

    if (platformValue === '2') {
        targetSkillDir = path.join(homeDir, '.claude', 'skills');
        targetLegacyDir = path.join(homeDir, '.claude', 'skills', 'legacy');
        const claudeAppSupport = process.platform === 'win32'
            ? path.join(process.env.APPDATA || homeDir, 'Claude')
            : path.join(homeDir, 'Library', 'Application Support', 'Claude');
        targetMcpDir = claudeAppSupport;
        mcpConfigPath = path.join(claudeAppSupport, 'claude_desktop_config.json');
        // Claude Desktop and Claude Code are two products with two separate MCP
        // stores, and this one option covers both: Desktop reads
        // claude_desktop_config.json, Claude Code (CLI *and* its desktop app)
        // reads ~/.claude.json. Writing only the first left every Claude Code
        // user without the MCP servers they just installed -- and on a machine
        // without Claude Desktop it created a config for a product that isn't
        // there. universalHarnessSync() already distinguished the two; the
        // per-platform path did not.
        extraMcpConfigPaths = [path.join(homeDir, '.claude.json')];
    } else if (platformValue === '3') {
        targetSkillDir = path.join(currentDir, '.cursor', 'bdb-skills');
        targetLegacyDir = path.join(currentDir, '.cursor', 'bdb-skills', 'legacy');
        targetWorkspaceDir = path.join(currentDir, '.cursor', 'workspace_skills');
        targetMcpDir = path.join(currentDir, '.cursor');
        mcpConfigPath = path.join(targetMcpDir, 'mcp.json');
    } else if (platformValue === '5') {
        targetSkillDir = path.join(homeDir, '.codex', 'skills');
        targetLegacyDir = path.join(homeDir, '.codex', 'skills', 'legacy');
        targetMcpDir = path.join(homeDir, '.codex');
        mcpConfigPath = path.join(targetMcpDir, 'config.toml');
    } else if (platformValue === '6') {
        targetSkillDir = path.join(homeDir, '.windsurf', 'bdb-skills');
        targetLegacyDir = path.join(homeDir, '.windsurf', 'bdb-skills', 'legacy');
        targetMcpDir = path.join(homeDir, '.windsurf');
        mcpConfigPath = path.join(targetMcpDir, 'mcp.json');
    } else if (platformValue === '7') {
        targetSkillDir = path.join(homeDir, '.roo', 'bdb-skills');
        targetLegacyDir = path.join(homeDir, '.roo', 'bdb-skills', 'legacy');
        targetMcpDir = path.join(homeDir, '.roo');
        mcpConfigPath = path.join(targetMcpDir, 'mcp.json');
    } else if (platformValue === '8') {
        targetSkillDir = path.join(homeDir, '.aider', 'bdb-skills');
        targetLegacyDir = path.join(homeDir, '.aider', 'bdb-skills', 'legacy');
        targetMcpDir = path.join(homeDir, '.aider');
        mcpConfigPath = path.join(targetMcpDir, 'mcp.json');
    } else if (platformValue === '4' && customPaths) {
        targetSkillDir = customPaths.skillDir;
        targetLegacyDir = customPaths.legacyDir;
        targetWorkspaceDir = customPaths.workspaceDir;
        targetMcpDir = customPaths.mcpDir;
        mcpConfigPath = customPaths.mcpConfigPath;
    }

    return { targetSkillDir, targetLegacyDir, targetWorkspaceDir, targetMcpDir, mcpConfigPath, extraMcpConfigPaths };
}

function getTierExcludeSkills(tier) {
    // Matched against directory entry names by copyDirRecursiveSync, so these
    // carry no extension: the MCP guides became <name>/SKILL.md directories.
    return tier === '2' ? [
        'bdb-adobe-suite-mcp',
        'bdb-after-effects-mcp',
        'bdb-blender-mcp',
        'bdb-davinci-mcp',
        'bdb-grandma3-mcp',
        'bdb-resolume-mcp',
        'bdb-rhino-mcp',
        'bdb-touchdesigner-mcp',
        'bdb-unreal-mcp',
        'bdb-vectorworks-mcp',
        'bdbmediastorm'
    ] : [];
}

// Merge the BDB MCP servers into a harness's *secondary* config store without
// disturbing anything else in it. Used where one harness option covers two
// products that read different files (Claude Desktop vs Claude Code): the
// primary write above owns its file wholesale, but a secondary store belongs
// to another product and is very likely to already hold the user's own
// servers -- so this merges per server key and never replaces the file.
function mirrorMcpServersTo(extraPaths, mcpConfigStr) {
    if (!Array.isArray(extraPaths) || extraPaths.length === 0) return;

    let servers;
    try {
        servers = JSON.parse(mcpConfigStr).mcpServers;
    } catch (e) {
        logDebug(e, 'mirrorMcpServersTo: primary config is not parseable JSON');
        return;
    }
    if (!servers || typeof servers !== 'object') return;

    for (const target of extraPaths) {
        try {
            const existing = fs.existsSync(target) ? readJsonFile(target) : null;
            if (fs.existsSync(target) && !existing) {
                // Same rule as the primary merge: never overwrite a file we
                // could not parse -- the user's own servers could be in there.
                log.warn(`${path.basename(target)} is not valid JSON - MCP mirror skipped, nothing overwritten.`);
                continue;
            }
            const data = existing || {};
            data.mcpServers = data.mcpServers && typeof data.mcpServers === 'object' ? data.mcpServers : {};
            for (const [key, val] of Object.entries(servers)) data.mcpServers[key] = val;
            fs.mkdirSync(path.dirname(target), { recursive: true });
            // Carries injected API keys, same as the primary config. The `mode`
            // option only applies when writeFileSync CREATES the file -- an
            // existing 0644 file keeps its old mode -- so chmod explicitly.
            fs.writeFileSync(target, JSON.stringify(data, null, 2), { mode: 0o600 });
            try { fs.chmodSync(target, 0o600); } catch (e) { logDebug(e, 'chmod mirrored mcp config'); }
            log.step(`Mirrored MCP servers into ${target}`);
        } catch (e) {
            log.warn(`Could not mirror MCP servers into ${target}: ${e.message}`);
        }
    }
}

async function installMcpsForTarget(paths, ctx) {
    const { selectedMcps, mode, platformValue, creds } = ctx;
    const mcpSrcDir = path.join(srcDir, 'mcps');
    const mcpCodeTarget = path.join(paths.targetMcpDir, 'mcps');

    if (!selectedMcps || selectedMcps.length === 0) {
        log.step('Skipping MCP installation for this target.');
        return;
    }

    installStep(`create ${paths.targetMcpDir}`, () => {
        fs.mkdirSync(paths.targetMcpDir, { recursive: true });
        if (!fs.existsSync(mcpCodeTarget)) fs.mkdirSync(mcpCodeTarget, { recursive: true });
    }, 'The MCP steps below will most likely fail as well and are reported individually.');

    for (const mcp of selectedMcps) {
        if (mcp === CORE_MCP) {
            // memb-mcp is pulled from npm, not copied from local mcps/. See below.
            continue;
        }
        installStep(`copy the MCP server ${mcp}`, () => {
            copyDirRecursiveSync(path.join(mcpSrcDir, mcp), path.join(mcpCodeTarget, mcp));
        }, 'The remaining MCP servers are still installed.');
    }

    // CORE_MCP (memb-mcp): always pulled from the npm package rather than
    // copied from the local vendor directory.  The npm tarball is byte-identical
    // for all files that matter (run.py, memb_ingest.py, memb_auto_inject.py,
    // requirements.txt, memb/).  memb_proxy.py is intentionally NOT injected:
    // it has zero references anywhere in this repo, and the npm package ships
    // memb/proxy/main.py instead.
    if (selectedMcps.includes(CORE_MCP)) {
        const membMcpTarget = path.join(mcpCodeTarget, CORE_MCP);
        installStep(`download/update ${CORE_MCP} from npm`, () => {
            // installStep only catches a throw, and downloadOrUpdateModule
            // reports failure by returning false -- so without this the hint
            // below never printed and the MCP config was written pointing at a
            // path that had not been populated.
            if (!downloadOrUpdateModule('@hybridlabor-api/memb', membMcpTarget, 'memB MCP')) {
                throw new Error('npm pack did not produce the memb-mcp payload');
            }
        }, 'memb-mcp installation skipped; MCP config may reference a missing path.');
    }
    log.step(`Installed selected MCP servers to ${mcpCodeTarget}`);

    const nodeMcps = ['adobe_uxp_mcp', 'unreal_mcp', 'tdmcp', 'touchdesigner-mcp', 'davinci-resolve-mcp', 'after-effects-mcp', 'computer-use-mcp'];
    for (const mcpFolder of nodeMcps.filter(m => selectedMcps.includes(m))) {
        const targetFolder = path.join(mcpCodeTarget, mcpFolder);
        if (fs.existsSync(path.join(targetFolder, 'package.json'))) {
            log.step(`Setting up Node dependencies for ${mcpFolder}...`);
            const ok = runNpmWithRetry('npm install --no-audit --no-fund', { cwd: targetFolder }, `npm install for ${mcpFolder}`);
            if (ok && (fs.existsSync(path.join(targetFolder, 'tsconfig.json')) || fs.existsSync(path.join(targetFolder, 'tsconfig.build.json')))) {
                log.step(`Compiling TypeScript for ${mcpFolder}...`);
                const built = runNpmWithRetry('npm run build', { cwd: targetFolder }, `npm run build for ${mcpFolder}`);
                // runNpmWithRetry already warned with the failure detail; this
                // just makes the consequence visible now instead of only later,
                // when the config-entry check below finds the missing dist file.
                if (!built) log.warn(`${mcpFolder}: build failed -- its MCP config entry will be dropped if the expected output is missing.`);
            }
        }
    }

    if (selectedMcps.includes('davinci-resolve-mcp')) {
        const davinciFolder = path.join(mcpCodeTarget, 'davinci-resolve-mcp');
        if (fs.existsSync(davinciFolder)) {
            try {
                if (DRY_RUN) {
                    log.step('[dry-run] would bootstrap DaVinci Resolve MCP Studio');
                } else {
                    const davinciResult = spawnSync('node', ['bin/davinci-resolve-mcp.mjs', 'setup', '--clients', 'manual'], { cwd: davinciFolder, stdio: 'ignore' });
                    if (davinciResult.status !== 0 && davinciResult.error) {
                        logDebug(davinciResult.error, 'DaVinci Resolve MCP setup');
                    }
                }
            } catch (e) {
                log.warn(`Failed to setup DaVinci Python env: ${e.message}`);
            }
        }
    }

    if (selectedMcps.includes('memb-mcp')) {
        const membMcpFolder = path.join(mcpCodeTarget, 'memb-mcp');
        if (fs.existsSync(membMcpFolder)) {
            try {
                const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
                const venvPython = process.platform === 'win32'
                    ? path.join(membMcpFolder, '.venv', 'Scripts', 'python.exe')
                    : path.join(membMcpFolder, '.venv', 'bin', 'python');

                // The fs.* writes are covered by the global dry-run patch, but
                // child processes are not -- these two would really create a venv.
                if (DRY_RUN) {
                    log.step(`[dry-run] would create the memb-mcp venv in ${membMcpFolder}`);
                } else if (!fs.existsSync(venvPython)) {
                    try {
                        execSync(`uv venv --seed .venv`, { cwd: membMcpFolder, stdio: 'ignore' });
                    } catch (e1) {
                        execSync(`${pythonCmd} -m venv .venv`, { cwd: membMcpFolder, stdio: 'ignore' });
                    }
                }

                const pipViaPython = `"${venvPython}" -m pip`;
                runPipWithRetry(`${pipViaPython} install --upgrade setuptools --timeout 30 --no-input`, { cwd: membMcpFolder, stdio: 'ignore' }, 'pip setuptools upgrade for memB MCP', 2, 120000);
                runPipWithRetry(`${pipViaPython} install -r requirements.txt --timeout 30 --no-input`, { cwd: membMcpFolder, stdio: 'inherit' }, 'pip install for memB MCP', 2, 900000);
            } catch (e) {
                log.warn(`Failed to set up Python virtual environment for memB: ${e.message}`);
            }
        }
    }

    const pythonMcps = [
        { folder: 'golem-rhino-mcp', args: ['-m', 'mcp_server', '--help'], uvArgs: true },
        { folder: 'davinci-mcp-professional', args: ['main.py', '--help'], uvArgs: true },
        { folder: 'davinci-resolve-mcp-free', args: ['-r', 'requirements.txt', 'src/resolve_mcp_bridge.py', '--help'], uvArgs: true },
        { folder: 'blender-mcp', args: ['-m', 'blender_mcp.server', '--help'], uvArgs: true },
        { folder: 'vectorworks-mcp', args: ['-r', 'requirements.txt', 'app/mcp_server.py', '--help'], uvArgs: true },
        { folder: 'windows-computer-use-mcp', args: ['run_server.py', '--help'], uvArgs: true }
    ];
    for (const mcp of pythonMcps.filter(m => selectedMcps.includes(m.folder))) {
        const targetFolder = path.join(mcpCodeTarget, mcp.folder);
        if (fs.existsSync(targetFolder)) {
            const prewarmArgs = mcp.uvArgs ? ['run', ...mcp.args] : mcp.args;
            if (DRY_RUN) {
                log.step(`[dry-run] would pre-warm Python deps for ${mcp.folder}`);
                continue;
            }
            const result = spawnSync('uv', prewarmArgs, { cwd: targetFolder, stdio: 'ignore' });
            if (result.error) {
                // uv itself is missing or unrunnable. That is one machine-level
                // fact, not six per-MCP failures — say it once and stop trying.
                log.warn(`uv could not be run (${result.error.message}) — skipping the Python prewarm for the remaining MCPs.`);
                break;
            }
            if (result.status === 0) {
                log.step(`Pre-warmed Python deps for ${mcp.folder}`);
            } else {
                log.warn(`Prewarm failed for ${mcp.folder}: uv exited ${result.status}. The MCP is configured but its dependencies may not resolve.`);
            }
        }
    }

    if (fs.existsSync(paths.mcpConfigPath)) {
        installStep(`back up ${path.basename(paths.mcpConfigPath)}`, () => {
            fs.copyFileSync(paths.mcpConfigPath, path.join(backupDir, 'mcp_config_backup.json'));
        }, 'The installation continues without a backup copy of this file.');
    }

    const mcpTemplatePath = path.join(srcDir, 'mcp_config.json');
    const mcpTemplate = installStep(
        `read the MCP template ${mcpTemplatePath}`,
        () => fs.readFileSync(mcpTemplatePath, 'utf8'),
        'No MCP config is generated; the existing config stays untouched.'
    );
    let mcpConfigStr = mcpTemplate.ok ? mcpTemplate.value : '';

    const skippedMcpConfigKeys = resolveUnsupportedMcpConfigKeys();
    try {
        const parsedMcpConfig = JSON.parse(mcpConfigStr);
        // npm's Windows shim is deja.cmd, which Node refuses to spawn without
        // a shell (EINVAL since the CVE-2024-27980 fix) -- wrap the command in
        // cmd /c here so every generated config, the Codex TOML block and the
        // ~/.claude.json mirror get the launchable form.
        if (process.platform === 'win32' && parsedMcpConfig.mcpServers.deja) {
            parsedMcpConfig.mcpServers.deja = { command: 'cmd', args: ['/c', 'deja', 'mcp'] };
        }
        const finalMcpServers = {};
        const availableFolders = fs.readdirSync(mcpSrcDir);

        // A node MCP's build can fail (see above) or simply never run for a
        // dist-based server that was skipped -- either way an entry pointing
        // at a file that was never produced fails at MCP launch, far from the
        // real cause. Derive the check from each entry's own args (node's
        // first arg is always its entry script) instead of a hardcoded list of
        // MCP names, so a fifth dist-based entry added later is covered too.
        if (!DRY_RUN) {
            for (const [key, val] of Object.entries(parsedMcpConfig.mcpServers)) {
                if (val.command !== 'node' || !Array.isArray(val.args) || !val.args[0]) continue;
                const entryArg = val.args[0];
                if (!entryArg.startsWith('__MCPS_DIR__/')) continue;
                const relPath = entryArg.slice('__MCPS_DIR__/'.length);
                const mcpFolder = relPath.split('/')[0];
                if (!selectedMcps.includes(mcpFolder)) continue; // not installed at all, already handled below
                if (!fs.existsSync(path.join(mcpCodeTarget, relPath))) {
                    log.warn(`${mcpFolder}: build produced no ${relPath.slice(mcpFolder.length + 1)} -- not registering ${key}`);
                    skippedMcpConfigKeys.push(key);
                }
            }
        }

        for (const [key, val] of Object.entries(parsedMcpConfig.mcpServers)) {
            let keep = !skippedMcpConfigKeys.includes(key);
            for (const available of availableFolders) {
                if (!selectedMcps.includes(available) && JSON.stringify(val).includes(available)) {
                    keep = false;
                    break;
                }
            }
            if (keep) finalMcpServers[key] = val;
        }
        parsedMcpConfig.mcpServers = finalMcpServers;
        mcpConfigStr = JSON.stringify(parsedMcpConfig, null, 2);
    } catch (e) { logDebug(e, 'operation'); }

    const jsonEscapePath = (p) => String(p).replace(/\\/g, '\\\\');
    mcpConfigStr = mcpConfigStr.replace(/__MCPS_DIR__/g, () => jsonEscapePath(mcpCodeTarget));
    mcpConfigStr = mcpConfigStr.replace(/\{\{HOME\}\}/g, () => jsonEscapePath(homeDir));

    let uvPath = 'uv';
    try {
        if (process.platform === 'win32') {
            uvPath = execFileSync('where.exe', ['uv'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim().split(/\r?\n/)[0];
        } else {
            uvPath = execSync('command -v uv', { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim().split(/\r?\n/)[0];
        }
    } catch (e) {
        if (fs.existsSync(path.join(homeDir, '.local', 'bin', 'uv'))) uvPath = path.join(homeDir, '.local', 'bin', 'uv');
        else if (fs.existsSync(path.join(homeDir, '.cargo', 'bin', 'uv'))) uvPath = path.join(homeDir, '.cargo', 'bin', 'uv');
    }
    mcpConfigStr = mcpConfigStr.replace(/"command":\s*"uv"/g, `"command": "${uvPath.replace(/\\/g, '/')}"`);

    if (selectedMcps.includes('memb-mcp')) {
        const pythonBinPath = process.platform === 'win32'
            ? path.join(mcpCodeTarget, 'memb-mcp', '.venv', 'Scripts', 'python.exe')
            : path.join(mcpCodeTarget, 'memb-mcp', '.venv', 'bin', 'python');
        const pythonBinValue = pythonBinPath.split('\\').join('/');
        const geminiKeyValue = (creds.keyEnvName === 'GEMINI_API_KEY' ? creds.gemini : '') || process.env.GEMINI_API_KEY || '';
        mcpConfigStr = mcpConfigStr.replace(/__PYTHON_BIN__/g, () => JSON.stringify(pythonBinValue).slice(1, -1));
        mcpConfigStr = mcpConfigStr.replace(/__GEMINI_API_KEY__/g, () => JSON.stringify(geminiKeyValue).slice(1, -1));
    }

    const githubToken = (creds.github || process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '').trim();
    if (githubToken) {
        try {
            const tokenizedConfig = JSON.parse(mcpConfigStr);
            if (tokenizedConfig.mcpServers && tokenizedConfig.mcpServers.github) {
                tokenizedConfig.mcpServers.github.env = Object.assign(
                    {},
                    tokenizedConfig.mcpServers.github.env,
                    { GITHUB_PERSONAL_ACCESS_TOKEN: githubToken }
                );
                mcpConfigStr = JSON.stringify(tokenizedConfig, null, 2);
            }
        } catch (e) {
            log.warn(`Could not attach GitHub token to the github MCP entry: ${e.message}`);
        }
    }

    const existingConfigIsEmpty = () => {
        try {
            return readTextFile(paths.mcpConfigPath).trim().length === 0;
        } catch (e) {
            return false;
        }
    };

    const configName = path.basename(paths.mcpConfigPath);
    const isTomlConfig = paths.mcpConfigPath.toLowerCase().endsWith('.toml');

    if (!mcpTemplate.ok) {
        log.warn(`No MCP config was written: the template could not be read. ${configName} left untouched.`);
    } else if (isTomlConfig) {
        try {
            const skipped = mergeCodexTomlMcpServers(paths.mcpConfigPath, JSON.parse(mcpConfigStr).mcpServers || {});
            log.step(`Merged BDB MCP servers into ${configName}`);
            if (skipped.length) log.step(`Kept your own entries for: ${skipped.join(', ')}`);
        } catch (e) {
            log.warn(`Could not merge MCP servers into ${configName}: ${e.message}`);
        }
    } else if (mode === 'merge' && fs.existsSync(paths.mcpConfigPath) && !existingConfigIsEmpty()) {
        const oldConfig = readJsonFile(paths.mcpConfigPath);
        if (!oldConfig) {
            const parseError = describeJsonParseError(paths.mcpConfigPath) || 'file could not be decoded as JSON';
            const backupCopy = `${paths.mcpConfigPath}.corrupt_${timestamp}.bak`;
            const sideCarPath = `${paths.mcpConfigPath}.bdb-new.json`;
            let backupWritten = true;
            try {
                fs.copyFileSync(paths.mcpConfigPath, backupCopy);
            } catch (copyError) {
                backupWritten = false;
                log.warn(`Could not create the backup copy: ${copyError.message}`);
            }
            try {
                fs.writeFileSync(sideCarPath, mcpConfigStr, { mode: 0o600 });
                try { fs.chmodSync(sideCarPath, 0o600); } catch (e) { logDebug(e, 'chmod sideCarPath'); }
            } catch (writeError) {
                log.warn(`Could not write ${path.basename(sideCarPath)}: ${writeError.message}`);
            }
            log.warn(`${configName} is not valid JSON - merge skipped, nothing overwritten.`);
            log.warn(`Reason: ${parseError}`);
            if (backupWritten) log.warn(`Backup copy: ${backupCopy}`);
            log.warn(`BDB config: ${sideCarPath}`);
        } else {
            try {
                if (oldConfig.mcpServers) {
                    unsupportedMcpConfigKeys.forEach(key => delete oldConfig.mcpServers[key]);
                }
                const newConfig = JSON.parse(mcpConfigStr);
                const oldServers = oldConfig.mcpServers || {};
                const newServers = newConfig.mcpServers || {};
                Object.keys(newServers).forEach(key => {
                    const previous = oldServers[key];
                    const incoming = newServers[key];
                    if (!previous || typeof previous !== 'object') return;
                    if (!incoming || typeof incoming !== 'object') return;
                    if (!incoming.env && previous.env) incoming.env = previous.env;
                });
                oldConfig.mcpServers = Object.assign({}, oldServers, newServers);
                fs.writeFileSync(paths.mcpConfigPath, JSON.stringify(oldConfig, null, 2), { mode: 0o600 });
                try { fs.chmodSync(paths.mcpConfigPath, 0o600); } catch (e) { logDebug(e, 'chmod mcpConfigPath'); }
                log.step(`Merged BDB MCPs into existing ${configName}`);
            } catch (e) {
                log.warn(`Could not merge into ${configName}: ${e.message}`);
                log.warn(`${configName} was left unchanged; the backup from this run is in ${backupDir}.`);
            }
        }
    } else {
        try {
            if ((platformValue === '2' || platformValue === '4') && !fs.existsSync(paths.mcpConfigPath)) {
                const wrapper = { mcpServers: JSON.parse(mcpConfigStr).mcpServers };
                fs.writeFileSync(paths.mcpConfigPath, JSON.stringify(wrapper, null, 2), { mode: 0o600 });
                try { fs.chmodSync(paths.mcpConfigPath, 0o600); } catch (e) { logDebug(e, 'chmod mcpConfigPath wrapper'); }
            } else {
                // The generated config carries injected API keys — 0600, not umask default.
                fs.writeFileSync(paths.mcpConfigPath, mcpConfigStr, { mode: 0o600 });
                try { fs.chmodSync(paths.mcpConfigPath, 0o600); } catch (e) { logDebug(e, 'chmod mcpConfigPath str'); }
            }
            log.step(`Installed optimized MCP config to ${paths.targetMcpDir}`);
        } catch (e) {
            log.warn(`Could not write ${configName}: ${e.message}`);
            log.warn('The MCP servers were NOT registered; fix the path and re-run the installer.');
        }
    }

    mirrorMcpServersTo(paths.extraMcpConfigPaths, mcpConfigStr);

    if (creds.gemini || creds.github || creds.keyEnvName) {
        const envPath = path.join(paths.targetMcpDir, '.env');
        let envContent = '';
        let envReadable = true;
        if (fs.existsSync(envPath)) {
            const existingEnvFile = installStep(
                `read ${envPath}`,
                () => fs.readFileSync(envPath, 'utf8'),
                'The credentials are not written; entries already in the file stay as they are.'
            );
            if (existingEnvFile.ok) envContent = existingEnvFile.value + '\n';
            else envReadable = false;
        }

        const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const updateOrAppend = (key, val) => {
            if (!val) return;
            const lineRegex = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm');
            if (lineRegex.test(envContent)) {
                envContent = envContent.replace(lineRegex, () => `${key}=${val}`);
            } else {
                envContent += `${key}=${val}\n`;
            }
        };

        if (creds.gemini) updateOrAppend('GEMINI_API_KEY', creds.gemini);
        if (creds.github) updateOrAppend('GITHUB_PERSONAL_ACCESS_TOKEN', creds.github);
        if (creds.keyEnvName && creds.gemini) updateOrAppend(creds.keyEnvName, creds.gemini);

        if (envReadable && envContent.trim().length > 0) {
            installStep(`save the credentials to ${envPath}`, () => {
                fs.writeFileSync(envPath, envContent.trim() + '\n', { mode: 0o600 });
                try { fs.chmodSync(envPath, 0o600); } catch (e) { logDebug(e, 'chmod envPath'); }
                log.step(`Saved credentials to ${envPath}`);
            }, 'Set GEMINI_API_KEY / GITHUB_PERSONAL_ACCESS_TOKEN yourself, or fix the path and re-run the installer.');
        }
    }
}

// Single source of truth for parsing .agents/agents.md into structured agent
// records. Used by every compiler (Claude Code, OpenCode, Antigravity) so a
// format change only needs a fix in one place. Requires a "- **Role**:" field
// to treat a "## " block as an agent -- this is what excludes trailing
// non-agent sections like "## Context Boot Sequence" from being compiled as
// a bogus agent (previously the Antigravity-only inline parser had no such
// guard). Name extraction strips any leading non-word characters (emoji,
// spaces) rather than matching the first alphanumeric run anywhere in the
// block, so it can't accidentally pick up a word from prose if the heading
// format changes.
function parseAgentsMd(content) {
    const blocks = content.split(/\n## /).slice(1);
    const agents = [];
    for (const raw of blocks) {
        const headingLine = raw.split('\n')[0];
        const name = headingLine.replace(/^[^\w]+/, '').trim().split(/\s+/)[0];
        if (!name) continue;

        const roleMatch = raw.match(/-\s*\*\*Role\*\*:\s*(.+)/);
        if (!roleMatch) continue; // not an agent block

        const modelMatch = raw.match(/-\s*\*\*Model\*\*:\s*(.+)/);
        const outputMatch = raw.match(/-\s*\*\*Output Artifacts?\*\*:\s*(.+)/);

        const extractListAfter = (label) => {
            const re = new RegExp(`-\\s*\\*\\*${label}\\*\\*:\\s*\\n((?:[ \\t]+-.*\\n?)*)`, 'm');
            const m = raw.match(re);
            if (!m) return [];
            return m[1]
                .split('\n')
                .map((l) => l.trim())
                .filter((l) => l.startsWith('-'))
                .map((l) => l.replace(/^-\s*/, '').replace(/`/g, '').trim())
                .filter(Boolean);
        };

        agents.push({
            name,
            role: roleMatch[1].trim(),
            model: modelMatch ? modelMatch[1].trim() : null,
            skills: extractListAfter('Primary Skills'),
            mcpServers: extractListAfter('MCP Servers'),
            output: outputMatch ? outputMatch[1].trim() : null,
            systemPrompt: raw.trim(),
        });
    }
    return agents;
}

// A role description is free text that may contain ": " (colon-space), which
// breaks an unquoted YAML plain scalar the moment a future role happens to
// use it (e.g. "Reviews: what changed"). Double-quoting defensively, with the
// two characters that would break a double-quoted scalar escaped, costs
// nothing when it's not needed and avoids a silent frontmatter-parse failure
// when it is.
function yamlQuote(str) {
    return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

// Canonical model tiers mapped to verified provider-specific model IDs for each harness.
// Protects against vendor model churn and provides seamless cross-harness defaults.
const CANONICAL_TIERS = {
    reasoning_max: {
        claude: 'opus',
        antigravity: 'gemini-3.1-pro-high',
        opencode: 'opencode/muse-spark-1.3-contributor-free',
        codex: 'o3-mini'
    },
    standard_fast: {
        claude: 'sonnet',
        antigravity: 'gemini-3.8-flash-high',
        opencode: 'opencode/muse-spark-1.3-contributor-free',
        codex: 'gpt-4o'
    },
    trivial_low: {
        claude: 'haiku',
        antigravity: 'gemini-3.8-flash-low',
        opencode: 'opencode/muse-spark-1.3-contributor-free',
        codex: 'gpt-4o-mini'
    }
};

// Loads .aos/pipeline.json or .aos/project.json containing role-to-model/harness mappings.
function loadPipelineConfig(projectDir = currentDir) {
    const candidates = [
        path.join(projectDir, '.aos', 'pipeline.json'),
        path.join(projectDir, '.aos', 'project.json'),
        path.join(homeDir, '.aos', 'pipeline.json')
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            try {
                const data = JSON.parse(fs.readFileSync(p, 'utf8'));
                if (data && data.pipeline) return data.pipeline;
            } catch {}
        }
    }
    return null;
}

// Resolves model ID, tier, and enabled status for a given agent role and target harness.
function resolveAgentConfig(agentSlug, harness, pipelineConfig = null) {
    const normSlug = agentSlug.toLowerCase().replace(/-/g, '_');
    const roleCfg = pipelineConfig ? (pipelineConfig[normSlug] || pipelineConfig[agentSlug]) : null;
    if (roleCfg) {
        if (roleCfg.model) {
            return {
                model: roleCfg.model,
                tier: roleCfg.tier || 'custom',
                enabled: roleCfg.enabled !== false,
                harness: roleCfg.harness || harness
            };
        }
        if (roleCfg.tier && CANONICAL_TIERS[roleCfg.tier] && CANONICAL_TIERS[roleCfg.tier][harness]) {
            return {
                model: CANONICAL_TIERS[roleCfg.tier][harness],
                tier: roleCfg.tier,
                enabled: roleCfg.enabled !== false,
                harness: roleCfg.harness || harness
            };
        }
    }
    const defaultTier = (normSlug === 'architect' || normSlug === 'reviewer') ? 'reasoning_max' : 'standard_fast';
    const fallbackModel = (CANONICAL_TIERS[defaultTier] && CANONICAL_TIERS[defaultTier][harness]) || 'inherit';
    return { model: fallbackModel, tier: defaultTier, enabled: true, harness };
}

// Generates .claude/agents/<name>.md — Claude Code's native subagent format.
// Only frontmatter fields confirmed against code.claude.com/docs/en/sub-agents
// are emitted (name, description, model).
function compileClaudeAgents(agents, targetDir, pipelineConfig = null) {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const a of agents) {
        const slug = a.name.toLowerCase().replace(/_/g, '-');
        const resolved = resolveAgentConfig(slug, 'claude', pipelineConfig);
        const model = (resolved && resolved.model) ? resolved.model.toLowerCase() : (a.model ? a.model.toLowerCase() : 'inherit');
        const body = [
            a.role,
            a.skills.length ? `**Primary skills:** ${a.skills.join(', ')}` : null,
            a.mcpServers.length ? `**MCP servers used:** ${a.mcpServers.join(', ')}` : null,
            a.output ? `**Output artifact(s):** ${a.output}` : null,
        ].filter(Boolean).join('\n\n');

        const frontmatter = [
            '---',
            `name: ${slug}`,
            `description: ${yamlQuote(a.role)}`,
            `model: ${model}`,
            '---',
            '',
        ].join('\n');

        fs.writeFileSync(path.join(targetDir, `${slug}.md`), frontmatter + body + '\n');
    }
}

// Generates .opencode/agents/<name>.md. Emits description, mode: subagent, and model.
function compileOpenCodeAgents(agents, targetDir, pipelineConfig = null) {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const a of agents) {
        const slug = a.name.toLowerCase().replace(/_/g, '-');
        const resolved = resolveAgentConfig(slug, 'opencode', pipelineConfig);
        const model = resolved && resolved.model ? resolved.model : null;
        const body = [
            a.role,
            a.skills.length ? `**Primary skills:** ${a.skills.join(', ')}` : null,
            a.mcpServers.length ? `**MCP servers used:** ${a.mcpServers.join(', ')}` : null,
            a.output ? `**Output artifact(s):** ${a.output}` : null,
        ].filter(Boolean).join('\n\n');

        const frontmatterLines = [
            '---',
            `description: ${yamlQuote(a.role)}`,
            'mode: subagent',
        ];
        if (model) {
            frontmatterLines.push(`model: ${model}`);
        }
        frontmatterLines.push('---', '');

        fs.writeFileSync(path.join(targetDir, `${slug}.md`), frontmatterLines.join('\n') + body + '\n');
    }
}

// Generates .codex/agents/<name>.toml and .codex/agents/<name>.md for ChatGPT Codex CLI.
function compileCodexAgents(agents, targetDir, pipelineConfig = null) {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const a of agents) {
        const slug = a.name.toLowerCase().replace(/_/g, '-');
        const resolved = resolveAgentConfig(slug, 'codex', pipelineConfig);
        const model = resolved && resolved.model ? resolved.model : 'o3-mini';

        const tomlContent = [
            `# Codex subagent configuration for ${slug}`,
            `name = "${slug}"`,
            `description = ${JSON.stringify(a.role)}`,
            `model = "${model}"`,
            `tier = "${resolved.tier || 'standard_fast'}"`,
            `enabled = ${resolved.enabled !== false}`,
            `prompt_file = "${slug}.md"`
        ].join('\n');
        fs.writeFileSync(path.join(targetDir, `${slug}.toml`), tomlContent + '\n');

        const body = [
            `# Role: ${a.name}`,
            a.role,
            a.skills.length ? `**Primary skills:** ${a.skills.join(', ')}` : null,
            a.mcpServers.length ? `**MCP servers used:** ${a.mcpServers.join(', ')}` : null,
            a.output ? `**Output artifact(s):** ${a.output}` : null,
            '',
            '## Instructions',
            a.systemPrompt
        ].filter(Boolean).join('\n\n');
        fs.writeFileSync(path.join(targetDir, `${slug}.md`), body + '\n');
    }
}


function injectHarnessRules() {
    const geminiMdSrc = path.join(srcDir, 'GEMINI.md');
    const agentsMdSrc = path.join(srcDir, '.agents', 'agents.md');

    if (fs.existsSync(geminiMdSrc)) {
        installStep(`install GEMINI.md to ${path.join(geminiDir, 'GEMINI.md')}`, () => {
            copyDirRecursiveSync(geminiMdSrc, path.join(geminiDir, 'GEMINI.md'));
            log.step(`Installed GEMINI.md to ${path.join(geminiDir, 'GEMINI.md')}`);
        }, 'The harness injection below still runs.');

        // Dispatcher scripts must land in ~/.claude/workflows/, because that is
        // where the skills that route to them look: startcycle-graph's SKILL.md
        // and teamwork-preview's both tell the model to call `Workflow` with
        // scriptPath `$HOME/.claude/workflows/<name>.mjs`. installProjectHarness()
        // copies them into a *project*, which only helps a project that opted into
        // the local harness -- on a plain global install those paths did not exist
        // at all, so the skill pointed at a file that was never delivered.
        installStep(`install dispatcher workflows to ${path.join(homeDir, '.claude', 'workflows')}`, () => {
            const workflowsSrc = path.join(srcDir, '.claude', 'workflows');
            if (fs.existsSync(workflowsSrc)) {
                copyDirRecursiveSync(workflowsSrc, path.join(homeDir, '.claude', 'workflows'));
                log.step(`Installed dispatcher workflows to ${path.join(homeDir, '.claude', 'workflows')}`);
            }
        }, '/startcycle-graph and /teamwork-preview fall back to their prose protocols.');

        const startcycleWorkflowSrc = path.join(srcDir, '.agents', 'workflows', 'startcycle.md');
        const sources = installStep('read the global rule sources', () => ({
            globalRules: fs.readFileSync(geminiMdSrc, 'utf8'),
            startcycleContent: fs.existsSync(startcycleWorkflowSrc) ? fs.readFileSync(startcycleWorkflowSrc, 'utf8') : '',
            agentsMdContent: fs.existsSync(agentsMdSrc) ? fs.readFileSync(agentsMdSrc, 'utf8') : ''
        }), 'Cursor, Claude, Copilot and Codex keep their current instruction files.');

        if (sources.ok) {
            const { globalRules, startcycleContent, agentsMdContent } = sources.value;

            const cursorRulesDir = path.join(currentDir, '.cursor', 'rules');
            installStep(`write the Cursor rules to ${cursorRulesDir}`, () => {
                fs.mkdirSync(cursorRulesDir, { recursive: true });
                fs.writeFileSync(path.join(cursorRulesDir, '000_global_rules.mdc'), `---\nname: global-rules\ndescription: Global BDB Agent Rules\n---\n\n${globalRules}`);
                if (startcycleContent) {
                    fs.writeFileSync(path.join(cursorRulesDir, 'startcycle.mdc'), `---\nname: startcycle\ndescription: Autonomous Multi-Agent Development Pipeline (/startcycle)\n---\n\n${startcycleContent}`);
                }
                if (agentsMdContent) {
                    fs.writeFileSync(path.join(cursorRulesDir, 'bdb_agents.mdc'), `---\nname: bdb-agents\ndescription: BDB Multi-Agent Team Specifications\n---\n\n${agentsMdContent}`);
                }
                log.step(`Injected Cursor Rules to ${cursorRulesDir}`);
            }, 'Cursor keeps its existing rules.');

            installStep('compile Antigravity subagents', () => {
                if (agentsMdContent) {
                    const agyAgentsDir = path.join(geminiDir, 'config', 'agents');
                    if (!fs.existsSync(agyAgentsDir)) fs.mkdirSync(agyAgentsDir, { recursive: true });

                    const pipelineConfig = loadPipelineConfig();
                    const agents = parseAgentsMd(agentsMdContent);
                    for (const a of agents) {
                        const slug = a.name.toLowerCase().replace(/_/g, '-');
                        const resolved = resolveAgentConfig(slug, 'antigravity', pipelineConfig);
                        const agentConfig = {
                            name: a.name,
                            description: a.role,
                            model: resolved.model,
                            model_tier: resolved.tier,
                            enable_write_tools: true,
                            enable_subagent_tools: true,
                            enable_mcp_tools: true,
                            system_prompt: a.systemPrompt,
                            _comment: "Auto-compiled from AGENTS.md by installer.js"
                        };
                        fs.writeFileSync(path.join(agyAgentsDir, `${a.name}.json`), JSON.stringify(agentConfig, null, 2));
                    }
                    log.step(`Compiled AGENTS.md to native Antigravity subagents in ${agyAgentsDir}`);
                }
            }, 'Antigravity agents unchanged');

            installStep('compile Claude Code subagents', () => {
                if (agentsMdContent) {
                    const pipelineConfig = loadPipelineConfig();
                    const agents = parseAgentsMd(agentsMdContent);
                    const claudeAgentsDir = path.join(homeDir, '.claude', 'agents');
                    compileClaudeAgents(agents, claudeAgentsDir, pipelineConfig);
                    log.step(`Compiled AGENTS.md to Claude Code subagents in ${claudeAgentsDir}`);
                }
            }, 'Claude Code agents unchanged');

            installStep('compile OpenCode subagents', () => {
                if (agentsMdContent) {
                    const pipelineConfig = loadPipelineConfig();
                    const agents = parseAgentsMd(agentsMdContent);
                    const opencodeAgentsDir = path.join(homeDir, '.opencode', 'agents');
                    compileOpenCodeAgents(agents, opencodeAgentsDir, pipelineConfig);
                    log.step(`Compiled AGENTS.md to OpenCode subagents in ${opencodeAgentsDir}`);
                }
            }, 'OpenCode agents unchanged');

            installStep('compile Codex subagents', () => {
                if (agentsMdContent) {
                    const pipelineConfig = loadPipelineConfig();
                    const agents = parseAgentsMd(agentsMdContent);
                    const codexAgentsDir = path.join(homeDir, '.codex', 'agents');
                    compileCodexAgents(agents, codexAgentsDir, pipelineConfig);
                    log.step(`Compiled AGENTS.md to Codex subagents in ${codexAgentsDir}`);
                }
            }, 'Codex agents unchanged');

            const claudeMdPath = path.join(currentDir, 'CLAUDE.md');
            installStep(`sync ${claudeMdPath}`, () => {
                let claudeContent = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, 'utf8') : '';
                // A CLAUDE.md carrying this title is the short, hand-maintained
                // form (see docs/sessions/audit-agents.md F-01): the GO gate lives in a hook,
                // not in this file's prose, and the /startcycle spec + agent
                // roster live in their own skill/workflow files, not duplicated
                // here. Re-appending the old long-form content on every install
                // would silently undo that diet. Leave it alone.
                const isManagedShortForm = claudeContent.includes('BDB Agent Skills — Global Instructions');
                if (isManagedShortForm) {
                    log.step('CLAUDE.md already uses the short managed form -- leaving it untouched.');
                } else {
                    if (!claudeContent.includes("Global Agent Instructions")) {
                        claudeContent = `${claudeContent}\n\n${globalRules}`.trim();
                    }
                    if (startcycleContent && !claudeContent.includes("Autonomous Development Cycle Workflow")) {
                        claudeContent = `${claudeContent}\n\n---\n\n${startcycleContent}`.trim();
                    }
                    fs.writeFileSync(claudeMdPath, claudeContent);
                    log.step('Synced CLAUDE.md with Global Rules and /startcycle workflow');
                }
            }, 'CLAUDE.md is unchanged.');

            const copilotPath = path.join(currentDir, '.github', 'copilot-instructions.md');
            if (fs.existsSync(path.dirname(copilotPath))) {
                installStep(`inject the global rules into ${copilotPath}`, () => {
                    const copilotContent = fs.existsSync(copilotPath) ? fs.readFileSync(copilotPath, 'utf8') : '';
                    if (!copilotContent.includes("Global Agent Instructions")) {
                        fs.appendFileSync(copilotPath, `\n\n${globalRules}`);
                        log.step(`Injected Global Rules to ${copilotPath}`);
                    }
                }, 'copilot-instructions.md is unchanged.');
            }

            const codexDirLocal = path.join(currentDir, '.codex-plugin');
            installStep(`sync ${path.join(codexDirLocal, 'system.md')}`, () => {
                fs.mkdirSync(codexDirLocal, { recursive: true });
                const codexPath = path.join(codexDirLocal, 'system.md');
                let codexContent = fs.existsSync(codexPath) ? fs.readFileSync(codexPath, 'utf8') : '';
                if (!codexContent.includes("Global Agent Instructions")) {
                    codexContent = `${codexContent}\n\n${globalRules}`.trim();
                }
                if (startcycleContent && !codexContent.includes("Autonomous Development Cycle Workflow")) {
                    codexContent = `${codexContent}\n\n---\n\n${startcycleContent}`.trim();
                }
                fs.writeFileSync(codexPath, codexContent);
                log.step('Synced .codex-plugin/system.md with Global Rules and /startcycle workflow');
            }, '.codex-plugin/system.md is unchanged.');
        }
    }

    if (fs.existsSync(agentsMdSrc)) {
        const rooModesPath = path.join(currentDir, '.roomodes');
        const rooModesData = {
            customModes: [
                { slug: "planner-orchestrator", name: "Planner Orchestrator", roleDefinition: "Lead System Planner & Task Decomposer. Analyzes prompts, /bdbrainstorm, and orchestrates /startcycle.", groups: ["read", "browser", "command"] },
                { slug: "godmode-ui-ux", name: "Godmode UI/UX", roleDefinition: "Lead Frontend Designer & UI Engineer. Anti-Slop, DTCG design tokens, fluid motion, React/Tailwind.", groups: ["read", "edit", "browser", "command"] },
                { slug: "godmode-engineering", name: "Godmode Engineering", roleDefinition: "Senior Fullstack & Backend Engineer. DDD, Clean Architecture, TDD, TypeScript/Python.", groups: ["read", "edit", "browser", "command"] },
                { slug: "godmode-eventtech", name: "Godmode EventTech", roleDefinition: "Architectural Authority for Real-Time Performance, Signal Flow, and Hardware Limits in live environments.", groups: ["read", "edit", "mcp", "command"] },
                { slug: "godmode-media-creation", name: "Godmode Media Creation", roleDefinition: "AI Video Production & Pipeline Orchestrator.", groups: ["read", "edit", "mcp", "command"] },
                { slug: "godmode-3d-creation", name: "Godmode 3D Creation", roleDefinition: "AI 3D Generation & Asset Architect. Master of TRELLIS, TripoSR, and Text-to-CAD MCPs.", groups: ["read", "edit", "mcp", "command"] },
                { slug: "godmode-shipping", name: "Godmode Shipping", roleDefinition: "Release Gatekeeper & Quality Auditor.", groups: ["read", "command"] }
            ]
        };
        installStep(`write ${rooModesPath}`, () => {
            fs.writeFileSync(rooModesPath, JSON.stringify(rooModesData, null, 2));
            log.step(`Synced Roo Code custom modes to ${rooModesPath}`);
        }, 'Roo Code keeps its existing custom modes.');

        installStep('copy harness directories', () => {
            const harnessDirs = ['.agents', '.cursor/rules', '.claude', '.github', '.codex-plugin'];
            harnessDirs.forEach(dir => {
                const sourcePath = path.join(srcDir, dir);
                if (fs.existsSync(sourcePath)) {
                    const targetPath = path.join(homeDir, dir);
                    // settings.json is merged separately below: a wholesale
                    // copy would clobber user-owned keys like enabledPlugins.
                    const exclude = dir === '.claude' ? ['settings.json'] : [];
                    copyDirRecursiveSync(sourcePath, targetPath, exclude);
                    log.step(`Copied ${dir} to ${targetPath}`);
                }
            });
            installGlobalHooks();
        }, '');

        installStep('sync global .agents/', () => {
            const globalAgentsDir = path.join(os.homedir(), '.agents');
            const agentsDirSrc = path.join(srcDir, '.agents');
            if (fs.existsSync(agentsDirSrc)) {
                copyDirRecursiveSync(agentsDirSrc, globalAgentsDir);
                log.step(`Synced global .agents/ to ${globalAgentsDir}`);
            }
        }, 'agents.md and workflows/startcycle.md may be missing globally.');
    }
}

// Deliver the hook scripts to ~/.claude/hooks/ and wire them in settings.json.
// Both the full install and Quick Update funnel through here. Quick Update used
// to do neither: it refreshes skills and submodules, but hooks are harness
// plumbing rather than skills, so an existing install updating to a version
// that adds or changes a hook silently never received it -- which is exactly
// what happened to memb-inject.mjs in v4.4.0, on the machines that needed it
// most (a fresh install got it; every machine that already had AOS did not).
function installGlobalHooks({ targetHome = homeDir, targetGemini = geminiDir } = {}) {
    const hooksSrc = path.join(srcDir, '.claude', 'hooks');
    const workflowsSrc = path.join(srcDir, '.claude', 'workflows');

    // 1. Claude Code
    if (fs.existsSync(hooksSrc)) {
        copyDirRecursiveSync(hooksSrc, path.join(targetHome, '.claude', 'hooks'));
        log.step(`Installed hooks to ${path.join(targetHome, '.claude', 'hooks')}`);
    }
    if (fs.existsSync(workflowsSrc)) {
        copyDirRecursiveSync(workflowsSrc, path.join(targetHome, '.claude', 'workflows'));
    }
    mergeBdbSettingsHooks(path.join(targetHome, '.claude', 'settings.json'));

    // 2. Google Antigravity
    const agyHooksDir = path.join(targetGemini, 'config', 'hooks');
    const agyWorkflowsDir = path.join(targetGemini, 'config', 'workflows');
    if (fs.existsSync(hooksSrc)) {
        copyDirRecursiveSync(hooksSrc, agyHooksDir);
        log.step(`Installed hooks to ${agyHooksDir}`);
    }
    if (fs.existsSync(workflowsSrc)) {
        copyDirRecursiveSync(workflowsSrc, agyWorkflowsDir);
    }
    mergeAntigravityHooks(path.join(targetGemini, 'config', 'hooks.json'));
    const agyCliDir = path.join(targetGemini, 'antigravity-cli');
    if (fs.existsSync(agyCliDir)) {
        const agyCliHooksDir = path.join(agyCliDir, 'hooks');
        const agyCliWorkflowsDir = path.join(agyCliDir, 'workflows');
        if (fs.existsSync(hooksSrc)) {
            copyDirRecursiveSync(hooksSrc, agyCliHooksDir);
            log.step(`Installed hooks to ${agyCliHooksDir}`);
        }
        if (fs.existsSync(workflowsSrc)) {
            copyDirRecursiveSync(workflowsSrc, agyCliWorkflowsDir);
        }
        mergeAntigravityHooks(path.join(agyCliDir, 'hooks.json'));
    }

    // 3. OpenAI Codex CLI
    const codexHooksDir = path.join(targetHome, '.codex', 'hooks');
    const codexWorkflowsDir = path.join(targetHome, '.codex', 'workflows');
    if (fs.existsSync(hooksSrc)) {
        copyDirRecursiveSync(hooksSrc, codexHooksDir);
        log.step(`Installed hooks to ${codexHooksDir}`);
    }
    if (fs.existsSync(workflowsSrc)) {
        copyDirRecursiveSync(workflowsSrc, codexWorkflowsDir);
    }
    mergeCodexTomlHooks(path.join(targetHome, '.codex', 'config.toml'));

    // 4. OpenCode CLI
    const opencodeDir = process.platform === 'win32'
        ? path.join(process.env.APPDATA || targetHome, 'opencode')
        : path.join(targetHome, '.config', 'opencode');
    const opencodePluginSrc = path.join(srcDir, '.opencode', 'plugins', 'bdb-aos.js');
    if (fs.existsSync(opencodePluginSrc)) {
        const opencodePluginsDir = path.join(opencodeDir, 'plugins');
        const opencodePluginDest = path.join(opencodePluginsDir, 'bdb-aos.js');
        try {
            fs.mkdirSync(opencodePluginsDir, { recursive: true });
            fs.copyFileSync(opencodePluginSrc, opencodePluginDest);
            try { fs.chmodSync(opencodePluginDest, 0o644); } catch (e) { logDebug(e, 'chmod opencode plugin'); }
            log.step(`Installed OpenCode plugin to ${opencodePluginDest}`);
        } catch (e) {
            log.warn(`Could not install OpenCode plugin: ${e.message}`);
        }
    }

    // 5. Global CLI launcher binaries (aos-config, aos-dashboard, aos-uninstall)
    installGlobalBinaries();
}

function installGlobalBinaries() {
    const binSrc = path.join(srcDir, 'bin');
    const globalAgentsBin = path.join(homeDir, '.agents', 'bin');
    if (fs.existsSync(binSrc)) {
        copyDirRecursiveSync(binSrc, globalAgentsBin);
        log.step(`Installed CLI binaries to ${globalAgentsBin}`);
    }

    const localBinDir = path.join(homeDir, '.local', 'bin');
    if (!fs.existsSync(localBinDir)) {
        try { fs.mkdirSync(localBinDir, { recursive: true }); } catch (e) { logDebug(e, 'mkdir localBin'); }
    }

    const isWin = process.platform === 'win32';
    const cliBins = ['aos-config', 'aos-dashboard', 'aos-uninstall', 'aos-store', 'aos-doctor'];

    for (const name of cliBins) {
        const targetMjs = path.join(globalAgentsBin, `${name}.mjs`);
        if (!fs.existsSync(targetMjs)) continue;

        // Shell wrapper for Unix / Git Bash
        const shPath = path.join(localBinDir, name);
        const shContent = `#!/bin/sh\nexec node "${targetMjs}" "$@"\n`;
        try {
            fs.writeFileSync(shPath, shContent, { mode: 0o755 });
            try { fs.chmodSync(shPath, 0o755); } catch (e) { logDebug(e, `chmod ${shPath}`); }
        } catch (e) { logDebug(e, `write ${shPath}`); }

        // Windows CMD and PowerShell launchers
        if (isWin) {
            const cmdPath = path.join(localBinDir, `${name}.cmd`);
            const cmdContent = `@echo off\r\nnode "${targetMjs}" %*\r\n`;
            try { fs.writeFileSync(cmdPath, cmdContent); } catch (e) { logDebug(e, `write ${cmdPath}`); }

            const ps1Path = path.join(localBinDir, `${name}.ps1`);
            const ps1Content = `node "${targetMjs}" $args\r\n`;
            try { fs.writeFileSync(ps1Path, ps1Content); } catch (e) { logDebug(e, `write ${ps1Path}`); }
        }
    }
    log.step(`Wired CLI launcher binaries (aos-config, aos-dashboard, aos-uninstall) in ${localBinDir}`);
}

// Merge the BDB hooks -- the two gates plus the memB ambient-memory hook --
// into a Claude Code settings.json without clobbering
// user-owned keys (v3.13 audit BLOCKER-3: the harness-dir copy used to
// overwrite the file wholesale, silently dropping e.g. enabledPlugins). Only
// BDB-owned hook entries -- identified by their script name inside `command` --
// are replaced or added; every other key and every foreign hook entry survives
// untouched. With projectLocal, `${HOME}` hook paths are rewritten to
// `$CLAUDE_PROJECT_DIR` so a project harness is self-contained on every
// collaborator's checkout -- the shipped template already writes the gates
// with `$CLAUDE_PROJECT_DIR` directly, so today that rewrite is a safety net
// for a future `${HOME}`-written gate rather than machinery in active use. If the existing file is not valid JSON(C), nothing
// is overwritten: the original is backed up as .corrupt_<ts>.bak and the
// merged result goes to a .bdb-new.json sidecar -- the same recovery pattern
// the MCP config merge in installMcpsForTarget uses.
function mergeBdbSettingsHooks(settingsPath, { projectLocal = false } = {}) {
    const bdbHookScripts = ['go-gate.mjs', 'graph-gate.mjs', 'memb-inject.mjs', 'trail-relay.mjs'];
    // memb-inject reads the machine-global memB store under $HOME and is
    // installed once per machine, so it stays $HOME-anchored even inside a
    // project harness -- unlike the two gate hooks, which are per-checkout by
    // design. Pointing it at $CLAUDE_PROJECT_DIR would make it fail on every
    // prompt in any project the harness was never installed into. trail-relay
    // talks to machine-global live-map daemons, so it is anchored the same way.
    const machineGlobalHooks = ['memb-inject.mjs', 'trail-relay.mjs'];
    const isBdbEntry = (entry) => {
        const cmds = (entry && Array.isArray(entry.hooks) ? entry.hooks : [])
            .map((h) => (h && typeof h.command === 'string' ? h.command : ''))
            .join(' ');
        return bdbHookScripts.some((name) => cmds.includes(name));
    };
    const localize = (cmd) => (projectLocal && !machineGlobalHooks.some((n) => cmd.includes(n))
        ? cmd.split('${HOME}').join('$CLAUDE_PROJECT_DIR')
        : cmd);
    const cloneBdbEntries = (entries) =>
        JSON.parse(JSON.stringify(entries)).map((e) => ({
            ...e,
            hooks: (e.hooks || []).map((h) => (typeof h.command === 'string' ? { ...h, command: localize(h.command) } : h)),
        }));

    const buildMerged = (existing) => {
        const merged = existing && typeof existing === 'object' ? existing : {};
        merged.hooks = merged.hooks && typeof merged.hooks === 'object' ? merged.hooks : {};
        const repoSettings = readJsonFile(path.join(srcDir, '.claude', 'settings.json')) || {};
        for (const [event, entries] of Object.entries(repoSettings.hooks || {})) {
            if (!Array.isArray(entries)) continue;
            const foreignEntries = (Array.isArray(merged.hooks[event]) ? merged.hooks[event] : [])
                .filter((e) => !isBdbEntry(e));
            merged.hooks[event] = [...foreignEntries, ...cloneBdbEntries(entries)];
        }
        return merged;
    };

    let existing = null;
    if (fs.existsSync(settingsPath)) {
        existing = readJsonFile(settingsPath);
        if (!existing) {
            const backupCopy = `${settingsPath}.corrupt_${timestamp}.bak`;
            const sideCarPath = `${settingsPath}.bdb-new.json`;
            let backupWritten = true;
            try {
                fs.copyFileSync(settingsPath, backupCopy);
            } catch (copyError) {
                backupWritten = false;
                log.warn(`Could not create the settings backup: ${copyError.message}`);
            }
            try {
                fs.writeFileSync(sideCarPath, JSON.stringify(buildMerged(null), null, 2) + '\n');
            } catch (writeError) {
                log.warn(`Could not write ${path.basename(sideCarPath)}: ${writeError.message}`);
            }
            log.warn(`${path.basename(settingsPath)} is not valid JSON - hook merge skipped, nothing overwritten.`);
            if (backupWritten) log.warn(`Backup copy: ${backupCopy}`);
            log.warn(`BDB-wired settings: ${sideCarPath}`);
            return;
        }
    }

    try {
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify(buildMerged(existing), null, 2) + '\n');
    } catch (e) {
        log.warn(`Could not write ${settingsPath}: ${e.message}`);
    }
}

// Merge the BDB hooks into Google Antigravity's hooks.json (.agents/hooks.json or
// ~/.gemini/config/hooks.json), preserving user-defined foreign hooks.
function mergeAntigravityHooks(hooksPath, { projectLocal = false } = {}) {
    const bdbHookScripts = ['go-gate.mjs', 'graph-gate.mjs', 'memb-inject.mjs', 'startcycle-dispatch.mjs', 'trail-relay.mjs'];
    const isBdbEntry = (entry) => {
        const cmds = (entry && Array.isArray(entry.hooks) ? entry.hooks : [entry])
            .map((h) => (h && typeof h.command === 'string' ? h.command : (typeof h === 'string' ? h : '')))
            .join(' ');
        return bdbHookScripts.some((name) => cmds.includes(name));
    };

    const baseDir = path.dirname(hooksPath);
    const hooksDir = projectLocal ? path.join(currentDir, '.agents', 'hooks') : path.join(baseDir, 'hooks');
    const workflowsDir = projectLocal ? path.join(currentDir, '.agents', 'workflows') : path.join(baseDir, 'workflows');
    const globalHooksDir = projectLocal ? path.join(homeDir, '.gemini', 'config', 'hooks') : hooksDir;

    const bdbHooks = {
        PreToolUse: [
            {
                matcher: "run_command|Bash",
                hooks: [{ type: "command", command: `node "${path.join(hooksDir, 'go-gate.mjs')}"`, timeout: 10000 }]
            },
            {
                hooks: [{ type: "command", command: `node "${path.join(globalHooksDir, 'trail-relay.mjs')}" --agent agy --event PreToolUse`, timeout: 2000 }]
            }
        ],
        Stop: [
            {
                hooks: [{ type: "command", command: `node "${path.join(hooksDir, 'graph-gate.mjs')}"`, timeout: 10000 }]
            },
            {
                hooks: [{ type: "command", command: `node "${path.join(globalHooksDir, 'trail-relay.mjs')}" --agent agy --event Stop`, timeout: 2000 }]
            }
        ],
        PreInvocation: [
            {
                hooks: [
                    { type: "command", command: `node "${path.join(globalHooksDir, 'memb-inject.mjs')}"`, timeout: 8000 },
                    { type: "command", command: `node "${path.join(workflowsDir, 'startcycle-dispatch.mjs')}"`, timeout: 30000 }
                ]
            }
        ]
    };

    const buildMerged = (existing) => {
        const merged = existing && typeof existing === 'object' ? existing : {};
        merged.hooks = merged.hooks && typeof merged.hooks === 'object' ? merged.hooks : {};
        for (const [event, entries] of Object.entries(bdbHooks)) {
            const foreignEntries = (Array.isArray(merged.hooks[event]) ? merged.hooks[event] : [])
                .filter((e) => !isBdbEntry(e));
            merged.hooks[event] = [...foreignEntries, ...entries];
        }
        return merged;
    };

    let existing = null;
    if (fs.existsSync(hooksPath)) {
        existing = readJsonFile(hooksPath);
        if (!existing) {
            const backupCopy = `${hooksPath}.corrupt_${timestamp}.bak`;
            const sideCarPath = `${hooksPath}.bdb-new.json`;
            let backupWritten = true;
            try {
                fs.copyFileSync(hooksPath, backupCopy);
            } catch (copyError) {
                backupWritten = false;
                log.warn(`Could not create the hooks backup: ${copyError.message}`);
            }
            try {
                fs.writeFileSync(sideCarPath, JSON.stringify(buildMerged(null), null, 2) + '\n');
            } catch (writeError) {
                log.warn(`Could not write ${path.basename(sideCarPath)}: ${writeError.message}`);
            }
            log.warn(`${path.basename(hooksPath)} is not valid JSON - hook merge skipped, nothing overwritten.`);
            if (backupWritten) log.warn(`Backup copy: ${backupCopy}`);
            log.warn(`BDB-wired hooks: ${sideCarPath}`);
            return;
        }
    }

    try {
        fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
        fs.writeFileSync(hooksPath, JSON.stringify(buildMerged(existing), null, 2) + '\n');
    } catch (e) {
        log.warn(`Could not write ${hooksPath}: ${e.message}`);
    }
}

// Writes the AOS MCP servers into Codex's config.toml between AOS:MCP markers,
// replacing the block on re-runs. A server the user already declared outside the
// block is skipped: a second [mcp_servers.<name>] table would make the file invalid TOML.
function mergeCodexTomlMcpServers(configTomlPath, servers) {
    const tomlKey = (k) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k));
    const tomlValue = (v) => {
        if (Array.isArray(v)) return `[${v.map(tomlValue).join(', ')}]`;
        if (v && typeof v === 'object') {
            const pairs = Object.entries(v).map(([k, x]) => `${tomlKey(k)} = ${tomlValue(x)}`);
            return `{ ${pairs.join(', ')} }`;
        }
        if (typeof v === 'number' || typeof v === 'boolean') return String(v);
        return JSON.stringify(String(v));
    };
    let content = fs.existsSync(configTomlPath) ? fs.readFileSync(configTomlPath, 'utf8') : '';
    const blockRegex = /# AOS:MCP:START[\s\S]*?# AOS:MCP:END\n?/;
    const outside = content.replace(blockRegex, '');
    const tables = [];
    const skipped = [];
    Object.entries(servers || {}).forEach(([name, cfg]) => {
        const header = `[mcp_servers.${tomlKey(name)}]`;
        const headerRegex = new RegExp(`^${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
        if (headerRegex.test(outside)) { skipped.push(name); return; }
        const rows = [header];
        Object.entries(cfg || {}).forEach(([k, v]) => rows.push(`${tomlKey(k)} = ${tomlValue(v)}`));
        tables.push(rows.join('\n'));
    });
    const block = ['# AOS:MCP:START', tables.join('\n\n'), '# AOS:MCP:END'].join('\n');
    if (blockRegex.test(content)) {
        content = content.replace(blockRegex, `${block}\n`);
    } else if (content.length) {
        content = `${content.trimEnd()}\n\n${block}\n`;
    } else {
        content = `${block}\n`;
    }
    fs.writeFileSync(configTomlPath, content, { mode: 0o600 });
    try { fs.chmodSync(configTomlPath, 0o600); } catch (e) { logDebug(e, 'chmod configTomlPath'); }
    return skipped;
}

// Merge the BDB hooks into ChatGPT Codex CLI's config.toml (~/.codex/config.toml or
// .codex/config.toml), ensuring [features] hooks = true and preserving existing
// non-BDB settings, comments, and MCP servers.
function mergeCodexTomlHooks(configTomlPath, { projectLocal = false } = {}) {
    const baseDir = path.dirname(configTomlPath);
    const hooksDir = projectLocal ? path.join(currentDir, '.codex', 'hooks') : path.join(baseDir, 'hooks');
    const workflowsDir = projectLocal ? path.join(currentDir, '.codex', 'workflows') : path.join(baseDir, 'workflows');
    const globalHooksDir = projectLocal ? path.join(homeDir, '.codex', 'hooks') : hooksDir;

    const tomlSnippet = [
        '# AOS:HOOKS:START',
        '[[hooks.PreToolUse]]',
        'matcher = "^(Bash|run_command)$"',
        '[[hooks.PreToolUse.hooks]]',
        'type = "command"',
        `command = ${JSON.stringify(`node "${path.join(hooksDir, 'go-gate.mjs')}"`)}`,
        'timeout = 30',
        '',
        '[[hooks.Stop]]',
        '[[hooks.Stop.hooks]]',
        'type = "command"',
        `command = ${JSON.stringify(`node "${path.join(hooksDir, 'graph-gate.mjs')}"`)}`,
        'timeout = 30',
        '',
        '[[hooks.UserPromptSubmit]]',
        '[[hooks.UserPromptSubmit.hooks]]',
        'type = "command"',
        `command = ${JSON.stringify(`node "${path.join(globalHooksDir, 'memb-inject.mjs')}"`)}`,
        'timeout = 30',
        '',
        '[[hooks.SessionStart]]',
        '[[hooks.SessionStart.hooks]]',
        'type = "command"',
        `command = ${JSON.stringify(`node "${path.join(globalHooksDir, 'memb-inject.mjs')}"`)}`,
        'timeout = 30',
        '',
        '[[hooks.UserPromptSubmit]]',
        '[[hooks.UserPromptSubmit.hooks]]',
        'type = "command"',
        `command = ${JSON.stringify(`node "${path.join(workflowsDir, 'startcycle-dispatch.mjs')}"`)}`,
        'timeout = 30',
        '',
        '[[hooks.PreToolUse]]',
        '[[hooks.PreToolUse.hooks]]',
        'type = "command"',
        `command = ${JSON.stringify(`node "${path.join(globalHooksDir, 'trail-relay.mjs')}" --agent codex --event PreToolUse`)}`,
        'timeout = 2',
        '',
        '[[hooks.Stop]]',
        '[[hooks.Stop.hooks]]',
        'type = "command"',
        `command = ${JSON.stringify(`node "${path.join(globalHooksDir, 'trail-relay.mjs')}" --agent codex --event Stop`)}`,
        'timeout = 2',
        '# AOS:HOOKS:END'
    ].join('\n');

    let content = fs.existsSync(configTomlPath) ? fs.readFileSync(configTomlPath, 'utf8') : '';

    // Ensure [features] hooks = true
    const hasHooksFeature = /(?:hooks|codex_hooks)\s*=\s*true/m.test(content);
    if (!hasHooksFeature) {
        if (/^\[features\]/m.test(content)) {
            content = content.replace(/^\[features\]/m, '[features]\nhooks = true');
        } else {
            content = `[features]\nhooks = true\n\n${content.trimStart()}`;
        }
    }

    // Replace existing AOS:HOOKS block or append
    const hookBlockRegex = /# AOS:HOOKS:START[\s\S]*?# AOS:HOOKS:END/;
    if (hookBlockRegex.test(content)) {
        content = content.replace(hookBlockRegex, tomlSnippet);
    } else {
        content = `${content.trimEnd()}\n\n${tomlSnippet}\n`;
    }

    try {
        fs.mkdirSync(path.dirname(configTomlPath), { recursive: true });
        fs.writeFileSync(configTomlPath, content, { mode: 0o600 });
    } catch (e) {
        log.warn(`Could not write ${configTomlPath}: ${e.message}`);
    }
}

// Tier 9 (Local Project Harness): drop the dispatcher contract into the
// CURRENT PROJECT only -- no writes to $HOME, no global skill/MCP sync, and
// this runs as an early return BEFORE any global install step. A bare
// `.agents/` copy alone would leave the graph contract half-installed
// (v3.13 audit EDGE-1): the executable dispatcher (.claude/workflows/), its
// two gate hooks (.claude/hooks/), the agent definitions the dispatcher's
// prompts reference (.claude/agents/), and a project-local settings.json
// wiring Claude Code to those local hooks are all part of the contract.
// Reachable interactively via the "Local Project Harness" platform option, or
// non-interactively via `--project-harness` (combine with -y for CI).
function installProjectHarness() {
    const projectClaudeDir = path.join(currentDir, '.claude');
    const projectAgentsDir = path.join(currentDir, '.agents');
    const projectCodexDir = path.join(currentDir, '.codex');

    installStep(`create harness directories`, () => {
        fs.mkdirSync(projectClaudeDir, { recursive: true });
        fs.mkdirSync(projectAgentsDir, { recursive: true });
        fs.mkdirSync(projectCodexDir, { recursive: true });
    }, 'The harness copies below will most likely fail as well.');

    installStep('copy .agents/ contract into project', () => {
        const agentsSrc = path.join(srcDir, '.agents');
        if (!fs.existsSync(agentsSrc)) throw new Error(`missing payload: ${agentsSrc}`);
        copyDirRecursiveSync(agentsSrc, projectAgentsDir);
        log.step(`Copied .agents/ contract to ${projectAgentsDir}`);
    }, 'graph.md / state.schema.json may be missing in the project.');

    installStep('copy dispatcher workflows into project', () => {
        const workflowsSrc = path.join(srcDir, '.claude', 'workflows');
        if (fs.existsSync(workflowsSrc)) {
            copyDirRecursiveSync(workflowsSrc, path.join(projectClaudeDir, 'workflows'));
            copyDirRecursiveSync(workflowsSrc, path.join(projectAgentsDir, 'workflows'));
            copyDirRecursiveSync(workflowsSrc, path.join(projectCodexDir, 'workflows'));
            log.step(`Copied dispatcher workflows to project harnesses`);
        }
    }, '/startcycle dispatch degrades to graph.md as a manual guide.');

    installStep('copy hooks into project', () => {
        const hooksSrc = path.join(srcDir, '.claude', 'hooks');
        if (fs.existsSync(hooksSrc)) {
            copyDirRecursiveSync(hooksSrc, path.join(projectClaudeDir, 'hooks'));
            copyDirRecursiveSync(hooksSrc, path.join(projectAgentsDir, 'hooks'));
            copyDirRecursiveSync(hooksSrc, path.join(projectCodexDir, 'hooks'));
            log.step(`Copied hooks to project harnesses`);
        }
    }, 'go-gate / graph-gate enforcement stays inactive in this project.');

    installStep('copy agent definitions into project', () => {
        const agentsMdSrc = path.join(srcDir, '.agents', 'agents.md');
        const pipelineConfig = loadPipelineConfig(currentDir);
        if (fs.existsSync(agentsMdSrc)) {
            const agents = parseAgentsMd(fs.readFileSync(agentsMdSrc, 'utf8'));
            compileClaudeAgents(agents, path.join(projectClaudeDir, 'agents'), pipelineConfig);
            compileOpenCodeAgents(agents, path.join(currentDir, '.opencode', 'agents'), pipelineConfig);
            compileCodexAgents(agents, path.join(projectCodexDir, 'agents'), pipelineConfig);
            log.step(`Compiled project agent definitions for Claude, OpenCode, and Codex`);
        } else {
            const agentsSrc = path.join(srcDir, '.claude', 'agents');
            if (fs.existsSync(agentsSrc)) {
                copyDirRecursiveSync(agentsSrc, path.join(projectClaudeDir, 'agents'));
                log.step(`Copied agent definitions to ${path.join(projectClaudeDir, 'agents')}`);
            }
        }
    }, 'The dispatcher runs, but its agent-file pointers resolve to nothing.');

    installStep('wire project harnesses to local hooks', () => {
        mergeBdbSettingsHooks(path.join(projectClaudeDir, 'settings.json'), { projectLocal: true });
        mergeAntigravityHooks(path.join(projectAgentsDir, 'hooks.json'), { projectLocal: true });
        mergeCodexTomlHooks(path.join(projectCodexDir, 'config.toml'), { projectLocal: true });
        log.step(`Wired project hooks in Claude, Antigravity, and Codex configurations`);
    }, 'The gate hooks exist but are not auto-wired for this project.');

    log.success(`Project harness installed to ${currentDir}`);
}

async function promptMcpSelection(tier) {
    const mcpSrcDir = path.join(srcDir, 'mcps');
    let availableMcps = [];
    try {
        availableMcps = fs.readdirSync(mcpSrcDir, { withFileTypes: true })
            .filter(d => !d.name.startsWith('.') && d.name !== '__pycache__')
            .map(d => d.name);
    } catch (e) { return []; }

    // memb-mcp ships via npm, not as a folder under mcps/, so readdir never lists it.
    if (!availableMcps.includes(CORE_MCP)) availableMcps.push(CORE_MCP);

    if (tier === '2') {
        const basicMcps = ['computer-use-mcp', 'memb-mcp', 'windows-computer-use-mcp'];
        availableMcps = availableMcps.filter(m => basicMcps.includes(m));
    }

    availableMcps = availableMcps.filter(m => !unsupportedMcpDirs.includes(m));

    if (mcpsArg !== null) return resolveMcpsArg(availableMcps);
    if (isAutoYes) return availableMcps;
    if (availableMcps.length === 0) return [];

    let existingInstalled = [];
    try {
        const mcpConfigPath = path.join(geminiDir, 'config', 'mcp_config.json');
        if (fs.existsSync(mcpConfigPath)) {
            const parsed = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
            const mcpStr = JSON.stringify(parsed.mcpServers || {});
            existingInstalled = availableMcps.filter(m => mcpStr.includes(m));
        }
    } catch (e) { logDebug(e, 'operation'); }

    const selectable = availableMcps.filter(m => m !== CORE_MCP);

    if (selectable.length === 0) return [CORE_MCP];

    const chosen = await multiselectWithBack({
        message: 'Select optional MCPs to install (memb-mcp core is always included):',
        options: selectable.map(m => ({ value: m, label: m, hint: existingInstalled.includes(m) ? 'currently installed' : undefined })),
        initialValues: existingInstalled.filter(m => selectable.includes(m)),
        allowEmpty: true
    });

    if (chosen === BACK) return BACK;

    return [CORE_MCP, ...chosen];
}

// Returns the module ids it actually installed this call (distinct from `installedModules`,
// which may already contain ids from a prior run that this call does NOT touch) -- callers
// use this to tell reloadDaemons() which daemons were just installed-and-verified here, so
// it doesn't redundantly relaunch and re-check them a second time.
async function promptOptionalModules(installedModules) {
    if (isAutoYes) return [];
    const allModules = [
        { id: 'synapse', name: 'BDB Synapse (3D Codebase Visualizer)', fn: installSynapse },
        { id: 'memb', name: 'memB Vector Engine (Local Semantic Memory)', fn: () => installMemB(true) },
        { id: 'remote', name: 'BDB OS Remote Gateway (Zero-Trust Tailscale Multiplexer)', fn: installOSRemoteGateway },
        // Offered only where it can actually run -- see aoSupportedHere(). The
        // predecessor, @hybridlabor-api/bdb-os-agent-workspace, must never come
        // back: its repository is archived and its last release predates the
        // archiving, so it hands out the build with the CDC loop defect.
        ...(aoSupportedHere()
            ? [{ id: 'ao', name: 'AO Agent Orchestrator (Session telemetry & WebUI)', fn: installOSAgentWorkspace }]
            : []),
        { id: 'creator', name: 'BDB Creator Extension (Generative 3D, Video & ComfyUI)', fn: installCreatorExtension },
        { id: 'hardware', name: 'BDB Hardware & PCB (KiCad + OpenSCAD Electrical/PCB Design)', fn: installHardwarePcb },
        { id: 'installer', name: 'BDB Dev Tool Installer (Interactive Hub & CLI Launcher)', fn: installDevToolInstaller }
    ];

    const uninstalled = allModules.filter(m => !installedModules.includes(m.id));
    if (uninstalled.length === 0) return [];

    const chosen = pick(await multiselect({
        message: 'New / optional BDB OS modules available - select what to install:',
        options: uninstalled.map(m => ({ value: m.id, label: m.name })),
        required: false
    }));

    for (const mod of allModules) {
        if (chosen.includes(mod.id)) {
            await mod.fn();
            installedModules.push(mod.id);
        }
    }
    return chosen;
}

// Module ids whose daemons ship a web interface or background service worth
// surfacing in the launchpad (each has a card in the generated HTML below).
const LAUNCHPAD_WEB_MODULES = ['memb', 'synapse', 'openwiki', 'ao', 'remote'];

// Explicit opt-in flags that open the launchpad even outside a dev checkout.
const LAUNCHPAD_OPEN_FLAGS = ['--launchpad', '--dashboard', '--open', '--dev'];

// True on a local BDB dev checkout (or BDB_DEV=1). This is intentionally
// narrower than the old isDevWorkflow check: CLI flags live in
// shouldOpenLaunchpad(), not here, so callers can tell "dev machine" apart
// from "user asked for it". Overrides exist for tests.
function isDevEnvironment(overrides = {}) {
    const home = overrides.homeDir || homeDir;
    const env = overrides.env || process.env;
    return fs.existsSync(path.join(home, 'dev', 'bdb-dev')) ||
        fs.existsSync(path.join(home, 'bdb-dev')) ||
        env.BDB_DEV === '1';
}

// True when the launchpad should be generated and opened: a dev checkout, an
// explicit flag, or installed daemon/WebUI modules. Overrides exist for tests.
function shouldOpenLaunchpad(installedModules = [], overrides = {}) {
    const argv = overrides.argv || process.argv;
    if (isDevEnvironment(overrides)) return true;
    if (LAUNCHPAD_OPEN_FLAGS.some(f => argv.includes(f))) return true;
    const installed = Array.isArray(installedModules) ? installedModules : [];
    return installed.some(m => LAUNCHPAD_WEB_MODULES.includes(m));
}

// Boot autostart (login item) is opt-in only: an explicit flag or a dev
// checkout. Regular end-user installs must not get an autostart entry that
// opens a browser on every login. Overrides exist for tests.
function shouldAutostartLaunchpad(overrides = {}) {
    const argv = overrides.argv || process.argv;
    if (argv.includes('--autostart-launchpad')) return true;
    return isDevEnvironment(overrides);
}

function generateAndOpenLaunchpad(installedModules = []) {
    if (DRY_RUN) {
        log.step('[dry-run] would generate & open BDB Launchpad HTML');
        return false;
    }
    if (process.env.SSH_CLIENT || process.env.SSH_TTY) return false;

    // Decoupled from the dev-checkout layout: on a regular end-user machine
    // (no ~/dev/bdb-dev, no ~/bdb-dev) the launchpad still opens when daemon
    // modules are installed or an explicit flag was passed.
    // ~/bdb-dev was the pre-reorg workspace root; the State-0 reorg moved it to
    // ~/dev/bdb-dev. Both are checked so this works regardless of which layout
    // a given machine still has.
    if (!shouldOpenLaunchpad(installedModules)) {
        return false;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BDB Agent OS – Launchpad</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImEiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPjxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiNGRkZGRkYiLz48c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiNFN0U3RUEiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48Y2lyY2xlIGN4PSIyNTYiIGN5PSIyNTYiIHI9IjI0NiIgZmlsbD0iIzBhMGEwYSIgc3Ryb2tlPSIjOWIzMGM0IiBzdHJva2Utd2lkdGg9IjEyIi8+PGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoNzAsNjgpIj48cGF0aCBmaWxsPSJ1cmwoI2EpIiBkPSJNMTgxLjYzLjA1YzEwMS4zOS0yLjQ3LDE4NC41Niw4MC4wOSwxOTAuMTQsMTc5LjkzLDUuNTMsOTkuMDMtNjYuMTYsMTg1LjQyLTE2NS4xMSwxOTUuNDYtODcuMzksOC44Ni0xNzEuMS00NS41Ni0xOTcuNjctMTI4Ljk2Qy0yOC43NCwxMjguMDMsNTYuNzgsMy4xLDE4MS42My4wNWgwWk0xNzcuNSwyMS4zQzY5LjA5LDI1LjMxLTcuMTYsMTI5LjYyLDIxLjc2LDIzNC41MmMxOC43Miw2Ny44OCw4MS41NiwxMTYuNywxNTEuNTMsMTIxLjMyLDEwNi4yMSw3LjAzLDE5NS42LTgxLjYzLDE3OS42OC0xODkuMDYtMTIuNTQtODQuNjUtODkuODEtMTQ4LjY2LTE3NS40Ny0xNDUuNDloMFoiLz48ZyBmaWxsPSIjRkZGRkZGIj48cGF0aCBkPSJNMTQ3LjY5LDEyMC4wNWMxMi4wNC4zNiwyNC42NC0uNzIsMzYuNjItLjA3LDI0LjI5LDEuMzIsNDEuMzcsMjAuMTMsNDIuOTEsNDMuOTktLjY5LDE2LjM1LjU3LDMzLjQyLS4yOCw0OS42OS0xLjMxLDI1LjQyLTE4LjU1LDQzLjc1LTQ0LjAyLDQ1LjY0LTkuNTkuNzItMjAuMTQuNjktMjkuNzguODQtNC45Ny4wOC05LjkuNjgtMTAuMzctNS42NnMuNDMtOS40MS4zNC0xNC4wM2MxMi42NS0xMS44NCwxNC43NS0zMS4xNyw0Ljc1LTQ1LjQxLS42My0uOS0yLjI2LTIuMzQtMi42Mi0zLjE3cy0uNDYtMTIuNTgtLjI2LTE0LjM3LDEuMS0zLjUyLDEuNDYtNS4xNmMxLjIxLTUuNDIsMS4wNi0xMS4yNi0uMzktMTYuNjItLjQxLTEuNTQtMS40OC0zLjU2LTEuNjMtNC45OS0uNDctNC4yOC0uMTQtOS42Ny0uMjYtMTQuMDgtLjExLTMuNTYtLjg0LTguNDMtLjU3LTExLjg2czEuMzItNC4zNSw0LjA4LTQuNzVoMFoiLz48cGF0aCBkPSJNMjMyLjY2LDEzMi40NmM5LjUzLjM2LDE5Ljc0LS43MiwyOS4xOS0uMDgsMjIuNjQsMS41MiwzMy45MiwyOC41OCwyMS45Myw0Ny4wNS0xLjQ5LDIuMy00LjMyLDQuNDctMy44NSw3LjQyLjQ3LDIuOTUsNS42NCw2LjIxLDcuNDIsOC4zLDExLjg4LDEzLjk2LDguNDEsMzUuNjktNi45MSw0NS40OS03Ljg1LDUuMDItMTQuNjksNC40My0yMy41Niw0Ljg2LTcuNjcuMzctMTYuMjQsMS4wNS0yMy45MS42NloiLz48cGF0aCBkPSJNOTAuNTksMTMzLjAzYzguODQtLjQ0LDI1LjI0LTEuMDgsMzMuMjMsMS45MiwxOC4wNyw2Ljc3LDIzLjk5LDI5Ljk2LDEzLjU2LDQ1LjctMS42LDIuNDEtNC41Miw0LjQ0LTMuMjgsNy43NS42OSwxLjg1LDUuNDEsNS40Miw3LjAzLDcuMzEsMTEuODYsMTMuODIsOC43NywzNS4yMy02LjI1LDQ1LjMzLTE1LjAyLDEwLjEtMjMuMzEsNS4yNy0zNC40NCw1LjU2WiIvPjwvZz48L2c+PC9zdmc+">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090a0f;
      --card-bg: rgba(22, 27, 34, 0.75);
      --card-border: rgba(255, 255, 255, 0.08);
      --text: #f0f6fc;
      --text-muted: #8b949e;
      --accent: #9b30c4;
      --green: #3fb950;
      --font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background-image: radial-gradient(circle at 50% 0%, rgba(88, 166, 255, 0.08) 0%, transparent 60%);
    }
    .container { width: 100%; max-width: 600px; }
    .header { margin-bottom: 28px; text-align: center; }
    .logo {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
      margin-bottom: 6px;
    }
    .logo-mark { width: 36px; height: 36px; flex-shrink: 0; }
    .logo-badge { color: #ffffff; }
    .tagline { color: var(--text-muted); font-size: 14px; font-weight: 400; }
    .grid { display: flex; flex-direction: column; gap: 12px; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      text-decoration: none;
      color: inherit;
      backdrop-filter: blur(12px);
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .card:hover {
      border-color: rgba(155, 48, 196, 0.45);
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    }
    .card-content { display: flex; align-items: center; gap: 14px; }
    .card-icon {
      width: 40px;
      height: 40px;
      padding: 6px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.06);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card-icon svg { width: 100%; height: 100%; }
    .card-info h2 { font-size: 15px; font-weight: 600; margin-bottom: 2px; }
    .card-info p { font-size: 13px; color: var(--text-muted); }
    .card-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      font-family: var(--mono);
      font-size: 12px;
    }
    .port-pill {
      background: rgba(255, 255, 255, 0.06);
      padding: 4px 10px;
      border-radius: 20px;
      color: #c77dea;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--text-muted);
      display: inline-block;
      transition: all 0.3s ease;
    }
    .status-dot.online {
      background-color: var(--green);
      box-shadow: 0 0 10px rgba(63, 185, 80, 0.6);
    }
    .footer {
      margin-top: 28px;
      text-align: center;
      font-size: 12px;
      color: var(--text-muted);
      font-family: var(--mono);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">
        <svg class="logo-mark" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="bdbPlateLight" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#FFFFFF"/><stop offset="60%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#E7E7EA"/>
            </linearGradient>
            <linearGradient id="bdbPlateDark" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#1C1C1F"/><stop offset="100%" stop-color="#050505"/>
            </linearGradient>
          </defs>
          <circle cx="256" cy="256" r="195" fill="url(#bdbPlateDark)" stroke="#FFFFFF" stroke-width="2" stroke-opacity="0.6"/>
          <circle cx="256" cy="256" r="175" fill="#0a0a0a"/>
          <g transform="translate(70, 68) scale(1.0)">
            <path fill="url(#bdbPlateLight)" d="M181.63.05c101.39-2.47,184.56,80.09,190.14,179.93,5.53,99.03-66.16,185.42-165.11,195.46-87.39,8.86-171.1-45.56-197.67-128.96C-28.74,128.03,56.78,3.1,181.63.05h0ZM177.5,21.3C69.09,25.31-7.16,129.62,21.76,234.52c18.72,67.88,81.56,116.7,151.53,121.32,106.21,7.03,195.6-81.63,179.68-189.06-12.54-84.65-89.81-148.66-175.47-145.49h0Z"/>
            <g fill="#FFFFFF">
              <path d="M147.69,120.05c12.04.36,24.64-.72,36.62-.07,24.29,1.32,41.37,20.13,42.91,43.99-.69,16.35.57,33.42-.28,49.69-1.31,25.42-18.55,43.75-44.02,45.64-9.59.72-20.14.69-29.78.84-4.97.08-9.9.68-10.37-5.66s.43-9.41.34-14.03c12.65-11.84,14.75-31.17,4.75-45.41-.63-.9-2.26-2.34-2.62-3.17s-.46-12.58-.26-14.37,1.1-3.52,1.46-5.16c1.21-5.42,1.06-11.26-.39-16.62-.41-1.54-1.48-3.56-1.63-4.99-.47-4.28-.14-9.67-.26-14.08-.11-3.56-.84-8.43-.57-11.86s1.32-4.35,4.08-4.75h0ZM162.03,135.5c-4.32.73-3.34,6.65-3.26,10.01.17,6.21.91,12.51,1.13,18.73.83,23.13-1.03,45.49-1.41,68.42-.07,3.93-1.27,10.87,4.01,11.46,10.36-.51,21.39,1.89,31.38-1.45,13.74-4.59,20.43-17.79,19.81-31.81-1.77-14.46-1.19-29.09-1.94-43.58-.52-10.12-3.97-20.33-12.44-26.46-10.8-7.82-24.82-4.88-37.29-5.34h0Z"/>
              <path d="M232.66,132.46c9.53.36,19.74-.72,29.19-.08,22.64,1.52,33.92,28.58,21.93,47.05-1.49,2.3-4.32,4.47-3.85,7.42.47,2.95,5.64,6.21,7.42,8.3,11.88,13.96,8.41,35.69-6.91,45.49-7.85,5.02-14.69,4.43-23.56,4.86-7.67.37-16.24,1.05-23.91.66-1.66-.08-2.98-.73-3.68-2.32s-.52-7.28-.43-9.26c.36-6.63,3.52-13.04,3.89-20.39.58-11.38-.1-23.12-.3-34.49-.1-5.68.32-11.44-.3-17.08-.41-3.82-1.64-7.52-1.89-11.35-.25-3.85-.18-7.99-.26-11.88-.07-2.84-1.26-6.03,2.68-6.95h-.01ZM243.68,144.59c-3.41.77-2.55,6.7-2.66,9.2-.28,6.08-.58,12.36-.29,18.47.1,2.06.36,6.36.9,8.21.54,1.85.84,1.79,1.66,2.19,1.66.83,8-.68,10.26-.88,4.22-.39,8.12.03,12.28-1.24,16.76-5.12,16.53-26.53,1.01-33.02-15.52-6.5-13.5-2.7-18.82-2.98-5.31-.28-3.37-.17-4.36.06h.03ZM243.68,194.52c-3.49.79-2.58,8.66-2.68,11.39-.26,7.05-1.06,17.41.07,24.21,1.13,6.8,2.63,3.38,5.32,3.26,3.96-.19,8.36-1.32,12.4-1.67,5.85-.5,10.68.22,16.24-2.25,13.6-6.04,12.62-25.27-.46-31.46-5.63-2.66-9.89-1.97-15.78-2.43-3.57-.28-7.2-.92-10.76-1.1-1.12-.06-3.35-.17-4.36.06h0Z"/>
              <path d="M90.59,133.03c8.84-.44,25.24-1.08,33.23,1.92,18.07,6.77,23.99,29.96,13.56,45.7-1.6,2.41-4.52,4.44-3.28,7.75.69,1.85,5.41,5.42,7.03,7.31,11.86,13.82,8.77,35.23-6.25,45.33-15.02,10.1-23.31,5.27-34.44,5.56-4.12.11-10.36.88-14.32.28-2.22-.34-3.45-2.79-3.48-4.83-.11-7.84.77-15.89,1.1-23.71.99-23.09,1.31-45.33.57-68.43-.14-4.15-1.05-9.79-.57-13.79.43-3.52,4.1-2.95,6.84-3.09h0ZM98.3,145.15c-1.71.29-2.98,1.7-3.21,3.41-.15,1.19-.23,3.13-.3,4.39-.39,8.01-.9,19.53.58,27.27.23,1.24.57,2.55,1.82,3.15,1.81.84,7.03-.55,9.32-.76,3.3-.3,6.62-.1,9.89-.59,21.2-3.21,21.02-29.7,1.28-34.86-4.36-1.14-13.16-1.92-17.79-2.07-.55-.01-1.03-.03-1.59.07h0ZM98.03,195.09c-4.25.88-2.46,6.76-3.24,9.72-.06,7.92-.55,15.86,0,23.75.22,3.21.77,5.75,4.57,5.67,3.82-.08,8.46-1.32,12.41-1.67,5.55-.48,11.21.12,16.48-2,14.62-5.88,13.53-26.13-.52-32.17-5.13-2.21-8.25-1.59-13.48-1.97-4.69-.34-9.7-1.23-14.35-1.38-.62-.01-1.26-.07-1.86.06h-.01Z"/>
            </g>
          </g>
        </svg>
        <span class="logo-badge">BDB Agent OS</span>
      </div>
      <p class="tagline">Local Multi-Agent Ecosystem Hub</p>
    </div>
    <div class="grid">
      <a class="card" href="http://127.0.0.1:8088" target="_blank">
        <div class="card-content">
          <div class="card-icon"><svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="grad-memb" x1="50%" y1="0%" x2="50%" y2="100%"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#51116F"/></linearGradient></defs>
            <polygon points="50,10 85,45 50,90 15,45" fill="url(#grad-memb)" opacity="0.9"/>
            <polyline points="50,10 50,90" stroke="#FFFFFF" stroke-width="2" opacity="0.6"/>
            <polyline points="15,45 85,45" stroke="#FFFFFF" stroke-width="2" opacity="0.6"/>
            <line x1="50" y1="45" x2="70" y2="25" stroke="#FFFFFF" stroke-width="1.5" opacity="0.5"/>
            <line x1="50" y1="45" x2="30" y2="70" stroke="#FFFFFF" stroke-width="1.5" opacity="0.5"/>
            <circle cx="50" cy="45" r="4" fill="#FFFFFF"/><circle cx="70" cy="25" r="2" fill="#FFFFFF"/><circle cx="30" cy="70" r="2" fill="#FFFFFF"/>
          </svg></div>
          <div class="card-info">
            <h2>memB Vector Memory</h2>
            <p>Autonomous Vector & Long-Term Memory</p>
          </div>
        </div>
        <div class="card-meta">
          <span class="port-pill">:8088</span>
          <span class="status-dot" id="dot-memb" title="Checking..."></span>
        </div>
      </a>
      <a class="card" href="http://127.0.0.1:7781" target="_blank">
        <div class="card-content">
          <div class="card-icon"><svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="grad-synapse" x1="50%" y1="0%" x2="50%" y2="100%"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#51116F"/></linearGradient></defs>
            <rect x="20" y="55" width="14" height="30" rx="2" fill="url(#grad-synapse)" opacity="0.85"/>
            <rect x="43" y="35" width="14" height="50" rx="2" fill="url(#grad-synapse)" opacity="0.9"/>
            <rect x="66" y="45" width="14" height="40" rx="2" fill="url(#grad-synapse)" opacity="0.8"/>
            <line x1="27" y1="55" x2="50" y2="35" stroke="#FFFFFF" stroke-width="1.5" opacity="0.5"/>
            <line x1="50" y1="35" x2="73" y2="45" stroke="#FFFFFF" stroke-width="1.5" opacity="0.5"/>
            <circle cx="27" cy="55" r="3" fill="#FFFFFF"/><circle cx="50" cy="35" r="3" fill="#FFFFFF"/><circle cx="73" cy="45" r="3" fill="#FFFFFF"/>
          </svg></div>
          <div class="card-info">
            <h2>Synapse 3D</h2>
            <p>Interactive Codebase Topology & Sessions</p>
          </div>
        </div>
        <div class="card-meta">
          <span class="port-pill">:7781</span>
          <span class="status-dot" id="dot-synapse" title="Checking..."></span>
        </div>
      </a>
      <a class="card" href="http://127.0.0.1:3101" target="_blank">
        <div class="card-content">
          <div class="card-icon"><svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="plateLight" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="60%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#E7E7EA"/></linearGradient>
              <linearGradient id="plateMid" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#9b30c4"/><stop offset="100%" stop-color="#51116F"/></linearGradient>
              <linearGradient id="plateDark" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#1C1C1F"/><stop offset="100%" stop-color="#050505"/></linearGradient>
            </defs>
            <g id="antennae" stroke="#000000" stroke-width="2.5" stroke-linejoin="round">
              <rect x="180" y="45" width="20" height="30" rx="2" fill="url(#plateLight)"/><polygon points="180,45 190,25 200,45" fill="#FFFFFF"/><circle cx="190" cy="25" r="4" fill="#FFFFFF"/>
              <rect x="186" y="80" width="22" height="34" rx="2" fill="url(#plateMid)"/><rect x="194" y="118" width="24" height="38" rx="2" fill="url(#plateDark)"/><rect x="202" y="160" width="26" height="38" rx="2" fill="url(#plateDark)"/>
              <rect x="312" y="45" width="20" height="30" rx="2" fill="url(#plateLight)"/><polygon points="312,45 322,25 332,45" fill="#FFFFFF"/><circle cx="322" cy="25" r="4" fill="#FFFFFF"/>
              <rect x="304" y="80" width="22" height="34" rx="2" fill="url(#plateMid)"/><rect x="294" y="118" width="24" height="38" rx="2" fill="url(#plateDark)"/><rect x="284" y="160" width="26" height="38" rx="2" fill="url(#plateDark)"/>
            </g>
            <g id="head" stroke="#000000" stroke-width="2.5" stroke-linejoin="round">
              <rect x="238" y="170" width="36" height="32" rx="3" fill="url(#plateLight)"/>
              <rect x="156" y="206" width="200" height="88" rx="6" fill="url(#plateDark)"/>
              <rect x="136" y="230" width="20" height="40" rx="3" fill="url(#plateMid)"/><rect x="356" y="230" width="20" height="40" rx="3" fill="url(#plateMid)"/>
            </g>
            <g id="eyes">
              <rect x="174" y="222" width="56" height="52" rx="5" fill="#000000" stroke="#FFFFFF" stroke-width="2"/><rect x="180" y="228" width="44" height="40" rx="3" fill="url(#plateDark)"/>
              <circle cx="202" cy="248" r="14" fill="#FFFFFF" opacity="0.3"/><circle cx="202" cy="248" r="7" fill="#FFFFFF"/><circle cx="205" cy="245" r="2.5" fill="#FFFFFF"/>
              <rect x="282" y="222" width="56" height="52" rx="5" fill="#000000" stroke="#FFFFFF" stroke-width="2"/><rect x="288" y="228" width="44" height="40" rx="3" fill="url(#plateDark)"/>
              <circle cx="310" cy="248" r="14" fill="#FFFFFF" opacity="0.3"/><circle cx="310" cy="248" r="7" fill="#FFFFFF"/><circle cx="313" cy="245" r="2.5" fill="#FFFFFF"/>
            </g>
            <g id="mandibles" stroke="#000000" stroke-width="2.5">
              <rect x="226" y="298" width="60" height="18" rx="3" fill="url(#plateLight)"/>
              <rect x="236" y="303" width="10" height="8" rx="1.5" fill="#51116F"/><rect x="251" y="303" width="10" height="8" rx="1.5" fill="#51116F"/><rect x="266" y="303" width="10" height="8" rx="1.5" fill="#51116F"/>
              <polygon points="196,300 220,300 206,340" fill="url(#plateLight)"/><polygon points="316,300 292,300 306,340" fill="url(#plateLight)"/>
            </g>
            <g id="thorax" stroke="#000000" stroke-width="2.5" stroke-linejoin="round">
              <rect x="180" y="336" width="152" height="74" rx="6" fill="url(#plateMid)"/>
              <rect x="216" y="352" width="80" height="42" rx="4" fill="#0c0414" stroke="#FFFFFF" stroke-width="1.5"/>
              <text x="256" y="378" fill="#FFFFFF" font-family="monospace" font-size="14" font-weight="900" text-anchor="middle" letter-spacing="3">BDB</text>
            </g>
          </svg></div>
          <div class="card-info">
            <h2>AO — Agent Orchestrator</h2>
            <p>Multi-Agent Cockpit & Git-Worktree Orchestration</p>
          </div>
        </div>
        <div class="card-meta">
          <span class="port-pill">:3101</span>
          <span class="status-dot" id="dot-ao" title="Checking..."></span>
        </div>
      </a>
      <a class="card" href="http://127.0.0.1:9080" target="_blank">
        <div class="card-content">
          <div class="card-icon"><svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="grad-remote" x1="50%" y1="0%" x2="50%" y2="100%"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#51116F"/></linearGradient></defs>
            <circle cx="50" cy="50" r="32" fill="none" stroke="url(#grad-remote)" stroke-width="3" opacity="0.6"/>
            <circle cx="50" cy="50" r="8" fill="url(#grad-remote)"/>
            <circle cx="50" cy="14" r="4" fill="#FFFFFF"/><circle cx="82" cy="65" r="4" fill="#FFFFFF"/><circle cx="18" cy="65" r="4" fill="#FFFFFF"/>
            <line x1="50" y1="50" x2="50" y2="18" stroke="#FFFFFF" stroke-width="1.5" opacity="0.6"/>
            <line x1="50" y1="50" x2="79" y2="63" stroke="#FFFFFF" stroke-width="1.5" opacity="0.6"/>
            <line x1="50" y1="50" x2="21" y2="63" stroke="#FFFFFF" stroke-width="1.5" opacity="0.6"/>
          </svg></div>
          <div class="card-info">
            <h2>RemoteOS Gateway</h2>
            <p>Multi-Cloud Execution & 4-Eyes Approval Gateway</p>
          </div>
        </div>
        <div class="card-meta">
          <span class="port-pill">:9080</span>
          <span class="status-dot" id="dot-remote" title="Checking..."></span>
        </div>
      </a>
      <a class="card" href="http://127.0.0.1:4321" target="_blank">
        <div class="card-content">
          <div class="card-icon"><svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="grad-openwiki" x1="50%" y1="0%" x2="50%" y2="100%"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#51116F"/></linearGradient></defs>
            <rect x="26" y="16" width="48" height="68" rx="4" fill="url(#grad-openwiki)" opacity="0.9"/>
            <line x1="36" y1="32" x2="64" y2="32" stroke="#0a0a0a" stroke-width="2.5" opacity="0.5"/>
            <line x1="36" y1="42" x2="64" y2="42" stroke="#0a0a0a" stroke-width="2.5" opacity="0.5"/>
            <line x1="36" y1="52" x2="52" y2="52" stroke="#0a0a0a" stroke-width="2.5" opacity="0.5"/>
            <circle cx="70" cy="68" r="14" fill="#0a0a0a" stroke="#FFFFFF" stroke-width="2"/>
            <circle cx="65" cy="64" r="2.5" fill="#FFFFFF"/><circle cx="74" cy="63" r="2.5" fill="#FFFFFF"/><circle cx="70" cy="72" r="2.5" fill="#FFFFFF"/>
            <line x1="65" y1="64" x2="74" y2="63" stroke="#FFFFFF" stroke-width="1.2" opacity="0.7"/>
            <line x1="65" y1="64" x2="70" y2="72" stroke="#FFFFFF" stroke-width="1.2" opacity="0.7"/>
            <line x1="74" y1="63" x2="70" y2="72" stroke="#FFFFFF" stroke-width="1.2" opacity="0.7"/>
          </svg></div>
          <div class="card-info">
            <h2>OpenWiki</h2>
            <p>Grounded Documentation & Evidence Graph</p>
          </div>
        </div>
        <div class="card-meta">
          <span class="port-pill">:4321</span>
          <span class="status-dot" id="dot-openwiki" title="Checking..."></span>
        </div>
      </a>
    </div>
    <div class="footer">
      <span>Autostart Daemons • 127.0.0.1</span>
    </div>
  </div>
  <script>
    function checkHealth(url, dotId) {
      const dot = document.getElementById(dotId);
      if (!dot) return;
      fetch(url, { mode: 'no-cors' })
        .then(() => dot.classList.add('online'))
        .catch(() => dot.classList.remove('online'));
    }
    function checkAllHealth() {
      checkHealth('http://127.0.0.1:8088', 'dot-memb');
      checkHealth('http://127.0.0.1:7781', 'dot-synapse');
      checkHealth('http://127.0.0.1:3101', 'dot-ao');
      checkHealth('http://127.0.0.1:9080', 'dot-remote');
      checkHealth('http://127.0.0.1:4321', 'dot-openwiki');
    }
    checkAllHealth();
    setInterval(checkAllHealth, 5000);
  </script>
</body>
</html>`;

    const filePath = path.join(os.homedir(), '.agents', 'bdb-launchpad.html');
    fs.writeFileSync(filePath, html, 'utf-8');
    const warnOpenFailed = (e) => log.warn(`Could not open the dashboard automatically (${e.message}). Open it yourself: ${filePath}`);
    try {
        let child;
        if (process.platform === 'darwin') {
            child = spawn('open', [filePath], { detached: true, stdio: 'ignore' });
        } else if (process.platform === 'win32') {
            // cmd.exe /c start has a title-vs-path quoting quirk when the
            // arguments come from spawn's argv array rather than a real shell --
            // on a real Windows test run it silently opened nothing, and the
            // failure was invisible: spawn() reports a bad launch asynchronously
            // via 'error', not by throwing, so the try/catch around this call
            // could never have caught it regardless of --verbose. explorer.exe
            // on a plain file path has no title argument to misparse.
            child = spawn('explorer', [filePath], { detached: true, stdio: 'ignore' });
        } else {
            child = spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore' });
        }
        child.on('error', warnOpenFailed);
        child.unref();
    } catch (e) { warnOpenFailed(e); }

    // Opening it once per install/update isn't the same as being available at
    // every login -- memB/Synapse/AO all get a real autostart entry for their
    // own background services, but the dashboard itself (a static file, not
    // a process) never got the equivalent: something to open it automatically
    // on login too, not just right after an installer run.
    // Opt-in only: without --autostart-launchpad (or a dev checkout) a regular
    // end-user install must not drop a login item that opens a browser on
    // every boot.
    if (!shouldAutostartLaunchpad()) {
        return true;
    }
    if (process.platform === 'darwin') {
        const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', 'com.bdb.launchpad.plist');
        const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bdb.launchpad</string>
    <key>ProgramArguments</key>
    <array>
        <string>open</string>
        <string>${filePath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>`;
        // Deliberately no KeepAlive: this launches a browser tab, not a
        // long-running service -- `open` exits the moment it's handed the
        // file to the browser, and KeepAlive would make launchd treat that
        // normal exit as a crash to restart, reopening the tab in a loop.
        try {
            fs.writeFileSync(plistPath, plistContent);
            execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`, { stdio: 'ignore' });
            execSync(`launchctl load -w "${plistPath}" 2>/dev/null || true`, { stdio: 'ignore' });
        } catch (e) { logDebug(e, 'launchpad autostart plist'); }
    } else if (process.platform === 'win32') {
        const startupDir = path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
        const vbsPath = path.join(startupDir, 'com.bdb.launchpad.vbs');
        const vbsContent = `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.Run """${filePath}""", 1, False\r\n`;
        try {
            fs.mkdirSync(startupDir, { recursive: true });
            fs.writeFileSync(vbsPath, vbsContent, 'utf-8');
        } catch (e) { logDebug(e, 'launchpad autostart vbs'); }
    }
    return true;
}

async function universalHarnessSync(primaryMcpConfigPath, installedModules = []) {
    log.info('Universal Agent Harness Sync...');
    const detections = detectPlatforms();
    let masterMcpData = {};
    try { masterMcpData = JSON.parse(fs.readFileSync(primaryMcpConfigPath, 'utf8')); } catch (e) { logDebug(e, 'operation'); }

    const syncMcpConfig = (targetPath) => {
        try {
            let data = { mcpServers: {} };
            const existing = readJsonFile(targetPath);
            if (existing) {
                data = existing;
                if (!data.mcpServers) data.mcpServers = {};
            }
            if (masterMcpData.mcpServers) {
                for (const [key, val] of Object.entries(masterMcpData.mcpServers)) {
                    data.mcpServers[key] = val;
                }
            }
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, JSON.stringify(data, null, 2), { mode: 0o600 });
            try { fs.chmodSync(targetPath, 0o600); } catch (e) { logDebug(e, 'chmod targetPath'); }
        } catch (e) {
            log.warn(`Failed to sync MCP to ${targetPath}: ${e.message}`);
        }
    };

    const syncOpencodeConfig = (targetPath) => {
        try {
            const existing = readJsoncFile(targetPath);
            const data = existing && existing.mcp ? existing : Object.assign({}, existing || {}, { mcp: {} });
            if (masterMcpData.mcpServers) {
                // OpenCode provider APIs (e.g. OpenAI-compatible, Console) enforce tool name length limits
                // (e.g. max 64 chars) and context limits. Loading 20+ MCPs causes provider errors (e.g. 73-char tool names).
                // OpenCode uses a slim profile: only core servers (memb_mcp, zavora_computer_use) are enabled by default.
                const OPENCODE_DEFAULT_SLIM = new Set(['memb_mcp', 'zavora_computer_use', 'deja']);
                const existingMcp = existing && existing.mcp ? existing.mcp : {};
                const hasExistingKeys = Object.keys(existingMcp).length > 0;

                for (const [key, val] of Object.entries(masterMcpData.mcpServers)) {
                    const rawCmd = Array.isArray(val.command) ? val.command : [val.command];
                    const rawArgs = Array.isArray(val.args) ? val.args : [];
                    const fullCmd = [...rawCmd, ...rawArgs].map(c => {
                        if (c === '__PYTHON_BIN__') {
                            return process.platform === 'win32'
                                ? path.join(homeDir, '.gemini', 'config', 'mcps', 'memb-mcp', '.venv', 'Scripts', 'python.exe')
                                : path.join(homeDir, '.gemini', 'config', 'mcps', 'memb-mcp', '.venv', 'bin', 'python');
                        }
                        return c;
                    });

                    const existingEntry = existingMcp[key];

                    // If existing config is intentionally slimmed (has keys, but omitted this one), don't resurrect unless in slim set
                    if (hasExistingKeys && !existingEntry && !OPENCODE_DEFAULT_SLIM.has(key)) {
                        continue;
                    }

                    // Preserve user's explicit enabled/disabled setting; otherwise default to true only for slim set
                    const isEnabled = existingEntry && typeof existingEntry.enabled === 'boolean'
                        ? existingEntry.enabled
                        : OPENCODE_DEFAULT_SLIM.has(key);

                    let envObj = val.environment || val.env;
                    if (envObj) {
                        envObj = Object.assign({}, envObj);
                        for (const [eKey, eVal] of Object.entries(envObj)) {
                            if (eVal === '__GEMINI_API_KEY__') {
                                envObj[eKey] = '${GEMINI_API_KEY}';
                            }
                        }
                    }

                    data.mcp[key] = {
                        type: "local",
                        command: fullCmd,
                        enabled: isEnabled,
                        ...(envObj ? { environment: envObj } : {})
                    };
                }
            }

            // Wire BDB AOS Plugin for OpenCode
            const opencodeDir = path.dirname(targetPath);
            const pluginsDir = path.join(opencodeDir, 'plugins');
            const pluginFile = path.join(pluginsDir, 'bdb-aos.js');
            const pluginSrc = path.join(srcDir, '.opencode', 'plugins', 'bdb-aos.js');

            try {
                if (fs.existsSync(pluginSrc)) {
                    fs.mkdirSync(pluginsDir, { recursive: true });
                    fs.copyFileSync(pluginSrc, pluginFile);
                    try { fs.chmodSync(pluginFile, 0o644); } catch (e) { logDebug(e, 'chmod pluginFile'); }
                }
            } catch (pluginErr) {
                log.warn(`Could not install OpenCode plugin: ${pluginErr.message}`);
            }

            // Register plugin in opencode.jsonc if plugin file exists
            if (fs.existsSync(pluginFile)) {
                if (!Array.isArray(data.plugin)) {
                    data.plugin = [];
                }
                const pluginPathNormalized = pluginFile.replace(/\\/g, '/');
                const alreadyRegistered = data.plugin.some(p => {
                    const str = typeof p === 'string' ? p : (Array.isArray(p) ? p[0] : '');
                    return str.includes('bdb-aos');
                });
                if (!alreadyRegistered) {
                    data.plugin.push(pluginPathNormalized);
                }
            }

            // Register skills paths for OpenCode
            if (!data.skills || typeof data.skills !== 'object') {
                data.skills = { paths: [".agents/skills"] };
            } else if (Array.isArray(data.skills.paths)) {
                if (!data.skills.paths.includes(".agents/skills")) {
                    data.skills.paths.push(".agents/skills");
                }
            } else {
                data.skills.paths = [".agents/skills"];
            }

            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, JSON.stringify(data, null, 2), { mode: 0o600 });
            try { fs.chmodSync(targetPath, 0o600); } catch (e) { logDebug(e, 'chmod targetPath'); }
        } catch (e) {
            log.warn(`Failed to sync MCP to ${targetPath}: ${e.message}`);
        }
    };

    for (const d of detections) {
        log.step(`Injecting MCP engines into ${d.name}...`);
        if (d.key === 'claudedesktop') {
            syncMcpConfig(path.join(d.path, 'claude_desktop_config.json'));
        } else if (d.key === 'claudecode') {
            syncMcpConfig(path.join(homeDir, '.claude.json'));
        } else if (d.key === 'cursor') {
            syncMcpConfig(path.join(homeDir, '.cursor', 'mcp.json'));
            syncMcpConfig(path.join(d.path, 'User', 'globalStorage', 'mcp.json'));
            syncMcpConfig(path.join(d.path, 'User', 'mcp.json'));
            syncMcpConfig(path.join(d.path, 'mcp.json'));
            syncMcpConfig(path.join(currentDir, '.cursor', 'mcp.json'));
        } else if (d.key === 'vscode') {
            syncMcpConfig(path.join(d.path, 'User', 'mcp.json'));
            syncMcpConfig(path.join(d.path, 'mcp.json'));
            syncMcpConfig(path.join(homeDir, '.roo', 'mcp_settings.json'));
            syncMcpConfig(path.join(d.path, 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json'));
            syncMcpConfig(path.join(homeDir, '.cline', 'mcp_settings.json'));
            syncMcpConfig(path.join(d.path, 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'));
        } else if (d.key === 'windsurf') {
            syncMcpConfig(path.join(homeDir, '.windsurf', 'mcp.json'));
            syncMcpConfig(path.join(d.path, 'User', 'mcp.json'));
            syncMcpConfig(path.join(d.path, 'mcp.json'));
        } else if (d.key === 'aider') {
            syncMcpConfig(path.join(homeDir, '.aider', 'mcp.json'));
        } else if (d.key === 'opencode') {
            syncOpencodeConfig(path.join(d.path, 'opencode.jsonc'));
        } else if (d.key === 'codex') {
            // Universal Sync never had a branch for Codex, so its config.toml
            // was never updated here even though the log claimed it was.
            try {
                mergeCodexTomlMcpServers(path.join(d.path, 'config.toml'), masterMcpData.mcpServers || {});
            } catch (e) {
                log.warn(`Failed to sync MCP to ${path.join(d.path, 'config.toml')}: ${e.message}`);
            }
        }
    }
    log.success('Universal Sync Complete!');
    generateAndOpenLaunchpad(installedModules);
}

async function runQuickUpdate(installState) {
    const s = spinner();
    s.start('Quick Update: refreshing skills & syncing installed submodules...');

    const excludeSkills = getTierExcludeSkills('1');
    const paths = resolveTargetPaths('1', null);

    fs.mkdirSync(backupDir, { recursive: true });
    fs.mkdirSync(paths.targetSkillDir, { recursive: true });
    retireObsoleteLegacyDir(paths.targetLegacyDir);
    fs.mkdirSync(paths.targetWorkspaceDir, { recursive: true });

    // Initialize manifest for this update session.
    initSessionManifest(installState.installManifest, [
        path.join(srcDir, 'skills'),
        path.join(srcDir, 'mcps'),
        path.join(srcDir, '.agents'),
        path.join(srcDir, '.claude'),
        path.join(srcDir, '.cursor'),
        path.join(srcDir, '.github'),
        path.join(srcDir, '.codex-plugin'),
    ]);

    const skillsBase = path.join(srcDir, 'skills');
    if (fs.existsSync(skillsBase)) {
        const rawDirs = fs.readdirSync(skillsBase);
        const dirs = rawDirs.sort((a, b) => {
            const aIsLeaf = fs.existsSync(path.join(skillsBase, a, 'SKILL.md'));
            const bIsLeaf = fs.existsSync(path.join(skillsBase, b, 'SKILL.md'));
            if (aIsLeaf && !bIsLeaf) return 1;
            if (!aIsLeaf && bIsLeaf) return -1;
            return 0;
        });
        for (const dir of dirs) {
            const fullPath = path.join(skillsBase, dir);
            if (!fs.statSync(fullPath).isDirectory()) continue;
            if (dir === 'global_legacy') {
                copyDirRecursiveSync(fullPath, paths.targetLegacyDir, excludeSkills);
            } else if (dir === 'workspace_agents') {
                copyDirRecursiveSync(fullPath, paths.targetWorkspaceDir, excludeSkills);
            } else {
                syncSkillEntry(fullPath, dir, paths.targetSkillDir, excludeSkills);
            }
        }
    }
    syncSkillsToGlobalHarnesses(excludeSkills);
    pruneRemovedSkills(_sessionManifest);
    s.stop('Skills refreshed');

    // Everything injectHarnessRules() delivers -- GEMINI.md, the dispatcher
    // workflows the skills point at, the compiled subagent definitions, the
    // harness rule files and the gate + memory hooks -- used to be
    // fresh-install-only. v4.4.1 split just the hooks out of it for Quick
    // Update; the rest stayed behind, so a machine that only ever quick-updates
    // kept running first-install agent definitions and dispatcher scripts
    // forever. Same defect as the hook, one layer up. Run the whole thing.
    installStep('refresh harness rules, workflows, agents and hooks', () => {
        injectHarnessRules();
    }, 'Harness files keep whatever version this machine already had.');

    // OpenWiki setup only ever ran on a brand-new install (main()'s fresh-install
    // branch below) -- an existing install running Quick Update never got offered
    // it and never had its daemon schedule refreshed. promptCredentials() already
    // detects an existing key and collapses to a single "keep existing" prompt in
    // that case, so this is a no-op confirm for anyone already configured and a
    // real one-time offer for anyone who isn't (including installs from before
    // this feature existed).
    if (!isAutoYes) {
        const creds = await promptCredentials(paths.targetMcpDir);
        if (creds !== BACK) {
            await installOpenWikiDaemon(creds.gemini, paths.targetSkillDir, { provider: creds.openwikiProvider, model: creds.openwikiModel, baseUrl: creds.openwikiBaseUrl });
            await installOpenWikiVisualizer();
        }
    }

    const modulesToUpdate = installState.installedModules || [];
    for (const subId of modulesToUpdate) {
        if (subId === 'synapse') await installSynapse();
        else if (subId === 'memb') await installMemB(false);
        else if (subId === 'remote') await installOSRemoteGateway();
        else if (subId === 'ao' && aoSupportedHere()) await installOSAgentWorkspace();
        else if (subId === 'creator') await installCreatorExtension();
        else if (subId === 'hardware') await installHardwarePcb();
        else if (subId === 'installer') await installDevToolInstaller();
    }

    await promptOptionalModules(modulesToUpdate);
    // modulesToUpdate now covers both the modules updated in the loop above and any newly
    // chosen ones promptOptionalModules just installed (it mutates the same array) -- every
    // one of them already ran its own install-and-verify, so reloadDaemons() should leave
    // them alone rather than relaunching and re-checking a daemon a second time.
    const alreadyHandled = modulesToUpdate.map(id => MODULE_ID_TO_DAEMON_NAME[id]).filter(Boolean);
    await reloadDaemons(alreadyHandled);
    saveManifest({ tier: '1', isUniversal: true, installedModules: modulesToUpdate });
    flushSessionManifest();

    console.log('');
    verifyEcosystemInstallation();
    // Fresh installs open this via universalHarnessSync(); Quick Update never
    // did, so a dev-workflow machine only ever saw it once, on day one --
    // every subsequent run is a Quick Update, which is what almost every
    // real run after the first actually is.
    generateAndOpenLaunchpad(modulesToUpdate);
}


function buildAoAnnouncementBanner() {
    return [
        '\x1b[36m╭──────────────────────────────────────────────────────────────────────────────╮\x1b[0m',
        '\x1b[36m│\x1b[0m                                                                              \x1b[36m│\x1b[0m',
        '\x1b[36m│\x1b[0m   \x1b[1m\x1b[35m🚀 BDB AGENT ORCHESTRATOR APP — FINALE BETA JETZT VERFÜGBAR!\x1b[0m              \x1b[36m│\x1b[0m',
        '\x1b[36m│\x1b[0m                                                                              \x1b[36m│\x1b[0m',
        '\x1b[36m│\x1b[0m   Die nächste Generation der Cross-Harness Multi-Agenten-Orchestrierung      \x1b[36m│\x1b[0m',
        '\x1b[36m│\x1b[0m   ist jetzt als finale Beta für alle User freigeschaltet.                    \x1b[36m│\x1b[0m',
        '\x1b[36m│\x1b[0m                                                                              \x1b[36m│\x1b[0m',
        '\x1b[36m│\x1b[0m   • \x1b[1mDashboard & WebUI:\x1b[0m  http://localhost:3101                                \x1b[36m│\x1b[0m',
        '\x1b[36m│\x1b[0m   • \x1b[1mService-Befehl:\x1b[0m     ao service install  (Hintergrunddienst aktivieren)   \x1b[36m│\x1b[0m',
        '\x1b[36m│\x1b[0m   • \x1b[1mQuick Launch:\x1b[0m       ao open  oder  ao service status                     \x1b[36m│\x1b[0m',
        '\x1b[36m│\x1b[0m   • \x1b[1mFeatures:\x1b[0m           Session-Telemetrie, Live-AgentTrail & Multi-Workspaces\x1b[36m│\x1b[0m',
        '\x1b[36m│\x1b[0m                                                                              \x1b[36m│\x1b[0m',
        '\x1b[36m╰──────────────────────────────────────────────────────────────────────────────╯\x1b[0m\n'
    ].join('\n');
}

// AOS CLI ships as a separate npm package under packages/ for one reason: pi
// updates on its own cadence, and folding it into this release cycle would turn
// every pi bump into a full AOS reinstall. So it installs as an ordinary global
// package and pulls pi in as its own dependency -- and it writes nothing to
// ~/.agents, because it reads that directory rather than owning it.
function installAosCli() {
    const pkgDir = path.join(srcDir, 'packages', 'aos-cli');
    const manual = 'cd packages/aos-cli && npm install -g .';

    if (!fs.existsSync(path.join(pkgDir, 'package.json'))) {
        log.warn(`AOS CLI package missing at ${pkgDir} -- skipped. Install it later: ${manual}`);
        return;
    }
    if (hasExecutable('aos-cli')) {
        log.step('aos-cli is already on PATH.');
        return;
    }
    if (DRY_RUN) {
        log.step('[dry-run] would run: npm install -g <packages/aos-cli>');
        return;
    }

    const res = installStep('install AOS CLI', () => {
        log.step('Installing AOS CLI globally (pi is installed as its dependency)...');
        execSync(`npm install -g ${JSON.stringify(pkgDir)}`, { stdio: 'ignore' });
    }, `The rest of AOS is installed. Install AOS CLI later: ${manual}`);

    if (res.ok && hasExecutable('aos-cli')) {
        log.success('AOS CLI installed -- run `aos-cli`.');
    } else if (res.ok) {
        log.warn('AOS CLI is installed but `aos-cli` is not on PATH. launchd and some Windows shells start with a PATH that omits npm\'s global bin.');
    }
}

async function main() {
    if (process.argv[2] === 'store') {
        const storeScript = path.join(srcDir, 'bin', 'aos-store.mjs');
        const result = spawnSync(process.execPath, [storeScript, ...process.argv.slice(3)], { stdio: 'inherit' });
        process.exitCode = result.status == null ? 1 : result.status;
        return;
    }
    if (process.argv[2] === 'doctor' || process.argv[2] === 'checkup' || process.argv.includes('--doctor')) {
        const doctorScript = path.join(srcDir, 'bin', 'aos-doctor.mjs');
        const doctorArgs = process.argv.slice(process.argv[2] === 'doctor' || process.argv[2] === 'checkup' ? 3 : 2).filter(a => a !== '--doctor');
        const result = spawnSync(process.execPath, [doctorScript, ...doctorArgs], { stdio: 'inherit' });
        process.exitCode = result.status == null ? 1 : result.status;
        return;
    }
    const skipIntro = isAutoYes || process.argv.includes('--no-intro') || process.argv.includes('--no-animation');
    await renderKineticIntro({ rotations: 1, fps: 12.5, skip: skipIntro, pkgVersion: pkg.version });
    console.log(buildWordmarkBanner());

    const installState = detectInstallState();
    const detections = detectPlatforms();

    // Fast local daemon checks (150ms budget)
    const aoOnline = await verifyDaemonListening(3101, 'AO Daemon', 150);
    const remoteOsOnline = await verifyDaemonListening(9080, 'RemoteOS', 150);
    const daemonStatus = [
        { name: 'AO Orchestrator', port: 3101, online: aoOnline },
        { name: 'RemoteOS Gateway', port: 9080, online: remoteOsOnline }
    ];

    intro(buildHeroHeader(pkg.version));
    console.log(buildTelemetryCard({ installState, detections, daemonStatus }));
    console.log(buildAoAnnouncementBanner());

    if (DRY_RUN) {
        // Precise on purpose: version comparison still queries the registry, and
        // npm writes its own cache and logs under ~/.npm doing so. Nothing AOS
        // owns is touched -- but claiming "no commands executed" was not true.
        log.warn('DRY-RUN MODE active - nothing AOS owns is written. Read-only registry lookups still run (npm caches under ~/.npm).');
    }
    if (isAutoYes) {
        log.warn('Non-interactive/auto mode (-y): all defaults are accepted automatically.');
    }

    const latest = await checkForUpdates();
    if (latest) {
        log.warn(`Update available: v${pkg.version} ➔ v${latest} — run: npx ${pkg.name}@latest`);
    }

    // Initialize session manifest – all copyDirRecursiveSync calls from here
    // forward will use manifest-aware writes automatically.
    initSessionManifest(installState.installManifest, [
        path.join(srcDir, 'skills'),
        path.join(srcDir, 'mcps'),
        path.join(srcDir, '.agents'),
        path.join(srcDir, '.claude'),
        path.join(srcDir, '.cursor'),
        path.join(srcDir, '.github'),
        path.join(srcDir, '.codex-plugin'),
        path.join(srcDir, 'GEMINI.md'),
        path.join(srcDir, 'AGENTS.md'),
        path.join(srcDir, 'CLAUDE.md'),
        path.join(srcDir, 'CODEX.md'),
    ]);

    if (PROJECT_HARNESS_ARG) {
        installProjectHarness();
        outro('Project harness installation complete.');
        return;
    }

    if (installState.isInstalled && !isAutoYes) {
        const options = installState.updateAvailable
            ? [
                { value: 'quick', label: `⚡ Quick Update (v${installState.localVersion} ➔ v${installState.currentVersion})`, hint: 'refresh skills, templates & daemons' },
                { value: 'doctor', label: '🩺 Run System Checkup / Doctor', hint: 'verify environment, placement, daemons & AO' },
                { value: 'project', label: '📁 Drop Local Project Harness', hint: 'copy dispatcher contract to cwd' },
                { value: 'reconfigure', label: '🛠️ Reconfigure System', hint: 'change targets, tier or options' },
                { value: 'uninstall', label: '🗑️ Uninstall AOS', hint: 'remove what this installer placed; your data stays' },
                { value: 'cancel', label: '❌ Exit' }
              ]
            : [
                { value: 'doctor', label: '🩺 Run System Checkup / Doctor', hint: 'verify environment, placement, daemons & AO' },
                { value: 'project', label: '📁 Drop Local Project Harness', hint: 'copy dispatcher contract to cwd' },
                { value: 'quick', label: '🔄 Verify & Refresh All Skills', hint: 're-sync and health check' },
                { value: 'reconfigure', label: '🛠️ Reconfigure System', hint: 'switch tier or targets' },
                { value: 'uninstall', label: '🗑️ Uninstall AOS', hint: 'remove what this installer placed; your data stays' },
                { value: 'cancel', label: '❌ Exit' }
              ];

        const action = pick(await select({
            message: 'Select an operation:',
            options,
            initialValue: options[0].value
        }));

        if (action === 'cancel') {
            outro('Cancelled.');
            return;
        }
        if (action === 'doctor') {
            const doctorScript = path.join(srcDir, 'bin', 'aos-doctor.mjs');
            spawnSync(process.execPath, [doctorScript], { stdio: 'inherit' });
            outro('System Checkup complete.');
            return;
        }
        if (action === 'project') {
            installProjectHarness();
            outro('Project harness installation complete.');
            return;
        }
        if (action === 'quick') {
            await runQuickUpdate(installState);
            outro('Quick Update complete.');
            return;
        }
        if (action === 'uninstall') {
            // aos-uninstall.mjs is its own script, not a function of this file --
            // it is ESM (installer.js is CommonJS) and drives its own readline
            // confirmation prompt, so it runs as a real child process with
            // inherited stdio rather than being imported in-process.
            const uninstallScript = path.join(srcDir, 'bin', 'aos-uninstall.mjs');
            if (!fs.existsSync(uninstallScript)) {
                log.error(`Uninstaller not found at ${uninstallScript} -- run it directly: npx @hybridlabor-api/aos-uninstall`);
                return;
            }
            spawnSync('node', [uninstallScript], { stdio: 'inherit' });
            return;
        }
    }

    const detectedNames = detections.map(d => d.name).join(', ');
    const platformOptions = [
        { value: '0', label: '🌐 Universal Agent Harness', hint: detections.length > 0 ? `sync ALL detected: ${detectedNames}` : 'sync across ALL AI platforms' },
        { value: '1', label: 'Google Antigravity', hint: '~/.gemini/config/skills' },
        { value: '2', label: 'Claude Desktop / Claude Code', hint: '~/.claude/skills' },
        { value: '3', label: 'Cursor / Generic IDE (project-local)', hint: '.cursor/' },
        { value: '5', label: 'ChatGPT Codex CLI', hint: '~/.codex/skills' },
        { value: '6', label: 'Windsurf IDE', hint: '~/.windsurf' },
        { value: '7', label: 'Roo Code / Cline / VS Code', hint: '~/.roo' },
        { value: '8', label: 'Aider CLI', hint: '~/.aider' },
        { value: '9', label: '📁 Local Project Harness', hint: 'copy dispatcher contract to current project' },
        { value: '10', label: '🖥️ AOS CLI', hint: 'pi harness -- reads ~/.agents, no own skill copy' },
        { value: '4', label: '⚙️ Custom Installation', hint: 'specify paths manually' }
    ];

    let tier = '1';
    let mode = 'merge';
    let customPaths = null;
    let creds = null;
    let selectedMcps = null;
    let wantsUniversal = true;
    let specificPlatforms = ['1'];

    markPlatformsExplicit(PLATFORMS_ARG || []);

    if (PLATFORMS_ARG) {
        // Explicit targets win over both the menu and the auto-yes default.
        // '0' means universal; anything else means exactly those targets, so
        // the universal MCP fan-out must NOT also run -- otherwise asking for
        // Claude only would still push servers into every detected harness.
        wantsUniversal = PLATFORMS_ARG.includes('0');
        specificPlatforms = wantsUniversal
            ? ['1']
            : PLATFORMS_ARG;
    }

    if (isAutoYes) {
        creds = { gemini: "", github: "", openwikiProvider: "google", openwikiModel: "", openwikiBaseUrl: "", keyEnvName: 'GEMINI_API_KEY' };
        selectedMcps = await promptMcpSelection(tier);
    } else {
        const ctx = { tier: '1', selectedPlatforms: ['0'], mode: 'merge', customPaths: null, creds: null, selectedMcps: null };
        const platformNames = { '0': '🌐 Universal Harness', '1': 'Google Antigravity', '2': 'Claude Desktop/Code', '3': 'Cursor/Generic IDE', '4': 'Custom Paths', '5': 'ChatGPT Codex CLI', '6': 'Windsurf', '7': 'Roo Code / Cline / VS Code', '8': 'Aider CLI', '9': 'Local Project Harness', '10': 'AOS CLI' };

        const stepTier = async () => {
            const t = await selectWithBack({
                message: 'Package Tier:',
                options: [
                    { value: '1', label: 'Pro MEDIA (Full suite of dev-optimized skills and creative MCPs)', hint: 'Default' },
                    { value: '2', label: 'Basic (Essential skills only, lightweight MCPs)' }
                ],
                initialValue: ctx.tier
            });
            if (t === BACK) return 'back';
            ctx.tier = t;
        };

        const stepPlatforms = async () => {
            const sel = await multiselectWithBack({
                message: 'Target AI Platform(s) - select multiple to install everywhere:',
                options: platformOptions,
                initialValues: ctx.selectedPlatforms
            });
            if (sel === BACK) return 'back';
            ctx.selectedPlatforms = sel;
            // A harness the user names counts as present even when no binary
            // or app bundle turns up for it.
            markPlatformsExplicit(sel);
        };

        const stepMode = async () => {
            // '9' is project-only: mode, custom paths, MCPs and credentials
            // don't apply to a harness drop (main() early-returns for it).
            if (ctx.selectedPlatforms.includes('9')) return;
            while (true) {
                const m = await selectWithBack({
                    message: 'Installation Mode:',
                    options: [
                        { value: 'merge', label: 'Merge: keep existing skills/MCPs, add/update BDB tools', hint: 'Recommended' },
                        { value: 'replace', label: 'Replace: backup & wipe existing skills/MCPs, ONLY BDB tools' }
                    ],
                    initialValue: ctx.mode
                });
                if (m === BACK) return 'back';
                if (m === 'replace') {
                    const sure = await askConfirm({
                        message: '⚠️  REPLACE MODE will back up and WIPE existing skills/MCPs of all selected target(s). Continue?',
                        initialValue: false
                    });
                    if (isCancel(sure)) { cancel('Installation aborted.'); process.exit(0); }
                    if (!sure) {
                        log.warn('Replace mode not confirmed - choose Merge or ← Back.');
                        continue;
                    }
                }
                ctx.mode = m;
                return;
            }
        };

        const stepCustomPaths = async () => {
            if (ctx.selectedPlatforms.includes('9')) return;
            if (!ctx.selectedPlatforms.includes('4')) return;
            log.info('Custom Path Configuration:');
            const skillDirRes = await textWithBack({ message: `Target directory for global skills [default: ${path.join(homeDir, '.bdb-skills')}] (< = back):`, placeholder: path.join(homeDir, '.bdb-skills') });
            if (skillDirRes === BACK) return 'back';
            const skillDir = ((skillDirRes || '') + '').trim() || path.join(homeDir, '.bdb-skills');
            const legacyDirRes = await textWithBack({ message: `Target directory for legacy skills [default: ${path.join(skillDir, 'legacy')}] (< = back):`, placeholder: path.join(skillDir, 'legacy') });
            if (legacyDirRes === BACK) return 'back';
            const legacyDir = ((legacyDirRes || '') + '').trim() || path.join(skillDir, 'legacy');
            const workDirRes = await textWithBack({ message: `Target directory for workspace skills [default: ${workspaceDir}] (< = back):`, placeholder: workspaceDir });
            if (workDirRes === BACK) return 'back';
            const workDir = ((workDirRes || '') + '').trim() || workspaceDir;
            const mcpConfRes = await textWithBack({ message: `Target path for MCP Config JSON file [default: ${path.join(homeDir, 'mcp_config.json')}] (< = back):`, placeholder: path.join(homeDir, 'mcp_config.json') });
            if (mcpConfRes === BACK) return 'back';
            const mcpConf = ((mcpConfRes || '') + '').trim() || path.join(homeDir, 'mcp_config.json');
            ctx.customPaths = { skillDir, legacyDir, workspaceDir: workDir, mcpConfigPath: mcpConf, mcpDir: path.dirname(mcpConf) };
        };

        const stepMcps = async () => {
            if (ctx.selectedPlatforms.includes('9')) return;
            const sel = await promptMcpSelection(ctx.tier);
            if (sel === BACK) return 'back';
            if (sel.length > 0) {
                const wantSaas = await askConfirm({
                    message: 'Install BDB SAAS SERVER MGMT tools (bdb-remoteos-mcp)?',
                    initialValue: false
                });
                if (isCancel(wantSaas)) { cancel('Installation aborted.'); process.exit(0); }
                if (wantSaas && !sel.includes('bdb-remoteos-mcp')) sel.push('bdb-remoteos-mcp');
            }
            ctx.selectedMcps = sel;
        };

        const stepCredentials = async () => {
            if (ctx.selectedPlatforms.includes('9')) return;
            const specNow = ctx.selectedPlatforms.filter(p => p !== '0');
            const ref = specNow[0] === '4' && ctx.customPaths ? ctx.customPaths.mcpDir : resolveTargetPaths(specNow[0] || '1', ctx.customPaths).targetMcpDir;
            const c = await promptCredentials(ref);
            if (c === BACK) return 'back';
            ctx.creds = c;
        };

        const stepReview = async () => {
            const specNow = ctx.selectedPlatforms.filter(p => p !== '0');
            if (specNow.length === 0 && ctx.selectedPlatforms.includes('0')) specNow.push('1');
            const lines = [
                `Tier:          ${ctx.tier === '1' ? 'Pro MEDIA' : 'Basic'}`,
                `Targets:       ${specNow.map(p => platformNames[p] || p).join(', ')}${ctx.selectedPlatforms.includes('0') ? ' + Universal Sync' : ''}`,
                `Mode:          ${ctx.mode}`,
                `MCPs:          ${(ctx.selectedMcps || []).join(', ') || '(none)'}`,
                `LLM Provider:  ${ctx.creds ? ctx.creds.openwikiProvider : '-'}`,
                `GitHub Token:  ${ctx.creds && ctx.creds.github ? maskApiKey(ctx.creds.github) : '(none)'}`,
                `Dry Run:       ${DRY_RUN ? 'YES - nothing will be written' : 'no'}`
            ];
            note(lines.join('\n'), '📋 Review your configuration');
            const action = await selectWithBack({
                message: 'Start installation?',
                options: [
                    { value: 'go', label: '🚀 Install now' },
                    { value: 'abort', label: '❌ Cancel installation' }
                ],
                initialValue: 'go'
            });
            if (action === BACK) return 'back';
            if (action === 'abort') return 'exit';
        };

        const steps = [stepTier, stepPlatforms, stepMode, stepCustomPaths, stepMcps, stepCredentials, stepReview];

        let i = 0;
        while (i < steps.length) {
            const res = await steps[i]();
            if (res === 'exit') { outro('Cancelled.'); return; }
            if (res === 'back') i = Math.max(0, i - 1);
            else i++;
        }

        tier = ctx.tier;
        mode = ctx.mode;
        customPaths = ctx.customPaths;
        creds = ctx.creds;
        selectedMcps = ctx.selectedMcps;
        wantsUniversal = ctx.selectedPlatforms.includes('0');
        specificPlatforms = ctx.selectedPlatforms.filter(p => p !== '0');
        if (specificPlatforms.length === 0 && wantsUniversal) specificPlatforms.push('1');
    }

    // Tier 9 is project-only and must run BEFORE any global install step --
    // a late postscript would still have dumped the full skill/MCP/daemon
    // payload into $HOME by then (v3.13 audit BLOCKER-2).
    const projectHarnessRequested = specificPlatforms.includes('9') || PROJECT_HARNESS_ARG;
    if (projectHarnessRequested) {
        const alsoSelected = specificPlatforms.filter(p => p !== '9');
        if (alsoSelected.length > 0) {
            log.warn(`Local Project Harness is project-only - skipping global install for target(s): ${alsoSelected.join(', ')}`);
        }
        installProjectHarness();
        outro('Project harness installation complete.');
        return;
    }

    installStep(`create the backup directory ${backupDir}`, () => {
        // Backups can hold credential copies (mcp_config_backup.json) --
        // 0700, not the umask default.
        fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    }, 'The installation continues, but existing files are not backed up.');

    // '10' is an action, not a directory target. AOS CLI reads
    // ~/.agents/skills, which syncSkillsToGlobalHarnesses() already writes --
    // left in this list it would fall through resolveTargetPaths()'s universal
    // defaults and install a second full copy of every skill somewhere nobody
    // reads them from.
    const aosCliRequested = specificPlatforms.includes('10');
    const dirPlatforms = specificPlatforms.filter(p => p !== '10');

    if (aosCliRequested && dirPlatforms.length === 0) {
        // AOS CLI alone would have no skills to load, and an empty target list
        // leaves primaryTarget undefined for everything downstream of it.
        log.warn('AOS CLI was the only target -- adding the universal skill target so it has something to load.');
        dirPlatforms.push('1');
    }

    const targets = dirPlatforms.map(p => ({
        value: p,
        ...resolveTargetPaths(p, customPaths)
    }));

    const excludeSkills = getTierExcludeSkills(tier);
    const skillsBase = path.join(srcDir, 'skills');

    const s = spinner();
    s.start(`Installing optimized skills${tier === '2' ? ' [Basic Tier]' : ''} to ${targets.length} target(s)...`);

    for (const t of targets) {
        if (mode === 'replace') {
            moveIfExists(t.targetSkillDir, path.join(backupDir, `config_skills_backup_${t.value}`), `global config skills (${t.value})`);
            moveIfExists(t.targetLegacyDir, path.join(backupDir, `legacy_skills_backup_${t.value}`), `legacy skills (${t.value})`);
            moveIfExists(t.targetWorkspaceDir, path.join(backupDir, `workspace_skills_backup_${t.value}`), `workspace skills (${t.value})`);
        }

        installStep(`create the skill target directories (${t.value})`, () => {
            fs.mkdirSync(t.targetSkillDir, { recursive: true });
            retireObsoleteLegacyDir(t.targetLegacyDir);
            fs.mkdirSync(t.targetWorkspaceDir, { recursive: true });
        }, 'The skill copies below will most likely be skipped as well.');

        if (fs.existsSync(skillsBase)) {
            installStep(`install the skills (${t.value})`, () => {
                const rawDirs = fs.readdirSync(skillsBase);
                const dirs = rawDirs.sort((a, b) => {
                    const aIsLeaf = fs.existsSync(path.join(skillsBase, a, 'SKILL.md'));
                    const bIsLeaf = fs.existsSync(path.join(skillsBase, b, 'SKILL.md'));
                    if (aIsLeaf && !bIsLeaf) return 1;
                    if (!aIsLeaf && bIsLeaf) return -1;
                    return 0;
                });
                for (const dir of dirs) {
                    const fullPath = path.join(skillsBase, dir);
                    if (!fs.statSync(fullPath).isDirectory()) continue;

                    if (dir === 'global_legacy') {
                        copyDirRecursiveSync(fullPath, t.targetLegacyDir, excludeSkills);
                    } else if (dir === 'workspace_agents') {
                        copyDirRecursiveSync(fullPath, t.targetWorkspaceDir, excludeSkills);
                    } else {
                        syncSkillEntry(fullPath, dir, t.targetSkillDir, excludeSkills);
                    }
                }
                log.step(`Installed all global config & core skills to ${t.targetSkillDir}`);
            }, 'The skills are missing or incomplete; the rest of the installation continues.');
        }
    }

    syncSkillsToGlobalHarnesses(excludeSkills);
    pruneRemovedSkills(_sessionManifest);
    s.stop('Skills installed.');

    injectHarnessRules();

    const primaryTarget = targets[0];
    for (const t of targets) {
        await installMcpsForTarget(t, { selectedMcps, mode, platformValue: t.value, creds });
    }

    await installOpenWikiDaemon(creds.gemini, primaryTarget.targetSkillDir, { provider: creds.openwikiProvider, model: creds.openwikiModel, baseUrl: creds.openwikiBaseUrl });
    await installOpenWikiVisualizer();
    await installTokenSaver(primaryTarget.platformValue);

    const installedModulesForPrompt = (installState && installState.installedModules) || [];
    // Unlike runQuickUpdate, nothing here reinstalls modules already in installedModulesForPrompt
    // -- only promptOptionalModules's own return value (the ones it just chose-and-installed
    // this call) actually ran an install-and-verify pass this run. Anything already in the
    // array before this call was untouched here and must still get its normal reloadDaemons()
    // check, not be skipped.
    const justInstalled = await promptOptionalModules(installedModulesForPrompt) || [];

    await promptMemBIngestion(path.join(primaryTarget.targetMcpDir, 'mcps'));

    const alreadyHandled = justInstalled.map(id => MODULE_ID_TO_DAEMON_NAME[id]).filter(Boolean);
    await reloadDaemons(alreadyHandled);
    saveManifest({ tier, isUniversal: wantsUniversal, installedModules: installedModulesForPrompt });

    if (wantsUniversal) {
        await universalHarnessSync(primaryTarget.mcpConfigPath, installedModulesForPrompt);
    }

    // Flush file-level install manifest after all writes are done.
    flushSessionManifest();

    // After the skill sync, because AOS CLI is useless without ~/.agents.
    if (aosCliRequested) installAosCli();

    console.log('');
    verifyEcosystemInstallation();

    outro(`🎉 Installation complete! Targets: ${targets.map(t => t.value).join(', ')}${aosCliRequested ? ' + AOS CLI' : ''} · Tier: ${tier === '1' ? 'Pro MEDIA' : 'Basic'}${DRY_RUN ? ' · DRY-RUN (nothing was modified)' : ''}`);
}

if (require.main === module) {
    main().catch(e => reportFatal('the beta installer run', e));
}

// Exported for tests -- requiring installer.js must not launch the TUI.
module.exports = {
    installOSAgentWorkspace,
    downloadOrUpdateModule,
    detectPlatforms,
    markPlatformsExplicit,
    mergeBdbSettingsHooks,
    mergeAntigravityHooks,
    mergeCodexTomlHooks,
    mergeCodexHooks: mergeCodexTomlHooks,
    mergeCodexTomlMcpServers,
    installGlobalHooks,
    installProjectHarness,
    promptMcpSelection,
    mirrorMcpServersTo,
    ensureDejaExclude,
    // Manifest store (exported for verification tests)
    computeFileHash,
    getInstallManifestPath,
    loadInstallManifest,
    saveInstallManifest,
    resolveFileConflict,
    buildKnownSourceHashes,
    initSessionManifest,
    flushSessionManifest,
    copyDirRecursiveSync,
    INSTALL_MANIFEST_PATH,
    // Agent compilers & pipeline helpers
    parseAgentsMd,
    compileClaudeAgents,
    compileOpenCodeAgents,
    compileCodexAgents,
    loadPipelineConfig,
    resolveAgentConfig,
    CANONICAL_TIERS,
    // Launchpad lifecycle (exported for regression tests)
    generateAndOpenLaunchpad,
    shouldOpenLaunchpad,
    shouldAutostartLaunchpad,
    isDevEnvironment,
    LAUNCHPAD_WEB_MODULES,
    LAUNCHPAD_OPEN_FLAGS,
};
