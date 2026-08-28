#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const net = require('net');
const readline = require('readline');
const util = require('util');

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
const { execSync, spawn, spawnSync, exec } = require('child_process');
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

const pkgPath = path.join(__dirname, 'package.json');
let pkg = { name: '@hybridlabor-api/bdb-dev-optimized-agent-skills', version: '3.9.6-beta' };
if (fs.existsSync(pkgPath)) {
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch (e) { logDebug(e, 'operation'); }
}

const colors = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    cyan: "\x1b[36m",
    purple: "\x1b[38;2;157;78;221m",
    purpleBold: "\x1b[1;\x1b[38;2;157;78;221m",
    // v3.13 "NODEFORGE" release identity. The wordmark itself is drawn with a
    // per-column pink -> yellow -> amethyst gradient computed in buildBanner();
    // these named constants cover the surrounding chrome (divider, tagline) and
    // the animation effects. Deliberately distinct from the purple/cyan beta
    // banner so a push to `latest` is visually obvious, not just a
    // version-number diff someone has to notice on their own.
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
// 8 Aider (9 = project harness has its own --project-harness flag).
const VALID_PLATFORMS = ['0', '1', '2', '3', '4', '5', '6', '7', '8'];
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
        const lookup = process.platform === 'win32' ? `where ${binary}` : `command -v ${binary}`;
        execSync(lookup, { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
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

function detectPlatforms() {
    const detections = [];

    if (fs.existsSync(geminiDir)) {
        detections.push({ name: "Google Antigravity", path: geminiDir, key: "antigravity" });
    }

    const codexDir = path.join(homeDir, '.codex');
    if (fs.existsSync(codexDir) || fs.existsSync(path.join(codexDir, 'config.toml'))) {
        detections.push({ name: "ChatGPT Codex CLI", path: codexDir, key: "codex" });
    }

    const claudeCodeConfig = path.join(homeDir, '.claude.json');
    const claudeCodeDir = path.join(homeDir, '.claude');
    if (fs.existsSync(claudeCodeConfig) || fs.existsSync(claudeCodeDir)) {
        detections.push({ name: "Claude Code CLI", path: claudeCodeDir, key: "claudecode" });
    }

    const claudePath = process.platform === 'win32'
        ? path.join(process.env.APPDATA || homeDir, 'Claude')
        : path.join(homeDir, 'Library', 'Application Support', 'Claude');
    if (fs.existsSync(claudePath)) {
        detections.push({ name: "Claude Desktop", path: claudePath, key: "claudedesktop" });
    }

    const cursorPath = process.platform === 'win32'
        ? path.join(process.env.APPDATA || homeDir, 'Cursor')
        : path.join(homeDir, 'Library', 'Application Support', 'Cursor');
    if (fs.existsSync(cursorPath)) {
        detections.push({ name: "Cursor IDE", path: cursorPath, key: "cursor" });
    }

    const windsurfPath = process.platform === 'win32'
        ? path.join(process.env.APPDATA || homeDir, 'Windsurf')
        : path.join(homeDir, 'Library', 'Application Support', 'Windsurf');
    if (fs.existsSync(windsurfPath)) {
        detections.push({ name: "Windsurf IDE", path: windsurfPath, key: "windsurf" });
    }

    const vscodePath = process.platform === 'win32'
        ? path.join(process.env.APPDATA || homeDir, 'Code')
        : path.join(homeDir, 'Library', 'Application Support', 'Code');
    const rooPath = path.join(homeDir, '.roo');
    const clinePath = path.join(homeDir, '.cline');
    if (fs.existsSync(vscodePath) || fs.existsSync(rooPath) || fs.existsSync(clinePath)) {
        detections.push({ name: "Roo Code / Cline / VS Code", path: vscodePath, key: "vscode" });
    }

    const aiderConf = path.join(homeDir, '.aider.conf.yml');
    if (fs.existsSync(aiderConf) || fs.existsSync(path.join(homeDir, '.aider'))) {
        detections.push({ name: "Aider CLI", path: homeDir, key: "aider" });
    }

    const opencodeDir = process.platform === 'win32'
        ? path.join(process.env.APPDATA || homeDir, 'opencode')
        : path.join(homeDir, '.config', 'opencode');
    if (fs.existsSync(opencodeDir) || fs.existsSync(path.join(homeDir, '.opencode'))) {
        detections.push({ name: "OpenCode CLI", path: fs.existsSync(opencodeDir) ? opencodeDir : path.join(homeDir, '.opencode'), key: "opencode" });
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
        { id: 'ao', dir: path.join(basePath, 'bdb-os-agent-workspace') },
        { id: 'creator', dir: path.join(basePath, 'bdb-dev-creator-extension') },
        { id: 'installer', dir: path.join(basePath, 'bdb-dev-tool-installer') }
    ];

    for (const sub of submodules) {
        if (fs.existsSync(sub.dir) && !installedModules.includes(sub.id)) {
            installedModules.push(sub.id);
        }
    }

    const currentVersion = pkg.version || '3.9.6';
    const updateAvailable = isInstalled && (localVersion !== currentVersion);

    return { isInstalled, localVersion, currentVersion, updateAvailable, installedModules, manifest };
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

function reloadDaemons() {
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
            if (fs.existsSync(d.plist)) {
                try {
                    execSync(`launchctl unload "${d.plist}" 2>/dev/null || true`, { stdio: 'ignore' });
                    execSync(`launchctl load "${d.plist}" 2>/dev/null || true`, { stdio: 'ignore' });
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
            if (fs.existsSync(d.vbs)) {
                try {
                    spawn('wscript.exe', [d.vbs], { detached: true, stdio: 'ignore' }).unref();
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

function copyDirRecursiveSync(source, target, excludeList = []) {
    if (!fs.existsSync(source)) return;
    const sourceStat = fs.lstatSync(source);
    if (sourceStat.isFile()) {
        const targetDir = path.dirname(target);
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        fs.copyFileSync(source, target);
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
                copyDirRecursiveSync(curSource, curTarget, excludeList);
            } else {
                fs.copyFileSync(curSource, curTarget);
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
// existed with different content; the root-level one (and 5 siblings:
// bdbsaastraining, github-repo, memb-ingest, bdb-dev-os-skill,
// synapse-integration-skill) never survived a global sync intact.
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

    const extraSkillDestinations = [
        path.join(homeDir, '.claude', 'skills'),
        path.join(homeDir, '.agents', 'skills'),
        path.join(homeDir, '.codex', 'skills'),
        path.join(homeDir, '.cursor', 'skills'),
        path.join(homeDir, '.roo', 'skills')
    ];

    for (const dest of extraSkillDestinations) {
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

async function promptCredentials(referenceMcpDir) {
    if (isAutoYes) return { gemini: "", github: "", openwikiProvider: "google", openwikiModel: "", openwikiBaseUrl: "", keyEnvName: 'GEMINI_API_KEY' };

    const existingEnv = loadExistingEnv(referenceMcpDir);
    const existingGemini = existingEnv['GEMINI_API_KEY'] || existingEnv['GOOGLE_API_KEY'] || existingEnv['OPENWIKI_API_KEY'] || '';
    const existingGithub = existingEnv['GITHUB_PERSONAL_ACCESS_TOKEN'] || existingEnv['GITHUB_TOKEN'] || '';
    const existingProvider = existingEnv['OPENWIKI_PROVIDER'] || 'google';
    const existingModel = existingEnv['OPENWIKI_MODEL'] || '';
    const existingBaseUrl = existingEnv['OPENWIKI_BASE_URL'] || '';

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
                keyEnvName: existingProvider === 'google' ? 'GEMINI_API_KEY' : 'OPENWIKI_API_KEY'
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

const GLITCH_CHARS = ['!', '@', '#', '$', '%', '^', '&', '*', '█', '▓', '▒', '░', '▄', '▀', '▌', '▐', '▆', '▇'];

async function glitchBanner(bannerStr) {
    if (!process.stdout.isTTY) return;

    const lines = bannerStr.split('\n');
    const lineCount = lines.length;
    
    console.log(bannerStr);
    
    try {
        process.stdout.write('\x1B[?25l');
        const duration = 800;
        const fps = 15;
        const frameTime = Math.floor(1000 / fps);
        const frames = Math.floor(duration / frameTime);
        
        for (let i = 0; i < frames; i++) {
            readline.moveCursor(process.stdout, 0, -lineCount);
            
            const glitchedLines = lines.map(line => {
                if (line.trim().length === 0) return line;
                
                let out = '';
                let inEscape = false;
                for (let j = 0; j < line.length; j++) {
                    const c = line[j];
                    if (c === '\x1B') inEscape = true;
                    
                    if (inEscape) {
                        out += c;
                        if (c === 'm') inEscape = false;
                    } else {
                        if (c !== ' ' && Math.random() < 0.05) {
                            const gChar = GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
                            out += `${colors.magenta}${gChar}${colors.reset}`;
                        } else {
                            out += c;
                        }
                    }
                }
                return out;
            });
            
            process.stdout.write(glitchedLines.join('\n') + '\n');
            await new Promise(r => setTimeout(r, frameTime));
        }
        
        readline.moveCursor(process.stdout, 0, -lineCount);
        readline.clearScreenDown(process.stdout);
    } finally {
        process.stdout.write('\x1B[?25h');
    }
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
        try {
            remoteVer = execSync(`npm view ${pkgName} version`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 4000 }).trim();
        } catch (e) { logDebug(e, 'operation'); }

        if (remoteVer && localVer !== remoteVer) {
            return { installed: true, updateAvailable: true, localVer, remoteVer };
        }
        return { installed: true, updateAvailable: false, localVer, remoteVer };
    } catch (e) {
        return { installed: true, updateAvailable: false, localVer: null, remoteVer: null };
    }
}

function downloadOrUpdateModule(pkgName, targetDir, displayName) {
    const status = checkModuleUpdate(pkgName, targetDir);
    if (status.installed && !status.updateAvailable) {
        log.step(`${displayName} is up to date (v${status.localVer})`);
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
        if (tarball) {
            execSync(`tar -xzf "${tarball}" --strip-components=1`, { stdio: 'ignore', cwd: targetDir });
            fs.unlinkSync(path.join(targetDir, tarball));
            s.stop(`${displayName} ready (v${status.remoteVer || 'latest'})`);
            return true;
        } else {
            throw new Error("NPM pack returned no archive.");
        }
    } catch (e) {
        s.stop(`Failed downloading ${displayName}: ${e.message}`);
        return false;
    }
}

function moduleBasePath() {
    return scriptDir.includes('_npx') ? path.join(os.homedir(), '.agents') : path.dirname(srcDir);
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
    downloadOrUpdateModule('@hybridlabor-api/memb', membDir, 'memB Vector Engine');
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

            if (!fs.existsSync(venvPython)) {
                try {
                    execSync(`uv venv --seed .venv`, { cwd: membDir, stdio: 'ignore' });
                } catch (e1) {
                    execSync(`${pythonCmd} -m venv .venv`, { cwd: membDir, stdio: 'ignore' });
                }
            }

            const pipViaPython = `"${venvPython}" -m pip`;
            runPipWithRetry(`${pipViaPython} install --upgrade setuptools --timeout 30 --no-input`, { cwd: membDir, stdio: 'ignore' }, 'pip setuptools for memB standalone', 2, 120000);
            runPipWithRetry(`${pipViaPython} install -r requirements.txt --timeout 30 --no-input`, { cwd: membDir, stdio: 'inherit' }, 'pip install for memB standalone', 2, 900000);

            if (installWebUI && fs.existsSync(serverPy)) {
                runPipWithRetry(`${pipViaPython} install fastapi uvicorn --timeout 30 --no-input`, { cwd: membDir, stdio: 'ignore' }, 'pip fastapi+uvicorn for memB WebUI', 2, 120000);
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
    downloadOrUpdateModule('@hybridlabor-api/bdb-synapse', synapseDir, 'BDB Synapse');
    if (DRY_RUN) {
        log.step('[dry-run] would link synapse binary into ~/.local/bin/synapse + setup background daemon');
        return;
    }

    const isWin = process.platform === 'win32';
    const binaryName = isWin ? 'synapse.js' : 'synapse';
    let binaryPath = path.join(synapseDir, 'bin', binaryName);
    if (!fs.existsSync(binaryPath)) {
        if (process.platform === 'darwin' && fs.existsSync(path.join(synapseDir, 'bin', 'synapse-darwin-arm64'))) {
            binaryPath = path.join(synapseDir, 'bin', 'synapse-darwin-arm64');
        } else if (process.platform === 'linux' && fs.existsSync(path.join(synapseDir, 'bin', 'synapse-linux-amd64'))) {
            binaryPath = path.join(synapseDir, 'bin', 'synapse-linux-amd64');
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
            const runCmd = binaryPath.endsWith('.js') ? `node "${binaryPath}" serve` : `"${binaryPath}" serve`;
            // WshShell.Run has no stdout/stderr redirection of its own, so a crash on launch
            // (e.g. a missing dependency the binary shells out to) used to die silently with
            // nothing to diagnose short of reading source — route through a .bat wrapper that
            // redirects to the same ~/.synapse log files the macOS launchd plist already writes.
            const batContent = `@echo off\r\ncd /d "${synapseDir}"\r\n${runCmd} >> "${stdoutLog}" 2>> "${stderrLog}"\r\n`;
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
                    log.warn(`Synapse 3D Windows daemon did not respond on Port 7781 within timeout. Check ${stderrLog} for the actual error (e.g. a missing 'go' on PATH) before assuming it's just slow to start.`);
                }
            } catch (e) { logDebug(e, 'windows synapse daemon setup'); }
        }
    } else {
        log.warn(`No pre-built binary for this platform. Compile with: cd "${synapseDir}" && go build -o ${binaryName} ./cmd/synapse/`);
    }
}

async function installCreatorExtension() {
    const creatorDir = path.join(moduleBasePath(), 'bdb-dev-creator-extension');
    downloadOrUpdateModule('@hybridlabor-api/bdb-dev-creator-extension', creatorDir, 'BDB Creator Extension');
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

async function installOSRemoteGateway() {
    const remoteDir = path.join(moduleBasePath(), 'bdb-os-remote');
    downloadOrUpdateModule('@hybridlabor-api/bdb-os-remote', remoteDir, 'BDB OS Remote Gateway');
}

async function installDevToolInstaller() {
    const toolInstallerDir = path.join(moduleBasePath(), 'bdb-dev-tool-installer');
    downloadOrUpdateModule('@hybridlabor-api/bdb-dev-tool-installer', toolInstallerDir, 'BDB Dev Tool Installer');
}

async function installOSAgentWorkspace() {
    const osAgentDir = path.join(moduleBasePath(), 'bdb-os-agent-workspace');
    const localBinDir = path.join(homeDir, '.local', 'bin');
    const binTarget = path.join(localBinDir, 'ao');

    fs.mkdirSync(localBinDir, { recursive: true });
    fs.mkdirSync(path.join(homeDir, '.ao', 'data'), { recursive: true });
    fs.mkdirSync(path.join(homeDir, '.ao', 'logs'), { recursive: true });

    downloadOrUpdateModule('@hybridlabor-api/bdb-os-agent-workspace', osAgentDir, 'BDB OS Agent Workspace');

    if (DRY_RUN) {
        log.step('[dry-run] would link ao binary + register LaunchAgent + Desktop App');
        return;
    }

    const daemonBin = path.join(osAgentDir, 'backend', 'ao-daemon');
    if (fs.existsSync(daemonBin)) {
        try {
            fs.copyFileSync(daemonBin, binTarget);
            fs.chmodSync(binTarget, '755');
        } catch (e) { logDebug(e, 'operation'); }
    }

    if (process.platform === 'darwin') {
        const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', 'com.bdb.agent-workspace.plist');
        const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bdb.agent-workspace</string>
    <key>ProgramArguments</key>
    <array>
        <string>${binTarget}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>AO_PORT</key>
        <string>3101</string>
        <key>AO_DATA_DIR</key>
        <string>${path.join(homeDir, '.ao', 'data')}</string>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:${localBinDir}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${path.join(homeDir, '.ao', 'logs', 'daemon.stdout.log')}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(homeDir, '.ao', 'logs', 'daemon.stderr.log')}</string>
</dict>
</plist>`;
        try {
            fs.writeFileSync(plistPath, plistContent);
            execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`, { stdio: 'ignore' });
            execSync(`launchctl load -w "${plistPath}" 2>/dev/null || true`, { stdio: 'ignore' });
            const isListening = await verifyDaemonListening(3101, 'Agent Workspace');
            if (isListening) {
                log.success('Agent Workspace LaunchAgent active (Port 3101)');
            } else {
                log.warn('Agent Workspace daemon did not respond on Port 3101 within timeout. You may need to start it manually or check for port conflicts.');
            }
        } catch (e) { logDebug(e, 'operation'); }

        let appDir = '/Applications/BDB Agent Workspace.app';
        try {
            fs.accessSync('/Applications', fs.constants.W_OK);
        } catch (e) {
            logDebug(e, 'write-access probe on /Applications');
            appDir = path.join(homeDir, 'Applications', 'BDB Agent Workspace.app');
            log.step('/Applications is not writable - falling back to ~/Applications');
        }
        try {
            fs.mkdirSync(path.join(appDir, 'Contents', 'MacOS'), { recursive: true });
            fs.mkdirSync(path.join(appDir, 'Contents', 'Resources'), { recursive: true });
            const iconSrc = path.join(osAgentDir, 'frontend', 'assets', 'icon.icns');
            if (fs.existsSync(iconSrc)) {
                fs.copyFileSync(iconSrc, path.join(appDir, 'Contents', 'Resources', 'AppIcon.icns'));
            }
            const launcherScript = `#!/usr/bin/env bash
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:${localBinDir}:$PATH"
if ! curl -s http://127.0.0.1:3101/healthz >/dev/null 2>&1; then
    launchctl start com.bdb.agent-workspace 2>/dev/null || "${binTarget}" &
    sleep 0.5
fi
if [ -d "/Applications/Google Chrome.app" ]; then
    open -na "/Applications/Google Chrome.app" --args --app="http://127.0.0.1:3101" --user-data-dir="$HOME/.ao/chrome-app-profile"
elif [ -d "/Applications/Brave Browser.app" ]; then
    open -na "/Applications/Brave Browser.app" --args --app="http://127.0.0.1:3101" --user-data-dir="$HOME/.ao/brave-app-profile"
else
    open "http://127.0.0.1:3101"
fi`;
            const launcherPath = path.join(appDir, 'Contents', 'MacOS', 'app_launcher');
            fs.writeFileSync(launcherPath, launcherScript);
            fs.chmodSync(launcherPath, '755');
            log.success(`Desktop App available under ${appDir}`);
        } catch (e) { logDebug(e, 'operation'); }
    } else if (process.platform === 'win32') {
        const startupDir = path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
        fs.mkdirSync(startupDir, { recursive: true });
        const vbsPath = path.join(startupDir, 'com.bdb.agent-workspace.vbs');
        const daemonBin = path.join(osAgentDir, 'backend', 'ao-daemon.exe');
        const runBin = fs.existsSync(daemonBin) ? daemonBin : path.join(osAgentDir, 'backend', 'ao.exe');
        if (fs.existsSync(runBin)) {
            const vbsContent = `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.CurrentDirectory = "${osAgentDir}"\r\nWshShell.Run """${runBin}""", 0, False\r\n`;
            try {
                fs.writeFileSync(vbsPath, vbsContent, 'utf-8');
                spawn('wscript.exe', [vbsPath], { detached: true, stdio: 'ignore' }).unref();
                const isListening = await verifyDaemonListening(3101, 'Agent Workspace');
                if (isListening) {
                    log.success('Agent Workspace Windows Background Service registered & started (Port 3101)');
                } else {
                    log.warn('Agent Workspace Windows daemon did not respond on Port 3101 within timeout. You may need to start it manually or check for port conflicts.');
                }
            } catch (e) { logDebug(e, 'windows workspace daemon setup'); }
        }
    }

    log.step('BDB Agent Workspace WebUI: http://localhost:3101');
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

async function promptEcosystemHealthScheduler() {
    if (isAutoYes) return;
    const doSchedule = pick(await askConfirm({
        message: 'Enable automated Health Audit Cron Job (2x daily at 01:00 and 12:00)?',
        initialValue: true
    }));
    if (doSchedule) {
        log.success(`Health Audit Scheduler configured for 01:00 & 12:00. Script: ${path.join(srcDir, 'scripts', 'ecosystem-health-audit.js')}`);
    }
}

function verifyEcosystemInstallation() {
    const modules = [
        { name: '1. bdb-synapse', pkg: '@hybridlabor-api/bdb-synapse', paths: [path.join(moduleBasePath(), 'bdb-synapse')] },
        { name: '2. memB', pkg: '@hybridlabor-api/memb', paths: [path.join(moduleBasePath(), 'memB'), path.join(geminiDir, 'config', 'mcps', 'memb-mcp')] },
        { name: '3. heimdall-token-saver', pkg: '@hybridlabor-api/heimdall-token-saver', paths: [path.join(moduleBasePath(), 'heimdall-token-saver'), path.join(srcDir, 'vendor', 'token-saver')] },
        { name: '4. bdb-os-agent-workspace', pkg: '@hybridlabor-api/bdb-os-agent-workspace', paths: [path.join(moduleBasePath(), 'bdb-os-agent-workspace')] },
        { name: '5. bdb-dev-creator-extension', pkg: '@hybridlabor-api/bdb-dev-creator-extension', paths: [path.join(moduleBasePath(), 'bdb-dev-creator-extension')] },
        { name: '6. bdb-os-remote', pkg: '@hybridlabor-api/bdb-os-remote', paths: [path.join(moduleBasePath(), 'bdb-os-remote')] },
        { name: '7. bdb-dev-tool-installer', pkg: '@hybridlabor-api/bdb-dev-tool-installer', paths: [path.join(moduleBasePath(), 'bdb-dev-tool-installer')] },
        { name: '8. bdb-dev-optimized-agent-skills', pkg: '@hybridlabor-api/bdb-dev-optimized-agent-skills', paths: [srcDir] }
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
                    const distTagsJson = execSync(`npm view ${mod.pkg} dist-tags --json`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 4000 }).trim();
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
            console.log(`  • ${colors.bold}${mod.name.padEnd(35)}${colors.reset} ➔ ${colors.green}✅ v2.6.3 (Integrated)${colors.reset}`);
        } else {
            console.log(`  • ${colors.bold}${mod.name.padEnd(35)}${colors.reset} ➔ ${colors.dim}⚪ Optional / Not downloaded${colors.reset}`);
        }
    }
}

function resolveTargetPaths(platformValue, customPaths) {
    let targetSkillDir = globalConfigDir;
    let targetLegacyDir = globalLegacyDir;
    let targetWorkspaceDir = workspaceDir;
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
    return tier === '2' ? [
        'bdb-adobe-suite-mcp.md',
        'bdb-after-effects-mcp.md',
        'bdb-blender-mcp.md',
        'bdb-davinci-mcp.md',
        'bdb-grandma3-mcp.md',
        'bdb-resolume-mcp.md',
        'bdb-rhino-mcp.md',
        'bdb-touchdesigner-mcp.md',
        'bdb-unreal-mcp.md',
        'bdb-vectorworks-mcp.md',
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
        installStep(`copy the MCP server ${mcp}`, () => {
            copyDirRecursiveSync(path.join(mcpSrcDir, mcp), path.join(mcpCodeTarget, mcp));
        }, 'The remaining MCP servers are still installed.');
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
                runNpmWithRetry('npm run build', { cwd: targetFolder }, `npm run build for ${mcpFolder}`);
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

                if (!fs.existsSync(venvPython)) {
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
        { folder: 'golem-rhino-mcp', args: ['-m', 'mcp_server', '--help'] },
        { folder: 'davinci-mcp-professional', args: ['main.py', '--help'] },
        { folder: 'davinci-resolve-mcp-free', args: ['-r', 'requirements.txt', 'src/resolve_mcp_bridge.py', '--help'], uvArgs: true },
        { folder: 'blender-mcp', args: ['-m', 'blender_mcp.server', '--help'] },
        { folder: 'vectorworks-mcp', args: ['-r', 'requirements.txt', 'app/mcp_server.py', '--help'], uvArgs: true },
        { folder: 'windows-computer-use-mcp', args: ['run_server.py', '--help'] }
    ];
    for (const mcp of pythonMcps.filter(m => selectedMcps.includes(m.folder))) {
        const targetFolder = path.join(mcpCodeTarget, mcp.folder);
        if (fs.existsSync(targetFolder)) {
            const prewarmArgs = mcp.uvArgs ? ['run', ...mcp.args] : mcp.args;
            if (DRY_RUN) {
                log.step(`[dry-run] would pre-warm Python deps for ${mcp.folder}`);
                continue;
            }
            spawnSync('uv', prewarmArgs, { cwd: targetFolder, stdio: 'ignore' });
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
        const finalMcpServers = {};
        const availableFolders = fs.readdirSync(mcpSrcDir);
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
        const whichCmd = process.platform === 'win32' ? 'where uv' : 'which uv';
        uvPath = execSync(whichCmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split(/\r?\n/)[0];
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
        const geminiKeyValue = creds.gemini || process.env.GEMINI_API_KEY || '';
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
        const snippetPath = `${paths.mcpConfigPath}.bdb-mcp-servers.toml`;
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
        try {
            const servers = JSON.parse(mcpConfigStr).mcpServers || {};
            const tables = Object.entries(servers).map(([name, cfg]) => {
                const rows = [`[mcp_servers.${tomlKey(name)}]`];
                Object.entries(cfg || {}).forEach(([k, v]) => rows.push(`${tomlKey(k)} = ${tomlValue(v)}`));
                return rows.join('\n');
            });
            const snippet = [
                '# BDB MCP servers for Codex, generated by installer.beta.js.',
                `# Append these tables to ${configName}; if you ran the installer`,
                '# before, replace the [mcp_servers.*] tables of the same name',
                '# instead of adding them a second time.',
                '',
                tables.join('\n\n'),
                ''
            ].join('\n');
            // Snippets can embed injected API keys — keep them user-readable only.
            fs.writeFileSync(snippetPath, snippet, { mode: 0o600 });
            try { fs.chmodSync(snippetPath, 0o600); } catch (e) { logDebug(e, 'chmod snippetPath'); }
            log.warn(`${configName} is TOML; written as snippet instead: ${snippetPath}`);
        } catch (e) {
            log.warn(`Could not write the Codex TOML snippet: ${e.message}`);
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

// Generates .claude/agents/<name>.md — Claude Code's native subagent format.
// Only frontmatter fields confirmed against code.claude.com/docs/en/sub-agents
// are emitted (name, description, model). `tools:`/`permission`-style
// allowlists are deliberately omitted rather than guessed from the MCP-server
// list -- an unverified mapping there would silently over- or under-scope a
// subagent's tool access, which is worse than inheriting the default set.
function compileClaudeAgents(agents, targetDir) {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const a of agents) {
        const slug = a.name.toLowerCase().replace(/_/g, '-');
        const model = a.model ? a.model.toLowerCase() : 'inherit';
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

// Generates .opencode/agents/<name>.md. Only `description` and `mode` are
// emitted -- confirmed fields per opencode.ai/docs/agents. `model` and
// `permission` are left unset: OpenCode's model-id format and its mapping
// from an MCP-server list to `permission` keys are not verified against its
// docs, so guessing either would risk emitting a value OpenCode silently
// can't resolve. `mode: subagent` is used for every generated agent, since
// none of these five is meant to be a primary/default agent a user talks to
// directly.
function compileOpenCodeAgents(agents, targetDir) {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const a of agents) {
        const slug = a.name.toLowerCase().replace(/_/g, '-');
        const body = [
            a.role,
            a.skills.length ? `**Primary skills:** ${a.skills.join(', ')}` : null,
            a.mcpServers.length ? `**MCP servers used:** ${a.mcpServers.join(', ')}` : null,
            a.output ? `**Output artifact(s):** ${a.output}` : null,
        ].filter(Boolean).join('\n\n');

        const frontmatter = [
            '---',
            `description: ${yamlQuote(a.role)}`,
            'mode: subagent',
            '---',
            '',
        ].join('\n');

        fs.writeFileSync(path.join(targetDir, `${slug}.md`), frontmatter + body + '\n');
    }
}

function injectHarnessRules() {
    const geminiMdSrc = path.join(srcDir, 'GEMINI.md');
    const agentsMdSrc = path.join(srcDir, '.agents', 'agents.md');

    if (fs.existsSync(geminiMdSrc)) {
        installStep(`install GEMINI.md to ${path.join(geminiDir, 'GEMINI.md')}`, () => {
            fs.copyFileSync(geminiMdSrc, path.join(geminiDir, 'GEMINI.md'));
            log.step(`Installed GEMINI.md to ${path.join(geminiDir, 'GEMINI.md')}`);
        }, 'The harness injection below still runs.');

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

                    const agents = parseAgentsMd(agentsMdContent);
                    for (const a of agents) {
                        const agentConfig = {
                            name: a.name,
                            description: a.role,
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
                    const agents = parseAgentsMd(agentsMdContent);
                    const claudeAgentsDir = path.join(homeDir, '.claude', 'agents');
                    compileClaudeAgents(agents, claudeAgentsDir);
                    log.step(`Compiled AGENTS.md to Claude Code subagents in ${claudeAgentsDir}`);
                }
            }, 'Claude Code agents unchanged');

            installStep('compile OpenCode subagents', () => {
                if (agentsMdContent) {
                    const agents = parseAgentsMd(agentsMdContent);
                    const opencodeAgentsDir = path.join(homeDir, '.opencode', 'agents');
                    compileOpenCodeAgents(agents, opencodeAgentsDir);
                    log.step(`Compiled AGENTS.md to OpenCode subagents in ${opencodeAgentsDir}`);
                }
            }, 'OpenCode agents unchanged');

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
            mergeBdbSettingsHooks(path.join(homeDir, '.claude', 'settings.json'));
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

// Merge the BDB gate hooks into a Claude Code settings.json without clobbering
// user-owned keys (v3.13 audit BLOCKER-3: the harness-dir copy used to
// overwrite the file wholesale, silently dropping e.g. enabledPlugins). Only
// BDB-owned hook entries -- identified by their script name inside `command` --
// are replaced or added; every other key and every foreign hook entry survives
// untouched. With projectLocal, `${HOME}` hook paths are rewritten to
// `$CLAUDE_PROJECT_DIR` so a project harness is self-contained on every
// collaborator's checkout. If the existing file is not valid JSON(C), nothing
// is overwritten: the original is backed up as .corrupt_<ts>.bak and the
// merged result goes to a .bdb-new.json sidecar -- the same recovery pattern
// the MCP config merge in installMcpsForTarget uses.
function mergeBdbSettingsHooks(settingsPath, { projectLocal = false } = {}) {
    const bdbHookScripts = ['go-gate.mjs', 'graph-gate.mjs'];
    const isBdbEntry = (entry) => {
        const cmds = (entry && Array.isArray(entry.hooks) ? entry.hooks : [])
            .map((h) => (h && typeof h.command === 'string' ? h.command : ''))
            .join(' ');
        return bdbHookScripts.some((name) => cmds.includes(name));
    };
    const localize = (cmd) => (projectLocal ? cmd.split('${HOME}').join('$CLAUDE_PROJECT_DIR') : cmd);
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
        fs.writeFileSync(settingsPath, JSON.stringify(buildMerged(existing), null, 2) + '\n');
    } catch (e) {
        log.warn(`Could not write ${settingsPath}: ${e.message}`);
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
    installStep(`create ${projectClaudeDir}`, () => {
        fs.mkdirSync(projectClaudeDir, { recursive: true });
    }, 'The harness copies below will most likely fail as well.');

    installStep('copy .agents/ contract into project', () => {
        const agentsSrc = path.join(srcDir, '.agents');
        if (!fs.existsSync(agentsSrc)) throw new Error(`missing payload: ${agentsSrc}`);
        copyDirRecursiveSync(agentsSrc, path.join(currentDir, '.agents'));
        log.step(`Copied .agents/ contract to ${path.join(currentDir, '.agents')}`);
    }, 'graph.md / state.schema.json may be missing in the project.');

    installStep('copy dispatcher workflows into project', () => {
        const workflowsSrc = path.join(srcDir, '.claude', 'workflows');
        if (fs.existsSync(workflowsSrc)) {
            copyDirRecursiveSync(workflowsSrc, path.join(projectClaudeDir, 'workflows'));
            log.step(`Copied dispatcher workflows to ${path.join(projectClaudeDir, 'workflows')}`);
        }
    }, '/startcycle dispatch degrades to graph.md as a manual guide.');

    installStep('copy gate hooks into project', () => {
        const hooksSrc = path.join(srcDir, '.claude', 'hooks');
        if (fs.existsSync(hooksSrc)) {
            copyDirRecursiveSync(hooksSrc, path.join(projectClaudeDir, 'hooks'));
            log.step(`Copied gate hooks to ${path.join(projectClaudeDir, 'hooks')}`);
        }
    }, 'go-gate / graph-gate enforcement stays inactive in this project.');

    installStep('copy agent definitions into project', () => {
        const agentsSrc = path.join(srcDir, '.claude', 'agents');
        if (fs.existsSync(agentsSrc)) {
            copyDirRecursiveSync(agentsSrc, path.join(projectClaudeDir, 'agents'));
            log.step(`Copied agent definitions to ${path.join(projectClaudeDir, 'agents')}`);
        }
    }, 'The dispatcher runs, but its agent-file pointers resolve to nothing.');

    installStep('wire project .claude/settings.json to local hooks', () => {
        mergeBdbSettingsHooks(path.join(projectClaudeDir, 'settings.json'), { projectLocal: true });
        log.step(`Wired project hooks in ${path.join(projectClaudeDir, 'settings.json')}`);
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

async function promptOptionalModules(installedModules) {
    if (isAutoYes) return;
    const allModules = [
        { id: 'synapse', name: 'BDB Synapse (3D Codebase Visualizer)', fn: installSynapse },
        { id: 'memb', name: 'memB Vector Engine (Local Semantic Memory)', fn: () => installMemB(true) },
        { id: 'remote', name: 'BDB OS Remote Gateway (Zero-Trust Tailscale Multiplexer)', fn: installOSRemoteGateway },
        { id: 'ao', name: 'BDB OS Agent Workspace (AI Orchestrator)', fn: installOSAgentWorkspace },
        { id: 'creator', name: 'BDB Creator Extension (Generative 3D, Video & ComfyUI)', fn: installCreatorExtension },
        { id: 'installer', name: 'BDB Dev Tool Installer (Interactive Hub & CLI Launcher)', fn: installDevToolInstaller }
    ];

    const uninstalled = allModules.filter(m => !installedModules.includes(m.id));
    if (uninstalled.length === 0) return;

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
}

function generateAndOpenLaunchpad() {
    if (DRY_RUN) {
        log.step('[dry-run] would generate & open BDB Launchpad HTML');
        return;
    }
    if (process.env.SSH_CLIENT || process.env.SSH_TTY) return;

    // Local Developer Workflow Guard:
    // Only generate and open the launchpad if running in a local developer repo environment or explicitly requested
    const isDevWorkflow = fs.existsSync(path.join(homeDir, 'bdb-dev')) ||
                          process.env.BDB_DEV === '1' ||
                          process.argv.includes('--launchpad') ||
                          process.argv.includes('--dev');
    if (!isDevWorkflow) {
        return;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BDB Agent OS – Launchpad</title>
  <style>
    :root {
      --bg: #090a0f;
      --card-bg: rgba(22, 27, 34, 0.75);
      --card-border: rgba(255, 255, 255, 0.08);
      --text: #f0f6fc;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --green: #3fb950;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
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
    .logo-badge {
      background: linear-gradient(135deg, #58a6ff 0%, #bc8cff 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .tagline { color: var(--text-muted); font-size: 14px; }
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
      border-color: rgba(88, 166, 255, 0.4);
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    }
    .card-content { display: flex; align-items: center; gap: 14px; }
    .card-icon {
      font-size: 22px;
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.06);
      display: flex;
      align-items: center;
      justify-content: center;
    }
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
      color: #79c0ff;
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
      <div class="logo">🚀 <span class="logo-badge">BDB Agent OS</span></div>
      <p class="tagline">Local Multi-Agent Ecosystem Hub</p>
    </div>
    <div class="grid">
      <a class="card" href="http://127.0.0.1:8088" target="_blank">
        <div class="card-content">
          <div class="card-icon">🧠</div>
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
          <div class="card-icon">🏙️</div>
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
          <div class="card-icon">⚡</div>
          <div class="card-info">
            <h2>Agent Workspace</h2>
            <p>Multi-Agent Cockpit & Orchestrator</p>
          </div>
        </div>
        <div class="card-meta">
          <span class="port-pill">:3101</span>
          <span class="status-dot" id="dot-ao" title="Checking..."></span>
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
    checkHealth('http://127.0.0.1:8088', 'dot-memb');
    checkHealth('http://127.0.0.1:7781', 'dot-synapse');
    checkHealth('http://127.0.0.1:3101', 'dot-ao');
    setInterval(() => {
      checkHealth('http://127.0.0.1:8088', 'dot-memb');
      checkHealth('http://127.0.0.1:7781', 'dot-synapse');
      checkHealth('http://127.0.0.1:3101', 'dot-ao');
    }, 5000);
  </script>
</body>
</html>`;

    const filePath = path.join(os.homedir(), '.agents', 'bdb-launchpad.html');
    fs.writeFileSync(filePath, html, 'utf-8');
    try {
        if (process.platform === 'darwin') {
            spawn('open', [filePath], { detached: true, stdio: 'ignore' }).unref();
        } else if (process.platform === 'win32') {
            spawn('cmd.exe', ['/c', 'start', '""', filePath], { detached: true, stdio: 'ignore' }).unref();
        } else {
            spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore' }).unref();
        }
    } catch (e) { logDebug(e, 'launchpad open'); }
}

async function universalHarnessSync(primaryMcpConfigPath) {
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
                for (const [key, val] of Object.entries(masterMcpData.mcpServers)) {
                    const cmd = Array.isArray(val.command) ? val.command : [val.command];
                    const args = Array.isArray(val.args) ? val.args : [];
                    data.mcp[key] = {
                        type: "local",
                        command: [...cmd, ...args],
                        enabled: true,
                        ...(val.environment || val.env ? { environment: val.environment || val.env } : {})
                    };
                }
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
        }
    }
    log.success('Universal Sync Complete!');
    generateAndOpenLaunchpad();
}

async function runQuickUpdate(installState) {
    const s = spinner();
    s.start('Quick Update: refreshing skills & syncing installed submodules...');

    const excludeSkills = getTierExcludeSkills('1');
    const paths = resolveTargetPaths('1', null);

    fs.mkdirSync(backupDir, { recursive: true });
    fs.mkdirSync(paths.targetSkillDir, { recursive: true });
    fs.mkdirSync(paths.targetLegacyDir, { recursive: true });
    fs.mkdirSync(paths.targetWorkspaceDir, { recursive: true });

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
    s.stop('Skills refreshed');

    const modulesToUpdate = installState.installedModules || [];
    for (const subId of modulesToUpdate) {
        if (subId === 'synapse') await installSynapse();
        else if (subId === 'memb') await installMemB(false);
        else if (subId === 'remote') await installOSRemoteGateway();
        else if (subId === 'ao') await installOSAgentWorkspace();
        else if (subId === 'creator') await installCreatorExtension();
        else if (subId === 'installer') await installDevToolInstaller();
    }

    await promptOptionalModules(modulesToUpdate);
    reloadDaemons();
    saveManifest({ tier: '1', isUniversal: true, installedModules: modulesToUpdate });

    console.log('');
    verifyEcosystemInstallation();
}


// v3.13 "NODEFORGE" release banner. Built programmatically rather than stored
// as one giant escaped string literal: the wordmark carries a per-column
// pink -> yellow -> amethyst gradient, which needs a truecolor escape emitted
// per character run. Hand-maintaining that as literal text would be
// unreadable and near-impossible to edit safely.
//
// Width discipline: every rendered line stays <= 76 visible columns (the
// wordmark's natural width), so the banner never wraps on an 80-column
// terminal -- the same class of terminal-width bug this release already fixed
// elsewhere. Changing the font means re-checking that number.
const BANNER_WORDMARK = [
    "█████▄ ████▄  █████▄   ▄████▄  ▄████  ██████ ███  ██ ██████   ▄████▄ ▄█████ ",
    "██▄▄██ ██  ██ ██▄▄██   ██▄▄██ ██  ▄▄▄ ██▄▄   ██ ▀▄██   ██     ██  ██ ▀▀▀▄▄▄ ",
    "██▄▄█▀ ████▀  ██▄▄█▀   ██  ██  ▀███▀  ██▄▄▄▄ ██   ██   ██     ▀████▀ █████▀"
];

function buildBanner() {
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

    const tagline = ' O P T I M I Z E D   A G E N T   S K I L L S  ·  v3.13';
    const taglinePad = ' '.repeat(Math.max(0, Math.floor((width - tagline.length) / 2)));

    return `${colors.bold}\n${wordmark}\n\n`
        + `${colors.beige}${divider}${colors.reset}\n\n`
        + `${colors.bannerWhite}${colors.bold}${taglinePad}${tagline}${colors.reset}`;
}

async function main() {
    const banner = buildBanner();

    await glitchBanner(banner);
    intro(banner);

    if (DRY_RUN) {
        log.warn('DRY-RUN MODE active - no files will be modified, no commands executed.');
    }
    if (isAutoYes) {
        log.warn('Non-interactive/auto mode (-y): all defaults are accepted automatically.');
    }

    const latest = await checkForUpdates();
    if (latest) {
        log.warn(`Update available: v${pkg.version} ➔ v${latest} — run: npx ${pkg.name}@latest`);
    }

    const installState = detectInstallState();

    if (PROJECT_HARNESS_ARG) {
        installProjectHarness();
        outro('Project harness installation complete.');
        return;
    }

    if (installState.isInstalled && !isAutoYes) {
        if (installState.updateAvailable) {
            log.warn(`BDB AGENT OS installation detected: v${installState.localVersion} ➔ v${installState.currentVersion}`);
        } else {
            log.success(`BDB AGENT OS is already up to date (v${installState.currentVersion}).`);
        }

        const options = installState.updateAvailable
            ? [
                { value: 'quick', label: `⚡ Quick Update (v${installState.localVersion} ➔ v${installState.currentVersion}) – refresh skills & daemons, keep settings` },
                { value: 'project', label: '📁 Drop Local Project Harness (in current directory)' },
                { value: 'reconfigure', label: '🛠️ Full re-installation / re-configuration' },
                { value: 'cancel', label: '❌ Exit' }
              ]
            : [
                { value: 'project', label: '📁 Drop Local Project Harness (in current directory)' },
                { value: 'reconfigure', label: '🛠️ Re-configuration / switch tier (Pro vs Basic)' },
                { value: 'quick', label: '🔄 Repair / force reinstall all skills' },
                { value: 'cancel', label: '❌ Exit' }
              ];

        const action = pick(await select({
            message: 'BDB OS maintenance:',
            options,
            initialValue: options[0].value
        }));

        if (action === 'cancel') {
            outro('Cancelled.');
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
    }

    const detections = detectPlatforms();
    if (detections.length > 0) {
        log.info('Detected Agent Environments on this system:');
        detections.forEach(d => log.message(`${d.name} (${d.path})`));
    } else {
        log.message('No active agent config directories auto-detected in standard locations.');
    }

    const detectedNames = detections.map(d => d.name).join(', ');
    const platformOptions = [
        { value: '9', label: 'Local Project Harness', hint: 'copy dispatcher contract to current project' },
        { value: '0', label: '🌐 Universal Agent Harness', hint: detections.length > 0 ? `sync ALL detected: ${detectedNames}` : 'sync across ALL AI platforms' },
        { value: '1', label: 'Google Antigravity', hint: '~/.gemini/config/skills' },
        { value: '2', label: 'Claude Desktop / Claude Code', hint: '~/.claude/skills' },
        { value: '3', label: 'Cursor / Generic IDE (project-local)', hint: '.cursor/' },
        { value: '4', label: 'Custom Installation (specify paths manually)' },
        { value: '5', label: 'ChatGPT Codex CLI', hint: '~/.codex/skills' },
        { value: '6', label: 'Windsurf IDE', hint: '~/.windsurf' },
        { value: '7', label: 'Roo Code / Cline / VS Code', hint: '~/.roo' },
        { value: '8', label: 'Aider CLI', hint: '~/.aider' }
    ];

    let tier = '1';
    let mode = 'merge';
    let customPaths = null;
    let creds = null;
    let selectedMcps = null;
    let wantsUniversal = true;
    let specificPlatforms = ['1'];

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
        const platformNames = { '0': '🌐 Universal Harness', '1': 'Google Antigravity', '2': 'Claude Desktop/Code', '3': 'Cursor/Generic IDE', '4': 'Custom Paths', '5': 'ChatGPT Codex CLI', '6': 'Windsurf', '7': 'Roo Code / Cline / VS Code', '8': 'Aider CLI', '9': 'Local Project Harness' };

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

    const targets = specificPlatforms.map(p => ({
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
            fs.mkdirSync(t.targetLegacyDir, { recursive: true });
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
    s.stop('Skills installed.');

    injectHarnessRules();

    const primaryTarget = targets[0];
    for (const t of targets) {
        await installMcpsForTarget(t, { selectedMcps, mode, platformValue: t.value, creds });
    }

    await installOpenWikiDaemon(creds.gemini, primaryTarget.targetSkillDir, { provider: creds.openwikiProvider, model: creds.openwikiModel, baseUrl: creds.openwikiBaseUrl });
    await installTokenSaver(primaryTarget.platformValue);

    const installedModulesForPrompt = (installState && installState.installedModules) || [];
    await promptOptionalModules(installedModulesForPrompt);

    await promptMemBIngestion(path.join(primaryTarget.targetMcpDir, 'mcps'));
    await promptEcosystemHealthScheduler();

    reloadDaemons();
    saveManifest({ tier, isUniversal: wantsUniversal, installedModules: installedModulesForPrompt });

    if (wantsUniversal) {
        await universalHarnessSync(primaryTarget.mcpConfigPath);
    }

    console.log('');
    verifyEcosystemInstallation();

    outro(`🎉 Installation complete! Targets: ${targets.map(t => t.value).join(', ')} · Tier: ${tier === '1' ? 'Pro MEDIA' : 'Basic'}${DRY_RUN ? ' · DRY-RUN (nothing was modified)' : ''}`);
}

if (require.main === module) {
    main().catch(e => reportFatal('the beta installer run', e));
}

// Exported for tests -- requiring installer.js must not launch the TUI.
module.exports = { mergeBdbSettingsHooks, installProjectHarness, mirrorMcpServersTo };
