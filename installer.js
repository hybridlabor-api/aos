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
const pluginMigration = require('./lib/plugin-migration');
const { claudeConfigDir } = require('./lib/plugin-evidence');
const { modelProblem } = require('./lib/agent-models');
const codexPluginInstall = require('./lib/codex-plugin-install');
const uninstallRecords = require('./lib/uninstall-records');
const { tarExtractArgs } = require('./lib/tar-extract-args');
const systemdUnits = require('./lib/systemd-units');
const mcpSecrets = require('./lib/mcp-secrets');
const { backupOnce, backupOf } = require('./lib/backup-once');
const codebaseMemory = require('./lib/codebase-memory');
const hardwareApps = require('./lib/hardware-apps');
const v5Secrets = require('./lib/v5/secrets');
const { pruneRetiredSkills, storeProtectedDirs } = require('./lib/retired-skills');
const coreSkills = require('./lib/core-skills');
const skillPacks = require('./lib/skill-packs');
const { hasExecutable, findExecutable, getGitInstallInstruction, isElevated } = require('./lib/executable-probe');
const { START: DESTRUCTIVE_START, upsertDestructiveBlock, stripDestructiveBlock, CLAUDE_DENY_RULES } = require('./lib/destructive-rules');
const { upsertRoutingBlock, stripRoutingBlock } = require('./lib/routing-rules');
const { writeManagedRulesFile } = require('./lib/harness-rules');
const { isAosShaped, tomlHasGateway } = require('./lib/gateway/harness');
const { gatewayCovered } = require('./lib/gateway/config');

function reloadLaunchAgent(plistPath) {
    execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`, { stdio: 'ignore' });
    execSync(`launchctl load -w "${plistPath}" 2>/dev/null || true`, { stdio: 'ignore' });
}

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
    spinner,
    isCancel,
    cancel,
    log
} = clack;
const { text, password, select, multiselect, confirm: askConfirm } = require('./lib/v5/noprompt')(clack);

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

// --profile, --no-hooks, --hooks-only, --without (docs/install-options.md). Parsed once; main() resolves them
// against the persisted v5 settings before anything installs.
const v5Profile = require('./lib/v5/profile');
let INSTALL_OPTS;
try {
    INSTALL_OPTS = v5Profile.parseOptions(process.argv, process.env, () => require('./lib/v5/packages').registry.map((p) => p.id));
} catch (e) {
    console.error(`${colors.red} -> ${e.message}${colors.reset}`);
    process.exit(1);
}
let contextHooksOn = true;
let activeProfile = v5Profile.DEFAULT_PROFILE;
let installExcluded = new Set();
// `skillSet` setting: "core" installs only lib/core-skills.json and leaves the rest to `aos store install`.
let skillSet = coreSkills.DEFAULT_SKILL_SET;
// Pack selection: array of pack names from ~/.aos/v5-settings.json ("packs", next to skillSet).
// null = no selection ever stored — everything is installed/kept, no silent removal.
let packSelection = null;
// Packs this run's own setup choices bring, on top of the stored selection: the Pro MEDIA tier
// (live-show), the Creator Extension / Hardware & PCB modules, and the pack checkboxes of the
// module picker. Additive only — see skillPacks.impliedPacks for the manifest-derived part.
const runImpliedPacks = [];
const addImpliedPack = (id) => { if (skillPacks.knownPack(id, srcDir) && !runImpliedPacks.includes(id)) runImpliedPacks.push(id); };

// The selection exclusion and install follow: the explicit selection plus every pack the last
// install manifest implies and this run's choices imply. null explicit selection stays null.
function effectivePackSelection(meta = readJsonFile(path.join(homeDir, '.agents', '.bdb-manifest.json'))) {
    return skillPacks.mergeSelection(
        packSelection,
        [...runImpliedPacks, ...skillPacks.impliedPacks(meta, srcDir)],
        srcDir,
    );
}
// Unified memory (docs/unified-memory.md): off when memb is excluded; then no memb_mcp, deja MCP or memb-inject is wired.
let memoryOn = true;
// `gate` setting (Settings menu): off = go-gate, go-token, go-grant and graph-gate are not registered; the script files stay on disk.
let gateOn = true;
// Harness keys whose config is AOS-wired but registers no gate hook any more (removed there by hand).
// gateReenableStep fills this on non-interactive runs so an update never silently re-enables the gate.
const gateHoldKeys = new Set();
// Effective per harness: the setting, minus a hold for exactly the harness the user disabled by hand.
const gateOnFor = (key) => gateOn && !gateHoldKeys.has(key);
// `key` names the harness whose config is being merged, so a hold in one harness never deletes
// gate hooks another harness still has. Without a key (no harness context) only the setting decides.
const droppedHook = (cmd, key = null) => typeof cmd === 'string'
    && ((!contextHooksOn && v5Profile.isContextCommand(cmd)) || (!memoryOn && /memb-inject\.mjs|memb-session-save\.mjs/.test(cmd))
        || ((key ? !gateOnFor(key) : !gateOn) && v5Profile.GATE_HOOKS.some((n) => cmd.includes(n))));

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

function checkSystemPrereqs({
    which = hasExecutable,
    platform = process.platform,
    logger = log,
    exitOnError = true,
    isElevated: isElevatedOpt,
} = {}) {
    const isWin = platform === 'win32';
    const isMac = platform === 'darwin';

    const gitOk = Boolean(which('git'));
    const ghOk = Boolean(which('gh'));

    const elevated = isElevatedOpt !== undefined
        ? Boolean(isElevatedOpt)
        : (isWin ? isElevated({ platform }) : false);

    const gitInstruction = getGitInstallInstruction({ platform, elevated });

    const ghInstruction = isWin
        ? 'Install GitHub CLI: winget install GitHub.cli'
        : isMac
            ? 'Install GitHub CLI: brew install gh'
            : 'Install GitHub CLI via https://cli.github.com/';

    if (!gitOk) {
        const msg = `Git CLI is required for AOS workflows and worktrees.\n${gitInstruction}`;
        if (logger && typeof logger.error === 'function') logger.error(msg);
        else console.error(msg);
        if (exitOnError) {
            process.exitCode = 1;
            throw new Error(`Git CLI is missing — required for AOS workflows and worktrees. ${gitInstruction}`);
        }
        return { ok: false, missing: 'git', error: msg, instruction: gitInstruction };
    }

    if (!ghOk) {
        const warnMsg = `GitHub CLI (gh) is optional — needed for repo automation & release PRs.\n${ghInstruction}`;
        if (logger && typeof logger.warn === 'function') logger.warn(warnMsg);
        else console.warn(warnMsg);
    }

    return { ok: true, git: true, gh: ghOk };
}

function findBundledClaudeCli({
    platform = process.platform,
    home = homeDir,
    env = process.env,
    fsImpl = fs,
} = {}) {
    const candidates = [];
    if (platform === 'darwin') {
        const appRoots = [
            '/Applications/Claude.app',
            path.join(home, 'Applications', 'Claude.app'),
        ];
        for (const app of appRoots) {
            candidates.push(
                path.join(app, 'Contents', 'Resources', 'claude'),
                path.join(app, 'Contents', 'Resources', 'bin', 'claude'),
                path.join(app, 'Contents', 'Resources', 'claude-code'),
            );
        }
    } else if (platform === 'win32') {
        const localAppData = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
        const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
        candidates.push(
            path.join(localAppData, 'Programs', 'Claude', 'resources', 'claude.exe'),
            path.join(localAppData, 'Programs', 'Claude', 'resources', 'bin', 'claude.exe'),
            path.join(localAppData, 'AnthropicClaude', 'bin', 'claude.exe'),
            path.join(localAppData, 'Programs', 'Claude', 'bin', 'claude.exe'),
            path.join(localAppData, 'Microsoft', 'WindowsApps', 'claude.exe'),
            path.join(appData, 'Claude', 'claude-code', 'claude.exe'),
        );
    } else {
        const appRoots = [
            '/opt/Claude',
            path.join(home, '.local', 'share', 'Claude'),
            path.join(home, 'Applications', 'Claude.app'),
        ];
        for (const app of appRoots) {
            candidates.push(
                path.join(app, 'claude'),
                path.join(app, 'bin', 'claude'),
                path.join(app, 'resources', 'claude'),
                path.join(app, 'Contents', 'Resources', 'claude'),
            );
        }
    }
    for (const c of candidates) {
        try {
            if (fsImpl.existsSync(c)) {
                const st = fsImpl.statSync(c);
                if (st.isFile()) {
                    if (platform === 'win32' ? st.size > 0 : Boolean(st.mode & 0o111)) {
                        return c;
                    }
                }
            }
        } catch {}
    }
    return null;
}


// uv's installers drop it in ~/.local/bin or ~/.cargo/bin, which a GUI-launched or
// fresh shell often lacks on PATH. PATH first, then the standard install locations.
function findUv(home = homeDir, platform = process.platform) {
    const win = platform === 'win32';
    try {
        const out = win
            ? execFileSync('where.exe', ['uv'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', windowsHide: true })
            : execSync('command -v uv', { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', windowsHide: true });
        const first = out.trim().split(/\r?\n/)[0];
        if (first && fs.existsSync(first)) return first;
    } catch (e) { logDebug(e, 'uv lookup'); }
    const dirs = win
        ? [path.join(home, '.local', 'bin'), path.join(home, '.cargo', 'bin'),
           path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'uv'),
           path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'uv', 'bin')]
        : [path.join(home, '.local', 'bin'), path.join(home, '.cargo', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
    if (!win) {
        try {
            const base = path.join(home, 'Library', 'Python');
            for (const v of fs.readdirSync(base)) dirs.push(path.join(base, v, 'bin'));
        } catch (e) { /* no user Python dir */ }
    }
    for (const d of dirs) {
        const candidate = path.join(d, win ? 'uv.exe' : 'uv');
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}
let _uvBin;
const uvBin = () => (_uvBin === undefined ? (_uvBin = findUv()) : _uvBin) || 'uv';

const MEMB_MIN_PYTHON = [3, 10];
const MEMB_PYTHON_FIX = 'memB needs Python >= 3.10; install uv (https://docs.astral.sh/uv/) or python 3.12, then run: aos package install memb';
const parsePyVersion = (s) => { const m = /(\d+)\.(\d+)(?:\.\d+)?/.exec(String(s || '')); return m ? [Number(m[1]), Number(m[2])] : null; };
const pyAtLeast = (v, min) => Boolean(v) && (v[0] > min[0] || (v[0] === min[0] && v[1] >= min[1]));

// First interpreter that is >= min: versioned names (newest first) before plain python3, PATH before the usual install dirs.
// opts.run(cmd, args) -> stdout (throws if the command is missing) is a test seam.
function pickPython(min = MEMB_MIN_PYTHON, opts = {}) {
    const home = opts.home || homeDir;
    const win = (opts.platform || process.platform) === 'win32';
    const run = opts.run || ((cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, windowsHide: true }));
    const names = win ? ['python'] : ['python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3'];
    const dirs = win ? [] : ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local', 'bin')];
    if (!win) {
        try {
            const base = path.join(home, 'Library', 'Python');
            for (const v of fs.readdirSync(base)) dirs.push(path.join(base, v, 'bin'));
        } catch (e) { /* no user Python dir */ }
    }
    for (const name of names) {
        for (const cmd of [name, ...dirs.map((d) => path.join(d, name))]) {
            try {
                const v = parsePyVersion(run(cmd, ['--version']));
                if (pyAtLeast(v, min)) return { cmd, version: v };
            } catch (e) { /* not there */ }
        }
    }
    return null;
}

// Interpreter version recorded by venv/uv in pyvenv.cfg (`version = 3.9.6` or `version_info = ...`), null if unreadable.
function venvPyVersion(dir) {
    try { return parsePyVersion((/^version(?:_info)?\s*=\s*(.+)$/m.exec(fs.readFileSync(path.join(dir, '.venv', 'pyvenv.cfg'), 'utf8')) || [])[1]); } catch (e) { return null; }
}

// Creates dir/.venv with a Python >= 3.10, or throws MEMB_PYTHON_FIX without leaving an empty venv behind.
// A venv built on an older Python is rebuilt (--clear). opts.pick / opts.hasUv / opts.run are test seams.
function ensurePythonVenv(dir, opts = {}) {
    const win = process.platform === 'win32';
    const venvPy = win ? path.join(dir, '.venv', 'Scripts', 'python.exe') : path.join(dir, '.venv', 'bin', 'python');
    if (fs.existsSync(venvPy)) {
        const v = venvPyVersion(dir);
        if (!v || pyAtLeast(v, MEMB_MIN_PYTHON)) return { created: false };
        log.step(`[memb] existing venv uses Python ${v.join('.')}; rebuilding with Python >= ${MEMB_MIN_PYTHON.join('.')}.`);
    }
    const run = opts.run || ((cmd, args, o) => execFileSync(cmd, args, { stdio: 'ignore', cwd: dir, windowsHide: true, ...o }));
    const hasUv = opts.hasUv !== undefined ? opts.hasUv : (() => { try { execFileSync(uvBin(), ['--version'], { stdio: 'ignore', windowsHide: true }); return true; } catch (e) { return false; } })();
    const sys = (opts.pick || pickPython)(MEMB_MIN_PYTHON);
    if (!sys && !hasUv) {
        log.warn(MEMB_PYTHON_FIX);
        throw new Error(MEMB_PYTHON_FIX);
    }
    if (hasUv) {
        const target = sys ? sys.cmd : '3.12';
        try {
            if (!sys) run(uvBin(), ['python', 'install', '3.12'], { timeout: 300000, env: { ...process.env, UV_NO_PROGRESS: '1' } });
            run(uvBin(), ['venv', '--clear', '--seed', '--python', target, '.venv']);
            return { created: true, viaUv: true };
        } catch (e) {
            if (!sys) { log.warn(MEMB_PYTHON_FIX); throw new Error(`${MEMB_PYTHON_FIX} (uv: ${e.message})`); }
        }
    }
    run(sys.cmd, ['-m', 'venv', '--clear', '.venv']);
    return { created: true, viaUv: false };
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
        const found = execFileSync('where.exe', ['go'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
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
        windowsHide: true,
    });
    return !result.error && result.status === 0;
}

// Reconcile a memB venv against its requirements.txt on every run -- not only on a
// version bump. A changed requirements hash, or a failing import of a required
// module (mcp, when the venv's requirements list it), forces a reinstall with the
// venv's pip or `uv pip install -r`. requirements.txt without mcp is a note, not an error.
function reconcileMembVenv(membDir, opts = {}) {
    const venvPython = opts.venvPython || (process.platform === 'win32'
        ? path.join(membDir, '.venv', 'Scripts', 'python.exe')
        : path.join(membDir, '.venv', 'bin', 'python'));
    const reqPath = opts.requirementsPath || path.join(membDir, 'requirements.txt');
    let reqText;
    try { reqText = fs.readFileSync(reqPath, 'utf8'); } catch { return { status: 'no-requirements' }; }
    const hash = computeFileHash(reqPath);
    const stampPath = path.join(membDir, '.venv', '.aos-requirements.sha256');
    let stamped = null;
    try { stamped = fs.readFileSync(stampPath, 'utf8').trim(); } catch { /* none yet */ }
    const hasMcp = /(^|\n)\s*mcp\s*([<>=!~;\[]|$)/.test(reqText);
    const verify = opts.verifyImports || ((code) => verifyPythonImports(venvPython, membDir, code));
    if (!hasMcp) log.step('[memb] requirements.txt does not list mcp; import check skipped (note only)');
    // entryImport must mirror what the server's entry file actually imports. The memb-mcp
    // copy's run.py resolves FastMCP from `mcp` first, `fastmcp` second; neither module is
    // reliably listed in requirements.txt, so the default `import mcp` check cannot see that
    // break. A caller proves the real entry by passing its import statement here.
    const entryImport = opts.entryImport || (hasMcp ? 'import mcp' : null);
    let importFailed = false;
    if (entryImport) {
        if (verify(entryImport)) {
            // The entry's imports resolve on the installed venv: that is the actual
            // up-to-date proof, even when the stamp is absent or stale. Requirements
            // without mcp are notes; a verified entry outranks a hash mismatch.
            try { fs.mkdirSync(path.dirname(stampPath), { recursive: true }); fs.writeFileSync(stampPath, hash); } catch { /* ignore */ }
            return { status: 'up-to-date' };
        }
        // entry import fails -> straight to reinstall below (import check outranks the stamp)
        importFailed = true;
    }
    if (hash === stamped && !importFailed) {
        try { fs.mkdirSync(path.dirname(stampPath), { recursive: true }); fs.writeFileSync(stampPath, hash); } catch { /* ignore */ }
        return { status: 'up-to-date' };
    }
    const install = opts.runInstall || (() => {
        const hasUv = (opts.hasUv !== undefined) ? opts.hasUv : (() => { try { execSync(`"${uvBin()}" --version`, { stdio: 'ignore', windowsHide: true }); return true; } catch { return false; } })();
        const cmd = hasUv
            ? `"${uvBin()}" pip install --python "${venvPython}" -r requirements.txt`
            : `"${venvPython}" -m pip install -r requirements.txt --timeout 30 --no-input`;
        return runPipWithRetry(cmd, { cwd: membDir, stdio: 'inherit' }, 'memB requirements reconcile', 2, 900000);
    });
    const ok = install();
    if (ok) {
        try { fs.mkdirSync(path.dirname(stampPath), { recursive: true }); fs.writeFileSync(stampPath, hash); } catch { /* ignore */ }
    }
    return { status: ok ? 'reinstalled' : 'failed' };
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

const { stripJsonc } = require('./lib/jsonc');

function readJsoncFile(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try { return JSON.parse(stripJsonc(readTextFile(filePath))); } catch (e) { return null; }
}

// For callers that WRITE the file back. state: 'missing' | 'empty' | 'ok' | 'invalid'. A parse failure
// is never an empty object: data is only set for missing, empty and a valid JSON object.
function loadJsonConfig(filePath) {
    if (!fs.existsSync(filePath)) return { state: 'missing', data: {} };
    let raw;
    try { raw = readTextFile(filePath); } catch (e) { return { state: 'invalid', data: null, error: e.message }; }
    if (!raw.trim()) return { state: 'empty', data: {} };
    try {
        const data = JSON.parse(stripJsonc(raw));
        if (!data || typeof data !== 'object' || Array.isArray(data)) return { state: 'invalid', data: null, error: 'not a JSON object' };
        return { state: 'ok', data };
    } catch (e) { return { state: 'invalid', data: null, error: e.message }; }
}

// The file is left untouched; one warning, never a failed install.
function warnUnparseable(filePath, what, loaded) {
    log.warn(`Could not parse ${filePath} (${loaded.error}); left untouched, ${what} skipped. Fix or remove the file and run the installer again.`);
}

// Backup name collision (hardening): the backup is `<file>.<fsStr>.bak` where fsStr has one-second
// granularity, so a second write to the same file within the same run would otherwise overwrite the
// first backup and LOSE the original. backupConfigPath is the generic copyFileSync(COPYFILE_EXCL)
// primitive (never overwrites; EEXIST -> counter suffix .1, .2, … up to a cap). The config writer
// uses backupConfigFile instead, which delegates to mcpSecrets.safeBackup: created `wx` with 0600
// at open time (no world-readable window, the file can hold credentials), EEXIST handled the same
// way, dry-run aware.
function backupConfigPath(src, fsStr) {
    const base = `${src}.${fsStr}.bak`;
    try { fs.copyFileSync(src, base, fs.constants.COPYFILE_EXCL); return base; }
    catch (e) {
        if (e && e.code !== 'EEXIST') throw e;
        for (let n = 1; ; n++) {
            const dest = `${base}.${n}`;
            try { fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL); return dest; }
            catch (e2) {
                if (e2 && e2.code !== 'EEXIST') throw e2;
                if (n >= 1000) throw new Error(`no free backup name for ${src} after 1000 attempts`);
            }
        }
    }
}

// Timestamped copy next to the config; it can hold credentials, so 0600. True when none was needed or it was made.
const configBackups = [];
function backupConfigFile(filePath) {
    if (!fs.existsSync(filePath)) return true;
    if (DRY_RUN) { log.message(`[dry-run] backup: ${filePath}`); return true; }
    try {
        // created `wx` with 0600 at open time: no world-readable window
        // an earlier writer's backup also counts: the plaintext-secrets notice must still name it
        const bak = backupOnce(filePath, () => mcpSecrets.safeBackup(filePath, `${filePath}.${timestamp}.bak`)) || backupOf(filePath);
        if (bak) configBackups.push(bak);
        return true;
    } catch (e) {
        log.warn(`Could not back up ${filePath}, not rewriting it: ${e.message}`);
        return false;
    }
}

// Writes `data` over an existing config only when it changed (`before` = JSON.stringify of the
// parsed original, null for none), after a non-destructive exclusive backup. The write is atomic:
// the temp file `<file>.tmp-<pid>` is written in the same directory with mode 0600 and renamed
// over the target; a failed rename leaves the backup and the original intact, and no temp file
// survives either path.
function writeConfigWithBackup(filePath, data, before) {
    const serialized = JSON.stringify(data, null, 2);
    if (before !== null && before === JSON.stringify(data)) {
        try { fs.chmodSync(filePath, 0o600); } catch (e) { logDebug(e, 'chmod config'); }
        return false;
    }
    // Backup first (0600, dry-run aware), then the atomic tmp-rename write.
    if (!backupConfigFile(filePath)) return false;
    const tmp = `${filePath}.tmp-${process.pid}`;
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(tmp, serialized, { mode: 0o600 });
        try { fs.chmodSync(tmp, 0o600); } catch (e) { logDebug(e, 'chmod config tmp'); }
        try { fs.renameSync(tmp, filePath); } catch (e) {
            try { fs.unlinkSync(tmp); } catch (e2) { logDebug(e2, 'unlink config tmp'); }
            throw e;
        }
    } catch (e) {
        log.warn(`Could not write ${filePath}, not rewriting it: ${e.message}`);
        return false;
    }
    try { fs.chmodSync(filePath, 0o600); } catch (e) { logDebug(e, 'chmod config'); }
    return true;
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

const { isNewerVersion } = require('./lib/update-check');

// Newest dist-tag of `pkg` that is ahead of `localVer`: {tag, version}, or null when none is
// ahead or npm cannot be reached. `view` is injectable for tests.
function newestDistTag(pkg, localVer, view = null) {
    try {
        const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const opts = { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 4000, windowsHide: true };
        const out = view
            ? view(pkg)
            : process.platform === 'win32'
                ? execSync(`"${npmCmd}" view ${pkg} dist-tags --json`, opts)
                : execFileSync(npmCmd, ['view', pkg, 'dist-tags', '--json'], opts);
        const distTags = JSON.parse(String(out).trim());
        let best = null;
        for (const [tag, ver] of Object.entries(distTags || {})) {
            if (typeof ver !== 'string' || !isNewerVersion(localVer, ver)) continue;
            if (!best || isNewerVersion(best.version, ver)) best = { tag, version: ver };
        }
        return best;
    } catch (e) {
        logDebug(e, `npm view ${pkg}`);
        return null;
    }
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
        execSync('npm cache clean --force', { stdio: 'ignore', windowsHide: true });
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
            execSync(cmd, { ...opts, stdio: 'pipe', maxBuffer: 16 * 1024 * 1024, windowsHide: true });
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
            execSync(process.platform === 'win32' ? `powershell -NoProfile -Command "Start-Sleep -Seconds ${waitMs / 1000}"` : `sleep ${waitMs / 1000}`, { stdio: 'ignore', windowsHide: true });
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
            execSync(cmd, { ...opts, timeout: timeoutMs, windowsHide: true });
            return true;
        } catch (e) {
            if (i === attempts) {
                log.warn(`Failed to ${label}: ${e.message}`);
                return false;
            }
            const waitMs = 1000 * i;
            log.warn(`${label} failed (attempt ${i}/${attempts}), retrying in ${waitMs / 1000}s...`);
            execSync(process.platform === 'win32' ? `powershell -NoProfile -Command "Start-Sleep -Seconds ${waitMs / 1000}"` : `sleep ${waitMs / 1000}`, { stdio: 'ignore', windowsHide: true });
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
//   ours + user-edited → disk_hash != manifest_hash         → keep user file,
//                                                             write <file>.new
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

// Hash of a text file with CRLF read as LF; null for binary or unreadable files. Windows git checkouts (core.autocrlf) leave
// CRLF copies of our own files, which must not count as user edits.
function lfNormalizedHash(filePath) {
    try {
        const buf = fs.readFileSync(filePath);
        if (buf.includes(0) || !buf.includes(13)) return null;
        return crypto.createHash('sha256').update(Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1')).digest('hex');
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

// Temp file in the same directory + rename: a crash mid-write cannot leave a truncated manifest.
function writeFileAtomic(filePath, data) {
    const tmp = `${filePath}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(tmp, data);
        fs.renameSync(tmp, filePath);
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch (_) {}
        throw e;
    }
}

function saveInstallManifest(manifest, customPath = null) {
    if (DRY_RUN) return;
    const manifestPath = customPath || getInstallManifestPath();
    try {
        fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
        writeFileAtomic(manifestPath, JSON.stringify(manifest, null, 2));
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

// User-edited files this run left untouched (shipped copy written as <file>.new).
const keptUserEdits = [];

// Manifest-aware file writer implementing the three-way conflict policy.
// Returns 'wrote' | 'bak' | 'kept' | 'skipped'.
// knownSourceHashes: Set of sha256 hashes of all source files in the current
// payload (used to identify files we recognise even before manifest entry).
// A stale gate is a security defect, so these are never left behind as <file>.new: the old copy is moved
// to <file>.bak and the shipped one installed.
const GUARD_FILES = new Set(['aos-gate.mjs', 'gate-profile.mjs', 'go-gate.mjs']);

function keepOrReplaceGuard(sourcePath, targetPath, manifest, sourceHash) {
    if (GUARD_FILES.has(path.basename(targetPath))) {
        fs.copyFileSync(targetPath, `${targetPath}.bak`);
        fs.copyFileSync(sourcePath, targetPath);
        manifest[targetPath] = { path: targetPath, sha256: sourceHash, version: pkg.version, installedAt: new Date().toISOString() };
        log.warn(`Gate file ${targetPath} differed from every shipped version; replaced it (previous copy: ${targetPath}.bak).`);
        return 'wrote';
    }
    fs.copyFileSync(sourcePath, `${targetPath}.new`);
    keptUserEdits.push(targetPath);
    return 'kept';
}

function resolveFileConflict(sourcePath, targetPath, manifest, knownSourceHashes, shippedHashes = SHIPPED_HASHES) {
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

    // Rebuilt on every pack and unable to contain its own hash, so an older copy is never a user edit.
    if (path.basename(targetPath) === 'shipped-hashes.json') {
        fs.copyFileSync(sourcePath, targetPath);
        manifest[targetPath] = { path: targetPath, sha256: sourceHash, version: pkg.version, installedAt: new Date().toISOString() };
        return 'wrote';
    }

    const diskHash = computeFileHash(targetPath);

    // Case: an older release of our own file. Its hash appears in the
    // shipped-hashes list (built from every released payload), so it is
    // AOS-owned even if no manifest entry survives -- overwrite directly,
    // no .new, no .bak.
    if (shippedHashes.has(diskHash)) {
        fs.copyFileSync(sourcePath, targetPath);
        manifest[targetPath] = { path: targetPath, sha256: sourceHash, version: pkg.version, installedAt: new Date().toISOString() };
        return 'wrote';
    }

    // Differs from the payload (or a released payload) only by CRLF line endings: ours, replace with the LF original.
    const lfHash = lfNormalizedHash(targetPath);
    if (lfHash && (lfHash === sourceHash || shippedHashes.has(lfHash))) {
        fs.copyFileSync(sourcePath, targetPath);
        manifest[targetPath] = { path: targetPath, sha256: sourceHash, version: pkg.version, installedAt: new Date().toISOString() };
        try { fs.rmSync(`${targetPath}.new`, { force: true }); } catch { /* a stale .new is only noise */ }
        return 'wrote';
    }

    // Identical to the payload is never a user edit, with or without a manifest entry (an interrupted or
    // dev-built run leaves none). Checked before the unrecognised-content case, which would keep it as a phantom edit.
    if (diskHash === sourceHash) {
        manifest[targetPath] = { path: targetPath, sha256: sourceHash, version: pkg.version, installedAt: new Date().toISOString() };
        try { fs.rmSync(`${targetPath}.new`, { force: true }); } catch { /* a stale .new is only noise */ }
        return 'wrote';
    }

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
    // That old-release case is now covered by the shipped-hash check above, so
    // what remains here is content we have no record of having ever shipped: a
    // local edit of one of our files (recoverable via the .new copy) or a
    // foreign file. Either way the disk version wins and the shipped copy
    // lands beside it as <file>.new.
    if (!manifestEntry && !knownSourceHashes.has(diskHash)) {
        return keepOrReplaceGuard(sourcePath, targetPath, manifest, sourceHash);
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
    // The user's file wins: the shipped version lands next to it as .new, and
    // the manifest keeps the old hash so the next run still sees the edit.
    if (manifestEntry && diskHash !== manifestEntry.sha256) {
        return keepOrReplaceGuard(sourcePath, targetPath, manifest, sourceHash);
    }

    // Default: manifest entry present, disk matches manifest (no change needed) – overwrite.
    fs.copyFileSync(sourcePath, targetPath);
    manifest[targetPath] = { path: targetPath, sha256: sourceHash, version: pkg.version, installedAt: new Date().toISOString() };
    return 'wrote';
}

// Hashes of every file shipped in ANY AOS release (built at pack time by
// scripts/build-shipped-hashes.mjs into lib/shipped-hashes.json). A file on
// disk matching one of these is AOS-owned regardless of which release placed
// it, so the installer overwrites it without a .new. Missing or corrupt file
// → empty Set: the installer then just falls back to the manifest policy.
function loadShippedHashes() {
    try {
        const arr = JSON.parse(fs.readFileSync(path.join(__dirname, 'lib', 'shipped-hashes.json'), 'utf8'));
        if (Array.isArray(arr)) return new Set(arr.filter((h) => typeof h === 'string'));
    } catch (e) { /* missing or broken – treat as empty */ }
    return new Set();
}
let SHIPPED_HASHES = loadShippedHashes();
// Tests inject their own set; production keeps the pack-time list.
function setShippedHashes(set) { SHIPPED_HASHES = set; }

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

// The exact roots syncSkillsToGlobalHarnesses and the Gemini/Antigravity
// config-skills path write into. Pruning only touches a manifest entry whose
// path starts under one of these -- never one that merely contains a
// "skills" segment somewhere deeper, which is what let the MCP-bundle and
// workspace_agents cases above leak in during testing.
function globalSkillDestRoots() {
    return [
        path.join(homeDir, '.agents', 'skills'),
        path.join(claudeConfigDir(homeDir), 'skills'),
        path.join(homeDir, '.codex', 'skills'),
        path.join(homeDir, '.cursor', 'skills'),
        path.join(homeDir, '.roo', 'skills'),
        path.join(geminiDir, 'config', 'skills'),
    ];
}

// Retires skills the package no longer ships (lib/retired-skills.js). Edited or foreign files are
// copied to the backup dir before the skill folder is removed.
function pruneRemovedSkills(manifest) {
    pruneRetiredSkills({
        home: homeDir,
        manifest,
        roots: globalSkillDestRoots(),
        backupDir: path.join(homeDir, '.agents', 'backups', `retired-skills-${timestamp}`),
        log,
    });
}

// "core" skill set: installed copies of moved skills are removed (lib/core-skills.js) and the move is announced.
function applySkillSet(manifest) {
    if (skillSet !== 'core') return;
    try {
        coreSkills.pruneMoved({
            root: srcDir,
            home: homeDir,
            manifest,
            roots: globalSkillDestRoots(),
            backupDir: path.join(homeDir, '.agents', 'backups', `skill-set-core-${timestamp}`),
            log,
        });
    } catch (e) { log.warn(`Skill set "core" skipped: ${e.message}`); }
}

// Populates the local library (~/.aos/library/skills) with every shipped skill and writes the
// pack index. The library is AOS's own full copy that no harness reads directly: harness dirs
// get base+packs, while `aos store install` copies single skills or whole packs from here, offline.
function populateSkillLibrary(home = homeDir) {
    const dest = skillPacks.librarySkillsDir(home);
    const dirs = skillPacks.shippedSkillDirs(srcDir);
    if (DRY_RUN) {
        log.step(`[dry-run] would copy ${dirs.size} skills into ${dest}`);
        return;
    }
    installStep('populate the skill library (~/.aos/library)', () => {
        fs.mkdirSync(dest, { recursive: true });
        for (const [name, abs] of dirs) copyDirRecursiveSync(abs, path.join(dest, name), []);
        const def = skillPacks.loadPacks(srcDir);
        fs.mkdirSync(path.dirname(skillPacks.libraryIndexFile(home)), { recursive: true });
        fs.writeFileSync(skillPacks.libraryIndexFile(home), JSON.stringify({
            version: pkg.version,
            generatedAt: new Date().toISOString(),
            base: def.base || [],
            packs: def.packs || {},
        }, null, 2));
        log.step(`Skill library populated: ${dirs.size} skills at ${dest}`);
    }, 'The library is incomplete; pack installs from it fall back to the package copy.');
}

// A stored pack selection removes installed copies of skills outside base+packs from the harness
// dirs. Manifest-aware (lib/retired-skills.js): only dirs the install manifest lists are touched,
// edited files are backed up first, and the exact copies the store wrote (installs.jsonl targets)
// are left alone. A user skill is never in the manifest, so it can never be removed here.
function applyPackSelection(manifest) {
    if (!Array.isArray(packSelection)) return;
    const names = skillPacks.excludedByPacks(srcDir, effectivePackSelection());
    if (!names.length) return;
    try {
        pruneRetiredSkills({
            home: homeDir,
            manifest,
            roots: globalSkillDestRoots(),
            backupDir: path.join(homeDir, '.agents', 'backups', `pack-deselect-${timestamp}`),
            log,
            names,
            what: 'deselected-pack',
            keep: storeProtectedDirs(homeDir),
        });
    } catch (e) { log.warn(`Pack deselection prune skipped: ${e.message}`); }
}

function flushSessionManifest() {
    if (_sessionManifest) saveInstallManifest(_sessionManifest);
    reportKeptUserEdits();
}

function reportKeptUserEdits() {
    if (keptUserEdits.length === 0) return;
    const kept = [...new Set(keptUserEdits)];
    log.warn([
        `${kept.length} file(s) you edited were KEPT; the shipped version is next to each as <file>.new:`,
        ...kept.map((p) => `  ${p}`),
        'Merge or delete the .new files when convenient.',
    ].join('\n'));
    keptUserEdits.length = 0;
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
        const backupRoot = fs.mkdtempSync(path.join(ensureBackupParent(), 'retired-legacy-'));
        fs.renameSync(targetLegacyDir, path.join(backupRoot, 'legacy'));
        log.step(`Moved retired legacy skill copies from ${targetLegacyDir} to ${backupRoot} (global_legacy has not shipped in a long time).`);
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
            key: 'claudecode', name: 'Claude Code CLI', path: claudeConfigDir(homeDir),
            evidence: () => hasExecutable('claude') || Boolean(findBundledClaudeCli()),
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
            path: path.join(homeDir, '.config', 'opencode'),
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

const HARNESS_LABELS = {
    antigravity: 'Antigravity', codex: 'Codex', claudecode: 'Claude Code', claudedesktop: 'Claude Desktop',
    cursor: 'Cursor', windsurf: 'Windsurf', vscode: 'Roo/Cline/VS Code', aider: 'Aider', opencode: 'OpenCode',
};
// Menu option value of the primary target per harness, in preference order.
const PRIMARY_TARGET_ORDER = [['antigravity', '1'], ['claudecode', '2'], ['codex', '5'], ['vscode', '7'], ['windsurf', '6'], ['aider', '8'], ['cursor', '3']];

// Harnesses that receive files this run: detected or explicitly chosen. Nothing found means Claude Code only.
function activeHarnessKeys() {
    const keys = new Set(detectPlatforms().map((d) => d.key));
    if (keys.size === 0) keys.add('claudecode');
    return keys;
}

// What "Universal" or -y installs into as its primary target; never Antigravity unless it is active.
function defaultPlatformValue() {
    const keys = activeHarnessKeys();
    const hit = PRIMARY_TARGET_ORDER.find(([k]) => keys.has(k));
    return hit ? hit[1] : '2';
}

// Which active harnesses have AOS hooks wired but no gate hook any more (removed there by hand).
// Reads only. A config that is absent or has no AOS wiring at all proves nothing — nothing to preserve there.
function gateMissingInHarnesses({ home = homeDir } = {}) {
    const read = (p) => { try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; } catch { return ''; } };
    const missing = [];
    const claude = read(path.join(claudeConfigDir(home), 'settings.json'));
    if (claude && /conventional-commits\.mjs|env-file-protection\.mjs|memb-inject\.mjs/.test(claude)
        && !v5Profile.GATE_HOOKS.some((n) => claude.includes(n))) missing.push('claudecode');
    const agyHooks = read(path.join(home === homeDir ? geminiDir : path.join(home, '.gemini'), 'config', 'hooks.json'));
    if (agyHooks && /aos-conventional-commits|aos-env-protection/.test(agyHooks)
        && !/aos-go-gate|aos-graph-gate/.test(agyHooks)) missing.push('antigravity');
    const codexToml = read(path.join(home, '.codex', 'config.toml'));
    if (codexToml.includes('# AOS:HOOKS:START')
        && !/go-gate\.mjs|graph-gate\.mjs/.test(codexToml)) missing.push('codex');
    return missing;
}

// The go-gate was turned off by hand in a harness config while the `gate` setting still says on. An update must
// not silently re-enable it: an interactive TTY asks once and stores the answer in the gate setting; without a
// TTY this run keeps the current state (setting untouched, hooks stay absent in exactly those harnesses) and
// prints one line saying so. ask: null means non-interactive.
async function gateReenableStep({ home = homeDir, ask = null, write = (s) => process.stdout.write(s) } = {}) {
    if (!gateOn || gateHoldKeys.size) return;
    const missing = gateMissingInHarnesses({ home });
    if (!missing.length) return;
    const labels = missing.map((k) => HARNESS_LABELS[k] || k).join(', ');
    if (typeof ask === 'function') {
        const yes = await ask(`The go-gate is off in ${labels}. Turn it back on? (y/N)`);
        if (yes) return;
        if (!DRY_RUN) {
            try { v5Profile.writeSettings(home, { ...v5Profile.readSettings(home), gate: 'off' }); } catch (e) { log.warn(`Could not save the gate choice: ${e.message}`); }
        }
        gateOn = false;
        write(`Go-gate stays off in ${labels}. Change it any time: run aos, Settings, Go-gate.\n`);
        return;
    }
    for (const k of missing) gateHoldKeys.add(k);
    write(`Go-gate: not re-registered in ${labels} (removed there by hand); the gate setting is unchanged. Decide in aos, Settings, Go-gate.\n`);
}

// Same interactivity rule as applyCodingModeStep: stdin must be a TTY, -y and CI never prompt.
function gateReenableAsk() {
    if (isAutoYes || !process.stdin.isTTY || process.env.CI) return null;
    return async (message) => { const a = await askConfirm({ message, initialValue: false }); return isCancel(a) ? false : Boolean(a); };
}

function harnessSummaryLine() {
    const keys = new Set(detectPlatforms().map((d) => d.key));
    if (keys.size === 0) keys.add('claudecode');
    const names = (want) => Object.keys(HARNESS_LABELS).filter((k) => keys.has(k) === want).map((k) => HARNESS_LABELS[k]).join(', ') || '-';
    return `Installed for: ${names(true)}  Skipped (not found): ${names(false)}`;
}

const ROUTER_TARGETS = ['claude', 'opencode-go', 'agy', 'codex', 'claude-glm'];
const ROUTER_TARGET_LABELS = {
    claude: 'Claude (Claude Code / Desktop)',
    'opencode-go': 'OpenCode (glm-5.3-flash)',
    agy: 'Google Antigravity (agy)',
    codex: 'ChatGPT Codex CLI',
    'claude-glm': 'Claude via GLM bridge',
};

// Map installed harnesses to router targets. Never guess: a target is only
// preselected when its CLI or app bundle is actually present.
function detectRouterTargets() {
    const detected = new Set();
    for (const d of detectPlatforms()) {
        if (d.chosen) continue; // chosen = explicitly selected but not detected
        if (d.key === 'claudecode' || d.key === 'claudedesktop') detected.add('claude');
        if (d.key === 'codex') detected.add('codex');
        if (d.key === 'opencode') detected.add('opencode-go');
        if (d.key === 'antigravity') detected.add('agy');
    }
    return ROUTER_TARGETS.map((key) => ({ key, detected: detected.has(key) }));
}

function orderTargets(first, selected) {
    return [first, ...selected.filter((t) => t !== first)];
}

const ROUTER_ROLES = ['architect', 'techlead', 'reviewer', 'builder', 'scout'];

function buildRouterPreferences(mainHarness, selectedTargets, preset = 'default') {
    const has = (t) => selectedTargets.includes(t);
    if (preset === 'claude-only') {
        return Object.fromEntries(ROUTER_ROLES.map((role) => [role, orderTargets('claude', selectedTargets)]));
    }
    // default / budget: planning roles start with the main harness; builder/scout
    // start with opencode-go when available, because it is the budget option.
    const planningFirst = mainHarness;
    const buildFirst = has('opencode-go') ? 'opencode-go' : mainHarness;
    return {
        architect: orderTargets(planningFirst, selectedTargets),
        techlead: orderTargets(planningFirst, selectedTargets),
        reviewer: orderTargets(planningFirst, selectedTargets),
        builder: orderTargets(buildFirst, selectedTargets),
        scout: orderTargets(buildFirst, selectedTargets),
    };
}

// default keeps the shipped table (no file written); claude-only/budget/custom write ~/.aos/router.json.
function writeUserRouterConfig({ home, preset, mainHarness, selectedTargets }) {
    if (!preset || preset === 'default') return null;
    const preferences = buildRouterPreferences(mainHarness || 'claude', selectedTargets, preset);
    const file = path.join(home, '.aos', 'router.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    fs.writeFileSync(file, JSON.stringify({ preferences }, null, 2) + '\n');
    return file;
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
        path.join(claudeConfigDir(homeDir), 'skills', 'startcycle', 'SKILL.md')
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
        if (!localVersion) {
            // ponytail: placeholder only feeds the version display/compare; pruning is driven by the file manifest, not this value.
            log.step('Previous AOS version is unknown (no manifest); assuming 3.8.0 for the update comparison only.');
            localVersion = '3.8.0';
        }
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

    // No module directory: Codebase Memory is opted into by the binary itself.
    if (codebaseMemory.cmbAppStatus().found && !installedModules.includes('codebase-memory')) {
        installedModules.push('codebase-memory');
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
        writeFileAtomic(manifestPath, JSON.stringify(updated, null, 2));
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
                if (v5Profile.isTestSandbox(homeDir)) {
                    log.success(`${d.name} daemon reloaded`);
                    continue;
                }
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
                    spawn('wscript.exe', [d.vbs], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
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
        fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
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

// A symlink is only a pointer and is safe to replace; a real file or folder there may be the user's own and is moved aside.
function clearLinkSlot(p) {
    let st;
    try { st = fs.lstatSync(p); } catch { return; }
    if (st.isSymbolicLink()) { fs.unlinkSync(p); return; }
    const backupRoot = fs.mkdtempSync(path.join(ensureBackupParent(), 'replaced-by-link-'));
    fs.renameSync(p, path.join(backupRoot, path.basename(p)));
    log.step(`Moved ${p} aside before linking it (backup: ${backupRoot}).`);
}

function ensureBackupParent() {
    const dir = path.join(homeDir, '.agents', 'backups');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
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
                        clearLinkSlot(curTarget);
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

function redactSecrets(text) {
    return String(text)
        .replace(/([\w.-]*(?:key|token|secret|passw(?:or)?d|auth|credential)[\w.-]*\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1[redacted]')
        .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/\b(?:sk|ghp|gho|ghs|xox[a-z])[-_][A-Za-z0-9_-]{16,}/g, '[redacted]');
}

// execFileSync error -> one message that keeps the child's own stderr/stdout (last 2 KB, redacted).
function describeExecError(e) {
    const out = [e && e.stderr, e && e.stdout].map((b) => (b ? b.toString() : '').trim()).filter(Boolean).join('\n');
    const head = redactSecrets(String((e && e.message) || e).split('\n')[0]).slice(0, 300);
    return out ? `${head}\n${redactSecrets(out.slice(-2048))}` : head;
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

// AOS_PLUGIN_MIGRATION=off skips plugin registration and loose-copy removal; =check only reports.
function pluginMigrationMode(argv = process.argv, env = process.env) {
    const flag = argv.find((a) => a.startsWith('--plugin-migration='));
    const raw = String(flag ? flag.slice('--plugin-migration='.length) : (env.AOS_PLUGIN_MIGRATION || '')).trim().toLowerCase();
    if (raw === 'off' || raw === '0' || raw === 'false') return 'off';
    return raw === 'check' || DRY_RUN ? 'check' : 'on';
}

// .agents/plugins holds the Codex marketplace file; it belongs to the repo checkout, not to ~/.agents or a project.
const AGENTS_COPY_EXCLUDE = ['plugins'];

// The claude CLI works on the account's real home only; a redirected HOME (tests, sandboxes) never
// runs it. AOS_PLUGIN_CLI=on is the test switch that forces the CLI path on a redirected HOME.
function realClaudeHome(h) {
    if (process.env.AOS_PLUGIN_CLI === 'off') return false;
    if (process.env.AOS_PLUGIN_CLI === 'on') return true;
    try {
        const norm = (x) => (process.platform === 'win32' ? path.resolve(x).toLowerCase() : path.resolve(x));
        return norm(h) === norm(os.userInfo().homedir);
    } catch { return false; }
}

let _pluginMigration = null;
function runPluginMigration({ targetHome = homeDir, detected = null, mode = pluginMigrationMode(), registrars, cli: pluginCli } = {}) {
    if (_pluginMigration && targetHome === homeDir) return _pluginMigration;
    const keys = detected || detectPlatforms().map((d) => d.key);
    const ownsManifest = !_sessionManifest;
    const manifest = _sessionManifest || loadInstallManifest();
    let result;
    let cliSkipped = true;
    try {
        const useCli = pluginCli === undefined && realClaudeHome(targetHome);
        if (pluginCli === undefined && !useCli && mode === 'on' && keys.includes('claudecode')) {
            log.step(`claude plugin CLI steps skipped: HOME is not the account's real home (${process.env.AOS_PLUGIN_CLI === 'off' ? 'AOS_PLUGIN_CLI=off' : 'set AOS_PLUGIN_CLI=on to force them'}).`);
        }
        const cliForRun = pluginCli !== undefined ? pluginCli : useCli ? pluginMigration.defaultCliRunner : null;
        cliSkipped = !cliForRun;
        result = pluginMigration.migrate({ home: targetHome, manifest, detected: keys, mode, version: require('./package.json').version, announce: (m) => log.step(m), cli: uninstallRecords.recordingCli(targetHome, cliForRun), ...(registrars ? { registrars } : {}) });
    } catch (e) {
        log.warn(`Plugin migration skipped: ${e.message}`);
        result = { covered: new Set(), lines: [], error: e.message };
    }
    for (const line of result.lines) log.step(line);
    const regFailed = result.lines.filter((l) => /plugin registration failed/.test(l));
    if (regFailed.length && !result.error) result.error = regFailed.join('; ');
    if (ownsManifest && mode === 'on') saveInstallManifest(manifest);
    result.cliSkipped = cliSkipped;
    if (targetHome === homeDir) _pluginMigration = result;
    return result;
}

// ONE highlighted line at the very end of the run (full install and Quick Update) when the Claude
// plugin step did not finish: what failed plus the exact fix for PowerShell and bash. Success stays
// in the step logs; nothing is printed then.
function printClaudePluginFix() {
    const line = _pluginMigration && !_pluginMigration.cliSkipped ? pluginMigration.pluginFixSummary(_pluginMigration) : null;
    if (line) console.log(line);
    return !!line;
}

// Antigravity and Codex plugin steps, shared by the full install and Quick Update so the default
// update path installs the same plugins. Order: Claude (runPluginMigration), agy, Codex.
function runAgyPluginStep() {
    if (!activeHarnessKeys().has('antigravity')) { log.step('Antigravity not found: agy plugin skipped.'); return null; }
    try { require('./lib/agy-plugin-install').run({ srcDir, home: homeDir, mode: pluginMigrationMode(), log }); return null; }
    catch (e) { log.warn(`agy plugin skipped: ${e.message}`); return e.message; }
}
function runCodexPluginStep() {
    if (!activeHarnessKeys().has('codex')) { log.step('Codex not found: Codex plugin skipped.'); return; }
    const r = codexPluginInstall.installCodexPlugin({ home: homeDir, pkgRoot: srcDir, version: require('./package.json').version, mode: pluginMigrationMode(), announce: (m) => log.step(m) });
    for (const line of r.lines) log.step(line);
    if (r.ok === false) throw new Error(r.lines.filter((l) => /FAILED/.test(l)).join('; ') || 'Codex plugin install failed');
}

function collectSkillFiles(dir) {
    const files = [];
    let unsafe = false;
    function walk(sub) {
        const fullDir = sub ? path.join(dir, sub) : dir;
        let items;
        try { items = fs.readdirSync(fullDir, { withFileTypes: true }); } catch (_) { unsafe = true; return; }
        for (const item of items) {
            if (item.name === '.DS_Store') continue;
            const rel = sub ? `${sub}/${item.name}` : item.name;
            const full = path.join(dir, rel);
            let st;
            try { st = fs.lstatSync(full); } catch (_) { unsafe = true; continue; }
            if (st.isSymbolicLink()) {
                unsafe = true;
            } else if (st.isDirectory()) {
                walk(rel);
            } else if (st.isFile()) {
                files.push(rel);
            } else {
                unsafe = true;
            }
        }
    }
    walk('');
    return { files: files.sort(), unsafe };
}

function cleanEmptySkillDirs(dir) {
    let items;
    try { items = fs.readdirSync(dir); } catch (_) { return; }
    for (const item of items) {
        const full = path.join(dir, item);
        try {
            if (item === '.DS_Store') {
                fs.unlinkSync(full);
            } else if (fs.statSync(full).isDirectory()) {
                cleanEmptySkillDirs(full);
            }
        } catch (_) {}
    }
    try { fs.rmdirSync(dir); } catch (_) {}
}

// Measured with codex 0.154.0: Codex loads BOTH ~/.agents/skills and ~/.codex/skills, so AOS copies
// in both double the list (366 entries, descriptions squeezed out, cut off after pb-ship). AOS writes
// only ~/.agents/skills; copies it wrote earlier into ~/.codex/skills (manifest hash still matches) are
// backed up and removed, all-or-nothing (edited files stop the removal and are reported). Legacy module
// skills (e.g. hardware-pcb) also present in ~/.agents/skills are backed up and retired when file
// hashes match; edited copies stay and are reported.
function retireCodexSkillCopies(manifest = _sessionManifest || loadInstallManifest(), { home = homeDir } = {}) {
    if (DRY_RUN || pluginMigrationMode() !== 'on' || !manifest) return { removed: [], leftover: [] };
    const targetHome = home || homeDir;
    const root = path.join(targetHome, '.codex', 'skills');
    if (!fs.existsSync(root)) return { removed: [], leftover: [] };
    let rootStat;
    try { rootStat = fs.lstatSync(root); } catch { return { removed: [], leftover: [] }; }
    if (rootStat.isSymbolicLink()) {
        log.warn(`Codex skills: ${root} is a symlink; not touched, Codex will list those skills twice.`);
        return { removed: [], leftover: [], refused: `${root} is a symlink` };
    }
    const backup = path.join(targetHome, '.agents', 'backups', `plugin-migration-codex-skills-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`);
    let r = { removed: [], leftover: [], refused: null };
    try {
        r = pluginMigration.removeLooseCopies({ home: targetHome, root, manifest: manifest || {}, backupDir: backup });
        if (r.refused) {
            log.warn(`Codex skills: ${r.refused}; not touched, Codex will list those skills twice.`);
            return { removed: [], leftover: [], refused: r.refused };
        }
    } catch (e) {
        log.warn(`Codex skill cleanup skipped: ${e.message}`);
    }

    const removedFiles = [...(r.removed || [])];
    const leftoverSkills = new Set(r.leftover || []);

    const agentsSkillsDir = path.join(targetHome, '.agents', 'skills');
    if (fs.existsSync(agentsSkillsDir)) {
        const prefix = path.resolve(root) + path.sep;
        let realPrefix = null;
        try { realPrefix = fs.realpathSync(root) + path.sep; } catch (_) {}

        let entries = [];
        try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { entries = []; }
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
            const skillName = entry.name;
            if (leftoverSkills.has(skillName)) continue;
            const codexSkillDir = path.join(root, skillName);
            const agentsSkillDir = path.join(agentsSkillsDir, skillName);
            let agentsStat;
            try { agentsStat = fs.statSync(agentsSkillDir); } catch (_) { continue; }
            if (!agentsStat.isDirectory()) continue;

            const codexScan = collectSkillFiles(codexSkillDir);
            const agentsScan = collectSkillFiles(agentsSkillDir);

            if (codexScan.unsafe || agentsScan.unsafe || codexScan.files.length === 0 || codexScan.files.length !== agentsScan.files.length) {
                leftoverSkills.add(skillName);
                continue;
            }

            let matches = true;
            for (let i = 0; i < codexScan.files.length; i++) {
                if (codexScan.files[i] !== agentsScan.files[i]) {
                    matches = false;
                    break;
                }
                const rel = codexScan.files[i];
                const fileA = path.join(codexSkillDir, rel);
                const fileB = path.join(agentsSkillDir, rel);
                const hashA = computeFileHash(fileA);
                const hashB = computeFileHash(fileB);
                if (!hashA || hashA !== hashB) {
                    matches = false;
                    break;
                }
            }

            if (!matches) {
                leftoverSkills.add(skillName);
                continue;
            }

            // Verify paths are safely within root before moving
            let pathsSafe = true;
            for (const rel of codexScan.files) {
                const abs = path.resolve(path.join(codexSkillDir, rel));
                let realAbs = null;
                try { realAbs = fs.realpathSync(abs); } catch (_) {}
                if (!abs.startsWith(prefix) || !realAbs || (realPrefix && !realAbs.startsWith(realPrefix))) {
                    pathsSafe = false;
                    break;
                }
            }
            if (!pathsSafe) {
                leftoverSkills.add(skillName);
                continue;
            }

            // All file hashes match the ~/.agents copy: back up and retire.
            for (const rel of codexScan.files) {
                const abs = path.join(codexSkillDir, rel);
                try {
                    const dest = path.join(backup, path.relative(targetHome, abs));
                    fs.mkdirSync(path.dirname(dest), { recursive: true });
                    fs.copyFileSync(abs, dest);
                    fs.unlinkSync(abs);
                    if (manifest && manifest[abs]) delete manifest[abs];
                    removedFiles.push(abs);
                } catch (e) {
                    logDebug(e, `Codex retire module skill: ${abs}`);
                }
            }
            cleanEmptySkillDirs(codexSkillDir);
        }
    }

    if (leftoverSkills.size) {
        const leftoverArr = [...leftoverSkills].sort();
        log.warn(`Codex skills: ${leftoverArr.length} edited or unsafe copies in ${root} (${leftoverArr.slice(0, 5).join(', ')}) stay, so Codex lists skills twice (it also reads ~/.agents/skills). Move your edits out and re-run to retire them.`);
    }
    if (removedFiles.length) {
        log.step(`Codex reads ~/.agents/skills, so ${removedFiles.length} AOS copies were removed from ${root} (backup: ${backup}).`);
    }
    return { removed: removedFiles, leftover: [...leftoverSkills].sort() };
}

// ~/.codex-plugin/plugin.json in HOME made Codex rename every skill, even OpenAI's, to bdb-aos:<name>.
// Older AOS versions copied it there. Only files the manifest (or a byte match with the package copy)
// says AOS wrote are moved to a backup; anything else in the folder stays.
function retireStaleCodexPluginDir(manifest) {
    if (DRY_RUN || pluginMigrationMode() !== 'on') return;
    const dir = path.join(homeDir, '.codex-plugin');
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    const backup = path.join(homeDir, '.agents', 'backups', `codex-plugin-dir-${Date.now()}`);
    let moved = 0;
    for (const n of names) {
        const file = path.join(dir, n);
        const hash = computeFileHash(file);
        const src = computeFileHash(path.join(srcDir, '.codex-plugin', n));
        const rec = manifest && manifest[file];
        if (!hash || !((rec && rec.sha256 === hash) || (src && src === hash))) continue;
        try {
            fs.mkdirSync(backup, { recursive: true });
            fs.copyFileSync(file, path.join(backup, n));
            fs.unlinkSync(file);
            if (manifest) delete manifest[file];
            moved++;
        } catch (e) { logDebug(e, 'operation'); }
    }
    try { fs.rmdirSync(dir); } catch { /* user files remain */ }
    if (moved) log.step(`Removed the stale ~/.codex-plugin AOS copied earlier (it renamed every Codex skill to bdb-aos:<name>); backup: ${backup}`);
}

// The plugin migration runs first: when it retires Claude's loose copies, ~/.claude/skills is not
// written again, so a rerun neither recreates nor re-backs-up what the plugin now delivers.
function installTargetSkills(targets, { mode, backupDir, excludeSkills, skillsBase }) {
    const detected = detectPlatforms().map((d) => d.key);
    if (targets.some((t) => t.value === '2') && !detected.includes('claudecode')) detected.push('claudecode');
    const pluginCovered = runPluginMigration({ detected }).covered;

    for (const t of targets) {
        const viaPlugin = t.value === '2' && pluginCovered.has('claudecode');
        if (mode === 'replace') {
            if (!viaPlugin) {
                moveIfExists(t.targetSkillDir, path.join(backupDir, `config_skills_backup_${t.value}`), `global config skills (${t.value})`);
                moveIfExists(t.targetLegacyDir, path.join(backupDir, `legacy_skills_backup_${t.value}`), `legacy skills (${t.value})`);
            }
            moveIfExists(t.targetWorkspaceDir, path.join(backupDir, `workspace_skills_backup_${t.value}`), `workspace skills (${t.value})`);
        }

        installStep(`create the skill target directories (${t.value})`, () => {
            if (!viaPlugin) {
                fs.mkdirSync(t.targetSkillDir, { recursive: true });
                retireObsoleteLegacyDir(t.targetLegacyDir);
            }
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

                    if (viaPlugin && dir !== 'workspace_agents') continue;
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
}

function globalSkillDestinations({ ignorePluginCoverage = false } = {}) {
    const pluginCovered = ignorePluginCoverage ? new Set() : runPluginMigration().covered;

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
    return [
        { dir: path.join(homeDir, '.agents', 'skills'), key: null },
        { dir: path.join(claudeConfigDir(homeDir), 'skills'), key: 'claudecode' },
        { dir: path.join(homeDir, '.cursor', 'skills'), key: 'cursor' },
        { dir: path.join(homeDir, '.roo', 'skills'), key: 'vscode' },
        { dir: path.join(homeDir, '.config', 'opencode', 'skills'), key: 'opencode' },
    ].filter((d) => d.key === null || (detectedKeys.has(d.key) && !pluginCovered.has(d.key)));
}

const TAURI_PILOT_VERSION = '0.8.1';
const TAURI_PILOT_CARGO_ARGS = ['install', 'tauri-pilot-cli', '--version', TAURI_PILOT_VERSION, '--locked'];
const TAURI_PILOT_INSTALL_CMD = `cargo ${TAURI_PILOT_CARGO_ARGS.join(' ')}`;
const TAURI_PILOT_MCP = 'tauri-pilot';

// The tauri-pilot CLI is also the MCP server. A missing cargo or a failed build only warns: the skills stay usable.
function ensureTauriPilotCli({ exec = execFileSync, has = hasExecutable } = {}) {
    try {
        const out = exec('tauri-pilot', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000, windowsHide: true });
        if ((String(out).match(/\d+\.\d+\.\d+/) || [])[0] === TAURI_PILOT_VERSION) {
            log.step(`tauri-pilot ${TAURI_PILOT_VERSION} already installed.`);
            return true;
        }
    } catch (e) { logDebug(e, 'tauri-pilot --version'); }
    if (!has('cargo')) {
        log.warn(`cargo not found on PATH: the tauri-pilot CLI and MCP server are not installed. Install Rust, then run: ${TAURI_PILOT_INSTALL_CMD}`);
        return false;
    }
    log.step(`Installing the tauri-pilot CLI: ${TAURI_PILOT_INSTALL_CMD} (compiles from source, can take several minutes)`);
    try {
        exec('cargo', TAURI_PILOT_CARGO_ARGS, { stdio: 'inherit', timeout: 30 * 60 * 1000 });
        uninstallRecords.recordCargoCrate(homeDir, 'rustauri', 'tauri-pilot-cli');
        return true;
    } catch (e) {
        log.warn(`tauri-pilot CLI install failed (${e.message}). Run it by hand: ${TAURI_PILOT_INSTALL_CMD}`);
        return false;
    }
}

// The full install's MCP sync writes this pick as well; `aos package install rustauri` runs no sync, so the
// entry is merged here into every existing harness MCP config. Package removal retires it on the next sync.
function registerTauriPilotMcp() {
    mcpPickCache = null; // the pick depends on the skills installRustauri has just written
    const entry = mcpPicks().servers[TAURI_PILOT_MCP];
    if (!entry) { log.warn('tauri-pilot MCP entry not registered: the tauri-pilot skill is not in ~/.agents/skills.'); return; }
    const master = { mcpServers: { [TAURI_PILOT_MCP]: entry } };
    const retired = new Set(mcpPicks().retired);
    const shipped = mcpShipped();
    for (const { file, kind } of mcpSecrets.harnessMcpFiles(homeDir, process.env, process.platform, homeDir)) {
        if (!fs.existsSync(file)) continue;
        if (kind === 'opencode') { syncOpencodeConfigFile(file, master); continue; }
        if (kind !== 'toml') { syncMcpConfigFile(file, master); continue; }
        // mergeCodexTomlMcpServers rewrites the whole AOS block from what it is given: hand it the AOS tables already there.
        try {
            const owned = {};
            for (const [name, t] of Object.entries(mcpSecrets.parseCodexTables(readTextFile(file)))) {
                const e = mcpSecrets.codexEntry(t);
                if (!retired.has(name) && typeof e.command === 'string' && mcpSecrets.isAosOwned(name, e, null, shipped)) owned[name] = e;
            }
            mergeCodexTomlMcpServers(file, { ...owned, ...master.mcpServers });
        } catch (e) {
            log.warn(`Could not add the tauri-pilot MCP server to ${file}: ${e.message}`);
        }
    }
    log.step('Registered the tauri-pilot MCP server (direct, not behind the gateway) in the harness MCP configs.');
}

// Copies vendor/<pkg>/skills/* to ~/.agents/skills and every detected harness; true when ~/.agents/skills got them.
function installVendorSkills(pkg, label) {
    const skillsBase = path.join(srcDir, 'vendor', pkg, 'skills');
    if (!fs.existsSync(skillsBase)) {
        log.warn(`${label} skills not found at ${skillsBase}; skipping.`);
        return false;
    }
    const leaves = fs.readdirSync(skillsBase).filter((d) => fs.existsSync(path.join(skillsBase, d, 'SKILL.md')));
    if (DRY_RUN) {
        log.step(`[dry-run] would copy ${label} skills (${leaves.join(', ')}) to ~/.agents/skills and each detected harness`);
        return true;
    }
    const agentsSkills = path.join(homeDir, '.agents', 'skills');
    let agentsOk = false;
    for (const { dir: dest } of globalSkillDestinations({ ignorePluginCoverage: true })) {
        try {
            fs.mkdirSync(dest, { recursive: true });
            for (const dir of leaves) syncSkillEntry(path.join(skillsBase, dir), dir, dest, []);
            if (pkg === 'rustauri') uninstallRecords.recordSkillCopies(homeDir, pkg, leaves.map((d) => path.join(dest, d)));
            if (dest === agentsSkills) agentsOk = true;
            log.step(`Installed ${label} skills to ${dest}`);
        } catch (e) {
            log.warn(`Could not install ${label} skills to ${dest}: ${e.message}`);
        }
    }
    return agentsOk;
}

function installRustauri(deps = {}) {
    if (!installVendorSkills('rustauri', 'Rust + Tauri')) return false;
    if (DRY_RUN) {
        log.step(`[dry-run] would run \`${TAURI_PILOT_INSTALL_CMD}\` when cargo is on PATH and tauri-pilot ${TAURI_PILOT_VERSION} is not installed`);
        log.step('[dry-run] would register the tauri-pilot MCP server ({"command": "tauri-pilot", "args": ["mcp"]}) in every harness MCP config');
        return true;
    }
    ensureTauriPilotCli(deps);
    registerTauriPilotMcp();
    return true;
}

// StyleSeed (bitjaru/styleseed, MIT): the Toss design-language skills, opt-in since they assume that design system.
function installStyleseed() {
    return installVendorSkills('styleseed', 'StyleSeed');
}

function syncSkillsToGlobalHarnesses(excludeSkills = []) {
    const skillsBase = path.join(srcDir, 'skills');
    if (!fs.existsSync(skillsBase)) return;
    const extraSkillDestinations = globalSkillDestinations();

    retireCodexSkillCopies(_sessionManifest);
    retireStaleCodexPluginDir(_sessionManifest);
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

    // The secrets file has its own quoting rules, so it is read with its own parser (private files only).
    const stored = mcpSecrets.readSecretsFile(mcpSecrets.secretsPath(homeDir));
    for (const [k, v] of Object.entries(stored.vars)) if (v && !envData[k]) envData[k] = v;

    // ~/.openwiki/.env speaks the openwiki CLI's provider names; translate them back to AOS's.
    let ow = {};
    try { ow = mcpSecrets.parseEnvText(fs.readFileSync(path.join(homeDir, '.openwiki', '.env'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') logDebug(e, 'operation'); }
    const base = ow.OPENAI_COMPATIBLE_BASE_URL;
    const aosProvider = ow.OPENWIKI_PROVIDER === 'gemini' ? 'google'
        : ow.OPENWIKI_PROVIDER === 'openai-compatible' ? (Object.keys(OPENWIKI_CLI_PROVIDERS).find((p) => OPENWIKI_CLI_PROVIDERS[p].baseUrl && OPENWIKI_CLI_PROVIDERS[p].baseUrl === base) || 'custom')
            : ow.OPENWIKI_PROVIDER;
    if (aosProvider && OPENWIKI_CLI_PROVIDERS[aosProvider] && !envData.OPENWIKI_PROVIDER) {
        envData.OPENWIKI_PROVIDER = aosProvider;
        if (ow.OPENWIKI_MODEL_ID && !envData.OPENWIKI_MODEL_ID) envData.OPENWIKI_MODEL_ID = ow.OPENWIKI_MODEL_ID;
        if (base && !envData.OPENWIKI_BASE_URL) envData.OPENWIKI_BASE_URL = base;
        const keyName = PROVIDER_KEY_ENV_NAMES[aosProvider];
        const key = ow[OPENWIKI_CLI_PROVIDERS[aosProvider].key];
        if (keyName && key && !envData[keyName]) envData[keyName] = key;
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
    const existingModel = existingEnv['OPENWIKI_MODEL_ID'] || existingEnv['OPENWIKI_MODEL'] || '';
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

    // Stored values are reused, never asked again; only what is missing is prompted for.
    const haveOpenWiki = Boolean(existingGemini) || existingProvider === 'ollama';
    const stored = { gemini: existingGemini, github: existingGithub, openwikiProvider: existingProvider, openwikiModel: existingModel, openwikiBaseUrl: existingBaseUrl, keyEnvName: existingKeyEnvName };
    if (haveOpenWiki || existingGithub) {
        log.info('Integrations & Credentials (reusing stored values)');
        if (existingGemini) log.message(`${existingKeyEnvName}: ${maskApiKey(existingGemini)}`);
        if (existingGithub) log.message(`GITHUB_PERSONAL_ACCESS_TOKEN: ${maskApiKey(existingGithub)}`);
        log.message('To change a stored key or the provider, use `aos-config`.');
    }
    // Asked once per key ever: a blank answer is remembered (AOS_SKIPPED_KEYS), a value is stored at once.
    const askSecret = async (key, message) => {
        let backed = false;
        const r = await v5Secrets.need([key], {
            home: homeDir, legacy: existingEnv,
            ask: async () => { const v = await passwordWithBack({ message }); if (v === BACK) { backed = true; return null; } return String(v || ''); },
        });
        return backed ? BACK : r[key];
    };
    const ghMessage = 'GITHUB_PERSONAL_ACCESS_TOKEN for GitHub MCP (leave blank to skip) (< = back):';
    if (haveOpenWiki && existingGithub) return stored;
    if (haveOpenWiki) {
        const gh = await askSecret('GITHUB_PERSONAL_ACCESS_TOKEN', ghMessage);
        if (gh === BACK) return BACK;
        return { ...stored, github: gh };
    }

    // Model names change faster than this installer: no per-provider model lists, the model is free text.
    const provOptions = [
        { value: '1', label: 'Google AI Studio / Gemini' },
        { value: '2', label: 'Groq' },
        { value: '3', label: 'Grok / xAI' },
        { value: '4', label: 'NVIDIA NIM' },
        { value: '5', label: 'OpenRouter' },
        { value: '6', label: 'OpenAI' },
        { value: '7', label: 'Ollama / LM Studio – Local LLM (no API key, no cost)' },
        { value: '8', label: 'Custom OpenAI API / Base URL + API Key + Model' }
    ];

    const defaultsFor = (c) => {
        let provider = "google", baseUrl = "", keyEnvName = "GEMINI_API_KEY";
        const v = (c || '1').trim();
        if (v === "2")      { provider = "groq";       keyEnvName = "GROQ_API_KEY"; }
        else if (v === "3") { provider = "grok";       keyEnvName = "XAI_API_KEY"; }
        else if (v === "4") { provider = "nvidia";     keyEnvName = "NVIDIA_API_KEY"; baseUrl = "https://integrate.api.nvidia.com/v1"; }
        else if (v === "5") { provider = "openrouter"; keyEnvName = "OPENROUTER_API_KEY"; }
        else if (v === "6") { provider = "openai";     keyEnvName = "OPENAI_API_KEY"; }
        else if (v === "7") { provider = "ollama";     baseUrl = "http://localhost:11434/v1"; }
        else if (v === "8") { provider = "custom";     keyEnvName = "OPENWIKI_API_KEY"; }
        return { provider, baseUrl, keyEnvName };
    };

    let sub = 0;
    let choice = '1';
    let d = defaultsFor('1');
    let enteredModel = '', customBaseUrl = '', apiKey = '', github = '';
    // A provider is already stored but its key is missing: ask for the key only.
    const storedChoice = { google: '1', groq: '2', grok: '3', nvidia: '4', openrouter: '5', openai: '6' }[existingEnv['OPENWIKI_PROVIDER']];
    if (storedChoice) {
        choice = storedChoice;
        d = defaultsFor(choice);
        enteredModel = existingModel;
        customBaseUrl = existingBaseUrl;
        sub = 2;
    }

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

            const m = await textWithBack({
                message: `Model name (free text; blank = the OpenWiki daemon's own default) (< = back):`
            });
            if (m === BACK) { sub = 0; continue; }
            enteredModel = ((m || '') + '').trim();
            sub = 2;
            continue;
        }

        if (sub === 2) {
            if (d.provider !== "ollama") {
                const existingKey = existingEnv[d.keyEnvName] || existingEnv['GEMINI_API_KEY'] || '';
                const entered = await askSecret(d.keyEnvName, `${d.keyEnvName} for OpenWiki${existingKey ? ` (existing detected: ${maskApiKey(existingKey)}, leave blank to keep)` : ' (leave blank to skip)'} (< = back):`);
                if (entered === BACK) { sub = 1; continue; }
                apiKey = entered || existingKey;
            } else {
                apiKey = '';
            }
            sub = 3;
            continue;
        }

        const ghExisting = existingEnv['GITHUB_PERSONAL_ACCESS_TOKEN'] || existingEnv['GITHUB_TOKEN'] || '';
        if (ghExisting) { github = ghExisting; break; }
        const enteredGithub = await askSecret('GITHUB_PERSONAL_ACCESS_TOKEN', ghMessage);
        if (enteredGithub === BACK) { sub = 2; continue; }
        github = enteredGithub || ghExisting;
        break;
    }

    return {
        gemini: apiKey.trim(),
        github: github.trim(),
        openwikiProvider: d.provider,
        openwikiModel: enteredModel,
        openwikiBaseUrl: customBaseUrl || d.baseUrl,
        keyEnvName: d.keyEnvName
    };
}

const DAEMON_LOGON_FALLBACK_EXIT_CODE = 10;

// The daemon job points at these scripts for good, so they live in the installer-owned shared store
// (~/.agents/skills), which the plugin migration never retires, not in ~/.claude/skills.
function stableOpenWikiScripts() {
    const dest = path.join(homeDir, '.agents', 'skills', 'openwiki-skill');
    if (!fs.existsSync(path.join(dest, 'scripts', 'install_daemon.sh'))) {
        const src = path.join(srcDir, 'skills', 'global_config', 'openwiki-skill');
        if (fs.existsSync(src)) copyDirRecursiveSync(src, dest);
    }
    return path.join(dest, 'scripts');
}

// Same format check the openwiki 0.5.0 CLI applies to OPENWIKI_MODEL_ID (dist/config/constants.js isValidModelId).
// The CLI accepts custom ids per provider, so there is no closed list to compare against.
function isValidOpenWikiModelId(id) {
    const m = String(id || '').trim();
    return m.length > 0 && m.length <= 120 && /^[@A-Za-z0-9][A-Za-z0-9._:/@+,-]*$/u.test(m) && !m.includes('://');
}

// AOS daemon provider name -> openwiki CLI provider and the env vars that CLI reads.
const OPENWIKI_CLI_PROVIDERS = {
    google:     { provider: 'gemini',            key: 'GEMINI_API_KEY' },
    openai:     { provider: 'openai',            key: 'OPENAI_API_KEY' },
    openrouter: { provider: 'openrouter',        key: 'OPENROUTER_API_KEY' },
    nvidia:     { provider: 'nvidia',            key: 'NVIDIA_API_KEY' },
    groq:       { provider: 'openai-compatible', key: 'OPENAI_COMPATIBLE_API_KEY', baseUrl: 'https://api.groq.com/openai/v1' },
    grok:       { provider: 'openai-compatible', key: 'OPENAI_COMPATIBLE_API_KEY', baseUrl: 'https://api.x.ai/v1' },
    xai:        { provider: 'openai-compatible', key: 'OPENAI_COMPATIBLE_API_KEY', baseUrl: 'https://api.x.ai/v1' },
    ollama:     { provider: 'openai-compatible', key: 'OPENAI_COMPATIBLE_API_KEY', baseUrl: 'http://localhost:11434/v1' },
    lmstudio:   { provider: 'openai-compatible', key: 'OPENAI_COMPATIBLE_API_KEY', baseUrl: 'http://localhost:1234/v1' },
    custom:     { provider: 'openai-compatible', key: 'OPENAI_COMPATIBLE_API_KEY' },
};

// Merge-only: a key already present (non-empty) in ~/.openwiki/.env is never changed, and no
// value is written that we do not have. Returns the list of keys it added.
function writeOpenWikiEnv(apiKey, openwikiEnv = {}, envPath = path.join(homeDir, '.openwiki', '.env')) {
    const map = OPENWIKI_CLI_PROVIDERS[openwikiEnv.provider || 'google'];
    if (!map) return [];
    const want = { OPENWIKI_PROVIDER: map.provider };
    if (openwikiEnv.model) {
        if (isValidOpenWikiModelId(openwikiEnv.model)) want.OPENWIKI_MODEL_ID = openwikiEnv.model.trim();
        else log.warn(`OpenWiki model id "${openwikiEnv.model}" is not a valid model id (letters, digits and . _ : / @ + , - only, max 120 chars); OPENWIKI_MODEL_ID was not written.`);
    }
    const baseUrl = openwikiEnv.baseUrl || map.baseUrl;
    if (map.provider === 'openai-compatible' && baseUrl) want.OPENAI_COMPATIBLE_BASE_URL = baseUrl;
    if (apiKey) want[map.key] = apiKey;

    let existing = '';
    try { existing = fs.readFileSync(envPath, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') { logDebug(e, 'operation'); return []; } }
    const present = new Set();
    for (const line of existing.split(/\r?\n/)) {
        const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (m && m[2].replace(/^["']|["']$/g, '')) present.add(m[1]);
    }
    const added = Object.keys(want).filter((k) => !present.has(k));
    if (!added.length) return [];
    const q = (v) => (/^[A-Za-z0-9_.:/@+,-]*$/.test(v) ? v : JSON.stringify(v));
    const body = (existing && !existing.endsWith('\n') ? '\n' : '') + added.map((k) => `${k}=${q(want[k])}\n`).join('');
    try {
        fs.mkdirSync(path.dirname(envPath), { recursive: true, mode: 0o700 });
        fs.appendFileSync(envPath, body, { mode: 0o600 });
        try { fs.chmodSync(envPath, 0o600); } catch (e) { logDebug(e, 'operation'); }
    } catch (e) { logDebug(e, 'operation'); return []; }
    return added;
}

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
    const added = writeOpenWikiEnv(apiKey, openwikiEnv);
    if (added.length) log.step(`Wrote ${added.join(', ')} to ~/.openwiki/.env`);
    const s = spinner();
    s.start('Installing OpenWiki Daemon...');

    const scriptBase = stableOpenWikiScripts();

    const daemonEnv = Object.assign({}, process.env, {
        OPENWIKI_PROVIDER:  prov,
        OPENWIKI_MODEL:     openwikiEnv.model   || '',
        OPENWIKI_MODEL_ID:  openwikiEnv.model   || '',
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
        const child = spawn(command, args, { stdio: 'inherit', env: daemonEnv, windowsHide: true });
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
                    spawn(pythonCmd, [daemonPath, '--one-shot'], { detached: true, stdio: 'ignore', env: daemonEnv, windowsHide: true }).unref();
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
    if (!fs.existsSync(tokenSaverDir)) return false;
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
        return false;
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
                // npm.cmd needs ~2 s warm and more under load: the old 4 s limit reported a reachable registry as unreachable.
                const r = require('./lib/cli-spawn').run('npm', ['view', pkgName, 'version'], { timeout: 30000 });
                if (r.error || r.status !== 0) throw r.error || new Error(`npm view exited ${r.status}`);
                remoteVer = r.stdout.trim();
            } else {
                remoteVer = execFileSync(npmCmd, ['view', pkgName, 'version'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 15000, windowsHide: true }).trim();
            }
        } catch (e) {
            // Offline, a proxy, or a misconfigured registry. Swallowing this
            // made every module report "up to date" forever on such a machine,
            // indistinguishable from a real answer -- so say which one it is.
            checkFailed = true;
            logDebug(e, `npm view ${pkgName}`);
        }

        if (remoteVer && (!localVer || isNewerVersion(localVer, remoteVer))) {
            return { installed: true, updateAvailable: true, localVer, remoteVer, checkFailed };
        }
        return { installed: true, updateAvailable: false, localVer, remoteVer, checkFailed };
    } catch (e) {
        return { installed: true, updateAvailable: false, localVer: null, remoteVer: null, checkFailed: true };
    }
}

// Anything a module generated in place -- venvs, caches, local state -- is not in its tarball and must
// survive the staging swap in downloadOrUpdateModule.
const MODULE_PRESERVE = ['.venv', 'venv', 'node_modules', '.env', 'data', 'logs'];
// Move preserved entries from one tree to another; an entry that already exists there stays put.
function movePreserved(fromDir, toDir) {
    for (const keep of MODULE_PRESERVE) {
        const from = path.join(fromDir, keep);
        if (!fs.existsSync(from) || fs.existsSync(path.join(toDir, keep))) continue;
        try { fs.renameSync(from, path.join(toDir, keep)); } catch (moveErr) { logDebug(moveErr, `preserve ${keep}`); }
    }
}
// Stale .incoming-*/.previous-* dirs of an interrupted swap may hold the preserved .env/data/logs (or the
// whole old tree): move those into targetDir, newest first, before the dirs are deleted (S1-1).
function recoverStaleSwaps(targetDir) {
    try {
        const parentDir = path.dirname(targetDir);
        const baseName = path.basename(targetDir);
        if (!fs.existsSync(parentDir)) return;
        fs.mkdirSync(targetDir, { recursive: true });
        const stamp = (item) => item.slice(item.lastIndexOf('-') + 1);
        const stale = fs.readdirSync(parentDir)
            .filter((item) => item.startsWith(`${baseName}.incoming-`) || item.startsWith(`${baseName}.previous-`))
            .sort((a, b) => stamp(b).localeCompare(stamp(a)));
        for (const item of stale) {
            movePreserved(path.join(parentDir, item), targetDir);
            safeRmDirSync(path.join(parentDir, item));
        }
    } catch (_) {}
}

const { renameWithRetry } = require('./lib/rename-retry.js');
const { stopModuleProcesses, isServiceModule } = require('./lib/stop-module-processes.js');
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

        recoverStaleSwaps(targetDir);

        safeRmDirSync(stagingDir);
        fs.mkdirSync(stagingDir, { recursive: true });
        const tar = tarExtractArgs(path.join(targetDir, tarball), stagingDir);
        execFileSync('tar', tar.args, { cwd: tar.cwd, stdio: 'ignore', windowsHide: true });
        fs.unlinkSync(path.join(targetDir, tarball));

        movePreserved(targetDir, stagingDir);

        // Phase 1: retire the live tree. On Windows a running service holds the directory: renameWithRetry backs off,
        // then, for a service module, stops only the processes that run from this directory (AOS_NO_STOP_SERVICES=1 opts
        // out) and tries again; otherwise it fails with a clear "locked" reason. The module's own step starts its service again.
        try {
            renameWithRetry(targetDir, retiredDir, {
                module: path.basename(targetDir).replace(/^bdb-/, ''),
                release: isServiceModule(targetDir) ? () => {
                    const stopped = stopModuleProcesses(targetDir);
                    if (stopped.length) log.warn(`${displayName}: stopped ${stopped.length} running process${stopped.length === 1 ? '' : 'es'} (${[...new Set(stopped.map((p) => p.Name))].join(', ')}) that held ${targetDir}`);
                    return stopped.length > 0;
                } : undefined,
            });
        } catch (retireError) {
            // The live tree stayed in place: give it its preserved entries back before staging goes.
            movePreserved(stagingDir, targetDir);
            safeRmDirSync(stagingDir);
            throw retireError;
        }

        // Phase 2: promote the staging tree. stagingDir was just unpacked and
        // has no open handles, so a single attempt is sufficient.
        try {
            fs.renameSync(stagingDir, targetDir);
        } catch (promoteError) {
            try { fs.renameSync(retiredDir, targetDir); } catch (_) {}
            // Only delete staging once the preserved entries are back; if the old tree could not be
            // restored either, keep staging so the next run's sweep can recover them.
            if (fs.existsSync(targetDir)) {
                movePreserved(stagingDir, targetDir);
                safeRmDirSync(stagingDir);
            }
            throw promoteError;
        }

        // On Windows especially, deleting a directory that was just renamed or contains
        // locked file handles can throw EPERM / EBUSY. Since targetDir already has the
        // new version in place, failure to clean up retiredDir must be non-fatal.
        safeRmDirSync(retiredDir);

        let installedVer = '';
        try { installedVer = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf8')).version || ''; } catch { /* shown without a version */ }
        s.stop(installedVer ? `${displayName} ready (v${installedVer})` : `${displayName} ready`);
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

const { DEJA_VERSION } = require('./lib/v5/pins.js');

async function installDeja() {
    if (DRY_RUN) {
        log.step(`[dry-run] would install deja-vu ${DEJA_VERSION} globally and add its exclude pattern`);
        return;
    }
    try {
        log.step('Installing deja-vu session memory...');
        execSync(`npm install -g @vshulcz/deja-vu@${DEJA_VERSION}`, { stdio: 'ignore', windowsHide: true });
        uninstallRecords.recordNpmGlobal(homeDir, '@vshulcz/deja-vu');
    } catch (e) {
        log.warn(`deja-vu install failed. Install later with: npm install -g @vshulcz/deja-vu@${DEJA_VERSION}`);
    }
    const dejaOnPath = hasExecutable('deja');
    if (!dejaOnPath) {
        log.warn(`deja is not on PATH. Install it with: npm install -g @vshulcz/deja-vu@${DEJA_VERSION}`);
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
    return dejaOnPath ? undefined : false;
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
    // On Windows the memB WebUI process holds open file handles inside membDir.
    // The atomic rename inside downloadOrUpdateModule fails with EPERM as long as
    // those handles are live — retry backoff cannot help. Kill the process on
    // port 8088 before attempting the download so the rename succeeds.
    if (process.platform === 'win32') {
        try {
            execSync(
                'powershell -NoProfile -Command "' +
                'Get-NetTCPConnection -LocalPort 8088 -ErrorAction SilentlyContinue |' +
                ' Select-Object -ExpandProperty OwningProcess |' +
                ' ForEach-Object { $p = Get-CimInstance Win32_Process -Filter (\'ProcessId=\' + $_);' +
                ' $o = Invoke-CimMethod -InputObject $p -MethodName GetOwner -ErrorAction SilentlyContinue;' +
                ' if ($o -and $o.User -and ($o.Domain + \'\\\' + $o.User) -eq ($env:USERDOMAIN + \'\\\' + $env:USERNAME)) { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"',
                { stdio: 'ignore', windowsHide: true }
            );
        } catch (_) {}
    }
    // A failed download used to fall through into venv setup and daemon
    // registration, each of which then failed on its own terms or, worse,
    // "succeeded" against a stale tree -- and the run still ended in a success
    // banner. Stop at the module that could not be fetched.
    if (!downloadOrUpdateModule('@hybridlabor-api/memb', membDir, 'memB Vector Engine')) {
        log.warn('Skipping memB setup: the module could not be downloaded.');
        return false;
    }
    await installDeja();
    if (DRY_RUN) {
        log.step('[dry-run] would bootstrap memB venv + pip requirements');
        return;
    }

    let membOk = true;
    const reqFile = path.join(membDir, 'requirements.txt');
    const serverPy = path.join(membDir, 'src', 'backend', 'server.py');
    if (fs.existsSync(reqFile)) {
        try {
            const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
            const venvPython = process.platform === 'win32'
                ? path.join(membDir, '.venv', 'Scripts', 'python.exe')
                : path.join(membDir, '.venv', 'bin', 'python');

            const createdViaUv = Boolean(ensurePythonVenv(membDir).viaUv);

            // `uv venv --seed` is supposed to seed pip/setuptools/wheel into the venv, but
            // this has been observed to silently under-deliver (venv created, pip missing) --
            // when that happens every `-m pip install` call below fails with "No module named
            // pip". `uv pip install --python <venv>` never needs pip present in the venv at
            // all, so prefer it whenever uv itself is on PATH, regardless of which tool
            // actually created the venv -- it's a strictly more reliable install path.
            let hasUv = createdViaUv;
            if (!hasUv) {
                try { execSync(`"${uvBin()}" --version`, { stdio: 'ignore', windowsHide: true }); hasUv = true; } catch (e) { hasUv = false; }
            }
            if (!hasUv && fs.existsSync(venvPython)) {
                try {
                    execSync(`"${venvPython}" -m pip --version`, { stdio: 'ignore', windowsHide: true });
                } catch (_) {
                    try {
                        execSync(`"${venvPython}" -m ensurepip --default-pip`, { cwd: membDir, stdio: 'ignore', windowsHide: true });
                    } catch (ePip) {
                        logDebug(ePip, 'ensurepip bootstrap for memB');
                    }
                }
            }
            const uvInstall = (pkgsArg) => `"${uvBin()}" pip install --python "${venvPython}" ${pkgsArg}`;
            const pipInstall = (pkgsArg) => `"${venvPython}" -m pip install ${pkgsArg} --timeout 30 --no-input`;
            const installCmd = (pkgsArg) => hasUv ? uvInstall(pkgsArg) : pipInstall(pkgsArg);

            runPipWithRetry(installCmd('--upgrade setuptools'), { cwd: membDir, stdio: 'ignore' }, 'pip setuptools for memB standalone', 2, 120000);
            const reconcile = reconcileMembVenv(membDir, { venvPython, hasUv });
            if (reconcile.status === 'failed') log.warn('memB requirements reconcile failed; inspect the venv before starting the daemon.');

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
                    membOk = false;
                }
            }
        } catch (e) {
            log.warn(`Failed memB standalone venv setup: ${e.message}`);
            membOk = false;
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
                if (v5Profile.isTestSandbox(homeDir)) {
                    log.success('memB WebUI LaunchAgent active (Port 8088)');
                } else {
                    reloadLaunchAgent(plistPath);
                    const isListening = await verifyDaemonListening(8088, 'memB WebUI');
                    if (isListening) {
                        log.success('memB WebUI LaunchAgent active (Port 8088)');
                    } else {
                        log.warn('memB WebUI daemon did not respond on Port 8088 within timeout. You may need to start it manually or check for port conflicts.');
                    }
                }
            } catch (e) { logDebug(e, 'operation'); }
        } else if (process.platform === 'linux') {
            // Same program, working dir and logs as the launchd plist above.
            const venvPython = path.join(membDir, '.venv', 'bin', 'python');
            const unitName = 'com.bdb.memb.webui.service';
            try {
                fs.mkdirSync(path.join(homeDir, '.memb'), { recursive: true });
                const unitFile = systemdUnits.unitPath(homeDir, unitName);
                fs.mkdirSync(path.dirname(unitFile), { recursive: true });
                fs.writeFileSync(unitFile, systemdUnits.buildUserUnit({
                    description: 'memB WebUI',
                    execStart: [venvPython, serverPy],
                    workingDirectory: path.join(membDir, 'src', 'backend'),
                    restart: 'always',
                    logOut: path.join(homeDir, '.memb', 'webui.stdout.log'),
                    logErr: path.join(homeDir, '.memb', 'webui.stderr.log'),
                }));
                await systemdUnits.enableUnit(async (cmd, args) => {
                    execFileSync(cmd, args, { stdio: 'ignore', windowsHide: true });
                    return { ok: true };
                }, unitName);
                const isListening = await verifyDaemonListening(8088, 'memB WebUI');
                if (isListening) {
                    log.success('memB WebUI systemd user unit active (Port 8088)');
                } else {
                    log.warn('memB WebUI daemon did not respond on Port 8088 within timeout. You may need to start it manually or check for port conflicts.');
                }
            } catch (e) { logDebug(e, 'linux memb unit'); }
        } else if (process.platform === 'win32') {
            const venvPython = path.join(membDir, '.venv', 'Scripts', 'python.exe');
            const startupDir = path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
            const vbsPath = path.join(startupDir, 'com.bdb.memb.webui.vbs');
            const workingDir = path.join(membDir, 'src', 'backend');
            const vbsContent = `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.CurrentDirectory = "${workingDir}"\r\nWshShell.Run """${venvPython}"" ""${serverPy}""", 0, False\r\n`;
            try {
                fs.mkdirSync(startupDir, { recursive: true });
                fs.writeFileSync(vbsPath, vbsContent, 'utf-8');
                spawn('wscript.exe', [vbsPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
                const isListening = await verifyDaemonListening(8088, 'memB WebUI');
                if (isListening) {
                    log.success('memB WebUI Windows Background Service registered & started (Port 8088)');
                } else {
                    log.warn('memB WebUI Windows daemon did not respond on Port 8088 within timeout. You may need to start it manually or check for port conflicts.');
                }
            } catch (e) { logDebug(e, 'windows memb daemon setup'); }
        }
    }
    // Memory import job (supervised by launchd / systemd): only exists when the user set a time (`aos memory set-time`).
    if (membOk && !DRY_RUN) {
        try {
            const job = await require('./lib/memory-import').applyJob(homeDir);
            if (job.file) log.success(`memB memory import job active (${path.basename(job.file)})`);
        } catch (e) { logDebug(e, 'memb memory import job'); }
    }
    return membOk;
}

// Never downloads a binary: only what the package itself ships is linked.
function findSynapseBinary(synapseDir, platform = process.platform, arch = process.arch) {
    const goArch = { x64: 'amd64', arm64: 'arm64', ia32: '386' }[arch] || arch;
    const osName = platform === 'win32' ? 'windows' : platform;
    const names = platform === 'win32'
        ? ['synapse.exe', `synapse-windows-${goArch}.exe`, 'synapse.js']
        : ['synapse', `synapse-${osName}-${goArch}`];
    for (const n of names) {
        const candidate = path.join(synapseDir, 'bin', n);
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

function describeMissingSynapseBinary(synapseDir, platform = process.platform, arch = process.arch) {
    const head = `Synapse: the package ships no binary for ${platform}/${arch} in ${path.join(synapseDir, 'bin')}.`;
    if (fs.existsSync(path.join(synapseDir, 'cmd', 'synapse'))) {
        const out = platform === 'win32' ? 'synapse.exe' : 'synapse';
        return `${head} Build it locally with Go (https://go.dev/dl/): cd "${synapseDir}" && go build -o bin/${out} ./cmd/synapse/ -- then re-run the installer.`;
    }
    return `${head} The package has no Go sources either, so it cannot be built here. Skipping Synapse; use a platform the package supports or ask the Synapse maintainers for a ${platform}/${arch} build.`;
}

async function installSynapse() {
    const synapseDir = path.join(moduleBasePath(), 'bdb-synapse');
    if (!downloadOrUpdateModule('@hybridlabor-api/bdb-synapse', synapseDir, 'BDB Synapse')) {
        log.warn('Skipping Synapse setup: the module could not be downloaded.');
        return false;
    }
    if (DRY_RUN) {
        log.step('[dry-run] would link synapse binary into ~/.local/bin/synapse + setup background daemon');
        return;
    }

    const isWin = process.platform === 'win32';
    const binaryPath = findSynapseBinary(synapseDir);

    if (binaryPath) {
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
        <string>--no-open</string>
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
                if (v5Profile.isTestSandbox(homeDir)) {
                    log.success('Synapse 3D LaunchAgent active (Port 7781)');
                } else {
                    reloadLaunchAgent(plistPath);
                    const isListening = await verifyDaemonListening(7781, 'Synapse 3D');
                    if (isListening) {
                        log.success('Synapse 3D LaunchAgent active (Port 7781)');
                    } else {
                        log.warn('Synapse 3D daemon did not respond on Port 7781 within timeout. You may need to start it manually or check for port conflicts.');
                    }
                }
            } catch (e) { logDebug(e, 'synapse plist setup'); }
        } else if (process.platform === 'linux') {
            // Same program, args, working dir and logs as the launchd plist above.
            const unitName = 'com.bdb.synapse.service';
            try {
                fs.mkdirSync(path.join(homeDir, '.synapse'), { recursive: true });
                const unitFile = systemdUnits.unitPath(homeDir, unitName);
                fs.mkdirSync(path.dirname(unitFile), { recursive: true });
                fs.writeFileSync(unitFile, systemdUnits.buildUserUnit({
                    description: 'Synapse 3D',
                    execStart: binaryPath.endsWith('.js') ? [process.execPath, binaryPath, 'serve', '--port', '7781', '--no-open'] : [binaryPath, 'serve', '--port', '7781', '--no-open'],
                    workingDirectory: synapseDir,
                    restart: 'always',
                    logOut: path.join(homeDir, '.synapse', 'daemon.stdout.log'),
                    logErr: path.join(homeDir, '.synapse', 'daemon.stderr.log'),
                }));
                await systemdUnits.enableUnit(async (cmd, args) => {
                    execFileSync(cmd, args, { stdio: 'ignore', windowsHide: true });
                    return { ok: true };
                }, unitName);
                const isListening = await verifyDaemonListening(7781, 'Synapse 3D');
                if (isListening) {
                    log.success('Synapse 3D systemd user unit active (Port 7781)');
                } else {
                    log.warn('Synapse 3D daemon did not respond on Port 7781 within timeout. You may need to start it manually or check for port conflicts.');
                }
            } catch (e) { logDebug(e, 'linux synapse unit'); }
        } else if (process.platform === 'win32') {
            const startupDir = path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
            fs.mkdirSync(startupDir, { recursive: true });
            const synapseLogDir = path.join(homeDir, '.synapse');
            fs.mkdirSync(synapseLogDir, { recursive: true });
            const stdoutLog = path.join(synapseLogDir, 'daemon.stdout.log');
            const stderrLog = path.join(synapseLogDir, 'daemon.stderr.log');
            const batPath = path.join(synapseLogDir, 'run-synapse.bat');
            const runCmd = binaryPath.endsWith('.js') ? `node "${binaryPath}" serve --port 7781 --no-open` : `"${binaryPath}" serve --port 7781 --no-open`;
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
                spawn('wscript.exe', [vbsPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
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
        log.warn(describeMissingSynapseBinary(synapseDir));
        return false;
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
        if (v5Profile.isTestSandbox(homeDir)) installCli = false;
        if (installCli) {
            try {
                log.step('Installing OpenWiki CLI globally (npm install -g openwiki@latest)...');
                execSync('npm install -g openwiki@latest', { stdio: 'ignore', windowsHide: true });
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
            openwikiBin = execFileSync('where.exe', ['openwiki'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).split(/\r?\n/)[0].trim() || 'openwiki';
        } else {
            openwikiBin = execSync('command -v openwiki', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).split(/\r?\n/)[0].trim() || 'openwiki';
        }
    } catch (e) { logDebug(e, 'openwiki path lookup'); }

    // The openwiki CLI is a Node script (#!/usr/bin/env node shebang). Under
    // launchd's minimal PATH there is no node either, so the agent died with
    // "env: node: No such file or directory" (exit 127) on every boot until
    // the interpreter itself is baked in as an absolute path.
    let nodeBin = 'node';
    try {
        if (process.platform === 'win32') {
            nodeBin = execFileSync('where.exe', ['node'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).split(/\r?\n/)[0].trim() || 'node';
        } else {
            nodeBin = execSync('command -v node', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).split(/\r?\n/)[0].trim() || 'node';
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
                execSync(`"${pyBin}" "${syncScript}"`, { stdio: 'ignore', windowsHide: true });
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
            if (v5Profile.isTestSandbox(homeDir)) {
                log.success('OpenWiki Visualizer LaunchAgent active (Port 4321)');
            } else {
                reloadLaunchAgent(plistPath);
                const isListening = await verifyDaemonListening(4321, 'OpenWiki Visualizer');
                if (isListening) {
                    log.success('OpenWiki Visualizer LaunchAgent active (Port 4321)');
                } else {
                    log.warn('OpenWiki Visualizer daemon did not respond on Port 4321 within timeout. You may need to start it manually or check for port conflicts.');
                }
            }
        } catch (e) { logDebug(e, 'openwiki visualizer plist setup'); }
    } else if (process.platform === 'linux') {
        // Same program, args, working dir and logs as the launchd plist above (com.bdb.openwiki-visualize).
        const unitName = 'com.bdb.openwiki-visualize.service';
        try {
            fs.mkdirSync(path.join(homeDir, '.openwiki'), { recursive: true });
            const unitFile = systemdUnits.unitPath(homeDir, unitName);
            fs.mkdirSync(path.dirname(unitFile), { recursive: true });
            const unit = systemdUnits.buildUserUnit({
                description: 'OpenWiki Visualizer',
                execStart: wikiPath ? [nodeBin, openwikiBin, 'visualize', wikiPath, '--port', '4321', '--no-open'] : [nodeBin, openwikiBin, 'visualize', '--port', '4321', '--no-open'],
                workingDirectory: homeDir,
                restart: 'always',
                logOut: path.join(homeDir, '.openwiki', 'visualize.stdout.log'),
                logErr: path.join(homeDir, '.openwiki', 'visualize.stderr.log'),
            });
            fs.writeFileSync(unitFile, unit);
            await systemdUnits.enableUnit(async (cmd, args) => {
                execFileSync(cmd, args, { stdio: 'ignore', windowsHide: true });
                return { ok: true };
            }, unitName);
            const isListening = await verifyDaemonListening(4321, 'OpenWiki Visualizer');
            if (isListening) {
                log.success('OpenWiki Visualizer systemd user unit active (Port 4321)');
            } else {
                log.warn('OpenWiki Visualizer daemon did not respond on Port 4321 within timeout. You may need to start it manually or check for port conflicts.');
            }
        } catch (e) { logDebug(e, 'linux openwiki visualizer unit'); }
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
            spawn('wscript.exe', [vbsPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
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
        return false;
    }
    if (DRY_RUN) {
        log.step('[dry-run] would run BDB Creator Extension setup');
        return;
    }
    const installerScript = path.join(creatorDir, 'installer.js');
    if (fs.existsSync(installerScript)) {
        const setupResult = DRY_RUN
            ? { status: 0 }
            : spawnSync('node', [installerScript, '--auto'], { stdio: 'pipe', cwd: creatorDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
        // Piped, then written through process.stdout/stderr: the v5 update step redirects those into its log file.
        if (setupResult.stdout) process.stdout.write(setupResult.stdout);
        if (setupResult.stderr) process.stderr.write(setupResult.stderr);
        if (setupResult.status !== 0) {
            const optional = require('./lib/v5/creator-failures').optionalOnlyWarning(`${setupResult.stdout || ''}\n${setupResult.stderr || ''}`);
            if (optional) { log.warn(`Creator Extension: ${optional}`); return optional; }
            log.warn(`Creator Extension setup note: exit code ${setupResult.status}`);
            return false;
        }
    }
}

// Removes kicad/openscad entries the hardware module registered in harness configs whose
// backing app is absent. The module's installer.js always registers both; this is the
// AOS-side gate, so an entry never points at a launcher that cannot start. Idempotent:
// an entry that is not there makes no change. Works like retireMcpServers: only entries
// AOS ships/registered are removed — a same-named user entry (a command that is not one of
// the hardware module's runner scripts and is not a shipped template shape) survives and
// triggers warnUserMcpEntry. Returns the removed [file, name] pairs.
function stripHwMcpEntries(serverNames, { home = homeDir } = {}) {
    const removed = [];
    const warnUser = (file) => warnUserMcpEntry(file);
    // The plain shipped template does not list the hw servers; they live in the module's own
    // install dir (bdb-hardware-pcb/scripts/run_*_mcp.*). isAosOwned covers them if a template
    // ever does; the runner-script match is the ownership rule that matters today.
    const shipped = mcpShipped();
    const hwOwned = (name, entry) => {
        if (!entry || typeof entry !== 'object') return false;
        if (mcpSecrets.isAosOwned(name, entry, null, shipped)) return true;
        const u = mcpSecrets.unwrap(entry);
        return typeof u.command === 'string'
            && /(^|[\\/])bdb-hardware-pcb([\\/]|$)/.test(u.command)
            && /(^|[\\/])run_(kicad|openscad)_mcp/.test(u.command);
    };
    const removeJson = (file, warnTag = file) => {
        if (!fs.existsSync(file)) return;
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            let changed = false;
            for (const name of serverNames) {
                if (data && data.mcpServers && typeof data.mcpServers === 'object' && data.mcpServers[name]) {
                    if (!hwOwned(name, data.mcpServers[name])) { warnUser(warnTag)(name); continue; }
                    delete data.mcpServers[name];
                    removed.push([file, name]);
                    changed = true;
                }
            }
            if (changed) {
                // Temp file in the same directory + rename: a crash mid-write cannot destroy the config.
                writeFileAtomic(file, JSON.stringify(data, null, 2) + '\n');
            }
        } catch (e) { logDebug(e, `strip hw entry (${path.basename(file)})`); }
    };
    removeJson(path.join(home, '.claude.json'));
    // agy keeps one config; the antigravity-cli variant is a link on the same inode.
    removeJson(path.join(home, '.gemini', 'config', 'mcp_config.json'), 'agy-mcp_config');
    // Codex keeps its own entries where the user put them: drop these two by table name, but
    // only when the table's command/args say AOS (or the hw module) wrote them.
    const codexToml = path.join(home, '.codex', 'config.toml');
    if (fs.existsSync(codexToml)) {
        try {
            const lines = fs.readFileSync(codexToml, 'utf8').split(/\r?\n/);
            const want = new Set(serverNames.map(String));
            const droppedNames = [];
            const drop = (name, sec) => {
                if (!want.has(name)) return false;
                const t = mcpSecrets.parseCodexTables(sec.join('\n'))[name];
                const entry = t && { command: t.fields.command, args: t.fields.args };
                if (!entry || !hwOwned(name, entry)) { warnUser(codexToml)(name); return false; }
                droppedNames.push(name);
                return true;
            };
            const stripped = uninstallRecords.dropMcpTables(lines, drop);
            if (stripped.length !== lines.length) {
                fs.writeFileSync(codexToml, stripped.join('\n'));
                for (const name of serverNames) if (droppedNames.includes(name)) removed.push([codexToml, name]);
            }
        } catch (e) { logDebug(e, 'strip hw entry (config.toml)'); }
    }
    return removed;
}

async function installHardwarePcb() {
    const hwDir = path.join(moduleBasePath(), 'bdb-hardware-pcb');
    if (!downloadOrUpdateModule('@hybridlabor-api/bdb-hardware-pcb', hwDir, 'BDB Hardware & PCB (KiCad + OpenSCAD)')) {
        log.warn('Skipping Hardware & PCB setup: the module could not be downloaded.');
        return false;
    }
    if (DRY_RUN) {
        log.step('[dry-run] would run BDB Hardware & PCB setup');
        return;
    }
    // The published package once shipped prebuilt .venv trees whose interpreter
    // shebang points at a python that does not exist on this machine ("bad
    // interpreter"). A venv dir with a dangling `bin/python` link must not stand
    // between the launcher and its dependency install: run `uv sync` per server
    // dir before the module installer registers the launchers.
    const needsSync = hardwareApps.hwServerDirsNeedingSync(hwDir);
    for (const serverDir of needsSync) {
        log.step(`Hardware & PCB: venv python missing in ${path.basename(serverDir)} — running uv sync (explicit uv path: ${uvBin()}).`);
        const res = spawnSync(uvBin(), ['sync'], { cwd: serverDir, stdio: 'ignore', timeout: 600000, windowsHide: true });
        if (res.error || res.status !== 0) {
            log.warn(`uv sync failed for ${path.basename(serverDir)}${res.error ? ` (${res.error.message})` : ` (exit ${res.status})`}. The MCP launcher may fall back to 'uv run', which needs uv on the harness's PATH.`);
        }
    }
    const installerScript = path.join(hwDir, 'installer.js');
    if (fs.existsSync(installerScript)) {
        const setupResult = spawnSync('node', [installerScript, '--auto'], { stdio: 'inherit', cwd: hwDir, windowsHide: true });
        if (setupResult.status !== 0) {
            log.warn(`Hardware & PCB setup note: exit code ${setupResult.status}`);
            return false;
        }
    }
    // Gate: the module registered both servers; undo the registrations whose app
    // is absent, with a plain notice. Kept after the module run because the
    // module itself offers no skip switch.
    const statuses = { kicad: hardwareApps.hwAppStatus('kicad'), openscad: hardwareApps.hwAppStatus('openscad') };
    const gate = hardwareApps.hwAppGate(statuses);
    if (gate.skip.length) {
        for (const appId of gate.skip) {
            log.warn(`${hardwareApps.appMissingMessage(appId)} — the '${appId}' MCP server is not registered (install the app and re-run the AOS installer to enable it).`);
        }
        const removed = stripHwMcpEntries(gate.skip);
        if (removed.length && !DRY_RUN) log.step(`Removed ${gate.skip.join(' and ')} MCP entries from ${[...new Set(removed.map(([f]) => path.basename(f)))].join(', ')}.`);
    }
}

// Codebase Memory MCP is third-party (DeusData/codebase-memory-mcp): a self-contained
// stdio binary with a local SQLite DB and no install-time download from AOS. The MCP
// entry is not written here; it comes from the one-MCP-per-app pick (mcp_picks.json,
// candidate gated on the binary), so a machine without the binary gets nothing registered.
// Picking the module (or --modules=codebase-memory) is an explicit "yes, coding": same path as --coding.
async function installCodebaseMemory() {
    await applyCodingModeStep({ flag: true });
    const status = codebaseMemory.cmbAppStatus();
    if (status.found) log.step(`Codebase Memory MCP: binary at ${status.path}; the codebase_memory_mcp MCP entry is registered with the next harness MCP sync.`);
}

// "Do you use AOS for coding?" -- asked once (interactive only), stored as codingMode in v5-settings.json.
// --coding / --no-coding set it; non-interactive runs never prompt. Never aborts the install.
async function applyCodingModeStep({ flag } = {}) {
    try {
        await codebaseMemory.applyCodingMode({
            settings: v5Profile.readSettings(homeDir),
            save: (s) => { if (!DRY_RUN) v5Profile.writeSettings(homeDir, s); },
            flag: flag !== undefined ? flag : codebaseMemory.parseCodingFlag(process.argv),
            // stdin must be a TTY too, and CI never prompts (a pty-allocating runner is still CI).
            interactive: !isAutoYes && Boolean(process.stdin.isTTY) && !process.env.CI,
            ask: async (message) => { const a = await askConfirm({ message, initialValue: false }); return isCancel(a) ? undefined : Boolean(a); },
            run: (cmd) => runNpmWithRetry(cmd, {}, 'install codebase-memory-mcp'),
            warn: (m) => log.warn(m),
            step: (m) => log.step(m),
        });
    } catch (e) {
        log.warn(`Coding mode step skipped: ${e.message}`);
    }
}

// With unified memory, a coding tool on this machine (binary or app, never a config AOS wrote) answers
// "Do you use AOS for coding?" with yes. --coding/--no-coding and an answer already stored win.
function memoryCodingOptions() {
    if (!memoryOn || codebaseMemory.parseCodingFlag(process.argv) !== undefined) return {};
    if (typeof v5Profile.readSettings(homeDir).codingMode === 'boolean') return {};
    const tools = detectPlatforms().filter((d) => !d.chosen && d.key !== 'claudedesktop');
    return tools.length ? { flag: true } : {};
}

// The interactive "skip unified memory" answer is saved like --without=memory, so update, repair,
// --hooks-only and the gateway keep memb_mcp, deja and memb-inject unwired too.
function declineUnifiedMemory() {
    for (const id of v5Profile.BUNDLES.memory) installExcluded.add(id);
    if (DRY_RUN) return;
    try {
        const st = v5Profile.readSettings(homeDir);
        v5Profile.writeSettings(homeDir, { ...st, disabled: [...new Set([...st.disabled, ...v5Profile.BUNDLES.memory])] });
    } catch (e) {
        log.warn(`Could not save the unified memory choice: ${e.message}`);
    }
}

async function installOSRemoteGateway() {
    const remoteDir = path.join(moduleBasePath(), 'bdb-os-remote');
    if (!downloadOrUpdateModule('@hybridlabor-api/bdb-os-remote', remoteDir, 'BDB OS Remote Gateway')) {
        log.warn('Skipping OS Remote Gateway setup: the module could not be downloaded.');
        return false;
    }
}

async function installDevToolInstaller() {
    const toolInstallerDir = path.join(moduleBasePath(), 'bdb-dev-tool-installer');
    if (!downloadOrUpdateModule('@hybridlabor-api/bdb-dev-tool-installer', toolInstallerDir, 'BDB Dev Tool Installer')) {
        log.warn('Skipping Dev Tool Installer setup: the module could not be downloaded.');
        return false;
    }
}

// AO is fully supported across macOS (arm64, amd64), Linux (amd64, arm64), and Windows (amd64).
function aoSupportedHere() {
    return ['darwin', 'linux', 'win32'].includes(process.platform);
}

const AO_PKG = '@hybridlabor-api/bdb-agent-orchestrator';
// `ao service install` restarts the daemon; it can take well over 8s to bind.
const AO_DAEMON_WAIT_MS = 30000;

function aoBinTarget() {
    return process.platform === 'win32'
        ? path.join(process.env.LOCALAPPDATA || homeDir, 'Programs', 'ao', 'ao.exe')
        : path.join(homeDir, '.local', 'bin', 'ao');
}

const { readGoBuildInfo, parseGoBuildInfo } = require('./lib/go-buildinfo.js');

// Never trade the installed ao for a build that is not provably newer and clean.
// allowDirty: the AOS_AO_DEV_BUILD opt-in. daemonRunning/candidateIsRelease
// only matter when the installed binary's revision is unreadable: a clean
// published release may then replace it, but not while some daemon of unknown
// build is running.
function decideAoInstall({ installedExists, installed, candidate, allowDirty = false, candidateIsRelease = false, daemonRunning = true }) {
    if (!installedExists) return { install: true, reason: 'no ao installed yet' };
    if (!candidate) return { install: false, reason: 'the candidate build has no readable revision' };
    if (candidate.modified && !allowDirty) return { install: false, reason: `the candidate ${candidate.revision.slice(0, 9)} is a dirty build (vcs.modified=true)` };
    if (!installed) {
        if (candidateIsRelease && !candidate.modified && daemonRunning === false) {
            return { install: true, reason: `the installed binary's revision is unreadable and no daemon is running; installing the clean release ${candidate.revision.slice(0, 9)}` };
        }
        return { install: false, reason: 'the installed binary\'s revision is unreadable, so a downgrade cannot be ruled out' };
    }
    if (candidate.revision === installed.revision) return { install: false, reason: `already at ${installed.revision.slice(0, 9)}` };
    const c = Date.parse(candidate.time || '');
    const i = Date.parse(installed.time || '');
    if (!(c > i)) return { install: false, reason: `the candidate ${candidate.revision.slice(0, 9)} (${candidate.time || 'no date'}) is not newer than the installed ${installed.revision.slice(0, 9)} (${installed.time || 'no date'})` };
    return { install: true, reason: `${installed.revision.slice(0, 9)} -> ${candidate.revision.slice(0, 9)}` };
}

// A dev checkout is a release source only when clean and HEAD sits on a tag.
function checkAoWorkspace(dir, git = (args) => execFileSync('git', ['--no-optional-locks', '-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim()) {
    try {
        if (git(['status', '--porcelain'])) return { ok: false, reason: 'it has uncommitted or untracked changes' };
        let tag;
        try { tag = git(['describe', '--tags', '--exact-match', 'HEAD']); } catch { return { ok: false, reason: 'HEAD is not on a release tag' }; }
        return { ok: true, tag, head: git(['rev-parse', 'HEAD']) };
    } catch (e) {
        return { ok: false, reason: `git could not read it (${String(e.message).split('\n')[0]})` };
    }
}

// Builds into a temp dir: a build left in the checkout's gitignored backend/bin
// outlives every later pull and gets picked up as if it were current.
function buildAoFromSource(dir) {
    if (!hasExecutable('go') || !fs.existsSync(path.join(dir, 'backend', 'cmd', 'ao'))) return null;
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aos-ao-build-')), process.platform === 'win32' ? 'ao.exe' : 'ao');
    const s = spinner();
    s.start('Compiling AO daemon binary from Go source...');
    try {
        execFileSync('go', ['build', '-ldflags=-s -w', '-o', out, './cmd/ao'], { cwd: path.join(dir, 'backend'), stdio: 'ignore', windowsHide: true });
        s.stop('Compiled AO daemon binary successfully.');
        return out;
    } catch (e) {
        s.stop(`Failed to compile AO from source: ${e.message}`);
        return null;
    }
}

// Installed version = the release version the installer recorded for exactly
// the revision on disk. Never the dev workspace's package.json.
function trustedAoVersion(build, record) {
    return build && !build.modified && record && record.version && record.revision === build.revision ? record.version : null;
}

function describeAoVersion({ exists, build, record, latest }) {
    if (!exists) return { text: 'Not installed', updateAvailable: false };
    if (!build) return { text: 'Installed (build revision unreadable, version unknown)', updateAvailable: false };
    const rev = build.revision.slice(0, 9);
    if (build.modified) return { text: `Dev build ${rev} with uncommitted changes (not a release, version not comparable)`, updateAvailable: false };
    const version = trustedAoVersion(build, record);
    if (!version) return { text: `Build ${rev} (release version unknown)`, updateAvailable: false };
    if (latest && isNewerVersion(version, latest)) return { text: `Update available (v${version} ➔ v${latest})`, updateAvailable: true };
    return { text: `v${version} (Up to date)`, updateAvailable: false };
}

// The daemon's running.json (AO backend/internal/runfile: pid, port, startedAt).
// pid+startedAt tells a restarted daemon from the old one still on :3101.
function readAoDaemonIdentity(file = process.env.AO_RUN_FILE || path.join(homeDir, '.ao', 'running.json')) {
    const data = readJsonFile(file);
    if (!data || data.pid == null) return null;
    return data.startedAt ? `${data.pid}@${data.startedAt}` : String(data.pid);
}

async function waitUntil(check, timeoutMs, pollMs = 300) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (check()) return true;
        if (Date.now() >= deadline) return false;
        await new Promise((r) => setTimeout(r, pollMs));
    }
}

// Back up, swap atomically, register the service, wait for a NEW daemon on
// :3101. A failed swap or service install puts the previous binary back.
async function installAoBinary({ src, dest, stamp = timestamp, serviceInstall, waitForDaemon, readIdentity = readAoDaemonIdentity, restartWaitMs = AO_DAEMON_WAIT_MS }) {
    let backup = null;
    if (src) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (fs.existsSync(dest)) {
            backup = `${dest}.bak-${stamp}`;
            fs.copyFileSync(dest, backup);
        }
        try {
            installBinaryAtomically(src, dest);
        } catch (e) {
            if (backup) installBinaryAtomically(backup, dest);
            log.warn(`Could not place the ao binary (${e.message})${backup ? '; the previous binary is back in place' : ''}.`);
            return { ok: false, backup, restored: !!backup };
        }
        log.step(`Installed ao to ${dest}${backup ? ` (previous binary kept at ${backup})` : ''}`);
    }
    const before = readIdentity();
    try {
        await serviceInstall(dest);
    } catch (e) {
        if (backup) {
            installBinaryAtomically(backup, dest);
            try { await serviceInstall(dest); } catch (e2) { logDebug(e2, 'ao service install after restore'); }
        }
        log.warn(`AO service install failed: ${e.message}${backup ? `. Restored the previous ao from ${backup}` : ''}. Start it by hand with: ao service install`);
        return { ok: false, backup, restored: !!backup };
    }
    // No identity before (file missing/unreadable): the port check is all we have.
    const restarted = before ? await waitUntil(() => { const now = readIdentity(); return !!now && now !== before; }, restartWaitMs) : true;
    const listening = await waitForDaemon();
    const backupNote = backup ? ` The previous binary is at ${backup} (restore: mv "${backup}" "${dest}" && ao service install).` : '';
    if (listening && restarted) {
        log.success('AO Orchestrator running on http://localhost:3101');
    } else if (listening) {
        log.warn(`AO on :3101 is still the old process (${before}); it was not restarted, probably because it does not run under the AO service. Restart it: ao service install, then check ao service status (or stop it and start it the way it was started).${backupNote}`);
    } else {
        const hint = process.platform === 'win32'
            ? 'Run `ao service install` again or log out and back in, then check `ao service status`.'
            : 'Check `ao service status` and `ao service logs`.';
        log.warn(`AO did not answer on :3101 within ${Math.round(AO_DAEMON_WAIT_MS / 1000)}s. ${hint}${backupNote}`);
    }
    return { ok: true, backup, listening, restarted };
}

function aoPlatformBinaries(dir) {
    const b = (...p) => path.join(dir, 'backend', ...p);
    if (process.platform === 'win32') return [b('bin', 'ao-windows-amd64.exe'), b('bin', 'ao.exe'), b('ao.exe')];
    const plat = process.platform === 'darwin' ? 'darwin' : 'linux';
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    return [b('bin', `ao-${plat}-${arch}`), b('ao-daemon'), b('bin', 'ao'), b('ao')];
}

// Picks the binary this run may install. A local checkout is looked at only
// when AOS_AO_DEV_BUILD=1 opts in; otherwise the published release package is
// used silently, never the dev checkout.
function selectAoCandidate({
    checkoutDir, isLocalGitRepo, releaseDir,
    devOptIn = process.env.AOS_AO_DEV_BUILD === '1',
    dryRun = DRY_RUN,
    checkWorkspace = checkAoWorkspace,
    download = (dir) => downloadOrUpdateModule(AO_PKG, dir, 'BDB Agent Orchestrator'),
    build = buildAoFromSource,
    candidatesIn = aoPlatformBinaries,
}) {
    if (isLocalGitRepo && devOptIn) {
        const ws = checkWorkspace(checkoutDir);
        if (ws.ok) {
            if (dryRun) return { bin: null, source: 'dry-run' };
            // A prebuilt binary counts only when it was built clean from this exact HEAD.
            const prebuilt = candidatesIn(checkoutDir).find((p) => {
                const info = readGoBuildInfo(p);
                return info && !info.modified && info.revision === ws.head;
            });
            return { bin: prebuilt || build(checkoutDir), source: 'checkout' };
        }
        log.warn(`AOS_AO_DEV_BUILD=1: building ao from ${checkoutDir} HEAD although ${ws.reason}; a downgrade is still refused.`);
        if (dryRun) return { bin: null, source: 'dry-run' };
        return { bin: build(checkoutDir), source: 'dev', allowDirty: true };
    }
    if (fs.existsSync(path.join(releaseDir, '.git'))) {
        log.warn(`${releaseDir} is a git checkout; not downloading the release over it. Keeping the installed ao.`);
        return { bin: null, source: 'release-dir-is-checkout' };
    }
    if (dryRun) {
        log.step(`[dry-run] would download ${AO_PKG} to ${releaseDir}`);
        return { bin: null, source: 'dry-run' };
    }
    if (!download(releaseDir)) {
        log.warn(`Could not download ${AO_PKG}; keeping the installed ao.`);
        return { bin: null, source: 'download-failed' };
    }
    return { bin: candidatesIn(releaseDir).find((p) => fs.existsSync(p)) || null, source: 'release' };
}

async function installOSAgentWorkspace() {
    if (!aoSupportedHere()) {
        log.warn(`AO is not supported on ${process.platform}/${process.arch}.`);
        return false;
    }

    const releaseDir = path.join(moduleBasePath(), 'bdb-agent-orchestrator');
    const checkoutDir = [
        path.join(homeDir, 'dev', 'agents', 'bdb-agent-orchestrator'),
        path.join(homeDir, 'dev', 'bdb-dev', 'bdb-agent-orchestrator'),
    ].find((d) => fs.existsSync(path.join(d, '.git')));
    if (checkoutDir && process.env.AOS_AO_DEV_BUILD === '1') log.step(`Found a local AO checkout: ${checkoutDir}`);

    const pick = selectAoCandidate({ checkoutDir, isLocalGitRepo: !!checkoutDir, releaseDir });
    if (DRY_RUN) {
        log.step('[dry-run] would install the ao binary and run `ao service install`');
        return;
    }

    const binTarget = aoBinTarget();
    const installedExists = fs.existsSync(binTarget);
    let src = null;
    let candidate = null;
    if (pick.bin) {
        candidate = readGoBuildInfo(pick.bin);
        const installed = installedExists ? readGoBuildInfo(binTarget) : null;
        const daemonRunning = installedExists && !installed
            ? (readAoDaemonIdentity() !== null || await verifyDaemonListening(3101, 'AO Orchestrator', 1500))
            : true;
        const verdict = decideAoInstall({ installedExists, installed, candidate, allowDirty: !!pick.allowDirty, candidateIsRelease: pick.source === 'release', daemonRunning });
        if (verdict.install) src = pick.bin;
        else log.step(`Keeping ${binTarget}: ${verdict.reason}.`);
    }

    if (!src && !installedExists) {
        log.warn(`No ao binary could be installed (${pick.source}).`);
        return false;
    }
    // Unchanged binary and a live daemon: nothing to restart.
    if (!src && await verifyDaemonListening(3101, 'AO Orchestrator', 1500)) {
        log.success('AO Orchestrator running on http://localhost:3101');
        return;
    }

    const result = await installAoBinary({
        src,
        dest: binTarget,
        serviceInstall: (bin) => aoServiceInstall(bin),
        waitForDaemon: () => verifyDaemonListening(3101, 'AO Orchestrator', AO_DAEMON_WAIT_MS),
    });
    if (result.ok && src) {
        const pkgJson = readJsonFile(path.join(pick.source === 'release' ? releaseDir : checkoutDir, 'package.json')) || {};
        saveManifest({ ao: { version: pick.source === 'dev' ? null : (pkgJson.version || null), revision: candidate ? candidate.revision : null, modified: !!(candidate && candidate.modified), installedAt: new Date().toISOString() } });
    }
    return result.ok ? undefined : false;
}

function aoServiceInstall(binTarget) {
    // macOS only: code-sign ad-hoc to prevent AMFI SIGKILL
    if (process.platform === 'darwin') {
        try {
            execFileSync('codesign', ['-v', binTarget], { stdio: 'ignore' });
        } catch {
            log.warn('The ao binary is not code-signed — AMFI will kill it at launch.');
            try {
                execFileSync('codesign', ['-s', '-', '-f', binTarget], { stdio: 'ignore' });
                log.step('Signed it ad-hoc.');
            } catch (e) { log.warn(`Could not sign it: ${e.message}`); }
        }
        const legacyPlist = path.join(homeDir, 'Library', 'LaunchAgents', 'com.bdb.agent-workspace.plist');
        if (fs.existsSync(legacyPlist)) {
            try { execFileSync('launchctl', ['unload', legacyPlist], { stdio: 'ignore' }); } catch (e) { logDebug(e, 'unload legacy ao agent'); }
            try { fs.unlinkSync(legacyPlist); log.step('Removed the old com.bdb.agent-workspace service.'); } catch (e) { logDebug(e, 'remove legacy plist'); }
        }
    }
    // AO installs its own service, and does it for macOS, Windows and Linux.
    try {
        execFileSync(binTarget, ['service', 'install'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
        throw new Error(describeExecError(e));
    }
}
// Optional setup step: which folders the daily memory import covers and when it runs. Skipped unattended; nothing is preset.
async function promptMemoryImport() {
    if (isAutoYes || DRY_RUN || !memoryOn) return;
    const yes = pick(await askConfirm({ message: 'Set up the daily memory import (folders to read into memB, and a time)?', initialValue: false }));
    if (!yes) return;
    const ui = v5Options(true).ui;
    await require('./lib/memory-import').interactive({ home: homeDir, write: (x) => process.stdout.write(x), ui });
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
                : spawnSync(pythonBin, ingestArgs, { stdio: 'inherit', windowsHide: true });
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
    for (const f of moduleFailures) {
        console.log(`  • ${colors.bold}${f.name}${colors.reset} ➔ ${colors.yellow}❌ NOT installed: ${f.reason.split('\n')[0]}${colors.reset}`);
    }
    if (moduleFailures.length) process.exitCode = 1;
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
        if (mod.pkg === AO_PKG) {
            const bin = aoBinTarget();
            const exists = fs.existsSync(bin);
            const build = exists ? readGoBuildInfo(bin) : null;
            const record = (readJsonFile(path.join(homeDir, '.agents', '.bdb-manifest.json')) || {}).ao || null;
            const version = trustedAoVersion(build, record);
            const latest = version ? (newestDistTag(AO_PKG, version) || {}).version : null;
            const s = describeAoVersion({ exists, build, record, latest });
            const mark = !exists ? `${colors.dim}⚪` : s.updateAvailable ? `${colors.yellow}⚠️ ` : build && !build.modified ? `${colors.green}✅` : `${colors.yellow}⚠️ `;
            console.log(`  • ${colors.bold}${mod.name.padEnd(35)}${colors.reset} ➔ ${mark} ${s.text}${colors.reset}`);
            continue;
        }
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
                const newer = newestDistTag(mod.pkg, localVer);
                if (newer) {
                    console.log(`  • ${colors.bold}${mod.name.padEnd(35)}${colors.reset} ➔ ${colors.yellow}⚠️  Update available (v${localVer} ➔ v${newer.version} (${newer.tag}))${colors.reset}`);
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
    console.log(`  Interactive Control Center: aos-dashboard`);
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
        targetSkillDir = path.join(claudeConfigDir(homeDir), 'skills');
        targetLegacyDir = path.join(claudeConfigDir(homeDir), 'skills', 'legacy');
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
        // Codex reads ~/.agents/skills too; a second copy under ~/.codex/skills would list every skill twice.
        targetSkillDir = path.join(homeDir, '.agents', 'skills');
        targetLegacyDir = path.join(homeDir, '.agents', 'skills', 'legacy');
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
    // A stored pack selection excludes every shipped skill outside base+packs; the Pro MEDIA
    // tier and installed modules imply their packs on top (additive). No stored selection
    // excludes nothing (existing users keep all skills).
    return [...coreSkills.excludedBySkillSet(skillSet, srcDir), ...skillPacks.excludedByPacks(srcDir, effectivePackSelection()), ...(tier === '2' ? [
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
    ] : [])];
}

// Merge the BDB MCP servers into a harness's *secondary* config store without
// disturbing anything else in it. Used where one harness option covers two
// products that read different files (Claude Desktop vs Claude Code): the
// primary write above owns its file wholesale, but a secondary store belongs
// to another product and is very likely to already hold the user's own
// servers -- so this merges per server key and never replaces the file.
//
// Secrets never go into a harness config: every server that needs one is written in launcher form
// (lib/mcp-secrets.js, bin/aos-mcp-env.mjs) and the values live in ~/.aos/secrets.env (0600).
// Ownership is judged against every shipped definition (both candidates of an app group), so a picked
// official entry is still AOS-owned for update and uninstall.
const mcpShipped = () => mcpSecrets.shippedAll(srcDir);
// App-aware pick, once per process: winners are written, `retired` (losing candidates) are removed again.
let mcpPickDetect = null;
let mcpPickCache = null;
const mcpPicks = () => {
    if (!mcpPickCache) {
        const detect = mcpPickDetect || require('./lib/mcp-pick').detectApps({ platform: process.platform, env: process.env, home: homeDir });
        mcpPickCache = mcpSecrets.shippedPicks(srcDir, { detect, env: process.env });
    }
    return mcpPickCache;
};
// Test hook: inject detect results (null restores real detection).
function setMcpPickDetect(fn) { mcpPickDetect = typeof fn === 'function' ? fn : null; mcpPickCache = null; }
// Drops AOS-owned entries of losing candidates from a harness server map (OpenCode shape with opencode=true).
// A user's own same-name entry, http entries and entries holding inline secrets stay.
function retireMcpServers(map, opencode = false) {
    if (!map || typeof map !== 'object') return false;
    const shipped = mcpShipped();
    let changed = false;
    for (const name of mcpPicks().retired) {
        if (map[name] === undefined) continue;
        const canon = opencode ? mcpSecrets.fromOpencode(map[name]) : map[name];
        if (!canon || canon.url || mcpSecrets.inlineSecrets(canon.env).length || !mcpSecrets.isAosOwned(name, canon, null, shipped)) continue;
        delete map[name];
        changed = true;
    }
    return changed;
}
// null once the launcher or its lib could not be installed: nothing is then wrapped and no inline value is moved.
let mcpLauncherFailed = false;
const mcpLauncher = () => (mcpLauncherFailed ? null : mcpSecrets.launcherPath(homeDir));
const secretBackups = new Set();
// One line per run naming the backups of configs whose inline secrets were moved; they hold plaintext secrets.
function noticeSecretBackups() {
    if (!secretBackups.size) return;
    log.warn(`Backups of the configs changed above contain the old plaintext secrets: ${[...secretBackups].join(', ')}. Delete them once you no longer need them.`);
    secretBackups.clear();
}
const warnedUserMcp = new Set();
const warnUserMcpEntry = (file) => (name) => {
    if (warnedUserMcp.has(`${file}\0${name}`)) return;
    warnedUserMcp.add(`${file}\0${name}`);
    log.warn(`${file}: your own "${name}" MCP entry differs from the AOS one and was left untouched.`);
};

// Backup of `file` first, then the collected inline values into the secrets file (never replacing a
// stored value). False means: do not rewrite `file`, its inline values are the only copy.
function stashInlineSecrets(collector, file) {
    if (!collector || !collector.size()) return true;
    if (DRY_RUN) return true;
    const before = configBackups.length;
    if (!backupConfigFile(file)) return false;
    configBackups.slice(before).forEach((b) => secretBackups.add(b));
    try {
        const res = mcpSecrets.storeSecrets(mcpSecrets.secretsPath(homeDir), collector.values);
        if (res.added.length) log.step(`Moved ${res.added.join(', ')} from ${file} into ${mcpSecrets.secretsPath(homeDir)}`);
        const differs = [...new Set([...res.kept, ...collector.conflicts])];
        if (differs.length) log.warn(`${file} held a different inline value for ${differs.join(', ')} than the secrets file; kept the stored value (neither is printed).`);
        return true;
    } catch (e) {
        log.warn(`Could not write ${mcpSecrets.secretsPath(homeDir)} (${e.message}); ${file} left unchanged.`);
        return false;
    }
}

// The launcher and the two lib files it needs; entries point at them, so they go in before any entry.
function installMcpLauncher() {
    if (DRY_RUN) return true;
    const pairs = [
        [path.join(srcDir, 'bin', mcpSecrets.LAUNCHER_FILE), mcpSecrets.launcherPath(homeDir)],
        [path.join(srcDir, 'lib', 'mcp-secrets.js'), path.join(homeDir, '.agents', 'lib', 'mcp-secrets.js')],
        [path.join(srcDir, 'lib', 'jsonc.js'), path.join(homeDir, '.agents', 'lib', 'jsonc.js')],
        [path.join(srcDir, 'lib', 'mcp-pick.js'), path.join(homeDir, '.agents', 'lib', 'mcp-pick.js')],
    ];
    let ok = true;
    for (const [src, dest] of pairs) {
        try { copyDirRecursiveSync(src, dest); } catch (e) { log.warn(`Could not install ${path.basename(dest)}: ${e.message}`); }
        if (!fs.existsSync(dest)) ok = false;
    }
    mcpLauncherFailed = !ok;
    if (!ok) log.warn('The MCP secrets launcher could not be installed: MCP entries are not rewritten and inline secrets stay where they are. Fix the error above and re-run the installer.');
    return ok;
}

// Custom and project-local MCP configs are recorded so migration, doctor and uninstall can find them later.
function recordMcpConfigPath(file) {
    if (DRY_RUN || !file || !fs.existsSync(file)) return;
    try { uninstallRecords.recordMcpConfig(homeDir, path.resolve(file)); } catch (e) { logDebug(e, 'record MCP config path'); }
}

// Decided per target file: a harness config that already points at the gateway (its aos entry or
// [mcp_servers.aos] table) gets no direct copies of the servers the gateway serves, or every tool is listed twice.
// Every other file keeps them, so harnesses the gateway does not wire never lose a server.
function hasGatewayAos(file) {
    try {
        if (file.toLowerCase().endsWith('.toml')) return fs.existsSync(file) && tomlHasGateway(fs.readFileSync(file, 'utf8'));
        const l = loadJsonConfig(file);
        return l.state === 'ok' && [l.data.mcpServers, l.data.mcp].some((m) => m && typeof m === 'object' && isAosShaped(m.aos));
    } catch (e) { logDebug(e, 'gateway aos check'); return false; }
}
function withoutGatewayServers(servers, file) {
    if (!servers || typeof servers !== 'object' || !hasGatewayAos(file)) return servers;
    const out = { ...servers };
    // Alternates of a gateway server (the pick-group duplicates) count too: a duplicate upstream is a duplicate tool list.
    for (const n of Object.keys(out)) if (gatewayCovered(n)) delete out[n];
    return out;
}

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
            const before = JSON.stringify(data);
            const collector = mcpSecrets.createCollector();
            mcpSecrets.mergeServers(data.mcpServers, JSON.parse(JSON.stringify(withoutGatewayServers(servers, target))), { shipped: mcpShipped(), collector, launcher: mcpLauncher(), onSkip: warnUserMcpEntry(target) });
            retireMcpServers(data.mcpServers);
            if (existing && JSON.stringify(data) === before) continue;
            if (!stashInlineSecrets(collector, target)) continue;
            fs.mkdirSync(path.dirname(target), { recursive: true });
            // The `mode` option only applies when writeFileSync CREATES the file -- an
            // existing 0644 file keeps its old mode -- so chmod explicitly.
            if (existing && !backupConfigFile(target)) continue;
            fs.writeFileSync(target, JSON.stringify(data, null, 2), { mode: 0o600 });
            try { fs.chmodSync(target, 0o600); } catch (e) { logDebug(e, 'chmod mirrored mcp config'); }
            log.step(`Mirrored MCP servers into ${target}`);
        } catch (e) {
            log.warn(`Could not mirror MCP servers into ${target}: ${e.message}`);
        }
    }
}

// mcsc delegates to agy (Antigravity), and agy loads its own MCP config: with mcsc registered there,
// each mcsc start spawned an agy that started another mcsc (fork bomb). Never register it for agy.
const agyMcpConfigPaths = (home = homeDir) => [
    path.join(home, '.gemini', 'config', 'mcp_config.json'),
    path.join(home, '.gemini', 'antigravity-cli', 'mcp_config.json'),
];
const isAgyMcpConfig = (p, home = homeDir) => agyMcpConfigPaths(home).some((a) => path.resolve(a) === path.resolve(p));
// Owned by AOS = name mcsc running node on an mcsc/server.js; a user's own "mcsc" entry stays.
const isAosMcscEntry = (e) => !!e && typeof e === 'object' && /(^|[\\/])node(\.exe)?$/i.test(String(e.command || ''))
    && Array.isArray(e.args) && /[\\/]mcsc[\\/](.*[\\/])?server\.js$/.test(String(e.args[0] || ''));
let lastGeneratedMcpServers = null;

function removeAosMcscFromAgyConfigs(home = homeDir) {
    const removed = [];
    for (const f of agyMcpConfigPaths(home)) {
        try {
            const loaded = loadJsonConfig(f);
            if (loaded.state !== 'ok' || !loaded.data.mcpServers || !isAosMcscEntry(loaded.data.mcpServers.mcsc)) continue;
            const before = JSON.stringify(loaded.data);
            delete loaded.data.mcpServers.mcsc;
            if (writeConfigWithBackup(f, loaded.data, before)) removed.push(f);
        } catch (e) { logDebug(e, 'remove mcsc from agy config'); }
    }
    if (removed.length) log.step(`Removed the AOS mcsc entry from ${removed.join(', ')} (it recurses when registered for agy)`);
    return removed;
}

let warnedDisabledMcps = false;

// A2A MCP server entry detection, registration and cleanup for agy and Cursor.
const isAosA2aEntry = (e) => !!e && typeof e === 'object'
    && /(^|[\\/])node(\.exe)?$/i.test(String(e.command || ''))
    && Array.isArray(e.args)
    && /[\\/](aos-a2a-mcp|a2a-inbox-mcp)\.mjs$/i.test(String(e.args[0] || ''));

// A2A MCP session names follow lib/a2a-registry.mjs validName rules (same alphabet the
// registry files use, so a name can never alias another file). The ESM module is loaded by
// require(esm) when the Node supports it; the identical pattern is kept inline as a fallback
// for a Node that cannot require() an .mjs yet.
function validA2aMcpSessionName(name) {
    let mod = null;
    try { mod = require('./lib/a2a-registry.mjs'); } catch { /* older Node, no require(esm) */ }
    if (mod) { try { return mod.validName(name); } catch { return null; } }
    const n = String(name ?? '');
    if (!n || n.length > 64 || n.startsWith('.') || n.startsWith('-') || n.endsWith('-') || !/^[a-z0-9._-]+$/.test(n)) return null;
    return n;
}

// Every A2A MCP registration name goes through the validName rules: invalid or empty
// becomes a warning plus the fixed default for that harness (never a silently invented
// name, never AOS_A2A_NAME from the installer's own environment).
function resolveAosA2aMcpName(raw, fallback, where) {
    const validated = raw == null ? null : validA2aMcpSessionName(String(raw));
    if (validated) return validated;
    // An unset override (raw == null) simply takes the fixed default — not a warning (B5):
    // only an override that was actually SET and is invalid gets the loud fallback message.
    if (raw == null) return fallback;
    log.warn(`${where} MCP session name ${JSON.stringify(raw)} is not a valid A2A session name (use [a-z0-9._-], no leading dot/dash, max 64); using "${fallback}"`);
    return fallback;
}

function makeAosA2aMcpEntry(sessionName, home = homeDir) {
    const cleanName = validA2aMcpSessionName(String(sessionName ?? ''));
    if (!cleanName) {
        throw new Error('AOS_A2A_NAME is required: session identity must be specified');
    }
    const scriptPath = path.join(home, '.agents', 'bin', 'aos-a2a-mcp.mjs');
    return {
        command: 'node',
        args: [scriptPath],
        env: {
            AOS_A2A_NAME: cleanName
        }
    };
}

// Defaults are fixed and distinct per harness (never AOS_A2A_NAME of the installer's own
// session): overriding happens ONLY via the explicit AOS_A2A_MCP_NAME_CURSOR /
// AOS_A2A_MCP_NAME_AGY env vars, and every name pressure-validates through validName.
const A2A_MCP_DEFAULT_NAME_CURSOR = 'cursor-mcp';
const A2A_MCP_DEFAULT_NAME_AGY = 'agy-mcp';

function registerA2aMcpCursor({ targetHome = homeDir, name = A2A_MCP_DEFAULT_NAME_CURSOR } = {}) {
    const sessionName = resolveAosA2aMcpName(name, A2A_MCP_DEFAULT_NAME_CURSOR, 'Cursor');
    const cursorMcpPath = path.join(targetHome, '.cursor', 'mcp.json');
    const loaded = loadJsonConfig(cursorMcpPath);
    // An unparseable config is never rewritten: the user's file stays untouched (B2).
    if (loaded.state === 'invalid') { warnUnparseable(cursorMcpPath, 'the Cursor A2A MCP registration', loaded); return cursorMcpPath; }
    const data = loaded.data;
    if (!data.mcpServers || typeof data.mcpServers !== 'object') data.mcpServers = {};
    // A foreign "aos-a2a" entry (not one of ours) is never overwritten (B3).
    if (data.mcpServers['aos-a2a'] != null && !isAosA2aEntry(data.mcpServers['aos-a2a'])) {
        log.warn(`${cursorMcpPath} already has its own "aos-a2a" entry that was not written by AOS; it was left untouched. Rename or remove that entry and run the installer again to register the A2A MCP.`);
        return cursorMcpPath;
    }
    const before = JSON.stringify(data);
    data.mcpServers['aos-a2a'] = makeAosA2aMcpEntry(sessionName, targetHome);
    fs.mkdirSync(path.dirname(cursorMcpPath), { recursive: true });
    writeConfigWithBackup(cursorMcpPath, data, before);
    return cursorMcpPath;
}

function registerA2aMcpAgy({ targetHome = homeDir, name = A2A_MCP_DEFAULT_NAME_AGY } = {}) {
    const sessionName = resolveAosA2aMcpName(name, A2A_MCP_DEFAULT_NAME_AGY, 'agy');
    const registered = [];
    for (const f of agyMcpConfigPaths(targetHome)) {
        const loaded = loadJsonConfig(f);
        if (loaded.state === 'invalid') { warnUnparseable(f, 'the agy A2A MCP registration', loaded); continue; }
        const data = loaded.data;
        if (!data.mcpServers || typeof data.mcpServers !== 'object') data.mcpServers = {};
        if (data.mcpServers['aos-a2a'] != null && !isAosA2aEntry(data.mcpServers['aos-a2a'])) {
            log.warn(`${f} already has its own "aos-a2a" entry that was not written by AOS; it was left untouched. Rename or remove that entry and run the installer again to register the A2A MCP.`);
            continue;
        }
        const before = JSON.stringify(data);
        data.mcpServers['aos-a2a'] = makeAosA2aMcpEntry(sessionName, targetHome);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        writeConfigWithBackup(f, data, before);
        registered.push(f);
    }
    return registered;
}

function removeAosA2aEntries({ targetHome = homeDir } = {}) {
    const targets = [
        path.join(targetHome, '.cursor', 'mcp.json'),
        ...agyMcpConfigPaths(targetHome)
    ];
    const cleaned = [];
    for (const f of targets) {
        if (!fs.existsSync(f)) continue;
        const loaded = loadJsonConfig(f);
        if (loaded.state !== 'ok' || !loaded.data.mcpServers) continue;
        const before = JSON.stringify(loaded.data);
        let modified = false;
        for (const [k, v] of Object.entries(loaded.data.mcpServers)) {
            if ((k === 'aos-a2a' || k === 'aos-a2a-mcp' || k === 'aos-a2a-inbox') && isAosA2aEntry(v)) {
                delete loaded.data.mcpServers[k];
                modified = true;
            }
        }
        if (modified) {
            writeConfigWithBackup(f, loaded.data, before);
            cleaned.push(f);
        }
    }
    return cleaned;
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

    const nodeMcps = ['adobe_uxp_mcp', 'unreal_mcp', 'tdmcp', 'touchdesigner-mcp', 'davinci-resolve-mcp', 'after-effects-mcp', 'mcsc'];
    for (const mcpFolder of nodeMcps.filter(m => selectedMcps.includes(m))) {
        const targetFolder = path.join(mcpCodeTarget, mcpFolder);
        if (fs.existsSync(path.join(targetFolder, 'package.json'))) {
            log.step(`Setting up Node dependencies for ${mcpFolder}...`);
            const ok = runNpmWithRetry('npm install --no-audit --no-fund', { cwd: targetFolder }, `npm install for ${mcpFolder}`);
            if (ok && (fs.existsSync(path.join(targetFolder, 'tsconfig.json')) || fs.existsSync(path.join(targetFolder, 'tsconfig.build.json')))) {
                log.step(`Compiling TypeScript for ${mcpFolder}...`);
                // touchdesigner-mcp's build ends in build:mcpb (npx @anthropic-ai/mcpb pack), a Claude Desktop bundle the
                // server does not need; without a TTY npx will not fetch it and the whole build failed (exit 127).
                const buildCmd = mcpFolder === 'touchdesigner-mcp' ? 'npm run build:gen && npm run build:dist' : 'npm run build';
                const built = runNpmWithRetry(buildCmd, { cwd: targetFolder }, `${buildCmd} for ${mcpFolder}`);
                // runNpmWithRetry already warned with the failure detail; this
                // just makes the consequence visible now instead of only later,
                // when the config-entry check below finds the missing dist file.
                if (!built) log.warn(`${mcpFolder}: build failed -- its MCP config entry will be dropped if the expected output is missing.`);
            }
        }
    }

    // The fallback runs the compiled binary, not `go run` (a cold Go build on
    // every MCP launch). Built once here; on failure the template's `go run`
    // shape is written instead (see the rewrite before __MCPS_DIR__ substitution).
    if (selectedMcps.includes('ae-mcp') && hasExecutable('go') && !DRY_RUN) {
        const aeDir = path.join(mcpCodeTarget, 'ae-mcp');
        const aeOut = path.join(aeDir, 'bin', process.platform === 'win32' ? 'ae-mcp.exe' : 'ae-mcp');
        installStep(`build the ae-mcp binary ${aeOut}`, () => {
            fs.mkdirSync(path.dirname(aeOut), { recursive: true });
            execFileSync('go', ['-C', aeDir, 'build', '-o', aeOut, './cmd/ae-mcp'], { stdio: 'ignore', timeout: 120000, windowsHide: true });
        }, 'ae-mcp keeps the `go run` fallback shape; rebuild manually with: go -C ' + aeDir + ' build -o ' + aeOut + ' ./cmd/ae-mcp');
    }

    if (selectedMcps.includes('davinci-resolve-mcp')) {
        const davinciFolder = path.join(mcpCodeTarget, 'davinci-resolve-mcp');
        if (fs.existsSync(davinciFolder)) {
            try {
                if (DRY_RUN) {
                    log.step('[dry-run] would bootstrap DaVinci Resolve MCP Studio');
                } else {
                    const davinciResult = spawnSync('node', ['bin/davinci-resolve-mcp.mjs', 'setup', '--clients', 'manual'], { cwd: davinciFolder, stdio: 'ignore', windowsHide: true });
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
                } else {
                    ensurePythonVenv(membMcpFolder);
                }

                const pipViaPython = `"${venvPython}" -m pip`;
                runPipWithRetry(`${pipViaPython} install --upgrade setuptools --timeout 30 --no-input`, { cwd: membMcpFolder, stdio: 'ignore' }, 'pip setuptools upgrade for memB MCP', 2, 120000);
                // run.py resolves FastMCP as `try: from mcp.server.fastmcp import FastMCP
                // except ImportError: from fastmcp import FastMCP`. requirements.txt does not
                // list `mcp`, so a reconcile whose hash stamp still matches leaves the venv
                // without the MCP SDK and run.py dies on import far from the real cause.
                const fastmcpImport = 'try:\n    from mcp.server.fastmcp import FastMCP\nexcept ImportError:\n    from fastmcp import FastMCP';
                if (!verifyPythonImports(venvPython, membMcpFolder, fastmcpImport)) {
                    log.step('[memb] mcp/fastmcp SDK missing from the memb-mcp venv; installing the MCP SDK pin.');
                    let hasUvSdk = false;
                    try { execSync(`"${uvBin()}" --version`, { stdio: 'ignore', windowsHide: true }); hasUvSdk = true; } catch (e) { logDebug(e, 'uv lookup for memb-mcp'); }
                    const sdkCmd = hasUvSdk
                        ? `"${uvBin()}" pip install --python "${venvPython}" "mcp>=1.0.0,<2.0.0" --no-input`
                        : `"${venvPython}" -m pip install "mcp>=1.0.0,<2.0.0" --timeout 30 --no-input`;
                    runPipWithRetry(sdkCmd, { cwd: membMcpFolder, stdio: 'ignore' }, 'mcp SDK for memB MCP', 2, 300000);
                    if (!verifyPythonImports(venvPython, membMcpFolder, fastmcpImport)) {
                        log.warn('memB MCP venv still cannot import FastMCP after the mcp install; memb-mcp will fail to start until it is repaired.');
                    }
                }
                // The FastMCP import alone passes right after the SDK pin above, so a fresh venv was
                // stamped up to date without requirements.txt (no numpy: run.py died on start).
                // `import run` is the server's real entry, the same check `aos package verify memb` runs.
                const reconcile = reconcileMembVenv(membMcpFolder, { venvPython, entryImport: 'import run' });
                if (reconcile.status === 'failed') log.warn('memB MCP requirements reconcile failed; inspect the venv before relying on memb-mcp.');
                if (!DRY_RUN && !verifyPythonImports(venvPython, membMcpFolder, 'import mcp, pydantic')) {
                    const reason = `the memb-mcp venv cannot import mcp and pydantic. ${MEMB_PYTHON_FIX}`;
                    log.warn(reason);
                    moduleFailures.push({ id: 'memb-mcp', name: 'memB MCP', reason });
                }
            } catch (e) {
                log.warn(`Failed to set up Python virtual environment for memB: ${e.message}`);
                moduleFailures.push({ id: 'memb-mcp', name: 'memB MCP', reason: e.message });
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
            const result = spawnSync(uvBin(), prewarmArgs, { cwd: targetFolder, stdio: 'ignore', windowsHide: true });
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

    const mcpTemplatePath = mcpSecrets.shippedMcpTemplatePath(srcDir);
    const mcpTemplate = installStep(
        `read the MCP template ${mcpTemplatePath}`,
        () => fs.readFileSync(mcpTemplatePath, 'utf8'),
        'No MCP config is generated; the existing config stays untouched.'
    );
    let mcpConfigStr = mcpTemplate.ok ? mcpTemplate.value : '';

    const skippedMcpConfigKeys = resolveUnsupportedMcpConfigKeys();
    try {
        const parsedMcpConfig = JSON.parse(mcpConfigStr);
        delete parsedMcpConfig.presets; // gateway template key, not a harness config key
        // One MCP per app: the pick's winners replace the template's servers (placeholders resolved below).
        const pickOnly = new Set(Object.keys(mcpPicks().servers).filter((n) => !(n in parsedMcpConfig.mcpServers)));
        parsedMcpConfig.mcpServers = { ...mcpPicks().servers };
        // npm's Windows shim is deja.cmd, which Node refuses to spawn without
        // a shell (EINVAL since the CVE-2024-27980 fix) -- wrap the command in
        // cmd /c here so every generated config, the Codex TOML block and the
        // ~/.claude.json mirror get the launchable form.
        if (process.platform === 'win32' && parsedMcpConfig.mcpServers.deja) {
            parsedMcpConfig.mcpServers.deja = { command: 'cmd', args: ['/c', 'deja', 'mcp'] };
        }
        // Direct mode spawns ONE plugin per harness session; the UXP plugins (Photoshop / Premiere)
        // hard-code ws://localhost:8080 (mcps/adobe_uxp_mcp/plugins/*/index.js:3), so a free-port
        // pick would leave them disconnected: direct mode therefore pins the FIXED default port
        // 8080 (only one direct instance per machine is supported). Gateway mode shares ONE
        // instance built from the shipped template, which keeps the default 8080 (or whatever
        // AOS_UXP_PORT the gateway process carries); a user-set AOS_UXP_PORT in this env block
        // is never overwritten.
        const uxpEntry = parsedMcpConfig.mcpServers.adobe_uxp_mcp;
        if (uxpEntry && !(uxpEntry.env && uxpEntry.env.AOS_UXP_PORT)) {
            parsedMcpConfig.mcpServers.adobe_uxp_mcp = { ...uxpEntry, env: { ...(uxpEntry.env || {}), AOS_UXP_PORT: '8080' } };
        }
        // AOS_DISABLED_MCPS=a,b: shipped server names that no harness config gets (universal sync reuses this result).
        const dropped = v5Profile.filterMcpServers(parsedMcpConfig.mcpServers, v5Profile.parseList(process.env.AOS_DISABLED_MCPS));
        if (!memoryOn) dropped.servers = v5Profile.filterMcpServers(dropped.servers, v5Profile.MEMORY_MCPS).servers;
        parsedMcpConfig.mcpServers = dropped.servers;
        if (dropped.unknown.length && !warnedDisabledMcps) {
            warnedDisabledMcps = true;
            log.warn(`AOS_DISABLED_MCPS: unknown MCP name(s) ignored: ${dropped.unknown.join(', ')}. Shipped: ${Object.keys(mcpPicks().servers).join(', ')}`);
        }
        const finalMcpServers = {};
        // memb-mcp comes from npm, not mcps/: listed here so its entry goes when it was not selected.
        const availableFolders = [...fs.readdirSync(mcpSrcDir), CORE_MCP];

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
            // An official pick runs outside mcps/; its package name may still contain a folder name.
            for (const available of (pickOnly.has(key) && !JSON.stringify(val).includes('__MCPS_DIR__') ? [] : availableFolders)) {
                if (!selectedMcps.includes(available) && JSON.stringify(val).includes(available)) {
                    keep = false;
                    break;
                }
            }
            if (keep) finalMcpServers[key] = val;
        }
        // The ae fallback runs the binary built above when it exists; otherwise the template's `go run` stays.
        const aeBin = `ae-mcp/bin/ae-mcp${process.platform === 'win32' ? '.exe' : ''}`;
        if (finalMcpServers.bdb_after_effects_mcp_fallback && fs.existsSync(path.join(mcpCodeTarget, aeBin))) {
            finalMcpServers.bdb_after_effects_mcp_fallback = { command: `__MCPS_DIR__/${aeBin}`, args: [] };
        }
        parsedMcpConfig.mcpServers = finalMcpServers;
        mcpConfigStr = JSON.stringify(parsedMcpConfig, null, 2);
    } catch (e) { logDebug(e, 'operation'); }

    const jsonEscapePath = (p) => String(p).replace(/\\/g, '\\\\');
    mcpConfigStr = mcpConfigStr.replace(/__MCPS_DIR__/g, () => jsonEscapePath(mcpCodeTarget));
    mcpConfigStr = mcpConfigStr.replace(/\{\{HOME\}\}/g, () => jsonEscapePath(homeDir));

    const uvPath = uvBin();
    mcpConfigStr = mcpConfigStr.replace(/"command":\s*"uv"/g, `"command": "${uvPath.replace(/\\/g, '/')}"`);

    if (selectedMcps.includes('memb-mcp')) {
        const pythonBinPath = process.platform === 'win32'
            ? path.join(mcpCodeTarget, 'memb-mcp', '.venv', 'Scripts', 'python.exe')
            : path.join(mcpCodeTarget, 'memb-mcp', '.venv', 'bin', 'python');
        const pythonBinValue = pythonBinPath.split('\\').join('/');
        mcpConfigStr = mcpConfigStr.replace(/__PYTHON_BIN__/g, () => JSON.stringify(pythonBinValue).slice(1, -1));
    }

    // Credentials from the prompts go to the secrets file; the entries only name the variables.
    const geminiKeyValue = (creds.keyEnvName === 'GEMINI_API_KEY' ? creds.gemini : '') || '';
    const githubToken = (creds.github || '').trim();
    const promptSecrets = Object.fromEntries(Object.entries({ GEMINI_API_KEY: geminiKeyValue, GITHUB_PERSONAL_ACCESS_TOKEN: githubToken }).filter(([, v]) => v && !/[\r\n]/.test(v)));
    if (Object.keys(promptSecrets).length && !DRY_RUN) {
        try {
            const res = mcpSecrets.storeSecrets(mcpSecrets.secretsPath(homeDir), promptSecrets);
            if (res.added.length) log.step(`Saved ${res.added.join(', ')} to ${mcpSecrets.secretsPath(homeDir)}`);
            if (res.kept.length) log.warn(`${mcpSecrets.secretsPath(homeDir)} already holds ${res.kept.join(', ')} with another value; kept it. Edit the file to change it.`);
        } catch (e) {
            log.warn(`Could not write ${mcpSecrets.secretsPath(homeDir)}: ${e.message}. Add the credentials there yourself (KEY=value, chmod 600).`);
        }
    }
    installMcpLauncher();
    try {
        const parsed = JSON.parse(mcpConfigStr);
        parsed.mcpServers = mcpSecrets.wrapServers(parsed.mcpServers, mcpLauncher());
        mcpConfigStr = JSON.stringify(parsed, null, 2);
    } catch (e) { logDebug(e, 'wrap MCP servers in the secrets launcher'); }

    try { lastGeneratedMcpServers = JSON.parse(mcpConfigStr).mcpServers || null; } catch (e) { lastGeneratedMcpServers = null; }
    if (isAgyMcpConfig(paths.mcpConfigPath)) {
        try {
            const parsed = JSON.parse(mcpConfigStr);
            if (parsed.mcpServers && parsed.mcpServers.mcsc) { delete parsed.mcpServers.mcsc; mcpConfigStr = JSON.stringify(parsed, null, 2); }
        } catch (e) { logDebug(e, 'strip mcsc for agy'); }
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
                const rawBefore = fs.readFileSync(paths.mcpConfigPath);
                const beforeMerge = JSON.stringify(oldConfig);
                if (oldConfig.mcpServers) {
                    unsupportedMcpConfigKeys.forEach(key => delete oldConfig.mcpServers[key]);
                }
                const newConfig = JSON.parse(mcpConfigStr);
                const oldServers = oldConfig.mcpServers && typeof oldConfig.mcpServers === 'object' ? oldConfig.mcpServers : {};
                const newServers = withoutGatewayServers(newConfig.mcpServers || {}, paths.mcpConfigPath);
                const collector = mcpSecrets.createCollector();
                mcpSecrets.mergeServers(oldServers, newServers, { shipped: mcpShipped(), collector, launcher: mcpLauncher(), onSkip: warnUserMcpEntry(paths.mcpConfigPath) });
                retireMcpServers(oldServers);
                oldConfig.mcpServers = oldServers;
                // The backup can hold credentials: only made (0600) when the merge really changes the content.
                if (JSON.stringify(oldConfig) === beforeMerge) {
                    log.step(`${configName} already has the BDB MCPs; nothing changed`);
                } else {
                    try {
                        fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
                        const mcpBackup = path.join(backupDir, 'mcp_config_backup.json');
                        fs.writeFileSync(mcpBackup, rawBefore, { mode: 0o600, flag: 'wx' });
                        if (collector.size()) secretBackups.add(mcpBackup);
                    } catch (e) { log.warn(`Could not create the backup copy: ${e.message}`); }
                    if (!stashInlineSecrets(collector, paths.mcpConfigPath)) throw new Error('inline secrets could not be moved');
                    fs.writeFileSync(paths.mcpConfigPath, JSON.stringify(oldConfig, null, 2), { mode: 0o600 });
                    try { fs.chmodSync(paths.mcpConfigPath, 0o600); } catch (e) { logDebug(e, 'chmod mcpConfigPath'); }
                    log.step(`Merged BDB MCPs into existing ${configName}`);
                }
            } catch (e) {
                log.warn(`Could not merge into ${configName}: ${e.message}`);
                log.warn(`${configName} was left unchanged.`);
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

    removeAosMcscFromAgyConfigs();
    mirrorMcpServersTo(paths.extraMcpConfigPaths, mcpConfigStr);
    for (const p of [paths.mcpConfigPath, ...(paths.extraMcpConfigPaths || [])]) recordMcpConfigPath(p);
    noticeSecretBackups();

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

// Single source of truth for parsing .agents/AGENTS.md into structured agent
// records. Used by every compiler (Claude Code, OpenCode, Antigravity) so a
// format change only needs a fix in one place. Requires a "- **Role**:" field
// to treat a "## " block as an agent -- this is what excludes trailing
// non-agent sections like "## Context Boot Sequence" from being compiled as
// a bogus agent (previously the Antigravity-only inline parser had no such
// guard). Name extraction strips any leading non-word characters (emoji,
// spaces) rather than matching the first alphanumeric run anywhere in the
// block, so it can't accidentally pick up a word from prose if the heading
// format changes.
function loadCommonSkills(dir = srcDir) {
    try {
        const reg = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'nodes.json'), 'utf8'));
        return Array.isArray(reg.common) ? reg.common.filter((s) => typeof s === 'string') : [];
    } catch {
        return [];
    }
}

function parseAgentsMd(content, commonSkills = loadCommonSkills()) {
    const blocks = content.split(/\n## /).slice(1).map((b) => b.split(/\n(?:#{1,2} |---\s*$)/m)[0]);
    const agents = [];
    for (const raw of blocks) {
        const headingLine = raw.split('\n')[0];
        const name = headingLine.replace(/^[^\w]+/, '').trim().split(/\s+/)[0];
        if (!name) continue;

        const roleMatch = raw.match(/-\s*\*\*Role\*\*:\s*(.+)/);
        if (!roleMatch) continue; // not an agent block

        // A legacy "- **Model**: x" line is ignored: AOS pins no model (docs/agent-models.md).
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
            skills: [...new Set([...extractListAfter('Primary Skills'), ...commonSkills])],
            mcpServers: extractListAfter('MCP Servers'),
            output: outputMatch ? outputMatch[1].trim() : null,
            systemPrompt: raw.replace(/^[ \t]*-\s*\*\*Model\*\*:.*\n?/gm, '').trim(),
        });
    }
    return agents;
}

// Load pack-specific agents from .agents/packs/<pack>/AGENTS.md.
// Default behavior: load all available packs (for backward compatibility).
// Future: respect pack selection from user config.
function loadPackAgents(packDir = path.join(currentDir, '.agents', 'packs'), commonSkills = loadCommonSkills()) {
    if (!fs.existsSync(packDir)) return [];

    const packAgents = [];
    const packs = fs.readdirSync(packDir).filter(f => {
        const stat = fs.statSync(path.join(packDir, f));
        return stat.isDirectory();
    });

    for (const pack of packs) {
        const agentsMdPath = path.join(packDir, pack, 'AGENTS.md');
        if (fs.existsSync(agentsMdPath)) {
            try {
                const content = fs.readFileSync(agentsMdPath, 'utf8');
                const agents = parseAgentsMd(content, commonSkills);
                packAgents.push(...agents);
            } catch (e) {
                log.warn(`Failed to load agents from ${agentsMdPath}: ${e.message}`);
            }
        }
    }

    return packAgents;
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

// No harness gets a model from the installer: agent files carry none and inherit the session model.
// A model is written only when .aos/pipeline.json pins one for that role and harness (docs/agent-models.md).

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

// Resolves the pinned model (or null) and enabled status for an agent role and harness.
// Shape: pipeline[role] = { models: { <harness>: "<model>" }, model, harness, enabled }.
// `models[harness]` wins; the legacy `model` applies when `harness` is absent or equal. Strings are verbatim.
// An override that fails the format check (empty, whitespace, non-string, bad OpenCode form) is
// warned about and dropped: never written, never replaced by another model.
function resolveAgentConfig(agentSlug, harness, pipelineConfig = null) {
    const normSlug = agentSlug.toLowerCase().replace(/-/g, '_');
    const roleCfg = pipelineConfig ? (pipelineConfig[normSlug] || pipelineConfig[agentSlug]) : null;
    let model = null;
    if (roleCfg && typeof roleCfg === 'object') {
        const models = roleCfg.models && typeof roleCfg.models === 'object' ? roleCfg.models : {};
        const field = Object.prototype.hasOwnProperty.call(models, harness) ? `models.${harness}`
            : (roleCfg.model !== undefined && (!roleCfg.harness || roleCfg.harness === harness)) ? 'model' : null;
        if (field) {
            const value = field === 'model' ? roleCfg.model : models[harness];
            const problem = modelProblem(harness, value);
            if (problem) log.warn(`Ignoring ${field} = ${JSON.stringify(value)} for ${agentSlug} on ${harness}: ${problem}. The agent inherits the session model.`);
            else model = value;
        }
    }
    return { model, enabled: !roleCfg || roleCfg.enabled !== false, harness };
}

// Ships the suggested helper-agent models (assets/pipeline.default.json) as a normal, user-editable
// ~/.aos/pipeline.json. Written only when absent ('wx'): an existing file is never touched.
function installPipelineDefault({ targetHome = homeDir } = {}) {
    const src = path.join(srcDir, 'assets', 'pipeline.default.json');
    const dest = path.join(targetHome, '.aos', 'pipeline.json');
    if (!fs.existsSync(src) || fs.existsSync(dest)) return false;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, fs.readFileSync(src), { flag: 'wx' });
    log.step(`Wrote default model suggestions to ${dest} (edit freely; never overwritten)`);
    return true;
}

// Generates .claude/agents/<name>.md — Claude Code's native subagent format.
// Only frontmatter fields confirmed against code.claude.com/docs/en/sub-agents
// are emitted (name, description, model). `model` is optional and omitting it inherits the
// session model, so it is written only for a pipeline.json override, verbatim.
function compileClaudeAgents(agents, targetDir, pipelineConfig = null) {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const a of agents) {
        const slug = a.name.toLowerCase().replace(/_/g, '-');
        const { model } = resolveAgentConfig(slug, 'claude', pipelineConfig);
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
            model ? `model: ${model}` : null,
            '---',
            '',
        ].filter((l) => l !== null).join('\n');

        fs.writeFileSync(path.join(targetDir, `${slug}.md`), frontmatter + body + '\n');
    }
}

// .claude/agents/<slug>.md is shipped and copied to ~/.claude/agents by the
// manifest-tracked "copy harness directories" step. Compiling the same slug
// there first made the two writers fight: the compiled bytes never matched the
// manifest, so every update flagged all 13 personas as user-edited.
function agentsNotShippedAsFiles(agents, shippedDir = path.join(srcDir, '.claude', 'agents')) {
    return agents.filter((a) => !fs.existsSync(path.join(shippedDir, `${a.name.toLowerCase().replace(/_/g, '-')}.md`)));
}

// The shipped personas reach ~/.claude/agents through the manifest copy, so a claude override is
// applied afterwards: insert `model:` and record the new hash. The next update then sees an
// unedited file (disk == manifest), overwrites it with the shipped bytes and applies it again.
// A file the user edited (disk != manifest) or that already has a model line is left alone.
function applyClaudeModelOverrides(agents, targetDir, pipelineConfig, manifest) {
    const applied = [];
    if (!pipelineConfig || !manifest) return applied;
    for (const a of agents) {
        const slug = a.name.toLowerCase().replace(/_/g, '-');
        const { model } = resolveAgentConfig(slug, 'claude', pipelineConfig);
        const file = path.join(targetDir, `${slug}.md`);
        const entry = manifest[file];
        if (!model || !entry || !fs.existsSync(file) || computeFileHash(file) !== entry.sha256) continue;
        const text = fs.readFileSync(file, 'utf8');
        const m = text.match(/^---\n([\s\S]*?)\n---\n/);
        if (!m || /^model:/m.test(m[1])) continue;
        fs.writeFileSync(file, text.replace(m[0], `---\n${m[1]}\nmodel: ${model}\n---\n`));
        entry.sha256 = computeFileHash(file);
        applied.push(file);
    }
    return applied;
}

// With the bdb-aos plugin installed, Claude lists its agents as bdb-aos:<name>; a loose copy in
// ~/.claude/agents doubles ~45 agent prompts per session. Unedited loose copies are backed up (same
// plugin-migration-* backup as skills, so --restore-plugin-backup restores them) and not copied again.
// Agents with a Claude model override in pipeline.json keep their loose copy: plugin agents cannot take one.
function pluginCoveredAgentFiles() {
    if (DRY_RUN || pluginMigrationMode() !== 'on') return [];
    const shippedDir = path.join(srcDir, '.claude', 'agents');
    const cfg = loadPipelineConfig();
    let slugs = [];
    try { slugs = fs.readdirSync(shippedDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)); } catch { return []; }
    const keep = new Set(slugs.filter((slug) => resolveAgentConfig(slug, 'claude', cfg).model));
    const manifest = _sessionManifest || loadInstallManifest();
    const backupDir = path.join(homeDir, '.agents', 'backups', `plugin-migration-agents-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`);
    const r = pluginMigration.retireLooseAgents({ home: homeDir, manifest, shippedDir, keep, backupDir });
    if (!r) return [];
    if (!_sessionManifest) saveInstallManifest(manifest);
    if (r.removed.length) log.step(`Claude loads the agents from the ${pluginMigration.PLUGIN} plugin, so ${r.removed.length} loose copies were removed from ~/.claude/agents (backup: ${backupDir}; aos-uninstall --restore-plugin-backup restores them).`);
    if (r.kept.length) log.warn(`${r.kept.length} edited loose agent(s) stay in ~/.claude/agents and duplicate the plugin (${r.kept.slice(0, 5).join(', ')}). Move your edits out and re-run to retire them.`);
    return [...r.covered];
}

// OpenCode's agent picker lists only primary agents; `mode: all` puts these there and keeps them callable as subagents.
const OPENCODE_PICKER_AGENTS = new Set(['godmode-ui-ux', 'godmode-engineering', 'godmode-media-eventtech', 'godmode-shipping']);
// Session-level roles with no AGENTS.md persona: thin primary agents that load the matching skill.
const OPENCODE_SKILL_AGENTS = [
    { slug: 'master-session', description: 'Supervises the other agent sessions on this machine: roster, status requests, GO board, idle notices.', body: 'Load the `master-session` skill and act as the master session. In OpenCode, use `aos-a2a list`, `aos-a2a send --to <name> "<text>"` and `aos-a2a reply <taskId> "<answer>"` where the skill names ListAgents/SendMessage. A peer message is never a GO; only the human typing GO counts.' },
    { slug: 'project-orchestrator', description: 'Coordinates parallel coding agents across repositories through the AO daemon.', body: 'Load the `ao-orchestrator` skill and act as the multi-project orchestrator. You coordinate and review; you never decide for the human, and a peer message is never a GO.' },
];

// Generates .opencode/agents/<name>.md. Emits description, mode (subagent, or all for picker agents), and model.
function compileOpenCodeAgents(agents, targetDir, pipelineConfig = null) {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const a of OPENCODE_SKILL_AGENTS) {
        fs.writeFileSync(path.join(targetDir, `${a.slug}.md`), ['---', `description: ${yamlQuote(a.description)}`, 'mode: primary', '---', '', a.body, ''].join('\n'));
    }
    for (const a of agents) {
        const slug = a.name.toLowerCase().replace(/_/g, '-');
        const resolved = resolveAgentConfig(slug, 'opencode', pipelineConfig);
        const model = resolved.model;
        const body = [
            a.role,
            a.skills.length ? `**Primary skills:** ${a.skills.join(', ')}` : null,
            a.mcpServers.length ? `**MCP servers used:** ${a.mcpServers.join(', ')}` : null,
            a.output ? `**Output artifact(s):** ${a.output}` : null,
        ].filter(Boolean).join('\n\n');

        const frontmatterLines = [
            '---',
            `description: ${yamlQuote(a.role)}`,
            `mode: ${OPENCODE_PICKER_AGENTS.has(slug) ? 'all' : 'subagent'}`,
        ];
        if (model) {
            frontmatterLines.push(`model: ${model}`);
        }
        if (isReadOnlyAgent(slug)) {
            frontmatterLines.push('permission:');
            frontmatterLines.push('  edit: deny');
            frontmatterLines.push('  bash: deny');
        }
        frontmatterLines.push('---', '');

        fs.writeFileSync(path.join(targetDir, `${slug}.md`), frontmatterLines.join('\n') + body + '\n');
    }
}

// Antigravity loads <dir>/agents/<slug>/agent.md (Markdown, YAML frontmatter, H1 + system prompt); the
// old <name>.json form is no longer written and existing .json files are left alone.
function compileAgyAgents(agents, targetDir, pipelineConfig = null) {
    const items = agents.map((a) => {
        const slug = a.name.toLowerCase().replace(/_/g, '-');
        if (!/^[a-z0-9][a-z0-9._-]*$/.test(slug) || slug.includes('..')) throw new Error(`unsafe agent name: ${JSON.stringify(a.name)}`);
        return { a, slug };
    });
    for (const { a, slug } of items) {
        const file = path.join(targetDir, slug, 'agent.md');
        // A model line only for an explicit pipeline.json override (aos-23: no pinned models); agy documents inherit|flash|pro.
        const model = resolveAgentConfig(slug, 'antigravity', pipelineConfig).model;
        const readOnly = isReadOnlyAgent(slug);
        const text = ['---', 'subagent: true', readOnly ? 'inheritMcp: false' : 'inheritMcp: true', ...(model ? [`model: ${model}`] : []), '---', '', `# ${a.name}`, '', a.systemPrompt, ''].join('\n');
        if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) continue;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    }
}

// Generates ~/.codex/agents/<name>.toml. Format per the Codex subagents docs
// (learn.chatgpt.com/docs/agent-configuration/subagents): required name, description,
// developer_instructions; optional model, sandbox_mode. No model is written (the agent inherits the
// session model) unless the user pinned one for Codex in .aos/pipeline.json.
const CODEX_AGENT_MARKER = '# aos-managed: generated by the AOS installer, rewritten on update';
const CODEX_LEGACY_MARKER = /^# Codex subagent configuration for /;
// Read-only enforcement slugs. This is an explicit allowlist, not a regex, so
// behavior changes only when a slug is added here on purpose. Kept in one place
// and used by the Codex, OpenCode and Antigravity compilers below. The set
// matches the slugs the old regex
// (/review|explor|security|sanitiz|hunter|advocate/) matched among existing
// agents -- reviewer, database-reviewer, security-reviewer,
// silent-failure-hunter, opensource-sanitizer, devils-advocate -- plus the new
// reviewer-1/reviewer-2; Codex behavior for existing agents is unchanged, and
// these additionally get OpenCode deny permissions and agy no-MCP inheritance.
const READ_ONLY_AGENT_SLUGS = new Set([
    'reviewer',
    'reviewer-1',
    'reviewer-2',
    'security-reviewer',
    'database-reviewer',
    'silent-failure-hunter',
    'devils-advocate',
    'opensource-sanitizer',
    // ECC language reviewers (v5/ecc-reviewers): strictly read-only by
    // frontmatter tools and by allowlist enforcement here.
    'go-reviewer',
    'python-reviewer',
    'rust-reviewer',
    'typescript-reviewer',
    'java-reviewer',
    'kotlin-reviewer',
    'cpp-reviewer',
    'csharp-reviewer',
    // ECC remaining reviewers and analyzers:
    'code-reviewer',
    'django-reviewer',
    'fastapi-reviewer',
    'flutter-reviewer',
    'fsharp-reviewer',
    'healthcare-reviewer',
    'mle-reviewer',
    'network-config-reviewer',
    'php-reviewer',
    'rag-pipeline-reviewer',
    'react-reviewer',
    'swift-reviewer',
    'vue-reviewer',
    'pr-test-analyzer',
    'comment-analyzer',
    'type-design-analyzer',
]);
const isReadOnlyAgent = (slug) => READ_ONLY_AGENT_SLUGS.has(slug);

const codexSandboxMode = (slug) => (isReadOnlyAgent(slug) ? 'read-only' : 'workspace-write');

// Ours = carries the current marker or the pre-4.18.2 header; anything else is a user's agent file.
function isAosCodexAgentFile(file) {
    try {
        const first = fs.readFileSync(file, 'utf8').split('\n', 1)[0];
        return first === CODEX_AGENT_MARKER || CODEX_LEGACY_MARKER.test(first);
    } catch { return false; }
}

function compileCodexAgents(agents, targetDir, pipelineConfig = null) {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const a of agents) {
        const slug = a.name.toLowerCase().replace(/_/g, '-');
        const file = path.join(targetDir, `${slug}.toml`);
        if (fs.existsSync(file) && !isAosCodexAgentFile(file)) {
            log.warn(`Codex agent ${file} is not AOS-managed; left untouched.`);
            continue;
        }
        const resolved = resolveAgentConfig(slug, 'codex', pipelineConfig);
        const pinned = resolved.model;

        const instructions = [
            a.skills.length ? `**Primary skills:** ${a.skills.join(', ')}` : null,
            a.mcpServers.length ? `**MCP servers used:** ${a.mcpServers.join(', ')}` : null,
            a.output ? `**Output artifact(s):** ${a.output}` : null,
            a.systemPrompt
        ].filter(Boolean).join('\n\n');

        const lines = [
            CODEX_AGENT_MARKER,
            `name = ${JSON.stringify(slug)}`,
            `description = ${JSON.stringify(a.role)}`,
            pinned ? `model = ${JSON.stringify(pinned)}` : null,
            `sandbox_mode = "${codexSandboxMode(slug)}"`,
            `developer_instructions = ${JSON.stringify(instructions)}`
        ].filter(Boolean);
        fs.writeFileSync(file, lines.join('\n') + '\n');
    }
}


function injectHarnessRules() {
    const rulesMdSrc = path.join(srcDir, 'RULES.md');
    const agentsMdSrc = path.join(srcDir, '.agents', 'AGENTS.md');
    const active = activeHarnessKeys();

    if (fs.existsSync(rulesMdSrc)) {
        if (active.has('antigravity')) installStep(`install RULES.md to ${path.join(geminiDir, 'RULES.md')}`, () => {
            // Managed-block upsert: a user's own content in RULES.md / GEMINI.md is never
            // overwritten. AOS replaces only its marker-delimited block, which
            // `aos uninstall` strips again (and the file with it if nothing user-owned remains).
            const rulesBody = fs.readFileSync(rulesMdSrc, 'utf8');
            const rulesTarget = path.join(geminiDir, 'RULES.md');
            // Keep GEMINI.md in sync for backwards compatibility with Antigravity CLI harnesses
            const geminiTarget = path.join(geminiDir, 'GEMINI.md');
            try {
                for (const target of [rulesTarget, geminiTarget]) writeManagedRulesFile(target, rulesBody);
            } catch (e) { logDebug(e, 'managed-block upsert for RULES.md/GEMINI.md'); }
            log.step(`Installed RULES.md as managed block to ${rulesTarget} (and GEMINI.md); user content preserved`);
        }, 'The harness injection below still runs.');

        // Dispatcher scripts must land in ~/.claude/workflows/, because that is
        // where the skills that route to them look: startcycle-graph's SKILL.md
        // and teamwork-preview's both tell the model to call `Workflow` with
        // scriptPath `$HOME/.claude/workflows/<name>.mjs`. installProjectHarness()
        // copies them into a *project*, which only helps a project that opted into
        // the local harness -- on a plain global install those paths did not exist
        // at all, so the skill pointed at a file that was never delivered.
        if (active.has('claudecode')) installStep(`install dispatcher workflows to ${path.join(claudeConfigDir(homeDir), 'workflows')}`, () => {
            const workflowsSrc = path.join(srcDir, '.claude', 'workflows');
            if (fs.existsSync(workflowsSrc)) {
                copyDirRecursiveSync(workflowsSrc, path.join(claudeConfigDir(homeDir), 'workflows'));
                log.step(`Installed dispatcher workflows to ${path.join(claudeConfigDir(homeDir), 'workflows')}`);
            }
        }, '/startcycle-graph and /teamwork-preview fall back to their prose protocols.');

        const startcycleWorkflowSrc = path.join(srcDir, '.agents', 'workflows', 'startcycle.md');
        const sources = installStep('read the global rule sources', () => ({
            globalRules: fs.readFileSync(rulesMdSrc, 'utf8'),
            startcycleContent: fs.existsSync(startcycleWorkflowSrc) ? fs.readFileSync(startcycleWorkflowSrc, 'utf8') : '',
            agentsMdContent: fs.existsSync(agentsMdSrc) ? fs.readFileSync(agentsMdSrc, 'utf8') : ''
        }), 'Cursor, Claude, Copilot and Codex keep their current instruction files.');

        if (sources.ok) {
            const { globalRules, startcycleContent, agentsMdContent } = sources.value;

            // F8: an install or update started inside a repo must not write into that repo (.github,
            // .codex-plugin, .roomodes); a repo gets files only via --project-harness.
            // ~/CLAUDE.md and ~/AGENTS.md are home files and are synced from any working directory.
            const cwdIsHome = path.resolve(currentDir) === path.resolve(homeDir);
            if (!cwdIsHome) log.step(`Not run from the home directory: no project rule files written into ${currentDir}`);

            if (active.has('antigravity')) installStep('compile Antigravity subagents', () => {
                if (agentsMdContent) {
                    const agyAgentsDir = path.join(geminiDir, 'config', 'agents');
                    const agents = parseAgentsMd(agentsMdContent);
                    const packAgents = loadPackAgents();
                    compileAgyAgents([...agents, ...packAgents], agyAgentsDir, loadPipelineConfig());
                    log.step(`Compiled AGENTS.md to native Antigravity subagents in ${agyAgentsDir}`);
                }
            }, 'Antigravity agents unchanged');

            if (active.has('claudecode')) installStep('compile Claude Code subagents', () => {
                if (agentsMdContent) {
                    const pipelineConfig = loadPipelineConfig();
                    const agents = parseAgentsMd(agentsMdContent);
                    const packAgents = loadPackAgents();
                    const allAgents = agentsNotShippedAsFiles([...agents, ...packAgents]);
                    const claudeAgentsDir = path.join(claudeConfigDir(homeDir), 'agents');
                    compileClaudeAgents(allAgents, claudeAgentsDir, pipelineConfig);
                    log.step(`Compiled AGENTS.md to Claude Code subagents in ${claudeAgentsDir}`);
                }
            }, 'Claude Code agents unchanged');

            if (active.has('opencode')) installStep('compile OpenCode subagents', () => {
                if (agentsMdContent) {
                    const pipelineConfig = loadPipelineConfig();
                    const agents = parseAgentsMd(agentsMdContent);
                    const packAgents = loadPackAgents();
                    const opencodeAgentsDir = path.join(homeDir, '.config', 'opencode', 'agents');
                    compileOpenCodeAgents([...agents, ...packAgents], opencodeAgentsDir, pipelineConfig);
                    log.step(`Compiled AGENTS.md to OpenCode subagents in ${opencodeAgentsDir}`);
                }
            }, 'OpenCode agents unchanged');

            if (active.has('codex')) installStep('compile Codex subagents', () => {
                if (agentsMdContent) {
                    const pipelineConfig = loadPipelineConfig();
                    const agents = parseAgentsMd(agentsMdContent);
                    const packAgents = loadPackAgents();
                    const codexAgentsDir = path.join(homeDir, '.codex', 'agents');
                    compileCodexAgents([...agents, ...packAgents], codexAgentsDir, pipelineConfig);
                    log.step(`Compiled AGENTS.md to Codex subagents in ${codexAgentsDir}`);
                }
            }, 'Codex agents unchanged');

            const claudeMdPath = path.join(homeDir, 'CLAUDE.md');
            installStep(`sync ${claudeMdPath}`, () => {
                let claudeContent = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, 'utf8') : '';
                // ~/CLAUDE.md is a pointer only to ~/AGENTS.md (canonical home for destructive and routing blocks).
                // It must not carry destructive-actions or routing blocks.
                let next = stripRoutingBlock(stripDestructiveBlock(claudeContent));
                next = next.replace(/\(CLAUDE\.md\/GEMINI\.md sind Symlinks darauf\)/g, '(CLAUDE.md/RULES.md verweisen darauf)');
                next = next.replace(/CLAUDE\.md \/ GEMINI\.md in den Repos sind Symlinks darauf/g, 'CLAUDE.md / RULES.md in den Repos verweisen darauf');
                next = next.replace(/Harness files: `CLAUDE\.md`, `RULES\.md` and `CODEX\.md` are symlinks to this/g, 'Harness files: `CLAUDE.md`, `RULES.md` and `CODEX.md` point to this');

                if (!next.trim()) {
                    next = '# AOS Rules\n\n**See [AGENTS.md](AGENTS.md) for the definitive rules — they apply to all harnesses.**\n';
                } else if (!next.includes('AGENTS.md')) {
                    next = `**Read [AGENTS.md](AGENTS.md) first.**\n\n${next}`;
                }

                if (next !== claudeContent) {
                    fs.writeFileSync(claudeMdPath, next);
                    log.step('Synced ~/CLAUDE.md as pointer to AGENTS.md (blocks live canonically in AGENTS.md)');
                } else {
                    log.step('~/CLAUDE.md already a clean pointer to AGENTS.md.');
                }
            }, 'CLAUDE.md is unchanged.');

            const copilotPath = path.join(currentDir, '.github', 'copilot-instructions.md');
            if (cwdIsHome && fs.existsSync(path.dirname(copilotPath))) {
                installStep(`inject the global rules into ${copilotPath}`, () => {
                    const copilotContent = fs.existsSync(copilotPath) ? fs.readFileSync(copilotPath, 'utf8') : '';
                    let next = copilotContent;
                    if (!next.includes("Global Agent Instructions") && !next.includes(DESTRUCTIVE_START)) {
                        next = `${next}\n\n${globalRules}`;
                    }
                    next = upsertRoutingBlock(upsertDestructiveBlock(next));
                    if (next !== copilotContent) {
                        fs.writeFileSync(copilotPath, next);
                        log.step(`Injected Global Rules to ${copilotPath}`);
                    }
                }, 'copilot-instructions.md is unchanged.');
            }

            const codexDirLocal = path.join(currentDir, '.codex-plugin');
            if (cwdIsHome && active.has('codex')) installStep(`sync ${path.join(codexDirLocal, 'system.md')}`, () => {
                fs.mkdirSync(codexDirLocal, { recursive: true });
                const codexPath = path.join(codexDirLocal, 'system.md');
                let codexContent = fs.existsSync(codexPath) ? fs.readFileSync(codexPath, 'utf8') : '';
                if (!codexContent.includes("Global Agent Instructions") && !codexContent.includes(DESTRUCTIVE_START)) {
                    codexContent = `${codexContent}\n\n${globalRules}`.trim();
                }
                if (startcycleContent && !codexContent.includes("Autonomous Development Cycle Workflow")) {
                    codexContent = `${codexContent}\n\n---\n\n${startcycleContent}`.trim();
                }
                codexContent = upsertRoutingBlock(upsertDestructiveBlock(codexContent));
                fs.writeFileSync(codexPath, codexContent);
                log.step('Synced .codex-plugin/system.md with Global Rules and /startcycle workflow');
            }, '.codex-plugin/system.md is unchanged.');

            const homeAgentsPath = path.join(homeDir, 'AGENTS.md');
            installStep(`sync ${homeAgentsPath}`, () => {
                if (!fs.existsSync(homeAgentsPath)) {
                    log.step(`${homeAgentsPath} does not exist: not created, only existing files get the managed blocks.`);
                    return;
                }
                const agentsContent = fs.readFileSync(homeAgentsPath, 'utf8');
                let next = agentsContent;
                next = next.replace(/\(CLAUDE\.md\/GEMINI\.md sind Symlinks darauf\)/g, '(CLAUDE.md/RULES.md verweisen darauf)');
                next = next.replace(/CLAUDE\.md \/ GEMINI\.md in den Repos sind Symlinks darauf/g, 'CLAUDE.md / RULES.md in den Repos verweisen darauf');
                next = next.replace(/Harness files: `CLAUDE\.md`, `RULES\.md` and `CODEX\.md` are symlinks to this/g, 'Harness files: `CLAUDE.md`, `RULES.md` and `CODEX.md` point to this');
                next = next.replace(/- \*\*Globale Regeln\*\* \(Core-Behavior, Safety, GO-Protokoll, Skill-Routing\): `~\/CLAUDE\.md` \(gilt für alle Harnesses; Codex\/OpenCode lesen zusätzlich diese Datei\) bzw\. `~\/\.gemini\/antigravity-cli\/GEMINI\.md`\n?/g, '');
                next = upsertRoutingBlock(upsertDestructiveBlock(next));
                if (next !== agentsContent) {
                    fs.writeFileSync(homeAgentsPath, next);
                    log.step(`Synced managed blocks in ${homeAgentsPath}`);
                }
            }, '~/AGENTS.md is unchanged.');
        }
    }

    // Only .roomodes lands in the working directory; hooks, deny rules and harness dirs go to home from any cwd.
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
        if (path.resolve(currentDir) === path.resolve(homeDir) && active.has('vscode')) installStep(`write ${rooModesPath}`, () => {
            fs.writeFileSync(rooModesPath, JSON.stringify(rooModesData, null, 2));
            log.step(`Synced Roo Code custom modes to ${rooModesPath}`);
        }, 'Roo Code keeps its existing custom modes.');

        installStep('copy harness directories', () => {
            const harnessKey = { '.cursor/rules': 'cursor', '.claude': 'claudecode', '.github': 'vscode' };
            const harnessDirs = ['.agents', '.cursor/rules', '.claude', '.github'].filter((d) => !harnessKey[d] || active.has(harnessKey[d]));
            harnessDirs.forEach(dir => {
                const sourcePath = path.join(srcDir, dir);
                if (fs.existsSync(sourcePath)) {
                    const targetPath = path.join(homeDir, dir);
                    // settings.json is merged separately below: a wholesale
                    // copy would clobber user-owned keys like enabledPlugins.
                    // hooks: installGlobalHooks delivers only what each harness wires.
                    let exclude = dir === '.claude' ? ['settings.json', 'hooks', ...pluginCoveredAgentFiles()] : dir === '.agents' ? AGENTS_COPY_EXCLUDE : [];
                    // Only ship antigravity-rtk-rules.md if rtk is detected on PATH
                    if (dir === '.agents') {
                        if (!hasExecutable('rtk')) exclude = [...exclude, 'rules/antigravity-rtk-rules.md'];
                    }
                    copyDirRecursiveSync(sourcePath, targetPath, exclude);
                    log.step(`Copied ${dir} to ${targetPath}`);
                }
            });
            installGlobalHooks({ harnesses: active });
        }, '');

        installStep('write the default ~/.aos/pipeline.json', () => {
            if (!DRY_RUN) installPipelineDefault();
        }, 'Helper agents of /startcycle-graph then inherit the session model.');

        installStep('apply Claude model overrides to the shipped agents', () => {
            if (DRY_RUN || !_sessionManifest || !active.has('claudecode')) return;
            const applied = applyClaudeModelOverrides(parseAgentsMd(fs.readFileSync(agentsMdSrc, 'utf8')), path.join(claudeConfigDir(homeDir), 'agents'), loadPipelineConfig(), _sessionManifest);
            if (applied.length) log.step(`Applied pipeline.json model overrides to ${applied.length} Claude agent file(s)`);
        }, 'Shipped Claude agents keep inheriting the session model.');

        installStep('sync global .agents/', () => {
            const globalAgentsDir = path.join(os.homedir(), '.agents');
            const agentsDirSrc = path.join(srcDir, '.agents');
            if (fs.existsSync(agentsDirSrc)) {
                copyDirRecursiveSync(agentsDirSrc, globalAgentsDir, AGENTS_COPY_EXCLUDE);
                log.step(`Synced global .agents/ to ${globalAgentsDir}`);
            }
        }, 'agents.md and workflows/startcycle.md may be missing globally.');
    }
}

// Optional third-party OpenCode components. Off unless named in
// AOS_OPENCODE_OPTIONAL=ponytail,loop,rtk or --opencode-optional=ponytail,loop,rtk.
// Pinned entries only; the foreign installers (opencode-loop's npx installer, rtk init)
// are never run because they rewrite the user's opencode config.
const OPENCODE_OPTIONAL_PINS = {
    ponytail: '@dietrichgebert/ponytail@4.10.0',
    loop: '@bybrawe/opencode-loop@0.6.2',
};
const OPENCODE_RTK_HINT = 'rtk is not installed by AOS. Run yourself: brew install rtk && rtk init -g --opencode';
const OPENCODE_LOOP_SHELL_WARNING = 'opencode-loop: /loop-shell style commands run shell commands as child processes. ' +
    'tool.execute.before, and so the AOS go-gate, may never see them (unverified). ' +
    'Do not schedule git push, publish or other gated commands through them.';

let codenotchResult = null;
async function maybeInstallCodenotch() {
    if (process.platform !== 'darwin' && process.platform !== 'win32') return;
    const codenotch = require('./lib/codenotch.js');
    codenotchResult = await codenotch.runCodenotchStep({
        interactive: !isAutoYes,
        dryRun: DRY_RUN,
        ask: async (message, initialValue = true) => { const a = await askConfirm({ message, initialValue }); return !isCancel(a) && !!a; },
        log: { info: (m) => log.info(m), warn: (m) => log.warn(m), success: (m) => log.success(m) },
    });
    const line = codenotch.codenotchSummaryLine(codenotchResult);
    const failed = codenotchResult?.status === 'error' || /FAILED/.test(line || '');
    if (line) (failed ? log.warn : log.info)(line);
    return failed ? false : undefined;
}

function parseOpencodeOptional(argv = process.argv, env = process.env) {
    const flag = argv.find((a) => a.startsWith('--opencode-optional='));
    const raw = [env.AOS_OPENCODE_OPTIONAL, flag && flag.slice('--opencode-optional='.length)].filter(Boolean).join(',');
    return new Set(raw.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
}

// Opt-in OpenCode permission. Off unless AOS_OPENCODE_PERMISSION=external_directory or
// --opencode-permission=external_directory. Only permission.external_directory is ever set,
// as path patterns (object form verified in the OpenCode config schema; ~ expands per its docs).
const OPENCODE_EXTERNAL_DIRECTORY_RULES = { '~/.agents/**': 'allow', '~/.config/opencode/**': 'allow' };

function parseOpencodePermission(argv = process.argv, env = process.env) {
    const flag = argv.find((a) => a.startsWith('--opencode-permission='));
    const raw = [env.AOS_OPENCODE_PERMISSION, flag && flag.slice('--opencode-permission='.length)].filter(Boolean).join(',');
    return new Set(raw.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
}

function applyOpencodePermission(data, configPath, wanted) {
    for (const name of wanted) {
        if (name !== 'external_directory') log.warn(`Unknown OpenCode permission "${name}" ignored.`);
    }
    if (!wanted.has('external_directory') || DRY_RUN) return;
    const perm = data.permission;
    if (perm !== undefined && (perm === null || typeof perm !== 'object' || Array.isArray(perm))) {
        log.warn('opencode.jsonc "permission" is not an object (string shorthand?); external_directory not set, left untouched.');
        return;
    }
    if (perm && 'external_directory' in perm) {
        if (JSON.stringify(perm.external_directory) !== JSON.stringify(OPENCODE_EXTERNAL_DIRECTORY_RULES)) {
            log.message('opencode.jsonc already has permission.external_directory; left untouched.');
        }
        return;
    }
    if (configPath && fs.existsSync(configPath)) {
        const loaded = loadJsonConfig(configPath);
        if (loaded.state === 'invalid') {
            log.warn(`Could not parse ${configPath}; permission.external_directory not set.`);
            return;
        }
        const bak = `${configPath}.${timestamp}.bak`;
        try { backupOnce(configPath, () => { fs.copyFileSync(configPath, bak); return bak; }); } catch (e) {
            log.warn(`Could not back up ${configPath}, skipping permission.external_directory: ${e.message}`);
            return;
        }
    }
    data.permission = Object.assign(perm || {}, { external_directory: { ...OPENCODE_EXTERNAL_DIRECTORY_RULES } });
    log.step('Added opt-in OpenCode permission.external_directory for AOS paths (comments in opencode.jsonc are not preserved on rewrite)');
}

const pluginPackageName = (entry) => {
    const str = typeof entry === 'string' ? entry : (Array.isArray(entry) ? String(entry[0]) : '');
    return str.replace(/(?<=.)@[^@/]*$/, '');
};

// OpenCode auto-loads plugins/*.js and also loads plugin[] paths, then dedupes by file
// URL (verified in the 1.18.30 binary strings, not by running it). Same path = one load;
// a second differing spelling would load the gate and loop keeper twice.
function warnOnDuplicateAosPlugin(plugins, canonical) {
    const norm = (v) => String(Array.isArray(v) ? v[0] : v).replace(/\\/g, '/');
    const others = plugins.filter((p) => /bdb-aos\.js$/.test(norm(p)) && norm(p) !== canonical);
    if (others.length > 0) {
        log.warn(`opencode.jsonc lists bdb-aos.js under another path (${others.map(norm).join(', ')}). ` +
            `plugins/bdb-aos.js is auto-loaded too; remove the extra entry to avoid a double gate.`);
    }
}

function appendOptionalOpencodePlugins(data, configPath, optional) {
    const wanted = optional instanceof Set ? optional : new Set(optional || []);
    for (const name of wanted) {
        if (!(name in OPENCODE_OPTIONAL_PINS) && name !== 'rtk') log.warn(`Unknown OpenCode optional component "${name}" ignored.`);
    }
    if (wanted.has('rtk')) log.message(OPENCODE_RTK_HINT);
    let backedUp = false;
    for (const name of Object.keys(OPENCODE_OPTIONAL_PINS)) {
        if (!wanted.has(name) || DRY_RUN) continue;
        const pin = OPENCODE_OPTIONAL_PINS[name];
        if (data.plugin.some((p) => pluginPackageName(p) === pluginPackageName(pin))) continue;
        if (!backedUp && configPath && fs.existsSync(configPath)) {
            const bak = `${configPath}.${timestamp}.bak`;
            try { backupOnce(configPath, () => { fs.copyFileSync(configPath, bak); return bak; }); backedUp = true; } catch (e) {
                log.warn(`Could not back up ${configPath}, skipping optional ${name}: ${e.message}`);
                continue;
            }
        }
        data.plugin.push(pin);
        log.step(`Added opt-in OpenCode plugin ${pin}`);
    }
    if (data.plugin.some((p) => pluginPackageName(p) === pluginPackageName(OPENCODE_OPTIONAL_PINS.loop))) {
        log.warn(OPENCODE_LOOP_SHELL_WARNING);
    }
}

// Idempotent and edit-safe: a file is overwritten only when it is absent, already
// identical, or still byte-equal to what this installer last recorded. Anything else
// (user edit, or an untracked file with the same name) is kept and the shipped copy
// lands as <file>.new. Files the installer did not create are never removed.
function installOpencodeCommands(srcDirPath, destDirPath) {
    if (DRY_RUN) {
        log.message(`[dry-run] install OpenCode commands: ${srcDirPath} -> ${destDirPath}`);
        return;
    }
    const ownsManifest = !_sessionManifest;
    const manifest = _sessionManifest || loadInstallManifest();
    fs.mkdirSync(destDirPath, { recursive: true });
    let wrote = 0;
    for (const file of fs.readdirSync(srcDirPath)) {
        const src = path.join(srcDirPath, file);
        if (!fs.statSync(src).isFile()) continue;
        const dest = path.join(destDirPath, file);
        const srcHash = computeFileHash(src);
        const diskHash = fs.existsSync(dest) ? computeFileHash(dest) : null;
        if (diskHash === null || diskHash === srcHash || diskHash === manifest[dest]?.sha256 || SHIPPED_HASHES.has(diskHash)) {
            if (diskHash !== srcHash) { fs.copyFileSync(src, dest); wrote++; }
            manifest[dest] = { path: dest, sha256: srcHash, version: pkg.version, installedAt: new Date().toISOString() };
        } else {
            fs.copyFileSync(src, `${dest}.new`);
            keptUserEdits.push(dest);
        }
    }
    if (ownsManifest) {
        saveInstallManifest(manifest);
        reportKeptUserEdits();
    }
    if (wrote) log.step(`OpenCode commands in ${destDirPath}: ${wrote} written`);
}

// Copy the OpenCode plugin + command payload and register both in
// opencode.jsonc. This is the single copy site: the Quick Update path
// (injectHarnessRules -> installGlobalHooks) and the fresh-install path
// (universalHarnessSync -> syncOpencodeConfig) both reach it, so a version that
// adds or changes the plugin can no longer ship to one path and miss the other.
//
// `data` is mutated in place when the caller owns the config write (Universal
// Sync merges MCP servers in the same pass and writes once). When `data` is
// omitted the function loads and saves the config itself, which is what lets the
// Quick Update path register the plugin as well as copy it.
function installOpencodePlugin({ targetHome = homeDir, configPath = null, data = null, optional = parseOpencodeOptional(), permission = parseOpencodePermission() } = {}) {
    const opencodeDir = configPath
        ? path.dirname(configPath)
        : path.join(targetHome, '.config', 'opencode');

    const pluginSrc = path.join(srcDir, '.opencode', 'plugins', 'bdb-aos.js');
    let pluginInstalled = false;
    if (fs.existsSync(pluginSrc)) {
        const pluginDest = path.join(opencodeDir, 'plugins', 'bdb-aos.js');
        try {
            // Only when the plugin is missing or differs from the shipped one; an identical copy is left alone, silently.
            const upToDate = fs.existsSync(pluginDest) && computeFileHash(pluginDest) === computeFileHash(pluginSrc);
            if (!upToDate) {
                fs.mkdirSync(path.dirname(pluginDest), { recursive: true });
                fs.copyFileSync(pluginSrc, pluginDest);
                try { fs.chmodSync(pluginDest, 0o644); } catch (e) { logDebug(e, 'chmod opencode plugin'); }
                log.step(`Installed OpenCode plugin to ${pluginDest}`);
            }
            pluginInstalled = true;
            uninstallRecords.recordOpencodePlugin(targetHome, pluginDest);
        } catch (e) {
            log.warn(`Could not install OpenCode plugin: ${e.message}`);
        }
    }

    // The plugin imports its decision logic from ./aos-hooks/ next to itself.
    const hooksSrc = path.join(srcDir, '.claude', 'hooks');
    if (fs.existsSync(hooksSrc)) {
        try {
            copyDirRecursiveSync(hooksSrc, path.join(opencodeDir, 'plugins', 'aos-hooks'));
        } catch (e) {
            log.error(`Could not install OpenCode plugin hooks (OpenCode gates inactive): ${e.message}`);
        }
    }

    const trailLibSrc = path.join(srcDir, '.opencode', 'plugins', 'lib');
    if (fs.existsSync(trailLibSrc)) {
        try { copyDirRecursiveSync(trailLibSrc, path.join(opencodeDir, 'plugins', 'lib')); } catch (e) { log.warn(`Could not install OpenCode plugin lib: ${e.message}`); }
    }

    // Profile flag for the plugin (context behaviours only; gates and A2A are never switched off).
    if (pluginInstalled && !DRY_RUN) {
        try {
            const gateEffective = gateOnFor('opencode');
            const flag = require('./lib/opencode-profile').writeProfileFlag(opencodeDir, contextHooksOn, memoryOn, gateEffective);
            if (flag.changed) log.step(`OpenCode plugin profile: contextHooks=${contextHooksOn !== false}, memory=${memoryOn}, gate=${gateEffective}`);
            uninstallRecords.recordOpencodeProfile(targetHome, flag.file);
        } catch (e) {
            log.warn(`Could not write OpenCode plugin profile flag: ${e.message}`);
        }
    }

    // The plugin imports ../../lib/a2a-inbox.mjs and ../../lib/a2a-session.mjs
    // directly; two levels above plugins/ is the opencode config dir's parent,
    // so the a2a lib must land there or the plugin fails to load.
    installA2aLibCopies({ targetHome, opencodeDir });

    // Slash-command payloads (/startcycle-graph and the generated /bdb-aos-<cmd> files).
    const commandsSrc = path.join(srcDir, '.opencode', 'commands');
    if (fs.existsSync(commandsSrc)) {
        try {
            installOpencodeCommands(commandsSrc, path.join(opencodeDir, 'commands'));
        } catch (e) {
            log.warn(`Could not install OpenCode commands: ${e.message}`);
        }
    }

    if (!pluginInstalled) return data;

    const ownsWrite = data === null;
    let beforeSerialized = null;
    if (ownsWrite) {
        if (!configPath) return data;
        const loaded = loadJsonConfig(configPath);
        if (loaded.state === 'invalid') { warnUnparseable(configPath, 'OpenCode plugin registration', loaded); return null; }
        const existing = loaded.data;
        // Snapshot before mutating: `data` becomes the same object, so
        // comparing afterwards would always report "unchanged".
        beforeSerialized = JSON.stringify(existing, null, 2);
        data = existing;
    }

    // Register the plugin.
    if (!Array.isArray(data.plugin)) data.plugin = [];
    const pluginPathNormalized = path.join(opencodeDir, 'plugins', 'bdb-aos.js').replace(/\\/g, '/');
    const alreadyRegistered = data.plugin.some(p => {
        const str = typeof p === 'string' ? p : (Array.isArray(p) ? p[0] : '');
        return str.includes('bdb-aos');
    });
    if (!alreadyRegistered) data.plugin.push(pluginPathNormalized);
    warnOnDuplicateAosPlugin(data.plugin, pluginPathNormalized);
    appendOptionalOpencodePlugins(data, configPath, optional);

    // Skill paths. `.agents/skills` stays project-relative on purpose: it is the
    // per-project contract, and OpenCode resolves it against each project, so it
    // is meaningful in a bootstrapped project and inert elsewhere. The absolute
    // ~/.agents/skills is added only when it is really there -- registering a
    // path that does not exist is the defect this replaces.
    const homeAgentsSkills = path.join(targetHome, '.agents', 'skills').replace(/\\/g, '/');
    const desired = ['.agents/skills'];
    if (fs.existsSync(homeAgentsSkills)) desired.unshift(homeAgentsSkills);
    if (!data.skills || typeof data.skills !== 'object' || !Array.isArray(data.skills.paths)) {
        data.skills = { paths: desired.slice() };
    } else {
        for (const p of desired) {
            if (!data.skills.paths.includes(p)) data.skills.paths.push(p);
        }
    }

    applyOpencodePermission(data, configPath, permission instanceof Set ? permission : new Set(permission || []));

    if (ownsWrite) {
        // Write only on a real change. readJsoncFile strips comments, so
        // serialising an unchanged config would silently eat a user's comments
        // for no benefit. When a write is genuinely needed the comments in the
        // file are lost -- acceptable, and worth saying out loud in the PR.
        const serialized = JSON.stringify(data, null, 2);
        if (beforeSerialized === serialized) return data;
        try {
            if (fs.existsSync(configPath)) backupOnce(configPath, () => { const b = `${configPath}.${timestamp}.bak`; fs.copyFileSync(configPath, b); return b; });
            fs.mkdirSync(path.dirname(configPath), { recursive: true });
            fs.writeFileSync(configPath, serialized, { mode: 0o600 });
            try { fs.chmodSync(configPath, 0o600); } catch (e) { logDebug(e, 'chmod opencode config'); }
        } catch (e) {
            log.warn(`Could not write ${configPath}: ${e.message}`);
        }
    }
    return data;
}

// Deliver the hook scripts to ~/.claude/hooks/ and wire them in settings.json.
// Both the full install and Quick Update funnel through here. Quick Update used
// to do neither: it refreshes skills and submodules, but hooks are harness
// plumbing rather than skills, so an existing install updating to a version
// that adds or changes a hook silently never received it -- which is exactly
// what happened to memb-inject.mjs in v4.4.0, on the machines that needed it
// most (a fresh install got it; every machine that already had AOS did not).
// harnesses: Set of harness keys to write for; null (tests, direct callers) means all of them.
function installGlobalHooks({ targetHome = homeDir, targetGemini = geminiDir, harnesses = null, dryRun = DRY_RUN } = {}) {
    const on = (k) => !harnesses || harnesses.has(k);
    const workflowsSrc = path.join(srcDir, '.claude', 'workflows');

    // Every harness gets only the scripts it wires (lib/v5/profile.js HARNESS_HOOKS), before any merge or self-check runs.
    installHarnessHookCopies({ targetHome, targetGemini, harnesses });

    // 1. Claude Code
    if (on('claudecode') && fs.existsSync(workflowsSrc)) {
        copyDirRecursiveSync(workflowsSrc, path.join(claudeConfigDir(targetHome), 'workflows'));
    }
    // rules-inject.mjs reads the rules text from here when it does not run from a checkout.
    const rulesLib = path.join(srcDir, 'lib', 'destructive-rules.js');
    if (fs.existsSync(rulesLib)) copyDirRecursiveSync(rulesLib, path.join(targetHome, '.agents', 'lib', 'destructive-rules.js'));
    const routingRulesLib = path.join(srcDir, 'lib', 'routing-rules.js');
    if (fs.existsSync(routingRulesLib)) copyDirRecursiveSync(routingRulesLib, path.join(targetHome, '.agents', 'lib', 'routing-rules.js'));
    // session-cap.mjs (memb-inject, aos-session-hint) reads the per-context-profile SessionStart cap from here outside a checkout.
    const ctxProfilesLib = path.join(srcDir, 'lib', 'v5', 'context-profiles.js');
    if (fs.existsSync(ctxProfilesLib)) copyDirRecursiveSync(ctxProfilesLib, path.join(targetHome, '.agents', 'lib', 'context-profiles.js'));
    // aos-acp (installed in ~/.agents/bin) loads ../lib/cli-spawn.js to start npx/opencode .cmd shims on Windows.
    const cliSpawnLib = path.join(srcDir, 'lib', 'cli-spawn.js');
    if (fs.existsSync(cliSpawnLib)) copyDirRecursiveSync(cliSpawnLib, path.join(targetHome, '.agents', 'lib', 'cli-spawn.js'));
    const claudeSettings = path.join(claudeConfigDir(targetHome), 'settings.json');
    if (on('claudecode')) {
        mergeBdbSettingsHooks(claudeSettings);
        const deny = uninstallRecords.addClaudeDeny({ home: targetHome, settingsPath: claudeSettings, rules: CLAUDE_DENY_RULES });
        if (deny.length) log.step(`Added ${deny.length} permissions.deny rule(s) for home-level deletes to ${claudeSettings}`);
        ensureClaudeDefaultMode(claudeSettings, { dryRun });
    }
    // a2a-inbox.mjs (drain + stop) ships inside the hooks dir copy above and is
    // wired by mergeBdbSettingsHooks from the shipped settings template. The
    // optional SessionStart sidecar hook registers only when the hook file is
    // actually shipped in the package.
    if (on('claudecode')) installClaudeA2aSessionHook({ targetHome });
    installA2aLibCopies({ targetHome, targetGemini });

    // 2. Google Antigravity
    const agyWorkflowsDir = path.join(targetGemini, 'config', 'workflows');
    if (on('antigravity') && fs.existsSync(workflowsSrc)) {
        copyDirRecursiveSync(workflowsSrc, agyWorkflowsDir);
    }
    if (on('antigravity')) mergeAntigravityHooks(path.join(targetGemini, 'config', 'hooks.json'));
    const agyCliDir = path.join(targetGemini, 'antigravity-cli');
    if (on('antigravity') && fs.existsSync(agyCliDir)) {
        const agyCliWorkflowsDir = path.join(agyCliDir, 'workflows');
        if (fs.existsSync(workflowsSrc)) {
            copyDirRecursiveSync(workflowsSrc, agyCliWorkflowsDir);
        }
        mergeAntigravityHooks(path.join(agyCliDir, 'hooks.json'));
    }

    // A2A inbox MCP for agy is print-only: the installer never runs agy (WP-INSTALL
    // fact 3 / fork-bomb rule), and agy is a delegation target, so it must never
    // carry a sidecar hook either. The registry-style mcp add args mirror
    // agyMcpAddArgs in lib/a2a-agy.mjs (kept inline here: installer is CJS, the
    // a2a lib is ESM).
    const agyA2aMcpSrc = path.join(srcDir, 'bin', 'aos-a2a-mcp.mjs');
    if (fs.existsSync(agyA2aMcpSrc) || fs.existsSync(path.join(srcDir, 'bin', 'a2a-inbox-mcp.mjs'))) {
        const agyMcpInstalled = path.join(homeDir, '.agents', 'bin', 'aos-a2a-mcp.mjs');
        log.message(`A2A MCP for agy and Cursor: node "${agyMcpInstalled}" (opt-in registration: AOS_A2A_MCP=on)`);
    }
    if (process.env.AOS_A2A_MCP === 'on' || process.env.AOS_A2A_MCP === '1') {
        // Fixed, distinct defaults; the installer's own AOS_A2A_NAME is deliberately NOT used here
        // (running from inside a session would impersonate that session), and the override env vars
        // are validated through validName (invalid -> warning + default).
        registerA2aMcpAgy({ targetHome, name: resolveAosA2aMcpName(process.env.AOS_A2A_MCP_NAME_AGY, A2A_MCP_DEFAULT_NAME_AGY, 'agy') });
        registerA2aMcpCursor({ targetHome, name: resolveAosA2aMcpName(process.env.AOS_A2A_MCP_NAME_CURSOR, A2A_MCP_DEFAULT_NAME_CURSOR, 'Cursor') });
    }


    // 3. OpenAI Codex CLI
    const codexWorkflowsDir = path.join(targetHome, '.codex', 'workflows');
    if (on('codex') && fs.existsSync(workflowsSrc)) {
        copyDirRecursiveSync(workflowsSrc, codexWorkflowsDir);
    }
    if (on('codex')) {
        if (mergeCodexTomlHooks(path.join(targetHome, '.codex', 'config.toml'))) codexHooksChanged = true;
        installCodexRules({ targetHome });
    }

    // 4. OpenCode CLI
    if (on('opencode')) installOpencodePlugin({
        targetHome,
        configPath: path.join(
            path.join(targetHome, '.config', 'opencode'),
            'opencode.jsonc'
        ),
    });

    // 5. Global CLI launcher binaries (aos-config, aos-dashboard, aos-uninstall)
    installGlobalBinaries();

    // 6. Fixed-path GO check for AO and other non-hook callers
    installGoCheck({ targetHome });
}

// Copies only the named hook scripts (never the whole dir). Scripts an older install left behind stay untouched.
function copyHookScripts(hooksSrc, destDir, names) {
    for (const name of names) copyDirRecursiveSync(path.join(hooksSrc, name), path.join(destDir, name));
}

// Each harness dir gets its own list (lib/v5/profile.js HARNESS_HOOKS: wired scripts plus what they import).
// agy's antigravity-cli dir only when agy created it, as before.
function installHarnessHookCopies({ targetHome = homeDir, targetGemini = geminiDir, harnesses = null } = {}) {
    const on = (k) => !harnesses || harnesses.has(k);
    const hooksSrc = path.join(srcDir, '.claude', 'hooks');
    if (!fs.existsSync(hooksSrc)) return [];
    const { claude, agy, codex } = v5Profile.HARNESS_HOOKS;
    // The agy A2A inbox hook is an agy-only variant; its source ships in agy-hooks/, not .claude/hooks.
    const agyA2aSrc = path.join(srcDir, 'agy-hooks', 'a2a-inbox.mjs');
    const agyNames = agy.filter((n) => n !== 'a2a-inbox.mjs');
    const agyCliDir = path.join(targetGemini, 'antigravity-cli');
    const agyDirs = [path.join(targetGemini, 'config', 'hooks'), ...(fs.existsSync(agyCliDir) ? [path.join(agyCliDir, 'hooks')] : [])];
    const targets = [
        ...(on('claudecode') ? [[path.join(claudeConfigDir(targetHome), 'hooks'), claude]] : []),
        ...(on('antigravity') ? [[agyDirs[0], agyNames]] : []),
        ...(on('antigravity') && agyDirs.length > 1 ? [[agyDirs[1], agyNames]] : []),
        ...(on('codex') ? [[path.join(targetHome, '.codex', 'hooks'), codex]] : []),
    ];
    for (const [dir, names] of targets) {
        copyHookScripts(hooksSrc, dir, names);
        log.step(`Installed hooks to ${dir}`);
    }
    if (on('antigravity') && fs.existsSync(agyA2aSrc)) {
        for (const dir of agyDirs) {
            copyDirRecursiveSync(agyA2aSrc, path.join(dir, 'a2a-inbox.mjs'));
            log.step(`Installed the agy A2A inbox hook to ${dir}`);
        }
    }
    return targets.map(([dir]) => dir);
}

// go-check.mjs is the fixed-path GO check for callers that are not a harness hook (AO).
// It imports go-gate.mjs from its own directory, so both land in ~/.aos/bin, together with
// the guarded patterns as JSON. Same conflict/backup rules as every other installed file.
function installGoCheck({ targetHome = homeDir } = {}) {
    const dest = path.join(targetHome, '.aos', 'bin');
    const files = [
        [path.join(srcDir, 'bin', 'go-check.mjs'), 'go-check.mjs'],
        [path.join(srcDir, '.claude', 'hooks', 'go-gate.mjs'), 'go-gate.mjs'],
        [path.join(srcDir, '.claude', 'hooks', 'gate-profile.mjs'), 'gate-profile.mjs'],
        [path.join(srcDir, 'bin', 'guarded-patterns.json'), 'guarded-patterns.json'],
        [path.join(srcDir, 'mcps', 'mcsc', 'packages', 'core', 'src', 'trail.js'), 'trail.mjs'],
        [path.join(srcDir, 'mcps', 'mcsc', 'packages', 'core', 'src', 'no-mcp.js'), 'no-mcp.mjs'],
        [path.join(srcDir, 'lib', 'a2a-permissions.mjs'), 'a2a-permissions.mjs'],
        [path.join(srcDir, 'lib', 'sandbox.mjs'), 'sandbox.mjs'],
    ];
    if (!files.every(([src]) => fs.existsSync(src))) return false;
    fs.mkdirSync(dest, { recursive: true });
    for (const [src, name] of files) copyDirRecursiveSync(src, path.join(dest, name));
    log.step(`Installed go-check to ${dest}`);
    return true;
}

// WP-INSTALL: the a2a hooks (Claude .claude/hooks/a2a-inbox.mjs + optional
// a2a-session.mjs, also copied into per-harness hook dirs) and the OpenCode
// plugin (.opencode/plugins/bdb-aos.js) import their shared logic from
// ../../lib/a2a-*.mjs. Inside the package checkout that resolves to lib/; in
// the installed layout those files are scattered across harness dirs under the
// home dir, so a lib copy must land two directory levels above each of them or
// every A2A hook dies with MODULE_NOT_FOUND. Copies are additive and owned
// (same files as the running package). go-gate solves the same problem by
// being blob-copied; the a2a lib keeps its import-path contract instead.
function a2aLibFiles() {
    const libDir = path.join(srcDir, 'lib');
    if (!fs.existsSync(libDir)) return [];
    let names = [];
    // The sidecar and client import @a2a-js/sdk / express, which do not resolve from ~/.agents/lib: hooks never need them.
    try { names = fs.readdirSync(libDir).filter((f) => /^a2a-.+\.mjs$/.test(f) && !/^a2a-(sidecar|client)\.mjs$/.test(f)); } catch (e) { logDebug(e, 'list a2a lib'); }
    return names.map((f) => path.join(libDir, f));
}

// The A2A sidecar and client resolve @a2a-js/sdk and express (package.json deps) from the
// package dir, not from the ~/.agents copies — lib/a2a-sdk-resolve.mjs reads the recorded
// package root beside the copies. The record is registered with the a2a lib copies, so the
// uninstall path removes it symmetrically with them. Returns the written path or null.
function writeA2aPackageRootRecord({ targetHome = homeDir } = {}) {
    const dir = path.join(targetHome, '.agents', 'lib');
    try {
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, '.aos-package-root.json');
        fs.writeFileSync(file, JSON.stringify({ packageRoot: srcDir }, null, 2) + '\n');
        uninstallRecords.recordA2aLibCopies(targetHome, [file]);
        return file;
    } catch (e) {
        logDebug(e, 'write a2a packageRoot record');
        return null;
    }
}

// The hooks and the OpenCode plugin fall back to ~/.agents/lib when ../../lib is absent, so the
// copies live under that one AOS-owned dir, never in the bare $HOME/lib or $HOME/.gemini/lib.
// Each copy is in the install manifest (copyDirRecursiveSync) and in the uninstall records.
function installA2aLibCopies({ targetHome = homeDir } = {}) {
    const files = a2aLibFiles();
    if (!files.length || DRY_RUN) return false;
    const dir = path.join(targetHome, '.agents', 'lib');
    const copied = [];
    try {
        fs.mkdirSync(dir, { recursive: true });
        for (const src of files) {
            const dest = path.join(dir, path.basename(src));
            copyDirRecursiveSync(src, dest);
            copied.push(dest);
        }
    } catch (e) {
        log.warn(`Could not install A2A lib copies to ${dir}: ${e.message}`);
    }
    const record = writeA2aPackageRootRecord({ targetHome });
    if (record) copied.push(record);
    uninstallRecords.recordA2aLibCopies(targetHome, copied);
    if (copied.length) log.step(`Installed A2A lib copies (a2a-*.mjs) to ${dir} (${copied.length} files)`);
    return copied.length > 0;
}

// The sidecar SessionStart hook is registered here for Claude Code, and only
// when the hook file ships inside this package (a package without it installs
// fine). Codex gets the same hook from mergeCodexTomlHooks (SessionStart); agy
// has no session-start event, so it gets none. The installer itself never starts a
// sidecar. At runtime the hook delegates to ensureSidecar
// (lib/a2a-session.mjs), which skips on AOS_A2A_SIDECAR=off (the off switch)
// and on AOS_DELEGATE_DEPTH>0 (delegated workers), so no harness that a
// delegator spawns can ever fork another sidecar.
function installClaudeA2aSessionHook({ targetHome = homeDir } = {}) {
    const hookSrc = path.join(srcDir, '.claude', 'hooks', 'a2a-session.mjs');
    if (!fs.existsSync(hookSrc)) {
        log.step('a2a-session.mjs hook is not shipped in this package: Claude A2A session-start sidecar hook not registered (safe to ignore)');
        return false;
    }
    if (DRY_RUN) {
        log.message('[dry-run] would register the a2a-session.mjs Claude SessionStart sidecar hook');
        return false;
    }
    const claudeHome = claudeConfigDir(targetHome);
    const hooksDir = path.join(claudeHome, 'hooks');
    try {
        fs.mkdirSync(hooksDir, { recursive: true });
        copyDirRecursiveSync(hookSrc, path.join(hooksDir, 'a2a-session.mjs'));
    } catch (e) {
        log.warn(`Could not install a2a-session.mjs hook: ${e.message}`);
        return false;
    }
    const settingsPath = path.join(claudeHome, 'settings.json');
    try {
        let settings = readJsonFile(settingsPath);
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {};
        if (JSON.stringify(settings).includes('a2a-session.mjs')) return true; // already wired
        settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
        if (!Array.isArray(settings.hooks.SessionStart)) settings.hooks.SessionStart = [];
        settings.hooks.SessionStart.push({ hooks: [{ type: 'command', command: 'node "$HOME/.claude/hooks/a2a-session.mjs"', timeout: 5 }] });
        if (fs.existsSync(settingsPath)) backupOnce(settingsPath, () => { const b = `${settingsPath}.${timestamp}.bak`; fs.copyFileSync(settingsPath, b); return b; });
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
        log.step('Registered a2a-session.mjs Claude SessionStart sidecar hook (skips itself under AOS_A2A_SIDECAR=off / AOS_DELEGATE_DEPTH>0)');
        return true;
    } catch (e) {
        log.warn(`Could not wire the a2a-session hook into settings.json: ${e.message}`);
        return false;
    }
}

function installGlobalBinaries(targetHome = (process.env.HOME || homeDir)) {
    const binSrc = path.join(srcDir, 'bin');
    const globalAgentsBin = path.join(targetHome, '.agents', 'bin');
    if (fs.existsSync(binSrc)) {
        copyDirRecursiveSync(binSrc, globalAgentsBin);
        log.step(`Installed CLI binaries to ${globalAgentsBin}`);
        // aos-doctor, aos-store and aos-uninstall require ../lib from their installed copy.
        copyDirRecursiveSync(path.join(srcDir, 'lib'), path.join(targetHome, '.agents', 'lib'));
        // The gateway reads the shipped server list from ~/.agents/gateway/upstream_template.json (aosRoot); without these it serves nothing.
        const gatewayDir = path.join(targetHome, '.agents', 'gateway');
        fs.mkdirSync(gatewayDir, { recursive: true });
        const srcTemplate = mcpSecrets.shippedMcpTemplatePath(srcDir);
        if (fs.existsSync(srcTemplate)) {
            copyDirRecursiveSync(srcTemplate, path.join(gatewayDir, 'upstream_template.json'));
        }
        if (fs.existsSync(path.join(srcDir, 'mcp_picks.json'))) {
            copyDirRecursiveSync(path.join(srcDir, 'mcp_picks.json'), path.join(targetHome, '.agents', 'mcp_picks.json'));
        }
        mcpSecrets.migrateLegacyAgyWorkspaceMcp(targetHome, srcDir, { log });
        // lib/gate-profile.mjs is a re-export of the hook copy, which does not exist under ~/.agents: aos-gate needs the real file there.
        const profileSrc = path.join(srcDir, '.claude', 'hooks', 'gate-profile.mjs');
        if (fs.existsSync(profileSrc)) copyDirRecursiveSync(profileSrc, path.join(targetHome, '.agents', 'lib', 'gate-profile.mjs'));
        // lib/a2a-sdk-resolve.mjs in the copy above needs the package root (deps are package deps).
        writeA2aPackageRootRecord();
    }

    const localBinDir = path.join(targetHome, '.local', 'bin');
    if (!fs.existsSync(localBinDir)) {
        try { fs.mkdirSync(localBinDir, { recursive: true }); } catch (e) { logDebug(e, 'mkdir localBin'); }
    }

    const isWin = process.platform === 'win32';
    const { LAUNCHERS, LAUNCHER_MARKER, AOS_NPX_SPEC, launcherTarget } = uninstallRecords;
    const wired = [];

    for (const name of LAUNCHERS) {
        let run;
        if (name === 'aos') {
            const shPath = path.join(localBinDir, name);
            // `aos` is a common name: never overwrite somebody else's file.
            try { if (fs.existsSync(shPath) && !fs.readFileSync(shPath, 'utf8').includes(LAUNCHER_MARKER)) continue; } catch { continue; }
            run = `npx -y ${AOS_NPX_SPEC}${aosDistTag(pkg.version)}`;
        } else if (name === 'aos-uninstall') {
            // aos-uninstall.mjs requires installer.js and lib/ next to it; ~/.agents/bin has neither
            // (Lenovo P15: "Cannot find module '../installer.js'"). Run it from the package instead.
            run = `npx -y -p ${AOS_NPX_SPEC}${aosDistTag(pkg.version)} aos-uninstall`;
        } else {
            const targetMjs = launcherTarget(targetHome, name);
            if (!fs.existsSync(targetMjs)) continue;
            run = `node "${targetMjs}"`;
        }

        // Shell wrapper for Unix / Git Bash
        const shPath = path.join(localBinDir, name);
        wired.push(name);
        const shContent = `#!/bin/sh\n${LAUNCHER_MARKER}\nexec ${run} "$@"\n`;
        try {
            fs.writeFileSync(shPath, shContent, { mode: 0o755 });
            try { fs.chmodSync(shPath, 0o755); } catch (e) { logDebug(e, `chmod ${shPath}`); }
        } catch (e) { logDebug(e, `write ${shPath}`); }

        // Windows CMD and PowerShell launchers
        if (isWin) {
            const cmdPath = path.join(localBinDir, `${name}.cmd`);
            const cmdContent = `@echo off\r\nrem ${LAUNCHER_MARKER}\r\n${run} %*\r\n`;
            try { fs.writeFileSync(cmdPath, cmdContent); } catch (e) { logDebug(e, `write ${cmdPath}`); }

            const ps1Path = path.join(localBinDir, `${name}.ps1`);
            const ps1Content = `${LAUNCHER_MARKER}\r\n${run} $args\r\n`;
            try { fs.writeFileSync(ps1Path, ps1Content); } catch (e) { logDebug(e, `write ${ps1Path}`); }
        }
    }
    log.step(`Wired CLI launcher binaries (${wired.join(', ') || 'none'}) in ${localBinDir}`);
    const hint = localBinPathHint(localBinDir);
    if (hint) log.warn(hint);
}

// The npm dist-tag a version was published under (same rule as release-please.yml):
// a prerelease goes to its own channel (5.0.0-beta.3 -> beta), everything else to latest.
// A channel tag rather than the exact version, so `aos update` reaches the newest release.
function aosDistTag(version) {
    const m = /^[^-]+-([A-Za-z]+)/.exec(String(version));
    return m ? m[1] : 'latest';
}

// One line telling the user how to put ~/.local/bin on PATH, or null when it already is.
function localBinPathHint(localBinDir, { pathEnv = process.env.PATH || '', platform = process.platform, shell = process.env.SHELL || '' } = {}) {
    const win = platform === 'win32';
    const norm = (p) => (win ? p.replace(/\//g, '\\').toLowerCase() : p).replace(/[\\/]+$/, '');
    const want = norm(localBinDir);
    if (pathEnv.split(win ? ';' : ':').filter(Boolean).some((p) => norm(p) === want)) return null;
    if (win) {
        return `${localBinDir} is not on your PATH. Add it in PowerShell, then open a new terminal: [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';${localBinDir}', 'User')`;
    }
    const sh = path.basename(shell) || (platform === 'darwin' ? 'zsh' : 'bash');
    if (sh === 'fish') return `${localBinDir} is not on your PATH. Add it, then open a new terminal: fish_add_path ${localBinDir}`;
    const rc = sh === 'zsh' ? '~/.zshrc' : '~/.bashrc';
    return `${localBinDir} is not on your PATH. Add it, then open a new terminal: echo 'export PATH="$HOME/.local/bin:$PATH"' >> ${rc}`;
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
    const bdbHookScripts = v5Profile.CLAUDE_MERGE_HOOKS;
    // The template wires a2a-session.mjs (SessionStart) too, so it is in CLAUDE_MERGE_HOOKS: replaced, not cloned, on every run;
    // installClaudeA2aSessionHook then only copies the script (it skips the settings write when already wired).
    // memb-inject reads the machine-global memB store under $HOME and is
    // installed once per machine, so it stays $HOME-anchored even inside a
    // project harness -- unlike the two gate hooks, which are per-checkout by
    // design. Pointing it at $CLAUDE_PROJECT_DIR would make it fail on every
    // prompt in any project the harness was never installed into. trail-relay
    // talks to machine-global live-map daemons, so it is anchored the same way.
    const machineGlobalHooks = v5Profile.CONTEXT_HOOKS;
    const isBdbEntry = (entry) => {
        const cmds = (entry && Array.isArray(entry.hooks) ? entry.hooks : [])
            .map((h) => (h && typeof h.command === 'string' ? h.command : ''))
            .join(' ');
        return bdbHookScripts.some((name) => cmds.includes(name));
    };
    // Global installs must point at the copies installGlobalHooks put under
    // $HOME/.claude/hooks; $CLAUDE_PROJECT_DIR would not exist in other projects.
    const localize = (cmd) => (projectLocal
        ? (machineGlobalHooks.some((n) => cmd.includes(n)) ? cmd : cmd.split('${HOME}').join('${CLAUDE_PROJECT_DIR}').replace(/\$CLAUDE_PROJECT_DIR\b/g, '${CLAUDE_PROJECT_DIR}'))
        : cmd.replace(/\$\{?CLAUDE_PROJECT_DIR\}?\/\.claude\/hooks\//g, '$HOME/.claude/hooks/').split('$HOME/.claude/hooks/').join(process.env.CLAUDE_CONFIG_DIR ? '${CLAUDE_CONFIG_DIR}/hooks/' : '$HOME/.claude/hooks/'));
    const DEFAULT_HOOK_TIMEOUTS = {
        'go-gate.mjs': 10,
        'conventional-commits.mjs': 10,
        'env-file-protection.mjs': 10,
        'graph-gate.mjs': 10,
        'memb-inject.mjs': 10,
        'a2a-inbox.mjs': 10,
        'a2a-session.mjs': 5,
        'go-token.mjs': 10,
        'go-grant.mjs': 10,
        'rules-inject.mjs': 10,
        'trail-relay.mjs': 3,
        'trail-autostart.mjs': 3,
        'aos-session-hint.mjs': 3,
        'memb-session-save.mjs': 5,
    };
    const cloneBdbEntries = (entries) =>
        JSON.parse(JSON.stringify(entries)).map((e) => ({
            ...e,
            hooks: (e.hooks || []).map((h) => {
                if (!h || typeof h.command !== 'string') return h;
                const updated = { ...h, command: localize(h.command) };
                if (typeof updated.timeout !== 'number' || updated.timeout <= 0) {
                    for (const [script, to] of Object.entries(DEFAULT_HOOK_TIMEOUTS)) {
                        if (updated.command.includes(script)) {
                            updated.timeout = to;
                            break;
                        }
                    }
                }
                return updated;
            }),
        }));

    const buildMerged = (existing) => {
        const merged = existing && typeof existing === 'object' ? existing : {};
        merged.hooks = merged.hooks && typeof merged.hooks === 'object' ? merged.hooks : {};
        const repoSettings = readJsonFile(path.join(srcDir, '.claude', 'settings.json')) || {};
        for (const [event, entries] of Object.entries(repoSettings.hooks || {})) {
            if (!Array.isArray(entries)) continue;
            const foreignEntries = (Array.isArray(merged.hooks[event]) ? merged.hooks[event] : [])
                .filter((e) => !isBdbEntry(e));
            // Only context-injection hooks can be dropped here (--no-hooks, minimal profile); the gates never are.
            const own = cloneBdbEntries(entries);
            merged.hooks[event] = [...foreignEntries, ...(contextHooksOn && memoryOn && gateOnFor('claudecode') ? own : v5Profile.dropContextHooks(own, (c) => droppedHook(c, 'claudecode')))];
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
        const tmpPath = `${settingsPath}.${process.pid}.tmp`;
        if (existing) {
            // hrtime counts from boot: shortly after a boot it has fewer than 13 digits, which the prune
            // regex below skipped (backups piled up). Fixed width also keeps the name sort chronological.
            backupOnce(settingsPath, () => { const b = `${settingsPath}.${String(process.hrtime.bigint()).padStart(20, '0')}.bak`; fs.copyFileSync(settingsPath, b); return b; });
            const dir = path.dirname(settingsPath);
            const base = path.basename(settingsPath);
            const baks = fs.readdirSync(dir).filter((f) => f.startsWith(`${base}.`) && /\.\d{13,}\.bak$/.test(f)).sort();
            for (const old of baks.slice(0, -3)) fs.rmSync(path.join(dir, old), { force: true });
        }
        fs.writeFileSync(tmpPath, JSON.stringify(buildMerged(existing), null, 2) + '\n', { mode: existing ? fs.statSync(settingsPath).mode & 0o777 : 0o644 });
        fs.renameSync(tmpPath, settingsPath);
    } catch (e) {
        log.warn(`Could not write ${settingsPath}: ${e.message}`);
    }
}

// Sets permissions.defaultMode = "auto" in Claude settings.json ONLY when that key is absent.
// Never overwrites an existing value, hooks, or other permissions.
// Works on fresh install and update; respects dry-run and backupOnce.
function ensureClaudeDefaultMode(settingsPathOrOpts, maybeOpts = {}) {
    let settingsPath;
    let dryRun;
    if (typeof settingsPathOrOpts === 'string') {
        settingsPath = settingsPathOrOpts;
        dryRun = maybeOpts.dryRun !== undefined ? Boolean(maybeOpts.dryRun) : DRY_RUN;
    } else if (settingsPathOrOpts && typeof settingsPathOrOpts === 'object') {
        const opts = settingsPathOrOpts;
        settingsPath = opts.settingsPath || (opts.targetHome ? path.join(claudeConfigDir(opts.targetHome), 'settings.json') : path.join(claudeConfigDir(homeDir), 'settings.json'));
        dryRun = opts.dryRun !== undefined ? Boolean(opts.dryRun) : DRY_RUN;
    } else {
        settingsPath = path.join(claudeConfigDir(homeDir), 'settings.json');
        dryRun = DRY_RUN;
    }

    if (!fs.existsSync(settingsPath)) {
        if (dryRun) {
            log.message(`[dry-run] would set permissions.defaultMode="auto" in ${settingsPath}`);
            return false;
        }
        try {
            fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
            const tmpPath = `${settingsPath}.${process.pid}.tmp`;
            fs.writeFileSync(tmpPath, JSON.stringify({ permissions: { defaultMode: 'auto' } }, null, 2) + '\n', { mode: 0o644 });
            fs.renameSync(tmpPath, settingsPath);
            log.step(`Set permissions.defaultMode="auto" in ${settingsPath}`);
            return true;
        } catch (e) {
            log.warn(`Could not write ${settingsPath}: ${e.message}`);
            return false;
        }
    }

    let target = settingsPath;
    try { target = fs.realpathSync(settingsPath); } catch { /* new/unresolvable */ }

    const settings = readJsonFile(target);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return false;
    }

    if (settings.permissions !== undefined && (typeof settings.permissions !== 'object' || settings.permissions === null || Array.isArray(settings.permissions))) {
        return false;
    }

    if (settings.permissions && 'defaultMode' in settings.permissions) {
        return false;
    }

    if (dryRun) {
        log.message(`[dry-run] would set permissions.defaultMode="auto" in ${settingsPath}`);
        return false;
    }

    try {
        backupOnce(settingsPath, () => {
            const b = `${settingsPath}.${String(process.hrtime.bigint()).padStart(20, '0')}.bak`;
            fs.copyFileSync(target, b);
            return b;
        });
    } catch (e) {
        log.warn(`Could not backup ${settingsPath}: ${e.message}`);
        return false;
    }

    const perms = settings.permissions || {};
    settings.permissions = { ...perms, defaultMode: 'auto' };

    try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        let mode = 0o644;
        try { mode = fs.statSync(target).mode & 0o777; } catch { /* new file */ }
        const tmpPath = `${target}.${process.pid}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n', { mode });
        if (mode !== null) fs.chmodSync(tmpPath, mode);
        fs.renameSync(tmpPath, target);
        log.step(`Set permissions.defaultMode="auto" in ${settingsPath}`);
        return true;
    } catch (e) {
        log.warn(`Could not write ${settingsPath}: ${e.message}`);
        return false;
    }
}

// agy runs a hook command through `sh -c` / `cmd /c` with cwd = the hooks.json folder, and
// cmd cannot parse the \" Go emits for quotes. So the command is relative and quote-free.
function agyHookCommand(hooksJsonDir, scriptPath, args = '') {
    const rel = path.relative(hooksJsonDir, scriptPath).split(path.sep).join('/');
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || /[\s"'&|<>^%]/.test(rel)) {
        throw new Error(`agy hook script must sit under ${hooksJsonDir} with a plain path, got ${scriptPath}`);
    }
    return `node ${rel}${args}`;
}

// Runs every AOS command of a hooks.json once with `{}` on stdin, the way agy does.
// Returns [{ command, reason }] for each failure; `spawn` is injectable for tests.
function selfCheckAgyHooks(hooksPath, spawn = spawnSync) {
    const bdbScripts = v5Profile.HOOK_SCRIPTS;
    const data = readJsonFile(hooksPath);
    const commands = [];
    const walk = (v) => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') {
            if (typeof v.command === 'string' && bdbScripts.some((n) => v.command.includes(n))) commands.push(v.command);
            Object.values(v).forEach(walk);
        }
    };
    walk(data);
    const [shell, flag] = process.platform === 'win32' ? ['cmd', '/c'] : ['sh', '-c'];
    const failures = [];
    for (const command of [...new Set(commands)]) {
        // AGENTTRAIL_PORT=1: the no-op payload must not show up on a live map.
        const r = spawn(shell, [flag, command], { cwd: path.dirname(hooksPath), input: '{}', encoding: 'utf8', timeout: 20000, windowsHide: true, env: { ...process.env, AGENTTRAIL_PORT: '1' } });
        const stderr = String((r && r.stderr) || '');
        let reason = null;
        // A slow machine (memb-inject reads the store) can exceed the limit without the hook being broken:
        // the failures this check exists for (bad path, missing module, non-zero exit) are immediate.
        if (r && r.error && r.error.code === 'ETIMEDOUT') { log.warn(`agy hook self-check timed out, not treated as a failure: ${command}`); continue; }
        if (!r || r.error) reason = `spawn failed: ${r && r.error ? r.error.message : 'no result'}`;
        else if (r.status !== 0) reason = `exit ${r.status}\n  ${stderr.trim().slice(0, 500)}`;
        else if (/MODULE_NOT_FOUND|Cannot find module/.test(stderr)) reason = `module not found\n  ${stderr.trim().slice(0, 500)}`;
        if (reason) failures.push({ command, reason });
    }
    return failures;
}

// Merge the BDB hooks into Google Antigravity's hooks.json (.agents/hooks.json or
// ~/.gemini/config/hooks.json), preserving user-defined foreign hooks.
function mergeAntigravityHooks(hooksPath, { projectLocal = false, selfCheck = spawnSync } = {}) {
    const bdbHookScripts = v5Profile.HOOK_SCRIPTS;
    const isBdbHandler = (h) => typeof h?.command === 'string' && bdbHookScripts.some((name) => h.command.includes(name));

    const baseDir = path.dirname(hooksPath);
    // Commands are relative to hooks.json's folder, so every script must live under it
    // (installProjectHarness copies the hooks into .agents/hooks for the project-local file).
    const hooksDir = path.join(baseDir, 'hooks');
    const workflowsDir = path.join(baseDir, 'workflows');
    const globalHooksDir = hooksDir;

    const cmd = (dir, script, args = '') => agyHookCommand(baseDir, path.join(dir, script), args);
    // Observability hooks must never block a tool call when they cannot start.
    const obs = (dir, script, args = '') => cmd(dir, script, `${args} || exit 0`);
    // agy's hooks.json: each top-level key is a NAMED hook ({PreToolUse|PostToolUse: grouped with matcher,
    // PreInvocation|PostInvocation|Stop: flat handler lists}). Measured on agy 1.2.14: `loaded N named hooks`
    // counts these keys, so AOS gets one name per concern instead of one lump called "hooks".
    const fileTools = 'file_change|code_action|propose_code|write_blob|write_to_file|replace_file_content|multi_replace_file_content|edit_notebook|write_file|edit_file|replace|Write|Edit|MultiEdit';
    const bdbHooks = {
        'aos-go-gate': {
            PreToolUse: [{ matcher: 'run_command|Bash', hooks: [{ type: 'command', command: cmd(hooksDir, 'go-gate.mjs'), timeout: 10 }] }]
        },
        'aos-conventional-commits': {
            PreToolUse: [{ matcher: 'run_command|Bash', hooks: [{ type: 'command', command: cmd(hooksDir, 'conventional-commits.mjs'), timeout: 10 }] }]
        },
        'aos-env-protection': {
            PreToolUse: [{ matcher: fileTools, hooks: [{ type: 'command', command: cmd(hooksDir, 'env-file-protection.mjs'), timeout: 10 }] }]
        },
        'aos-trail-relay': {
            PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: obs(globalHooksDir, 'trail-relay.mjs', ' --agent agy --event PreToolUse'), timeout: 5 }] }],
            Stop: [{ type: 'command', command: obs(globalHooksDir, 'trail-relay.mjs', ' --agent agy --event Stop'), timeout: 5 }]
        },
        'aos-graph-gate': {
            Stop: [{ type: 'command', command: cmd(hooksDir, 'graph-gate.mjs'), timeout: 10 }]
        },
        'aos-context': {
            PreInvocation: [
                { type: 'command', command: obs(globalHooksDir, 'memb-inject.mjs'), timeout: 8 },
                { type: 'command', command: obs(globalHooksDir, 'aos-session-hint.mjs'), timeout: 3 },
                { type: 'command', command: obs(globalHooksDir, 'rules-inject.mjs'), timeout: 3 },
                { type: 'command', command: cmd(workflowsDir, 'startcycle-dispatch.mjs'), timeout: 30 }
            ]
        },
        // Session-end memory capture: agy's Stop event. Payload fields are unverified on live agy; the hook skips quietly without a transcript.
        'aos-memb-save': {
            Stop: [{ type: 'command', command: obs(globalHooksDir, 'memb-session-save.mjs'), timeout: 5 }]
        },
        'aos-a2a-inbox': {
            // Interactive-session A2A inbox (agy PreInvocation): delivers pending messages only on the
            // first model call of a turn. Not a context hook, so --no-hooks and minimal keep it; the
            // hook fails open itself, but stay fail-safe around it as well.
            PreInvocation: [{ type: 'command', command: obs(globalHooksDir, 'a2a-inbox.mjs'), timeout: 5 }]
        }
    };

    const allHookNames = Object.keys(bdbHooks);
    if (!contextHooksOn) delete bdbHooks['aos-trail-relay'];
    if (!contextHooksOn || !memoryOn) delete bdbHooks['aos-memb-save'];
    if (!gateOnFor('antigravity')) { delete bdbHooks['aos-go-gate']; delete bdbHooks['aos-graph-gate']; }
    bdbHooks['aos-context'].PreInvocation = bdbHooks['aos-context'].PreInvocation.filter((h) => !droppedHook(h.command, 'antigravity'));

    // Earlier AOS versions wrote all handlers under one named hook called "hooks" (old wrapped shapes
    // included). Strip the BDB handlers out of it, keep foreign ones, and drop it when nothing is left.
    const flatEvents = ['PreInvocation', 'PostInvocation', 'Stop'];
    const stripLegacy = (spec) => {
        if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return spec;
        const out = {};
        for (const [event, entries] of Object.entries(spec)) {
            if (!Array.isArray(entries)) { out[event] = entries; continue; }
            const kept = [];
            for (const e of entries) {
                if (e && Array.isArray(e.hooks)) {
                    const rest = e.hooks.filter((h) => !isBdbHandler(h));
                    // Flat events hold handlers directly; the old wrapped form is unwrapped.
                    if (rest.length) { if (flatEvents.includes(event)) kept.push(...rest); else kept.push({ ...e, hooks: rest }); }
                } else if (!isBdbHandler(e)) kept.push(e);
            }
            if (kept.length) out[event] = kept;
        }
        return out;
    };

    const buildMerged = (existing) => {
        const merged = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
        if ('hooks' in merged) {
            const rest = stripLegacy(merged.hooks);
            const hasEvents = rest && typeof rest === 'object' && Object.keys(rest).some((k) => Array.isArray(rest[k]));
            if (hasEvents) merged.hooks = rest; else delete merged.hooks;
        }
        for (const name of allHookNames) delete merged[name];
        return { ...merged, ...bdbHooks };
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
        const previousRaw = existing ? fs.readFileSync(hooksPath, 'utf8') : null;
        // agy links antigravity-cli/hooks.json to config/hooks.json on first start; write through the link.
        let writeTarget = hooksPath;
        try { writeTarget = fs.realpathSync(hooksPath); } catch { /* not there yet */ }
        const tmpPath = `${writeTarget}.${process.pid}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(buildMerged(existing), null, 2) + '\n');
        fs.renameSync(tmpPath, writeTarget);
        if (!DRY_RUN) {
            const failures = selfCheckAgyHooks(hooksPath, selfCheck);
            if (failures.length) {
                if (previousRaw === null) fs.unlinkSync(hooksPath);
                else fs.writeFileSync(hooksPath, previousRaw);
                log.warn(`Antigravity hook self-check FAILED for ${hooksPath}; the previous hooks.json was ${previousRaw === null ? 'removed (none existed)' : 'restored'}.`);
                for (const f of failures) log.warn(`  command: ${f.command}\n  ${f.reason}`);
            }
        }
    } catch (e) {
        log.warn(`Could not write ${hooksPath}: ${e.message}`);
    }
}

// Writes the AOS MCP servers into Codex's config.toml between AOS:MCP markers,
// replacing the block on re-runs. A server the user already declared outside the
// block is skipped: a second [mcp_servers.<name>] table would make the file invalid TOML.
function mergeCodexTomlMcpServers(configTomlPath, servers) {
    servers = mcpSecrets.wrapServers(withoutGatewayServers(servers, configTomlPath), mcpLauncher());
    const shipped = mcpShipped();
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
    const PLACEHOLDER = '# AOS:MCP:PLACEHOLDER';
    const hadBlock = blockRegex.test(content);
    const rows = (name, cfg) => [`[mcp_servers.${tomlKey(name)}]`, ...Object.entries(cfg || {}).map(([k, v]) => `${tomlKey(k)} = ${tomlValue(v)}`)];
    // Codex drops marker comments on rewrite: AOS tables left without markers are recognised by name plus
    // the exact command AOS writes, replaced into the single block, and orphan markers are removed.
    // A table is AOS's when its name is shipped and command/args are what AOS writes (launcher form or
    // not); a table whose args this reader cannot parse is judged by its command line alone, as before.
    const ownedNames = new Set();
    // A table with anything this reader does not fully understand (or inline secrets while there is no
    // launcher to take them) is never rewritten: it stays exactly as it is and the AOS entry of that name is skipped.
    const priorTables = mcpSecrets.parseCodexTables(content);
    const refused = new Set(Object.entries(priorTables)
        .filter(([, t]) => t.unparsed.length || (!mcpLauncher() && mcpSecrets.inlineSecrets(t.env).length))
        .map(([n]) => n));
    // Losing pick candidates (no incoming entry): dropped only when the table is AOS-shaped and holds no inline secret.
    const retired = new Set(mcpPicks().retired);
    const owns = (name, sec) => {
        const cfg = (servers || {})[name];
        const gone = !cfg && retired.has(name);
        if ((!cfg && !gone) || refused.has(name)) return false;
        const t = mcpSecrets.parseCodexTables(sec.join('\n'))[name];
        const command = t && t.fields.command;
        if (typeof command !== 'string') return false;
        let ok;
        if (gone) ok = Array.isArray(t.fields.args) && !mcpSecrets.inlineSecrets(t.env).length && mcpSecrets.isAosOwned(name, { command, args: t.fields.args }, null, shipped);
        else {
            const inc = mcpSecrets.unwrap(cfg);
            ok = Array.isArray(t.fields.args)
                ? mcpSecrets.isAosOwned(name, { command, args: t.fields.args }, cfg, shipped)
                : [cfg.command, inc.command].includes(command);
            if (ok) ownedNames.add(name);
        }
        return ok;
    };
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    // Codex may insert a user's own [mcp_servers.x] table between the markers. Regenerating the
    // block replaces its content, so tables AOS does not ship are moved behind the block, not lost.
    let foreign = '';
    const original = content;
    if (hadBlock) {
        const aosNames = new Set([...uninstallRecords.aosMcpNames(), ...Object.keys(servers || {})]);
        const inner = content.match(blockRegex)[0].split(/\r?\n/).filter((l) => !/^\s*# AOS:MCP:(START|END)\s*$/.test(l));
        foreign = uninstallRecords.dropMcpTables(inner, (n) => aosNames.has(n) && !refused.has(n)).join('\n').trim();
        Object.keys(mcpSecrets.parseCodexTables(inner.join('\n'))).filter((n) => aosNames.has(n) && !refused.has(n)).forEach((n) => ownedNames.add(n));
    }
    const stripped = content.replace(blockRegex, `${PLACEHOLDER}\n`).split(/\r?\n/)
        .filter((l) => !/^\s*# AOS:MCP:(START|END)\s*$/.test(l));
    const outsideLines = uninstallRecords.dropMcpTables(stripped, owns);
    const outside = outsideLines.join('\n');
    // Inline secrets of the tables AOS replaces: collected for the secrets file, their names stay declared.
    const collector = mcpSecrets.createCollector();
    for (const n of ownedNames) {
        const env = priorTables[n] && priorTables[n].env;
        for (const [k, v] of mcpSecrets.inlineSecrets(env)) collector.add(k, v);
        if (servers[n]) servers[n] = mcpSecrets.wrapServer(n, servers[n], mcpLauncher(), Object.keys(env || {}).filter((k) => mcpSecrets.secretKV(k, env[k])));
    }
    const tables = [];
    const skipped = [];
    Object.entries(servers || {}).forEach(([name, cfg]) => {
        const header = `[mcp_servers.${tomlKey(name)}]`;
        const headerRegex = new RegExp(`^${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
        if (refused.has(name)) {
            skipped.push(name);
            log.warn(`${configTomlPath}: table "${name}" has content this installer cannot rewrite safely; kept as it is.`);
            return;
        }
        if (headerRegex.test(outside)) { skipped.push(name); return; }
        tables.push(rows(name, cfg).join('\n'));
    });
    const block = ['# AOS:MCP:START', tables.join('\n\n'), '# AOS:MCP:END'].concat(foreign ? ['', foreign] : []).join('\n');
    if (hadBlock) {
        content = outsideLines.join('\n').replace(PLACEHOLDER, block);
    } else if (outside.trim().length) {
        content = `${outside.trimEnd()}\n\n${block}\n`;
    } else {
        content = `${block}\n`;
    }
    content = content.replace(/\n{3,}/g, '\n\n');
    if (eol === '\r\n') content = content.replace(/\n/g, '\r\n');
    if (content === original) return skipped;
    if (!backupConfigFile(configTomlPath)) throw new Error('config.toml could not be backed up');
    if (!stashInlineSecrets(collector, configTomlPath)) throw new Error('inline secrets could not be moved');
    fs.writeFileSync(configTomlPath, content, { mode: 0o600 });
    try { fs.chmodSync(configTomlPath, 0o600); } catch (e) { logDebug(e, 'chmod configTomlPath'); }
    return skipped;
}

// The go-gate PreToolUse stanza for Codex's config.toml. No matcher: Codex runs shell commands
// through its exec/exec_command tool, so `^(Bash|run_command)$` never fired and a git push ran
// (Lenovo P15, Codex 0.162.1). The gate itself lets tool calls without a command through.
function codexGateSnippet(hooksDir) {
    return [
        '[[hooks.PreToolUse]]',
        '[[hooks.PreToolUse.hooks]]',
        'type = "command"',
        `command = ${JSON.stringify(`node "${path.join(hooksDir, 'go-gate.mjs')}"`)}`,
        'timeout = 30',
    ].join('\n');
}

// Codex ignores hook denials in `codex exec` / bypass modes, but its execution-policy rules enforce.
// One prefix_rule per irreversible command the go-gate guards. Matching is by command prefix: flags
// between the program and the subcommand (git -C x push, gh -R o/r pr merge) are not matched; the hook
// still covers those where Codex honours hooks. Match examples are validated by Codex at load time.
const CODEX_RULE_SPECS = [
    [['git', 'push'], 'git push origin main', 'git status'],
    [['npm', 'publish'], 'npm publish', 'npm view left-pad'],
    [['npm', 'version'], 'npm version patch', 'npm view left-pad'],
    [['gh', 'release', 'create'], 'gh release create v1.0.0', 'gh release list'],
    [['gh', 'pr', 'merge'], 'gh pr merge 12', 'gh pr view 12'],
    [['gh', 'repo', 'delete'], 'gh repo delete o/r', 'gh repo view o/r'],
    [['git', 'reset', '--hard'], 'git reset --hard HEAD', 'git reset --soft HEAD'],
    [['git', 'clean', '-f'], 'git clean -f', 'git clean -n'],
    [['git', 'clean', '-fd'], 'git clean -fd', 'git clean -n'],
    [['git', 'clean', '-fdx'], 'git clean -fdx', 'git clean -n'],
    [['rm', '-rf'], 'rm -rf build', 'rm file.txt'],
    [['rm', '-fr'], 'rm -fr build', 'rm file.txt'],
    [['rm', '-r'], 'rm -r build', 'rm file.txt'],
    [['rm', '-R'], 'rm -R build', 'rm file.txt'],
];

function codexGateRules() {
    const q = JSON.stringify;
    const rules = CODEX_RULE_SPECS.map(([pattern, match, notMatch]) => `prefix_rule(pattern = ${q(pattern)}, decision = "prompt", justification = "AOS go-gate: needs a human GO (type GO, or approve interactively)", match = [${q(match)}], not_match = [${q(notMatch)}])`);
    return [
        uninstallRecords.CODEX_RULES_HEADER,
        '# Prefix matching only: flags between program and subcommand (git -C x push, gh -R o/r pr merge) are not matched;',
        '# the go-gate hook still covers those where Codex honours hooks.',
        '',
        ...rules,
        '',
    ].join('\n');
}

// Writes <codex home>/rules/aos-gate.rules. A file at that path without the AOS-OWNED header is the user's: warn, never overwrite.
function installCodexRules({ targetHome = homeDir } = {}) {
    const dir = path.join(targetHome, '.codex', 'rules');
    const file = path.join(dir, 'aos-gate.rules');
    const want = codexGateRules();
    try {
        const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
        if (!gateOnFor('codex')) {
            if (have !== null && have.startsWith(uninstallRecords.CODEX_RULES_HEADER) && !DRY_RUN) { fs.unlinkSync(file); log.step(`Removed Codex go-gate rules ${file} (gate setting is off)`); return true; }
            return false;
        }
        if (have === want) return false;
        if (have !== null && !have.startsWith(uninstallRecords.CODEX_RULES_HEADER)) {
            log.warn(`${file} exists and is not from AOS; kept. The Codex go-gate rules backstop is not installed.`);
            return false;
        }
        const dirCreated = !fs.existsSync(dir);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, want, { mode: 0o644 });
        uninstallRecords.recordCodexRules(targetHome, { dirCreated });
        log.step(`Installed Codex go-gate rules to ${file}`);
        return true;
    } catch (e) {
        log.warn(`Could not write ${file}: ${e.message}`);
        return false;
    }
}

const CODEX_TRUST_REMINDER =
    'Codex: open Codex, run /hooks and trust the AOS go-gate hook — until then the gate does not run in Codex.\n' +
    'Non-interactive opt-in: pass --dangerously-bypass-hook-trust to codex.';
// Set when an install changed the AOS hook groups in ~/.codex/config.toml; printed as the last outro line.
let codexHooksChanged = false;

const CODEX_GATE_NOTICE = 'Codex asks you to trust new or changed hooks before it runs them; approve the go-gate hook in Codex, or it stays inactive. Firing under `codex exec` and under aos-acp is UNVERIFIED: run the smoke test in docs/codex-gate-smoke.md.';

// Merge the BDB hooks into ChatGPT Codex CLI's config.toml (~/.codex/config.toml or
// .codex/config.toml), ensuring [features] hooks = true and preserving existing
// non-BDB settings, comments, and MCP servers.
function mergeCodexTomlHooks(configTomlPath, { projectLocal = false } = {}) {
    const baseDir = path.dirname(configTomlPath);
    const hooksDir = projectLocal ? path.join(currentDir, '.codex', 'hooks') : path.join(baseDir, 'hooks');
    const workflowsDir = projectLocal ? path.join(currentDir, '.codex', 'workflows') : path.join(baseDir, 'workflows');
    const globalHooksDir = projectLocal ? path.join(homeDir, '.codex', 'hooks') : hooksDir;

    const fullSnippet = [
        '# AOS:HOOKS:START',
        codexGateSnippet(hooksDir),
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
        '[[hooks.UserPromptSubmit]]',
        '[[hooks.UserPromptSubmit.hooks]]',
        'type = "command"',
        `command = ${JSON.stringify(`node "${path.join(globalHooksDir, 'rules-inject.mjs')}"`)}`,
        'timeout = 10',
        '',
        '[[hooks.SessionStart]]',
        '[[hooks.SessionStart.hooks]]',
        'type = "command"',
        `command = ${JSON.stringify(`node "${path.join(globalHooksDir, 'memb-inject.mjs')}"`)}`,
        'timeout = 30',
        '',
        '[[hooks.SessionStart]]',
        '[[hooks.SessionStart.hooks]]',
        'type = "command"',
        `command = ${JSON.stringify(`node "${path.join(globalHooksDir, 'aos-session-hint.mjs')}"`)}`,
        'timeout = 3',
        '',
        // Re-arms the once-per-session rules block after /clear or compaction (SessionStart source); prints nothing.
        '[[hooks.SessionStart]]',
        '[[hooks.SessionStart.hooks]]',
        'type = "command"',
        `command = ${JSON.stringify(`node "${path.join(globalHooksDir, 'rules-inject.mjs')}"`)}`,
        'timeout = 3',
        '',
        // Sidecar starter: not a context hook, so --no-hooks and minimal keep it. Prints only the session's own A2A peer name (one line of additionalContext); skips itself under AOS_A2A_SIDECAR=off / AOS_DELEGATE_DEPTH>0.
        '[[hooks.SessionStart]]',
        '[[hooks.SessionStart.hooks]]',
        'type = "command"',
        `command = ${JSON.stringify(`node "${path.join(globalHooksDir, 'a2a-session.mjs')}" --harness codex`)}`,
        'timeout = 10',
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
        'timeout = 5',
        '',
        '[[hooks.Stop]]',
        '[[hooks.Stop.hooks]]',
        'type = "command"',
        `command = ${JSON.stringify(`node "${path.join(globalHooksDir, 'trail-relay.mjs')}" --agent codex --event Stop`)}`,
        'timeout = 5',
        '# AOS:HOOKS:END'
    ].join('\n');
    // Blocks are blank-line separated; without context hooks only blocks naming a context script go.
    const tomlSnippet = contextHooksOn && memoryOn && gateOnFor('codex') ? fullSnippet
        : `${fullSnippet.replace(/\n# AOS:HOOKS:END$/, '').split('\n\n').filter((b) => !droppedHook(b, 'codex')).join('\n\n')}\n# AOS:HOOKS:END`;

    let content = fs.existsSync(configTomlPath) ? fs.readFileSync(configTomlPath, 'utf8') : '';
    const original = content;

    // Ensure [features] hooks = true
    // Only the [features] table counts: `hooks = true` in another table does not enable hooks, and
    // `hooks = false` there must be flipped, not duplicated (duplicate keys are invalid TOML).
    const featuresRe = /^(\[features\][^\n]*\n)((?:(?!\s*\[)[^\n]*(?:\n|$))*)/m;
    const fm = featuresRe.exec(content);
    if (!fm) {
        content = `[features]\nhooks = true\n\n${content.trimStart()}`;
    } else if (!/^\s*(?:hooks|codex_hooks)\s*=\s*true\b/m.test(fm[2])) {
        const body = /^\s*(?:hooks|codex_hooks)\s*=/m.test(fm[2])
            ? fm[2].replace(/^(\s*(?:hooks|codex_hooks)\s*=\s*)\S+/m, '$1true')
            : `hooks = true\n${fm[2]}`;
        content = content.slice(0, fm.index) + fm[1] + body + content.slice(fm.index + fm[0].length);
    }

    // Drop every AOS hook entry (marker block or not, duplicates included), then append one fresh block.
    const isAosMarker = (l) => /^\s*# AOS:HOOKS:(START|END)\s*$/.test(l);
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const kept = (uninstallRecords.dropAosHookGroups(content.split(/\r?\n/).filter((l) => !isAosMarker(l))));
    // Blank lines left where AOS groups sat are collapsed, so a block that is not last in the file does not grow on every run.
    const body = kept.join(eol).replace(/(?:\r?\n){3,}/g, eol + eol).trimEnd();
    content = `${body}${eol}${eol}${tomlSnippet.split('\n').join(eol)}${eol}`;

    const hookHash = uninstallRecords.codexAosHookHash(content);
    const hooksChanged = hookHash !== uninstallRecords.codexAosHookHash(original);
    try {
        fs.mkdirSync(path.dirname(configTomlPath), { recursive: true });
        // Codex trusts a hook by its hash: an unchanged file is not rewritten.
        if (content !== original) fs.writeFileSync(configTomlPath, content, { mode: 0o600 });
        // The doctor compares Codex's trust entries against this snapshot to tell whether /hooks ran since.
        if (hooksChanged && !projectLocal && !DRY_RUN && path.basename(baseDir) === '.codex') {
            const record = path.join(path.dirname(baseDir), '.aos', 'codex-hooks.json');
            try {
                fs.mkdirSync(path.dirname(record), { recursive: true });
                fs.writeFileSync(record, JSON.stringify({ hookHash, trustedHashes: uninstallRecords.codexTrustedHashes(content), changedAt: new Date().toISOString() }, null, 2) + '\n');
            } catch (e) { logDebug(e, 'codex-hooks.json'); }
        }
        // Hooks live in config.toml only; Codex warns when hooks.json holds them too.
        for (const line of uninstallRecords.migrateCodexHooksJson({ file: path.join(baseDir, 'hooks.json'), dryRun: DRY_RUN })) log.step(line);
    } catch (e) {
        log.warn(`Could not write ${configTomlPath}: ${e.message}`);
        return false;
    }
    return hooksChanged;
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
        copyDirRecursiveSync(agentsSrc, projectAgentsDir, AGENTS_COPY_EXCLUDE);
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
            const { claude, agy, codex } = v5Profile.HARNESS_HOOKS;
            const agyA2aSrc = path.join(srcDir, 'agy-hooks', 'a2a-inbox.mjs');
            const agyNames = agy.filter((n) => n !== 'a2a-inbox.mjs');
            copyHookScripts(hooksSrc, path.join(projectClaudeDir, 'hooks'), claude);
            copyHookScripts(hooksSrc, path.join(projectAgentsDir, 'hooks'), agyNames);
            if (fs.existsSync(agyA2aSrc)) copyDirRecursiveSync(agyA2aSrc, path.join(projectAgentsDir, 'hooks', 'a2a-inbox.mjs'));
            copyHookScripts(hooksSrc, path.join(projectCodexDir, 'hooks'), codex);
            log.step(`Copied hooks to project harnesses`);
        }
    }, 'go-gate / graph-gate enforcement stays inactive in this project.');

    installStep('copy agent definitions into project', () => {
        const agentsMdSrc = path.join(srcDir, '.agents', 'AGENTS.md');
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
    if (memoryOn && !availableMcps.includes(CORE_MCP)) availableMcps.push(CORE_MCP);

    if (tier === '2') {
        const basicMcps = ['memb-mcp', 'windows-computer-use-mcp'];
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

    const core = memoryOn ? [CORE_MCP] : [];
    if (selectable.length === 0) return core;

    const chosen = await multiselectWithBack({
        message: memoryOn ? 'Select optional MCPs to install (memb-mcp core is always included):' : 'Select optional MCPs to install:',
        options: selectable.map(m => ({ value: m, label: m, hint: existingInstalled.includes(m) ? 'currently installed' : undefined })),
        initialValues: existingInstalled.filter(m => selectable.includes(m)),
        allowEmpty: true
    });

    if (chosen === BACK) return BACK;

    return [...core, ...chosen];
}

// Returns the module ids it actually installed this call (distinct from `installedModules`,
// which may already contain ids from a prior run that this call does NOT touch) -- callers
// use this to tell reloadDaemons() which daemons were just installed-and-verified here, so
// it doesn't redundantly relaunch and re-check them a second time.
// Explicit opt-in for unattended runs: --modules=synapse,memb or AOS_MODULES (ids as in the
// module picker, or "all"). -y alone selects none.
function parseModuleSelection(argv = process.argv, env = process.env) {
    const flag = argv.find((a) => a.startsWith('--modules='));
    return [env.AOS_MODULES, flag && flag.slice('--modules='.length)].filter(Boolean).join(',')
        .split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
}

// Pack checkboxes of the setup module picker: every pack that is not brought by a tier or a
// module on its own (live-show rides with Pro MEDIA, creator/hardware with their modules,
// stacks rides along with app-dev). Selecting one implies the pack additively.
const PACK_CHECKBOX_LABELS = {
    'web-design': 'Web Design & Frontend',
    'app-dev': 'App Development & Deploy (adds the language stacks pack)',
    'agents-automation': 'Agents & Automation',
    'business': 'Agency & Business',
    'harness-engineering': 'Harness Engineering',
};
const PACK_CHECKBOX_IDS = Object.keys(PACK_CHECKBOX_LABELS);

async function promptOptionalModules(installedModules, requested = parseModuleSelection(), modulesOverride = null) {
    const packDefs = (() => { try { return skillPacks.loadPacks(srcDir).packs || {}; } catch { return {}; } })();
    const allModules = (modulesOverride || [
        { id: 'synapse', name: 'BDB Synapse (3D Codebase Visualizer)', fn: installSynapse },
        { id: 'memb', name: 'memB Vector Engine (Local Semantic Memory)', fn: () => installMemB(true) },
        { id: 'remote', name: 'BDB OS Remote Gateway (Zero-Trust Tailscale Multiplexer)', fn: installOSRemoteGateway },
        // Offered only where it can actually run -- see aoSupportedHere(). The
        // predecessor, @hybridlabor-api/bdb-os-agent-workspace, must never come
        // back: its repository is archived and its last release predates the
        // archiving, so it hands out the build with the CDC defect.
        ...(aoSupportedHere()
            ? [{ id: 'ao', name: 'AO Agent Orchestrator (Session telemetry & WebUI)', fn: installOSAgentWorkspace }]
            : []),
        { id: 'creator', name: 'BDB Creator Extension (Generative 3D, Video & ComfyUI)', fn: installCreatorExtension },
        { id: 'hardware', name: 'BDB Hardware & PCB (KiCad + OpenSCAD Electrical/PCB Design)', fn: installHardwarePcb },
        { id: 'rustauri', name: 'Rust + Tauri (tauri-pilot + rust-pro skills, optional)', fn: installRustauri },
        { id: 'styleseed', name: 'StyleSeed (Toss design-language UI/UX skills, optional)', fn: installStyleseed },
        { id: 'codebase-memory', name: 'Codebase Memory MCP (Code Knowledge Graph, Local SQLite)', fn: installCodebaseMemory },
        { id: 'installer', name: 'BDB Dev Tool Installer (Interactive Hub & CLI Launcher)', fn: installDevToolInstaller },
        // Skill-pack checkboxes: a no-op module whose only effect is the implied pack.
        ...PACK_CHECKBOX_IDS.filter((id) => skillPacks.knownPack(id, srcDir)).map((id) => ({
            id,
            name: `${PACK_CHECKBOX_LABELS[id] || id} (skill pack)`,
            hint: packDefs[id] && packDefs[id].description,
            fn: () => true,
        })),
    ]).filter((m) => !installExcluded.has(m.id));

    const uninstalled = allModules.filter(m => !installedModules.includes(m.id));
    const implyPacks = (ids) => { for (const id of ids) addImpliedPack(id); };
    if (isAutoYes) {
        if (!requested.length) return [];
        const wantAll = requested.includes('all');
        for (const id of requested) {
            if (id !== 'all' && !allModules.some((m) => m.id === id)) log.warn(`Unknown module "${id}" in --modules ignored (known: ${allModules.map((m) => m.id).join(', ')}).`);
        }
        const auto = uninstalled.filter((m) => wantAll || requested.includes(m.id)).map((m) => m.id);
        const res = await runModuleInstalls(allModules, auto, installedModules);
        implyPacks(res.installed);
        return res.installed;
    }
    if (uninstalled.length === 0) return [];

    const chosen = pick(await multiselect({
        message: 'New / optional BDB OS modules and skill packs - select what to install:',
        options: uninstalled.map(m => ({ value: m.id, label: m.name, hint: m.hint })),
        required: false
    }));

    const res = await runModuleInstalls(allModules, chosen, installedModules);
    implyPacks(res.installed);
    return res.installed;
}

// Module installers return false (or throw) on failure; undefined/true mean success.
// Only successes are recorded, so the manifest never claims a module that is not there.
const moduleFailures = [];
async function runModuleInstalls(allModules, chosen, installedModules) {
    const installed = [];
    const failed = [];
    for (const mod of allModules) {
        if (!chosen.includes(mod.id)) continue;
        let reason = null;
        try {
            if (await mod.fn() === false) reason = 'installation reported a failure (see warnings above)';
        } catch (e) {
            reason = e && e.message ? e.message : String(e);
        }
        if (reason === null) {
            installed.push(mod.id);
            if (!installedModules.includes(mod.id)) installedModules.push(mod.id);
        } else {
            failed.push({ id: mod.id, name: mod.name, reason });
            moduleFailures.push({ id: mod.id, name: mod.name, reason });
            log.warn(`${mod.name} was not installed: ${reason}`);
        }
    }
    return { installed, failed };
}

// Module ids whose daemons ship a web interface or background service worth
// surfacing in the launchpad (each has a card in the generated HTML below).
const LAUNCHPAD_WEB_MODULES = ['memb', 'synapse', 'openwiki', 'ao', 'remote'];
// The hub is a core, on-demand service (started with `aos hub`, same as the
// store UI), not an optional daemon module — but its launchpad card belongs on
// the page. Registered after the literal so the constant itself keeps its
// documented daemon-module shape.
LAUNCHPAD_WEB_MODULES.push('hub');

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
    const env = overrides.env || process.env;
    const argv = overrides.argv || process.argv;
    if (env.AOS_NO_OPEN === '1' || argv.includes('--no-open')) return false;
    if (overrides.isUpdate || overrides.isRepair) return false;
    if (argv.includes('update') || argv.includes('repair') || argv.includes('--update') || argv.includes('--repair')) return false;
    if (isDevEnvironment(overrides)) return true;
    if (LAUNCHPAD_OPEN_FLAGS.some(f => argv.includes(f))) return true;
    const installed = Array.isArray(installedModules) ? installedModules : [];
    return installed.some(m => LAUNCHPAD_WEB_MODULES.includes(m));
}

// Boot autostart (login item) is opt-in only: an explicit flag or a dev
// checkout. Regular end-user installs must not get an autostart entry that
// opens a browser on every login. Overrides exist for tests.
function shouldAutostartLaunchpad(overrides = {}) {
    const env = overrides.env || process.env;
    const argv = overrides.argv || process.argv;
    if (env.AOS_NO_OPEN === '1' || argv.includes('--no-open')) return false;
    if (overrides.isUpdate || overrides.isRepair) return false;
    if (argv.includes('update') || argv.includes('repair') || argv.includes('--update') || argv.includes('--repair')) return false;
    if (argv.includes('--autostart-launchpad')) return true;
    return isDevEnvironment(overrides);
}

// Plan Canvas autostart is strictly opt-in (--autostart-plan-canvas): unlike
// the launchpad opener it is NOT implied by a dev checkout. The server never
// idle-exits there (AOS_PLAN_CANVAS_IDLE_MS=0 is honoured by server.js).
const PLAN_CANVAS_LABEL = 'com.bdb.plan-canvas';

function shouldAutostartPlanCanvas(overrides = {}) {
    const argv = overrides.argv || process.argv;
    return argv.includes('--autostart-plan-canvas');
}

function buildPlanCanvasPlist({ nodeBin, scriptPath, home, logDir }) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLAN_CANVAS_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodeBin}</string>
        <string>${scriptPath}</string>
        <string>server</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>AOS_PLAN_CANVAS_IDLE_MS</key>
        <string>0</string>
        <key>AOS_SUPERVISED</key>
        <string>1</string>
    </dict>
    <key>WorkingDirectory</key>
    <string>${home}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <key>StandardOutPath</key>
    <string>${path.join(logDir, 'plan-canvas.stdout.log')}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(logDir, 'plan-canvas.stderr.log')}</string>
</dict>
</plist>`;
}

// Same bat + hidden-vbs-in-Startup mechanism as the OpenWiki visualizer. Windows has no supervisor for a
// Startup entry, so the bat loops: a crash or exit 3 (new code on disk, AOS_SUPERVISED) restarts in 5 s.
// ponytail: also loops every 5 s while another canvas holds the port; a Task Scheduler task if that matters.
function buildPlanCanvasWinFiles({ nodeBin, scriptPath, home, logDir, batPath }) {
    const out = path.join(logDir, 'plan-canvas.stdout.log');
    const err = path.join(logDir, 'plan-canvas.stderr.log');
    return {
        bat: `@echo off\r\ncd /d "${home}"\r\nset AOS_PLAN_CANVAS_IDLE_MS=0\r\nset AOS_SUPERVISED=1\r\n:loop\r\n"${nodeBin}" "${scriptPath}" server >> "${out}" 2>> "${err}"\r\ntimeout /t 5 /nobreak >nul\r\ngoto loop\r\n`,
        vbs: `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.CurrentDirectory = "${home}"\r\nWshShell.Run """${batPath}""", 0, False\r\n`,
    };
}

function installPlanCanvasAutostart(overrides = {}) {
    if (!shouldAutostartPlanCanvas(overrides)) return false;
    if ((overrides.dryRun ?? DRY_RUN)) {
        log.step('[dry-run] would register the Plan Canvas background server (Port 4519, no idle exit)');
        return false;
    }
    const home = overrides.homeDir || homeDir;
    const platform = overrides.platform || process.platform;
    const scriptPath = [
        path.join(home, '.agents', 'skills', 'plan-canvas', 'scripts', 'plan-canvas.js'),
        path.join(srcDir, 'skills', 'global_config', 'plan-canvas', 'scripts', 'plan-canvas.js'),
    ].find(p => fs.existsSync(p));
    if (!scriptPath) {
        log.warn('Plan Canvas autostart skipped: plan-canvas.js not found. Start it with: aos-plan-canvas server');
        return false;
    }
    const nodeBin = overrides.nodeBin || process.execPath;
    const logDir = path.join(home, '.agents', 'logs');
    try {
        fs.mkdirSync(logDir, { recursive: true });
        if (platform === 'darwin') {
            const plistPath = path.join(home, 'Library', 'LaunchAgents', `${PLAN_CANVAS_LABEL}.plist`);
            fs.mkdirSync(path.dirname(plistPath), { recursive: true });
            fs.writeFileSync(plistPath, buildPlanCanvasPlist({ nodeBin, scriptPath, home, logDir }));
            if (!overrides.skipLaunchctl && !v5Profile.isTestSandbox(home)) {
                reloadLaunchAgent(plistPath);
            }
            log.success('Plan Canvas LaunchAgent registered (Port 4519)');
        } else if (platform === 'win32') {
            const startupDir = path.join(overrides.appData || process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
            fs.mkdirSync(startupDir, { recursive: true });
            const batPath = path.join(home, '.agents', 'run-plan-canvas.bat');
            const vbsPath = path.join(startupDir, `${PLAN_CANVAS_LABEL}.vbs`);
            const files = buildPlanCanvasWinFiles({ nodeBin, scriptPath, home, logDir, batPath });
            fs.writeFileSync(batPath, files.bat, 'utf-8');
            fs.writeFileSync(vbsPath, files.vbs, 'utf-8');
            if (!overrides.skipLaunchctl) spawn('wscript.exe', [vbsPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
            log.success('Plan Canvas Startup entry registered (Port 4519)');
        } else if (platform === 'linux') {
            // Same program, env and logs as the launchd plist above.
            const unitName = 'com.bdb.plan-canvas.service';
            const unitFile = systemdUnits.unitPath(home, unitName);
            fs.mkdirSync(path.dirname(unitFile), { recursive: true });
            fs.writeFileSync(unitFile, systemdUnits.buildUserUnit({
                description: 'Plan Canvas',
                execStart: [nodeBin, scriptPath, 'server'],
                workingDirectory: home,
                env: { AOS_PLAN_CANVAS_IDLE_MS: '0', AOS_SUPERVISED: '1' },
                restart: 'always',
                logOut: path.join(logDir, 'plan-canvas.stdout.log'),
                logErr: path.join(logDir, 'plan-canvas.stderr.log'),
            }));
            if (!overrides.skipLaunchctl) {
                // This install path stays synchronous (its return value is asserted
                // in tests), so the enable result is reported outside the try.
                systemdUnits.enableUnit(async (cmd, args) => {
                    execFileSync(cmd, args, { stdio: 'ignore', windowsHide: true });
                    return { ok: true };
                }, unitName).catch((e) => logDebug(e, 'plan canvas linux unit'));
            }
            log.success('Plan Canvas systemd user unit registered (Port 4519)');
        } else {
            log.step('Plan Canvas autostart is not wired for this platform. Start it with: aos-plan-canvas server');
            return false;
        }
        return true;
    } catch (e) { logDebug(e, 'plan canvas autostart'); return false; }
}

function generateAndOpenLaunchpad(installedModules = []) {
    if (DRY_RUN) {
        log.step('[dry-run] would generate & open BDB Launchpad HTML');
        return false;
    }
    if (process.env.SSH_CLIENT || process.env.SSH_TTY) return false;
    if (process.env.AOS_NO_OPEN === '1' || process.argv.includes('--no-open')) return false;

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
    .card-hint {
      display: none;
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 4px;
      font-style: italic;
    }
    .card.offline .card-hint {
      display: block;
    }
    .card-hint code {
      font-family: var(--mono);
      font-style: normal;
      color: #ffffff;
      background: #0a0a0a;
      border: 1px solid var(--accent);
      border-radius: 4px;
      padding: 1px 6px;
      cursor: copy;
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
      <a class="card" href="http://127.0.0.1:4322" target="_blank">
        <div class="card-content">
          <div class="card-icon"><svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="grad-store" x1="50%" y1="0%" x2="50%" y2="100%"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#9b30c4"/></linearGradient></defs>
            <rect x="20" y="20" width="60" height="60" rx="4" fill="url(#grad-store)" opacity="0.85"/>
            <rect x="28" y="28" width="12" height="14" rx="1.5" fill="#0a0a0a" opacity="0.6"/><rect x="45" y="28" width="12" height="14" rx="1.5" fill="#0a0a0a" opacity="0.6"/><rect x="62" y="28" width="12" height="14" rx="1.5" fill="#0a0a0a" opacity="0.6"/>
            <rect x="28" y="48" width="12" height="14" rx="1.5" fill="#0a0a0a" opacity="0.6"/><rect x="45" y="48" width="12" height="14" rx="1.5" fill="#0a0a0a" opacity="0.6"/><rect x="62" y="48" width="12" height="14" rx="1.5" fill="#0a0a0a" opacity="0.6"/>
          </svg></div>
          <div class="card-info">
            <h2>AOS Store</h2>
            <p>Browse & install skills and agents</p>
            <div class="card-hint">offline — run: aos-store ui</div>
          </div>
        </div>
        <div class="card-meta">
          <span class="port-pill">:4322</span>
          <span class="status-dot" id="dot-store" title="Checking..."></span>
        </div>
      </a>
      <a class="card" href="http://127.0.0.1:4519/" target="_blank">
        <div class="card-content">
          <div class="card-icon"><svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="grad-plancanvas" x1="50%" y1="0%" x2="50%" y2="100%"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#9b30c4"/></linearGradient></defs>
            <rect x="18" y="22" width="64" height="56" rx="4" fill="url(#grad-plancanvas)" opacity="0.85"/>
            <rect x="26" y="30" width="22" height="14" rx="1.5" fill="#0a0a0a" opacity="0.6"/><rect x="52" y="30" width="22" height="14" rx="1.5" fill="#0a0a0a" opacity="0.6"/>
            <line x1="26" y1="54" x2="74" y2="54" stroke="#0a0a0a" stroke-width="2.5" opacity="0.5"/><line x1="26" y1="64" x2="56" y2="64" stroke="#0a0a0a" stroke-width="2.5" opacity="0.5"/>
          </svg></div>
          <div class="card-info">
            <h2>Plan Canvas</h2>
            <p>Review plans in the browser: annotate, chat, approve</p>
            <div class="card-hint">offline — run: <code data-copy="aos-plan-canvas server" title="Click to copy">aos-plan-canvas server</code></div>
          </div>
        </div>
        <div class="card-meta">
          <span class="port-pill">:4519</span>
          <span class="status-dot" id="dot-plancanvas" title="Checking..."></span>
        </div>
      </a>
      <a class="card" href="http://127.0.0.1:7900/" target="_blank">
        <div class="card-content">
          <div class="card-icon"><svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="grad-hub" x1="50%" y1="0%" x2="50%" y2="100%"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#9b30c4"/></linearGradient></defs>
            <circle cx="50" cy="50" r="34" fill="url(#grad-hub)" opacity="0.85"/>
            <circle cx="50" cy="50" r="9" fill="#0a0a0a"/>
            <circle cx="50" cy="18" r="4" fill="#FFFFFF"/><circle cx="79" cy="65" r="4" fill="#FFFFFF"/><circle cx="21" cy="65" r="4" fill="#FFFFFF"/>
            <line x1="50" y1="50" x2="50" y2="18" stroke="#FFFFFF" stroke-width="1.5" opacity="0.6"/>
            <line x1="50" y1="50" x2="79" y2="65" stroke="#FFFFFF" stroke-width="1.5" opacity="0.6"/>
            <line x1="50" y1="50" x2="21" y2="65" stroke="#FFFFFF" stroke-width="1.5" opacity="0.6"/>
          </svg></div>
          <div class="card-info">
            <h2>AOS Hub</h2>
            <p>Services, plan kits and the store in one page</p>
            <div class="card-hint">on demand — run: <code data-copy="aos hub" title="Click to copy">aos hub</code></div>
          </div>
        </div>
        <div class="card-meta">
          <span class="port-pill">:7900</span>
          <span class="status-dot" id="dot-hub" title="Checking..."></span>
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
      const card = dot.closest('.card');
      fetch(url, { mode: 'no-cors' })
        .then(() => {
          dot.classList.add('online');
          if (card) card.classList.remove('offline');
        })
        .catch(() => {
          dot.classList.remove('online');
          if (card) card.classList.add('offline');
        });
    }
    function checkAllHealth() {
      checkHealth('http://127.0.0.1:8088', 'dot-memb');
      checkHealth('http://127.0.0.1:7781', 'dot-synapse');
      checkHealth('http://127.0.0.1:3101', 'dot-ao');
      checkHealth('http://127.0.0.1:9080', 'dot-remote');
      checkHealth('http://127.0.0.1:4321', 'dot-openwiki');
      checkHealth('http://127.0.0.1:4322', 'dot-store');
      checkHealth('http://127.0.0.1:4519', 'dot-plancanvas');
      checkHealth('http://127.0.0.1:7900', 'dot-hub');
    }
    document.addEventListener('click', (ev) => {
      const el = ev.target.closest && ev.target.closest('[data-copy]');
      if (!el) return;
      ev.preventDefault();
      ev.stopPropagation();
      const text = el.getAttribute('data-copy');
      const fallback = () => {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        ta.remove();
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(fallback);
      else fallback();
      el.title = 'Copied';
    }, true);
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
            child = spawn('explorer', [filePath], { detached: true, stdio: 'ignore', windowsHide: true });
        } else {
            child = spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore', windowsHide: true });
        }
        if (child) {
            child.on('error', warnOpenFailed);
            child.unref();
        }
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
            if (!v5Profile.isTestSandbox(homeDir)) {
                reloadLaunchAgent(plistPath);
            }
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

function syncMcpConfigFile(targetPath, masterMcpData) {
    try {
        const loaded = loadJsonConfig(targetPath);
        if (loaded.state === 'invalid') { warnUnparseable(targetPath, 'MCP sync', loaded); return; }
        const before = loaded.state === 'ok' ? JSON.stringify(loaded.data) : null;
        const data = loaded.data;
        if (!data.mcpServers || typeof data.mcpServers !== 'object') data.mcpServers = {};
        const collector = mcpSecrets.createCollector();
        mcpSecrets.mergeServers(data.mcpServers, withoutGatewayServers(masterMcpData.mcpServers, targetPath), { shipped: mcpShipped(), collector, launcher: mcpLauncher(), onSkip: warnUserMcpEntry(targetPath) });
        retireMcpServers(data.mcpServers);
        if (before !== null && before === JSON.stringify(data)) { writeConfigWithBackup(targetPath, data, before); return; }
        if (!stashInlineSecrets(collector, targetPath)) return;
        if (writeConfigWithBackup(targetPath, data, before)) recordMcpConfigPath(targetPath);
    } catch (e) {
        log.warn(`Failed to sync MCP to ${targetPath}: ${e.message}`);
    }
}

function syncOpencodeConfigFile(targetPath, masterMcpData) {
    try {
        const loaded = loadJsonConfig(targetPath);
        if (loaded.state === 'invalid') { warnUnparseable(targetPath, 'OpenCode MCP and plugin sync', loaded); return; }
        const existing = loaded.state === 'ok' ? loaded.data : null;
        const before = existing ? JSON.stringify(existing) : null;
        const data = existing && existing.mcp ? existing : Object.assign({}, existing || {}, { mcp: {} });
        const collector = mcpSecrets.createCollector();
        if (masterMcpData.mcpServers) {
            // OpenCode provider APIs (e.g. OpenAI-compatible, Console) enforce tool name length limits
            // (e.g. max 64 chars) and context limits. Loading 20+ MCPs causes provider errors (e.g. 73-char tool names).
            // OpenCode uses a slim profile: only core servers (memb_mcp, zavora_computer_use) are enabled by default.
            // tauri-pilot is only in the master set when the opt-in Rust + Tauri package is installed.
            const OPENCODE_DEFAULT_SLIM = new Set(['memb_mcp', 'zavora_computer_use', 'deja', 'tauri-pilot']);
            const existingMcp = existing && existing.mcp ? existing.mcp : {};
            const hasExistingKeys = Object.keys(existingMcp).length > 0;

            for (const [key, rawVal] of Object.entries(withoutGatewayServers(masterMcpData.mcpServers, targetPath))) {
                const existingEntry = existingMcp[key];
                const prevEnv = (existingEntry && existingEntry.environment) || {};
                const val = mcpSecrets.wrapServer(key, rawVal, mcpLauncher(), Object.keys(prevEnv).filter((k) => mcpSecrets.secretKV(k, prevEnv[k])));
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

                // A same-named entry the user wrote with another command is not ours to replace.
                if (existingEntry && !mcpSecrets.isAosOwned(key, mcpSecrets.fromOpencode(existingEntry), { command: val.command, args: val.args }, mcpShipped())) {
                    warnUserMcpEntry(targetPath)(key);
                    continue;
                }

                // If existing config is intentionally slimmed (has keys, but omitted this one), don't resurrect unless in slim set
                if (hasExistingKeys && !existingEntry && !OPENCODE_DEFAULT_SLIM.has(key)) {
                    continue;
                }

                // Preserve user's explicit enabled/disabled setting; otherwise default to true only for slim set
                const isEnabled = existingEntry && typeof existingEntry.enabled === 'boolean'
                    ? existingEntry.enabled
                    : OPENCODE_DEFAULT_SLIM.has(key);

                for (const [k, v] of mcpSecrets.inlineSecrets(prevEnv)) collector.add(k, v);
                const envObj = val.environment || val.env;

                data.mcp[key] = {
                    type: "local",
                    command: fullCmd,
                    enabled: isEnabled,
                    ...(envObj && Object.keys(envObj).length ? { environment: envObj } : {})
                };
            }
        }

        retireMcpServers(data.mcp, true);

        // Wire BDB AOS Plugin for OpenCode. `data` is handed in because this
        // function owns the write -- it merges MCP servers in the same pass.
        // homeDir matches how the opencode harness entry builds its path.
        installOpencodePlugin({ targetHome: homeDir, configPath: targetPath, data });

        if (before !== null && before === JSON.stringify(data)) { writeConfigWithBackup(targetPath, data, before); return; }
        if (!stashInlineSecrets(collector, targetPath)) return;
        writeConfigWithBackup(targetPath, data, before);
    } catch (e) {
        log.warn(`Failed to sync MCP to ${targetPath}: ${e.message}`);
    }
}

// Update-time migration: AOS-owned entries in every known harness config (CLAUDE_CONFIG_DIR and CODEX_HOME
// honoured) that still carry inline secrets are rewritten to the launcher form. Backup first, values go into
// the secrets file unless it already holds that variable, user entries stay untouched. Idempotent.
function migrateMcpSecrets() {
    const shipped = mcpShipped();
    const moved = [];
    installMcpLauncher();
    const launcher = mcpLauncher();
    if (!launcher) return moved;
    for (const { file, kind } of mcpSecrets.harnessMcpFiles(homeDir)) {
        if (!fs.existsSync(file)) continue;
        try {
            if (kind === 'toml') {
                const tables = mcpSecrets.parseCodexTables(readTextFile(file));
                const owned = {};
                let blocked = null;
                for (const [name, t] of Object.entries(tables)) {
                    if (!shipped[name]) continue;
                    const entry = mcpSecrets.codexEntry(t);
                    if (typeof entry.command !== 'string' || !mcpSecrets.isAosOwned(name, entry, null, shipped)) continue;
                    if (t.unparsed.length) blocked = name;
                    owned[name] = entry;
                }
                if (blocked) { log.warn(`${file}: table "${blocked}" has fields this installer cannot rewrite safely; its inline secrets (if any) were left in place.`); continue; }
                if (!Object.keys(owned).length || JSON.stringify(mcpSecrets.wrapServers(owned, launcher)) === JSON.stringify(owned)) continue;
                mergeCodexTomlMcpServers(file, owned);
                moved.push(file);
                continue;
            }
            const loaded = loadJsonConfig(file);
            if (loaded.state === 'invalid') { warnUnparseable(file, 'secret migration', loaded); continue; }
            if (loaded.state !== 'ok') continue;
            const map = loaded.data[kind === 'opencode' ? 'mcp' : 'mcpServers'];
            if (!map || typeof map !== 'object') continue;
            const before = JSON.stringify(loaded.data);
            const collector = mcpSecrets.createCollector();
            for (const [name, entry] of Object.entries(map)) {
                const canon = kind === 'opencode' ? mcpSecrets.fromOpencode(entry) : entry;
                if (!canon || !mcpSecrets.isAosOwned(name, canon, null, shipped)) continue;
                const env = (canon.env && typeof canon.env === 'object') ? canon.env : {};
                for (const [k, v] of mcpSecrets.inlineSecrets(env)) collector.add(k, v);
                const wrapped = mcpSecrets.wrapServer(name, canon, launcher);
                map[name] = kind === 'opencode' ? mcpSecrets.toOpencode(entry, wrapped) : wrapped;
            }
            if (JSON.stringify(loaded.data) === before) continue;
            if (!stashInlineSecrets(collector, file)) continue;
            if (writeConfigWithBackup(file, loaded.data, before)) moved.push(file);
        } catch (e) {
            log.warn(`Could not migrate MCP secrets in ${file}: ${e.message}`);
        }
    }
    if (moved.length) log.step(`MCP entries now use the secrets launcher in: ${moved.join(', ')}`);
    noticeSecretBackups();
    return moved;
}

async function universalHarnessSync(primaryMcpConfigPath, installedModules = []) {
    log.info('Universal Agent Harness Sync...');
    installMcpLauncher();
    const detections = detectPlatforms();
    let masterMcpData = {};
    try { masterMcpData = JSON.parse(fs.readFileSync(primaryMcpConfigPath, 'utf8')); } catch (e) { logDebug(e, 'operation'); }
    // The primary file may be agy's own, which must not hold mcsc; the other harnesses still get it.
    if (lastGeneratedMcpServers) masterMcpData = Object.assign({}, masterMcpData, { mcpServers: lastGeneratedMcpServers });

    const syncMcpConfig = (targetPath) => syncMcpConfigFile(targetPath, masterMcpData);
    const syncOpencodeConfig = (targetPath) => syncOpencodeConfigFile(targetPath, masterMcpData);

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
    noticeSecretBackups();
    log.success('Universal Sync Complete!');
    generateAndOpenLaunchpad(installedModules);
    installPlanCanvasAutostart();
}

// Kernel = skills, plugin migration; Harnesses = rules/hooks/MCP secrets. v5 runs them as separate steps.
function quickUpdateKernel(installState) {
    const s = spinner();
    s.start('Quick Update: refreshing skills & syncing installed submodules...');

    const excludeSkills = getTierExcludeSkills('1');
    const paths = resolveTargetPaths(defaultPlatformValue(), null);

    populateSkillLibrary();
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
    applySkillSet(_sessionManifest);
    applyPackSelection(_sessionManifest);
    s.stop('Skills refreshed');
    // Every AOS bin gets its ~/.local/bin launcher, on update too: skills above refreshed the files the
    // launchers point at (plan-canvas, archify, trail), and an install that predates a new bin never
    // gains the launcher without this. Idempotent; 'aos' still never overwrites a foreign file.
    installGlobalBinaries();
    const failures = [];
    const migration = runPluginMigration();
    if (migration.error) failures.push(`plugin migration: ${migration.error}`);
    const agy = runAgyPluginStep();
    if (agy) failures.push(`agy plugin: ${agy}`);
    return failures;
}

// Returns the list of failed steps (empty = all ok); v5 turns a non-empty list into a failed step.
function quickUpdateHarnesses() {
    // Everything injectHarnessRules() delivers -- RULES.md, the dispatcher
    // workflows the skills point at, the compiled subagent definitions, the
    // harness rule files and the gate + memory hooks -- used to be
    // fresh-install-only. v4.4.1 split just the hooks out of it for Quick
    // Update; the rest stayed behind, so a machine that only ever quick-updates
    // kept running first-install agent definitions and dispatcher scripts
    // forever. Same defect as the hook, one layer up. Run the whole thing.
    const steps = [
        ['refresh harness rules, workflows, agents and hooks', installStep('refresh harness rules, workflows, agents and hooks', () => {
            injectHarnessRules();
        }, 'Harness files keep whatever version this machine already had.')],
        ['remove the AOS mcsc entry from agy configs', installStep('remove the AOS mcsc entry from agy configs', () => { removeAosMcscFromAgyConfigs(); }, 'An mcsc entry in the agy config can recurse; remove it by hand.')],
        ['migrate legacy agy workspace MCP config', installStep('migrate legacy agy workspace MCP config', () => { mcpSecrets.migrateLegacyAgyWorkspaceMcp(homeDir, srcDir, { log }); })],
        ['move inline MCP secrets into the secrets file', installStep('move inline MCP secrets into the secrets file', () => { migrateMcpSecrets(); }, `Inline tokens stay in the harness configs; run the installer again or move them into ${mcpSecrets.secretsPath(homeDir)} yourself.`)],
        ['install the Codex plugin', installStep('install the Codex plugin', () => { runCodexPluginStep(); })],
    ];
    return steps.filter(([, r]) => !r.ok).map(([what, r]) => `${what}: ${r.error.message}`);
}

// No prompt: only refreshes when a key (or ollama) is already configured. Returns false when there is nothing to refresh.
async function refreshOpenWikiSilently({ key: given } = {}) {
    const paths = resolveTargetPaths('1', null);
    const env = loadExistingEnv(paths.targetMcpDir);
    const provider = env['OPENWIKI_PROVIDER'] || 'google';
    const keyName = PROVIDER_KEY_ENV_NAMES[provider] || 'GEMINI_API_KEY';
    const key = given || env[keyName] || env['GEMINI_API_KEY'] || env['GOOGLE_API_KEY'] || env['OPENWIKI_API_KEY'] || '';
    if (!key && provider !== 'ollama') return false;
    await installOpenWikiDaemon(key, paths.targetSkillDir, { provider, model: env['OPENWIKI_MODEL_ID'] || env['OPENWIKI_MODEL'] || '', baseUrl: env['OPENWIKI_BASE_URL'] || '' });
    await installOpenWikiVisualizer();
    return true;
}

async function runQuickUpdate(installState) {
    quickUpdateKernel(installState);
    quickUpdateHarnesses();
    const paths = resolveTargetPaths('1', null);

    // OpenWiki: if already configured, refresh the daemon silently (no prompt).
    // Only ask when there is no key yet — i.e. a first-time offer or a machine
    // that predates this feature. This avoids the "keep existing?" confirmation
    // on every Quick Update for users who have already set up OpenWiki.
    if (!isAutoYes) {
        const _owEnv = loadExistingEnv(paths.targetMcpDir);
        const _owProvider = _owEnv['OPENWIKI_PROVIDER'] || 'google';
        const _owKeyName = PROVIDER_KEY_ENV_NAMES[_owProvider] || 'GEMINI_API_KEY';
        const _owKey = _owEnv[_owKeyName] || _owEnv['GEMINI_API_KEY'] || _owEnv['GOOGLE_API_KEY'] || _owEnv['OPENWIKI_API_KEY'] || '';
        if (_owKey || _owProvider === 'ollama') {
            await installOpenWikiDaemon(_owKey, paths.targetSkillDir, { provider: _owProvider, model: _owEnv['OPENWIKI_MODEL_ID'] || _owEnv['OPENWIKI_MODEL'] || '', baseUrl: _owEnv['OPENWIKI_BASE_URL'] || '' });
            await installOpenWikiVisualizer();
        } else {
            const creds = await promptCredentials(paths.targetMcpDir);
            if (creds !== BACK) {
                await installOpenWikiDaemon(creds.gemini, paths.targetSkillDir, { provider: creds.openwikiProvider, model: creds.openwikiModel, baseUrl: creds.openwikiBaseUrl });
                await installOpenWikiVisualizer();
            }
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
        else if (subId === 'codebase-memory') await installCodebaseMemory();
        else if (subId === 'installer') await installDevToolInstaller();
    }

    await applyCodingModeStep(memoryCodingOptions());
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
    await maybeInstallCodenotch();
    // Very last line of a Quick Update when the Claude plugin step failed (issue #54).
    printClaudePluginFix();
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
        execSync(`npm install -g ${JSON.stringify(pkgDir)}`, { stdio: 'ignore', windowsHide: true });
    }, `The rest of AOS is installed. Install AOS CLI later: ${manual}`);

    if (res.ok && hasExecutable('aos-cli')) {
        log.success('AOS CLI installed -- run `aos-cli`.');
    } else if (res.ok) {
        log.warn('AOS CLI is installed but `aos-cli` is not on PATH. launchd and some Windows shells start with a PATH that omits npm\'s global bin.');
    }
}

// A running daemon may execute dest; overwriting its inode keeps stale code-signature
// state on macOS and every new exec dies with SIGKILL. Rename gives dest a fresh inode.
function installBinaryAtomically(src, dest) {
    const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.${process.pid}.${Date.now()}.tmp`);
    try {
        fs.copyFileSync(src, tmp);
        if (process.platform !== 'win32') fs.chmodSync(tmp, 0o755);
        fs.renameSync(tmp, dest);
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch (_) {}
        throw e;
    }
}

// aos-uninstall.mjs is ESM and drives its own confirmation prompt, so it runs as a child process.
function runUninstaller() {
    const uninstallScript = path.join(srcDir, 'bin', 'aos-uninstall.mjs');
    if (!fs.existsSync(uninstallScript)) {
        log.error(`Uninstaller not found at ${uninstallScript} -- run it directly: aos-uninstall (or npx -p @hybridlabor-api/aos aos-uninstall)`);
        return 1;
    }
    const r = spawnSync(process.execPath, [uninstallScript], { stdio: 'inherit', windowsHide: true });
    return r.status == null ? 1 : r.status;
}

// Prompts exist only in a TTY; `aos update` without one passes ui = {} and nothing is ever asked.
// menuMode (the interactive menu only): cancel returns null (back, nothing written). Otherwise cancel aborts like the wizard.
function v5Options(interactive, menuMode = false) {
    const ask = (v) => (menuMode ? (isCancel(v) ? null : v) : pick(v));
    const ui = interactive ? {
        select: async (message, options, initialValue) => ask(await select({ message, options, initialValue })),
        multi: async (message, options, initialValues) => ask(await multiselect({ message, options, initialValues, required: false })),
        text: async (message, initialValue) => { const v = await text({ message, initialValue }); return isCancel(v) ? null : String(v || '').trim(); },
        ask: async (key) => { const v = await password({ message: `${key} (leave blank to skip):` }); return isCancel(v) ? null : String(v || ''); },
        confirm: async (message) => { const a = await askConfirm({ message, initialValue: false }); return !isCancel(a) && !!a; },
    } : {};
    return { home: homeDir, write: (s) => process.stdout.write(s), ui, force: process.argv.includes('--force') || Boolean(process.env.AOS_FORCE) };
}

// Flags/env win over the persisted v5 settings for this run. Writes nothing: see persistInstallOptions.
function applyInstallOptions(home = homeDir) {
    const r = v5Profile.resolve(INSTALL_OPTS, v5Profile.readSettings(home));
    contextHooksOn = r.contextHooks;
    activeProfile = r.profile;
    installExcluded = r.excluded;
    skillSet = r.skillSet;
    packSelection = r.packs;
    runImpliedPacks.length = 0;
    // An unattended --modules= request that names a pack (or the creator/hardware modules)
    // brings that pack's skills in the same run: the module picker runs after the skill copy.
    for (const id of parseModuleSelection()) addImpliedPack(id);
    memoryOn = !installExcluded.has('memb');
    gateOn = r.gateOn;
    gateHoldKeys.clear(); // a fresh resolution restarts the decision; an explicit Settings choice re-applies everywhere
    return r;
}

// Saved so `aos update` keeps it. Called only where a real install or update starts (never for help, version,
// --dry-run, status or uninstall). A flag on the command line is saved; AOS_PROFILE is not.
function persistInstallOptions(home = homeDir) {
    const o = INSTALL_OPTS;
    if (DRY_RUN || !(o.profileFromFlag || o.noHooks || o.without.length || o.skillSetFromFlag || o.packsFromFlag)) return false;
    try {
        const st = v5Profile.readSettings(home);
        const next = { ...st, disabled: [...new Set([...st.disabled, ...o.without])] };
        if (o.profileFromFlag) { next.profile = o.profile; next.noHooks = o.noHooks; } else if (o.noHooks) next.noHooks = true;
        if (o.skillSetFromFlag) next.skillSet = o.skillSet;
        if (o.packsFromFlag) next.packs = skillPacks.normalizeSelection(o.packs, srcDir) || [];
        v5Profile.writeSettings(home, next);
        return true;
    } catch (e) {
        log.warn(`Could not save the install profile: ${e.message}`);
        return false;
    }
}

// The wizard's choices (Pro MEDIA tier, Creator/Hardware modules, pack checkboxes) become the stored pack
// selection on a fresh install or a setup re-run. `aos update` never calls this: no stored selection = keep everything.
function persistWizardPacks(home = homeDir) {
    if (DRY_RUN || isAutoYes || INSTALL_OPTS.packsFromFlag) return false;
    try {
        const meta = readJsonFile(path.join(home, '.agents', '.bdb-manifest.json'));
        const sel = skillPacks.normalizeSelection([...(packSelection || []), ...runImpliedPacks, ...skillPacks.impliedPacks(meta, srcDir)], srcDir) || [];
        v5Profile.writeSettings(home, { ...v5Profile.readSettings(home), packs: sel });
        packSelection = sel;
        log.step(`Skill packs saved: base${sel.length ? ` + ${sel.join(', ')}` : ' only'} (change with aos store install/remove --pack).`);
        return true;
    } catch (e) {
        log.warn(`Could not save the skill pack selection: ${e.message}`);
        return false;
    }
}

// The file-manifest session of a full install; --hooks-only needs the same one so its copies are tracked alike.
function initFullSession(installState) {
    initSessionManifest(installState.installManifest, [
        path.join(srcDir, 'skills'),
        path.join(srcDir, 'mcps'),
        path.join(srcDir, '.agents'),
        path.join(srcDir, '.claude'),
        path.join(srcDir, '.cursor'),
        path.join(srcDir, '.github'),
        path.join(srcDir, '.codex-plugin'),
        path.join(srcDir, 'RULES.md'),
        path.join(srcDir, 'AGENTS.md'),
        path.join(srcDir, 'CLAUDE.md'),
        path.join(srcDir, 'CODEX.md'),
    ]);
}

async function main() {
    const args = process.argv.slice(2);
    // An unknown word used to fall through to the full install, and without a TTY that is a silent -y install
    // that writes rule files into the cwd repo (F8: an agent's `aos gateway status`).
    const COMMANDS = ['memory', 'status', 'update', 'repair', 'version', 'help', 'store', 'doctor', 'checkup', 'hub', 'services', 'restart', 'dashboard', 'package', 'context', 'setup', 'allow'];
    if (args[0] && !args[0].startsWith('-') && !COMMANDS.includes(args[0])) {
        console.error(`aos: unknown command "${args[0]}". Nothing was changed. Commands: ${COMMANDS.join(', ')} (aos --help).`);
        process.exitCode = 2;
        return;
    }
    if (args[0] === 'allow') {
        process.exitCode = require('./lib/permissions-allow').allowCommand(args.slice(1), { home: homeDir });
        return;
    }
    applyInstallOptions();
    if (args[0] === 'memory') {
        process.exitCode = await require('./lib/memory-import').command(args.slice(1), { home: homeDir });
        return;
    }
    if (args[0] === 'context') {
        const { contextCommand } = require('./lib/v5/context-profiles');
        process.exitCode = contextCommand(args.slice(1), { home: homeDir });
        return;
    }
    if (['status', 'update', 'repair'].includes(args[0])) {
        if (args[0] !== 'status') {
            process.env.AOS_NO_OPEN = '1';
            persistInstallOptions();
        }
        process.exitCode = await require('./lib/v5/menu').runCommand(args[0], module.exports, v5Options(Boolean(process.stdout.isTTY && process.stdin.isTTY)));
        return;
    }
    if (args.includes('--version') || args.includes('-V') || args[0] === 'version') {
        console.log(pkg.version);
        return;
    }
    if (args.includes('--codex-gate')) {
        console.log(`${codexGateSnippet(path.join(homeDir, '.codex', 'hooks'))}\n\n${CODEX_GATE_NOTICE}`);
        return;
    }
    if (args.includes('--help') || args.includes('-h') || args[0] === 'help') {
        console.log(`Usage: aos [command] [options]

Commands:
  store            Browse and install skills
  hub              Open the AOS Hub (start|stop|status on 127.0.0.1:7900)
  services         Status or control of the local services (status|start|stop|restart)
  restart <id>     Restart one local service (typed confirm; same as aos services restart)
  dashboard        Run the AOS dashboard (--port N, --no-open)
  package          Install, update, repair or verify one v5 package by id
  doctor|checkup   Check the installation
  setup            Run setup wizard (interactive configuration)
  context [role]   Show or set context profile (full|orchestrator|worker|small)

Options:
  --codex-gate     Print the go-gate [[hooks.PreToolUse]] stanza for ~/.codex/config.toml
                   and the Codex hook-trust note, then exit (writes nothing)
  -y, --yes        Non-interactive install (implied without a TTY)
  --modules=LIST   With -y: also install these optional modules (comma list of synapse,
                   memb, remote, ao, creator, hardware, installer, or all), or set
                   AOS_MODULES. -y alone installs none. Ignored in interactive runs.
  --coding, --no-coding
                   Answer "Do you use AOS for coding?" up front. --coding enables the Codebase
                   Memory MCP and installs the pinned npm package codebase-memory-mcp@0.11.0
                   (npm install -g) if the binary is missing; --no-coding turns it off (nothing
                   is uninstalled). The answer is saved in ~/.aos/v5-settings.json, so install
                   and \`aos update\` ask only once, and only interactively. With -y or without
                   a TTY nothing is asked and coding mode stays off unless --coding is given.
                   Re-run with a flag to change it.
  --dry-run        Show what would change
  --opencode-optional=LIST
                   Opt in to OpenCode extras (comma list: ponytail, loop, rtk), or set
                   AOS_OPENCODE_OPTIONAL. Pinned plugin[] entries are appended after a
                   config backup; rtk only prints a brew hint. Off by default. AOS never
                   runs foreign installers and never touches OpenCode's mcp set.
  --no-codenotch   macOS and Windows only (never Linux): BDB AO Codenotch (desktop app,
                   from hybridlabor-api/bdb-ao-codenotch) installs by default;
                   skip it with this flag or AOS_CODENOTCH=0. --codenotch or
                   AOS_CODENOTCH=1 forces it. Interactive prompt defaults to yes. Failures
                   only warn and never fail the install. SHA-256 verified; Windows runs
                   the per-user installer silently (/S, no admin). Never overwrites an app
                   AOS did not install. See docs/codenotch.md.
  --opencode-permission=external_directory
                   Opt in to OpenCode's permission.external_directory for ~/.agents and
                   ~/.config/opencode only (path patterns, allow), or set
                   AOS_OPENCODE_PERMISSION. Existing keys are never overwritten; a string
                   "permission" is refused. Config backed up first. Off by default.
  --plugin-migration=off|check
                   Skip (off) or only report (check) the bdb-aos plugin registration and
                   removal of AOS's own loose skill copies; same as AOS_PLUGIN_MIGRATION.
                   --dry-run implies check. Default: on.
  --profile=minimal|standard|full
                   (also --profile minimal) Or AOS_PROFILE. standard (default) = today's
                   install. minimal = skills, agents and harness rules only: no
                   context-injection hooks, no OpenWiki, Token Saver, Codenotch, optional
                   modules, gateway, hub service or Claude Code mods. full = standard plus
                   all optional modules with -y. A --profile flag is saved, so \`aos update\`
                   keeps it; AOS_PROFILE is not saved. Uninstall resets the saved profile.
  --no-hooks       Skip only the context-injection hooks (memb-inject, rules-inject, trail
                   relay/autostart) in the Claude, Antigravity and Codex configs. The go-gate,
                   graph-gate and safety hooks are ALWAYS installed; no profile or flag
                   removes them. Takes no value. It also rewrites hook entries of yours whose
                   command only names a bdb script. The OpenCode plugin bdb-aos.js reads the
                   profile flag and skips memB, rules and trail autostart the same way.
  --hooks-only     Install or refresh only the hooks and their settings entries, then exit.
                   Combine with --no-hooks only: not with --profile or --without, and not with
                   status, update or repair.
  --without=ID,ID  (also --without ID,ID) Exclude packages by id (memb, synapse, openwiki,
                   remote, ao, creator, hardware, installer, deja, token-saver, codenotch,
                   gateway, hub, fleet, sessions, alert); saved to the v5 disabled list. An
                   unknown id is an error; kernel cannot be excluded. A fresh install installs
                   the MCP gateway and the hub service, and enables the Claude Code mods
                   (fleet, sessions, alert) when Claude Code is found (offered interactively,
                   enabled with -y); deja comes with memb, so for it the list only affects
                   update and repair.
  AOS_DISABLED_MCPS=a,b
                   Shipped MCP server names that are not written to the harness MCP configs
                   the installer writes (not the memB sync, OpenWiki or the gateway); not
                   saved; unknown names are ignored with one warning.
  --verbose, -v    Verbose output
  -V, --version    Print the version and exit
  -h, --help       Print this help and exit`);
        return;
    }
    if (process.argv[2] === 'team') {
        const teamScript = path.join(srcDir, 'bin', 'aos-team.mjs');
        const result = spawnSync(process.execPath, [teamScript, ...process.argv.slice(3)], { stdio: 'inherit', shell: false, windowsHide: true });
        process.exitCode = result.status == null ? 1 : result.status;
        return;
    }
    if (process.argv[2] === 'store') {
        const storeScript = path.join(srcDir, 'bin', 'aos-store.mjs');
        const result = spawnSync(process.execPath, [storeScript, ...process.argv.slice(3)], { stdio: 'inherit', windowsHide: true });
        process.exitCode = result.status == null ? 1 : result.status;
        return;
    }
    if (process.argv[2] === 'doctor' || process.argv[2] === 'checkup' || process.argv.includes('--doctor')) {
        const doctorScript = path.join(srcDir, 'bin', 'aos-doctor.mjs');
        const doctorArgs = process.argv.slice(process.argv[2] === 'doctor' || process.argv[2] === 'checkup' ? 3 : 2).filter(a => a !== '--doctor');
        const result = spawnSync(process.execPath, [doctorScript, ...doctorArgs], { stdio: 'inherit', windowsHide: true });
        process.exitCode = result.status == null ? 1 : result.status;
        return;
    }
    if (process.argv[2] === 'hub') {
        // bin/aos-hub.mjs is ESM: run it with the current node binary and an
        // args array, shell:false, so no value from argv can become a command.
        const hubScript = path.join(srcDir, 'bin', 'aos-hub.mjs');
        const hubArgs = process.argv.slice(3);
        const result = spawnSync(process.execPath, [hubScript, ...hubArgs], { stdio: 'inherit', shell: false, windowsHide: true });
        process.exitCode = result.status == null ? 1 : result.status;
        return;
    }
    if (process.argv[2] === 'services') {
        const { cli } = await import('./lib/hub/services.mjs');
        const code = await cli(process.argv.slice(3), {});
        process.exitCode = code ?? 0;
        return;
    }
    if (process.argv[2] === 'restart') {
        const rest = process.argv.slice(3);
        const ci = rest.findIndex((a) => a === '--confirm' || a === '-c');
        const id = rest.filter((a, i) => !a.startsWith('-') && (ci === -1 || i !== ci + 1))[0];
        // TTY without --confirm: ask the user to type the id (the services CLI's own guard).
        if (ci === -1 && process.stdin.isTTY && id) {
            const answer = (await password({ message: `Type "${id}" to confirm the restart (Ctrl+C to abort):` })) || '';
            if (answer !== id) { console.error(`aos restart: confirm did not match "${id}". Nothing was restarted.`); process.exitCode = 2; return; }
            rest.push('--confirm', id);
        }
        const { cli } = await import('./lib/hub/services.mjs');
        const code = await cli(['restart', ...rest], {});
        process.exitCode = code ?? 0;
        return;
    }
    if (process.argv[2] === 'dashboard') {
        // Same spawn discipline as `hub`: ESM bin, current node, args array, shell:false.
        const dashScript = path.join(srcDir, 'bin', 'aos-dashboard.mjs');
        const result = spawnSync(process.execPath, [dashScript, ...process.argv.slice(3)], { stdio: 'inherit', shell: false, windowsHide: true });
        process.exitCode = result.status == null ? 1 : result.status;
        return;
    }
    if (process.argv[2] === 'package') {
        // WP4 store handler: `aos package <install|update|repair|verify> <id>`
        // and `aos package mcp <name> --target <harness>`. Never prompts.
        process.exitCode = await require('./lib/v5/menu').packageCommand(module.exports, v5Options(Boolean(process.stdout.isTTY && process.stdin.isTTY)), process.argv.slice(3));
        return;
    }
    // Before the intro, the telemetry card and the update check: refreshing hooks needs none of them.
    if (INSTALL_OPTS.hooksOnly && !PROJECT_HARNESS_ARG) {
        if (DRY_RUN) log.warn('DRY-RUN MODE active - nothing AOS owns is written.');
        initFullSession(detectInstallState());
        persistInstallOptions();
        // --platforms is parsed above but only marked explicit further down the full flow; hooks-only exits before that.
        markPlatformsExplicit(PLATFORMS_ARG || []);
        await gateReenableStep(gateReenableAsk());
        installGlobalHooks({ harnesses: activeHarnessKeys() });
        flushSessionManifest();
        console.log(`Hooks refreshed${contextHooksOn ? '' : ' (context-injection hooks skipped, gate hooks installed)'}${DRY_RUN ? ' · DRY-RUN (nothing was modified)' : ''}`);
        return;
    }
    if (!DRY_RUN && !checkSystemPrereqs({ exitOnError: false }).ok) {
        process.exitCode = 1;
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
    initFullSession(installState);

    if (PROJECT_HARNESS_ARG) {
        installProjectHarness();
        outro('Project harness installation complete.');
        return;
    }

    if (installState.isInstalled && !isAutoYes && args[0] !== 'setup') {
        persistInstallOptions();
        process.exitCode = await require('./lib/v5/menu').menu(module.exports, v5Options(true, true));
        return;
    }

    // A -y reinstall re-merges every hook: never silently re-enable a gate the user removed by hand.
    await gateReenableStep(gateReenableAsk());

    const detectedNames = detections.map(d => d.name).join(', ');
    const platformOptions = [
        { value: '0', label: '🌐 Universal Agent Harness', hint: detections.length > 0 ? `sync ALL detected: ${detectedNames}` : 'sync across ALL AI platforms' },
        { value: '1', label: 'Google Antigravity', hint: '~/.gemini/config/skills' },
        { value: '2', label: 'Claude Desktop / Claude Code', hint: '~/.claude/skills' },
        { value: '3', label: 'Cursor / Generic IDE (project-local)', hint: '.cursor/' },
        { value: '5', label: 'ChatGPT Codex CLI', hint: '~/.agents/skills' },
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
    let contextProfileChoice = null;
    let routerChoice = null;
    let wantsUniversal = true;
    markPlatformsExplicit(PLATFORMS_ARG || []);
    let specificPlatforms = [defaultPlatformValue()];
    if (detections.length === 0 && !PLATFORMS_ARG) {
        log.warn('No supported harness was detected; installing for Claude Code only. Add one with --platforms=<n[,n]> (e.g. 1 Antigravity, 5 Codex, 7 Roo/Cline).');
    }

    if (PLATFORMS_ARG) {
        // Explicit targets win over both the menu and the auto-yes default.
        // '0' means universal; anything else means exactly those targets, so
        // the universal MCP fan-out must NOT also run -- otherwise asking for
        // Claude only would still push servers into every detected harness.
        wantsUniversal = PLATFORMS_ARG.includes('0');
        specificPlatforms = wantsUniversal
            ? [defaultPlatformValue()]
            : PLATFORMS_ARG;
    }

    if (isAutoYes) {
        creds = { gemini: "", github: "", openwikiProvider: "google", openwikiModel: "", openwikiBaseUrl: "", keyEnvName: 'GEMINI_API_KEY' };
        selectedMcps = await promptMcpSelection(tier);
    } else {
        const ctx = { tier: '1', selectedPlatforms: ['0'], mode: 'merge', customPaths: null, creds: null, selectedMcps: null, contextProfile: null, router: null };
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

        // Unified memory: one choice for memB + deja + OpenWiki (+ Codebase Memory when coding). Asked before the
        // MCP step because memb-mcp is only offered with it. Not asked when memb is already excluded.
        const stepMemory = async () => {
            if (ctx.selectedPlatforms.includes('9') || installExcluded.has('memb')) return;
            const v = await selectWithBack({
                message: 'Unified memory (memB + deja + OpenWiki, plus Codebase Memory MCP when you code):',
                options: [
                    { value: 'on', label: 'Install unified memory', hint: 'Default' },
                    { value: 'off', label: 'Skip: no memory engine, no memb_mcp/deja MCP, no memB hook' }
                ],
                initialValue: memoryOn ? 'on' : 'off'
            });
            if (v === BACK) return 'back';
            memoryOn = v === 'on';
        };

        const stepContextProfile = async () => {
            if (ctx.selectedPlatforms.includes('9')) return;
            const { CONTEXT_PROFILES, CONTEXT_PROFILE_DEFS, contextProfileOf } = require('./lib/v5/context-profiles');
            const st = v5Profile.readSettings(homeDir, () => {});
            const cur = ctx.contextProfile || contextProfileOf(st);
            const ans = await selectWithBack({
                message: 'Context Profile (session token budget & gateway MCP tools):',
                options: CONTEXT_PROFILES.map((p) => ({
                    value: p,
                    label: `${CONTEXT_PROFILE_DEFS[p].label}`,
                    hint: CONTEXT_PROFILE_DEFS[p].description
                })),
                initialValue: cur
            });
            if (ans === BACK) return 'back';
            ctx.contextProfile = ans;
        };

        const stepRouter = async () => {
            if (ctx.selectedPlatforms.includes('9')) return;
            const mode = await selectWithBack({
                message: 'Team & Router (which harness leads, which workers you have):',
                options: [
                    { value: 'keep', label: 'Keep the shipped table (recommended)', hint: 'advisory routing, nothing written' },
                    { value: 'custom', label: 'Set up my team', hint: 'writes ~/.aos/router.json' }
                ],
                initialValue: 'keep'
            });
            if (mode === BACK) return 'back';
            if (mode === 'keep') { ctx.router = null; return; }
            const found = detectRouterTargets();
            const sel = await multiselectWithBack({
                message: 'Which targets/workers do you have? (detected CLIs are preselected)',
                options: found.map((t) => ({ value: t.key, label: ROUTER_TARGET_LABELS[t.key], hint: t.detected ? 'detected' : 'not detected' })),
                initialValues: found.filter((t) => t.detected).map((t) => t.key),
                allowEmpty: true
            });
            if (sel === BACK) return 'back';
            if (sel.length === 0) { ctx.router = null; return; }
            const main = sel.length === 1 ? sel[0] : await selectWithBack({
                message: 'Your main harness (leads architect, techlead, reviewer):',
                options: sel.map((k) => ({ value: k, label: ROUTER_TARGET_LABELS[k] })),
                initialValue: sel[0]
            });
            if (main === BACK) return 'back';
            ctx.router = { preset: 'custom', mainHarness: main, selectedTargets: sel };
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
            const ref = specNow[0] === '4' && ctx.customPaths ? ctx.customPaths.mcpDir : resolveTargetPaths(specNow[0] || defaultPlatformValue(), ctx.customPaths).targetMcpDir;
            const c = await promptCredentials(ref);
            if (c === BACK) return 'back';
            ctx.creds = c;
        };

        const stepReview = async () => {
            const specNow = ctx.selectedPlatforms.filter(p => p !== '0');
            if (specNow.length === 0 && ctx.selectedPlatforms.includes('0')) specNow.push(defaultPlatformValue());
            const lines = [
                `Tier:          ${ctx.tier === '1' ? 'Pro MEDIA' : 'Basic'}`,
                `Skill Packs:   ${Array.isArray(packSelection) ? `base + ${[...new Set([...packSelection, ...(ctx.tier === '1' ? ['live-show'] : [])])].join(', ')}` : 'all skills (no pack selection stored)'}`,
                `Targets:       ${specNow.map(p => platformNames[p] || p).join(', ')}${ctx.selectedPlatforms.includes('0') ? ' + Universal Sync' : ''}`,
                `Mode:          ${ctx.mode}`,
                `Memory:        ${memoryOn ? 'unified (memB, deja, OpenWiki)' : 'off'}`,
                `Context:       ${ctx.contextProfile || 'full'}`,
                `Router:        ${ctx.router ? `custom (lead: ${ctx.router.mainHarness})` : 'shipped table'}`,
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

        const steps = [stepTier, stepPlatforms, stepMode, stepCustomPaths, stepMemory, stepContextProfile, stepRouter, stepMcps, stepCredentials, stepReview];

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
        contextProfileChoice = ctx.contextProfile;
        routerChoice = ctx.router;
        wantsUniversal = ctx.selectedPlatforms.includes('0');
        specificPlatforms = ctx.selectedPlatforms.filter(p => p !== '0');
        if (specificPlatforms.length === 0 && wantsUniversal) specificPlatforms.push(defaultPlatformValue());
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
    // Pro MEDIA brings the live-show pack (additive; base pack is always in).
    if (tier === '1') addImpliedPack('live-show');
    persistInstallOptions();
    if (INSTALL_OPTS.router && !routerChoice) {
        const detected = detectRouterTargets().filter((t) => t.detected).map((t) => t.key);
        routerChoice = { preset: INSTALL_OPTS.router, mainHarness: 'claude', selectedTargets: [...new Set(['claude', ...detected])] };
    }
    if (routerChoice && !DRY_RUN) {
        const file = writeUserRouterConfig({ home: homeDir, ...routerChoice });
        if (file) log.info(`Router table written: ${file}`);
    }
    if (INSTALL_OPTS.context && !contextProfileChoice) contextProfileChoice = INSTALL_OPTS.context;
    if (contextProfileChoice) {
        const st = v5Profile.readSettings(homeDir, () => {});
        st.context = contextProfileChoice;
        v5Profile.writeSettings(homeDir, st);
    }
    if (!isAutoYes && !DRY_RUN && process.stdout.isTTY && process.stdin.isTTY) {
        const ok = await askConfirm({ message: 'Optional: allow read-only aos status/doctor commands without prompts (adds rules to ~/.claude/settings.json, backup first, undo with `aos allow aos-tools --remove`)?', initialValue: false });
        if (!isCancel(ok) && ok) require('./lib/permissions-allow').allowCommand(['aos-tools'], { home: homeDir, write: (t) => log.info(t.trim()) });
        else log.info('Other presets (remote CI hosts etc.): `aos allow` lists them; run them yourself with `! aos allow <preset>`.');
    }
    if (!memoryOn && !installExcluded.has('memb')) declineUnifiedMemory();

    // The backup directory is created on first use (moveIfExists, the MCP merge), never empty, 0700 because it can hold credential copies.

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
        dirPlatforms.push(defaultPlatformValue());
    }

    const targets = dirPlatforms.map(p => ({
        value: p,
        ...resolveTargetPaths(p, customPaths)
    }));

    const excludeSkills = getTierExcludeSkills(tier);
    const skillsBase = path.join(srcDir, 'skills');

    const s = spinner();
    s.start(`Installing optimized skills${tier === '2' ? ' [Basic Tier]' : ''} to ${targets.length} target(s)...`);

    populateSkillLibrary();

    installTargetSkills(targets, { mode, backupDir, excludeSkills, skillsBase });

    syncSkillsToGlobalHarnesses(excludeSkills);
    pruneRemovedSkills(_sessionManifest);
    applySkillSet(_sessionManifest);
    applyPackSelection(_sessionManifest);
    s.stop('Skills installed.');
    runAgyPluginStep();

    injectHarnessRules();

    // Codex plugin via the real `codex plugin` CLI (best effort, see lib/codex-plugin-install.js)
    try { runCodexPluginStep(); } catch (e) { log.warn(`Codex plugin: ${e.message}`); }

    const primaryTarget = targets[0];
    for (const t of targets) {
        await installMcpsForTarget(t, { selectedMcps, mode, platformValue: t.value, creds });
    }
    migrateMcpSecrets();

    if (installExcluded.has('openwiki')) log.step('OpenWiki skipped (profile or --without).');
    else {
        await installOpenWikiDaemon(creds.gemini, primaryTarget.targetSkillDir, { provider: creds.openwikiProvider, model: creds.openwikiModel, baseUrl: creds.openwikiBaseUrl });
        await installOpenWikiVisualizer();
    }
    if (installExcluded.has('token-saver')) log.step('Token Saver skipped (profile or --without).');
    else await installTokenSaver(primaryTarget.platformValue);

    const installedModulesForPrompt = (installState && installState.installedModules) || [];
    // Unified memory is part of the default install, not an optional module: memB (with deja) goes in here.
    const memoryInstalled = memoryOn && !installedModulesForPrompt.includes('memb')
        ? (await runModuleInstalls([{ id: 'memb', name: 'memB Vector Engine (unified memory)', fn: () => installMemB(true) }], ['memb'], installedModulesForPrompt)).installed
        : [];
    await applyCodingModeStep(memoryCodingOptions());
    const modulePlan =v5Profile.PROFILES[activeProfile].modules;
    const explicitModules = parseModuleSelection();
    // Unlike runQuickUpdate, nothing here reinstalls modules already in installedModulesForPrompt
    // -- only promptOptionalModules's own return value (the ones it just chose-and-installed
    // this call) actually ran an install-and-verify pass this run. Anything already in the
    // array before this call was untouched here and must still get its normal reloadDaemons()
    // check, not be skipped.
    const justInstalled = (modulePlan === 'none' && !explicitModules.length)
        ? []
        : await promptOptionalModules(installedModulesForPrompt, explicitModules.length || modulePlan !== 'all' ? explicitModules : ['all']) || [];
    justInstalled.push(...memoryInstalled);

    await promptMemBIngestion(path.join(primaryTarget.targetMcpDir, 'mcps'));
    await promptMemoryImport();

    const alreadyHandled = justInstalled.map(id => MODULE_ID_TO_DAEMON_NAME[id]).filter(Boolean);
    await reloadDaemons(alreadyHandled);
    saveManifest({ tier, isUniversal: wantsUniversal, installedModules: installedModulesForPrompt });
    if (persistWizardPacks()) applyPackSelection(_sessionManifest);

    if (wantsUniversal) {
        await universalHarnessSync(primaryTarget.mcpConfigPath, installedModulesForPrompt);
    }

    // Flush file-level install manifest after all writes are done.
    flushSessionManifest();

    // After the skill sync, because AOS CLI is useless without ~/.agents.
    if (aosCliRequested) installAosCli();

    // After every harness MCP config write above: the gateway switches those entries, and a later write would undo it.
    saveGatewaySelectedServers(tier);
    for (const name of await require('./lib/v5/menu').installDefaults(module.exports, { ...v5Options(!isAutoYes), dryRun: DRY_RUN }, installExcluded)) {
        moduleFailures.push({ id: name, name, reason: 'see the step line above and ~/.aos/logs' });
    }

    console.log('');
    console.log(harnessSummaryLine());
    verifyEcosystemInstallation();
    if (!installExcluded.has('codenotch')) await maybeInstallCodenotch();

    if (moduleFailures.length) {
        outro(`⚠️ Installation incomplete: ${moduleFailures.length} module(s) not installed (see above).`);
    } else {
        outro(`🎉 Installation complete! Targets: ${targets.map(t => t.value).join(', ')}${aosCliRequested ? ' + AOS CLI' : ''} · Tier: ${tier === '1' ? 'Pro MEDIA' : 'Basic'}${DRY_RUN ? ' · DRY-RUN (nothing was modified)' : ''}`);
    }
    // Last line on purpose: an earlier CODEX_GATE_NOTICE scrolled by unread and the gate stayed off.
    if (codexHooksChanged) console.log(`⚠️  ${CODEX_TRUST_REMINDER}`);
    // After that notice: the very last line when the Claude plugin step failed (issue #54).
    printClaudePluginFix();
}

// Persist which shipped servers the 1mcp gateway runs: derived once from this install's tier
// (Pro MEDIA adds the media/show-control group) and installed modules (Creator Extension adds
// the creative group), unioned with what the user already runs today. An explicit choice saved
// by a prior run or `aos-gateway add/remove` is kept; DRY_RUN writes nothing.
function saveGatewaySelectedServers(tierValue = tier, installedList = null, home = homeDir) {
    if (DRY_RUN) return false;
    try {
        const gwConfig = require('./lib/gateway/config');
        const selection = require('./lib/gateway/selection');
        const dir = gwConfig.gatewayDir(home);
        const current = require('./lib/v5/pkg-gateway').currentShippedUpstreams(dir);
        const seen = require('./lib/gateway/doctor').directGatewayNames({ files: harnessMcpFiles(home, process.env, process.platform, home), shipped: mcpSecrets.shippedServers(srcDir) });
        const st = v5Profile.readSettings(home, () => {});
        const r = selection.resolveGatewayServers({
            settingServers: st.gateway && st.gateway.servers,
            media: tierValue === '1',
            creator: selection.detectCreatorServers({ platform: process.platform, env: process.env, home }),
            keep: [...current, ...seen],
        });
        if (r.kept.length) log.step(`Gateway: keeping the servers you already run (${r.kept.join(', ')})`);
        const next = { ...st, gateway: { ...(st.gateway || {}), servers: r.servers } };
        v5Profile.writeSettings(home, next);
        log.step(`Gateway servers: ${r.servers.join(', ')}`);
        return true;
    } catch (e) {
        log.warn(`Could not save the gateway server selection: ${e.message}`);
        return false;
    }
}

// Exported for tests -- requiring installer.js must not launch the TUI.
module.exports = {
    detectRouterTargets,
    buildRouterPreferences,
    writeUserRouterConfig,
    movePreserved,
    recoverStaleSwaps,
    MODULE_PRESERVE,
    withoutGatewayServers,
    mirrorMcpServersTo,
    codexPluginInstall,
    newestDistTag,
    verifyEcosystemInstallation,
    runModuleInstalls,
    copyDirRecursiveSync,
    retireObsoleteLegacyDir,
    installBinaryAtomically,
    installOSRemoteGateway,
    installOSAgentWorkspace,
    installCreatorExtension,
    installHardwarePcb,
    installRustauri,
    TAURI_PILOT_VERSION,
    TAURI_PILOT_INSTALL_CMD,
    rustauriSourceDir: () => path.join(srcDir, 'vendor', 'rustauri'),
    installStyleseed,
    styleseedSourceDir: () => path.join(srcDir, 'vendor', 'styleseed'),
    installCodebaseMemory,
    installDevToolInstaller,
    installDeja,
    installTokenSaver,
    readGoBuildInfo,
    parseGoBuildInfo,
    decideAoInstall,
    checkAoWorkspace,
    installAoBinary,
    readAoDaemonIdentity,
    selectAoCandidate,
    describeAoVersion,
    agentsNotShippedAsFiles,
    downloadOrUpdateModule,
    detectPlatforms,
    markPlatformsExplicit,
    runModuleInstalls,
    describeExecError,
    migrateMcpSecrets,
    installMcpLauncher,
    installMcpsForTarget,
    mergeBdbSettingsHooks,
    ensureClaudeDefaultMode,
    mergeAntigravityHooks,
    agyHookCommand,
    selfCheckAgyHooks,
    mergeCodexTomlHooks,
    mergeCodexHooks: mergeCodexTomlHooks,
    mergeCodexTomlMcpServers,
    installGlobalHooks,
    injectHarnessRules,
    activeHarnessKeys,
    gateMissingInHarnesses,
    gateReenableStep,
    gateHoldKeys,
    defaultPlatformValue,
    harnessSummaryLine,
    applyInstallOptions,
    getTierExcludeSkills,
    currentPackSelection: () => packSelection,
    effectivePackSelection,
    addImpliedPack,
    populateSkillLibrary,
    applyPackSelection,
    installHarnessHookCopies,
    copyHookScripts,
    installA2aLibCopies,
    installClaudeA2aSessionHook,
    installGoCheck,
    installGlobalBinaries,
    aosDistTag,
    localBinPathHint,
    codexGateSnippet,
    codexGateRules,
    installCodexRules,
    CODEX_GATE_NOTICE,
    CODEX_TRUST_REMINDER,
    installOpencodePlugin,
    stripJsonc,
    syncMcpConfigFile,
    syncOpencodeConfigFile,
    loadJsonConfig,
    installOpencodeCommands,
    parseOpencodeOptional,
    maybeInstallCodenotch,
    pluginMigrationMode,
    prompts: { text, password, select, multiselect, confirm: askConfirm },
    runPluginMigration,
    printClaudePluginFix,
    runAgyPluginStep,
    runCodexPluginStep,
    retireCodexSkillCopies,
    syncSkillsToGlobalHarnesses,
    retireStaleCodexPluginDir,
    realClaudeHome,
    runAgyPlugin: (opts) => require('./lib/agy-plugin-install').run(opts),
    installProjectHarness,
    promptMcpSelection,
    mirrorMcpServersTo,
    setMcpPickDetect,
    ensureDejaExclude,
    // Manifest store (exported for verification tests)
    computeFileHash,
    reconcileMembVenv,
    pickPython,
    ensurePythonVenv,
    getInstallManifestPath,
    loadInstallManifest,
    saveInstallManifest,
    resolveFileConflict,
    buildKnownSourceHashes,
    loadShippedHashes,
    setShippedHashes,
    initSessionManifest,
    installTargetSkills,
    stableOpenWikiScripts,
    writeOpenWikiEnv,
    removeAosMcscFromAgyConfigs,
    isAosMcscEntry,
    isAgyMcpConfig,
    makeAosA2aMcpEntry,
    registerA2aMcpCursor,
    registerA2aMcpAgy,
    removeAosA2aEntries,
    isAosA2aEntry,
    resolveAosA2aMcpName,
    backupConfigPath,
    writeConfigWithBackup,

    findUv,
    stripHwMcpEntries,
    hardwareApps,
    parseModuleSelection,
    promptOptionalModules,
    findSynapseBinary,
    describeMissingSynapseBinary,
    isValidOpenWikiModelId,
    loadExistingEnv,
    // installer v5 host surface (lib/v5/*)
    runQuickUpdate, applyCodingModeStep, quickUpdateKernel, quickUpdateHarnesses, refreshOpenWikiSilently, detectInstallState, installMemB, installSynapse,
    saveManifest, DEJA_VERSION, moduleBasePath, resolveTargetPaths, uvBin, isNewerVersion, checkModuleUpdate, runUninstaller, PROVIDER_KEY_ENV_NAMES,
    AGENTS_COPY_EXCLUDE,
    flushSessionManifest,
    copyDirRecursiveSync,
    INSTALL_MANIFEST_PATH,
    // Agent compilers & pipeline helpers
    parseAgentsMd,
    loadPackAgents,
    loadCommonSkills,
    compileClaudeAgents,
    compileOpenCodeAgents,
    compileCodexAgents,
    compileAgyAgents,
    applyClaudeModelOverrides,
    pluginCoveredAgentFiles,
    loadPipelineConfig,
    resolveAgentConfig,
    installPipelineDefault,
    // Launchpad lifecycle (exported for regression tests)
    generateAndOpenLaunchpad,
    shouldOpenLaunchpad,
    shouldAutostartLaunchpad,
    shouldAutostartPlanCanvas,
    buildPlanCanvasPlist,
    buildPlanCanvasWinFiles,
    installPlanCanvasAutostart,
    isDevEnvironment,
    LAUNCHPAD_WEB_MODULES,
    LAUNCHPAD_OPEN_FLAGS,
    checkSystemPrereqs,
    findBundledClaudeCli,
    hasExecutable,
    findExecutable,
    shippedMcpTemplatePath: mcpSecrets.shippedMcpTemplatePath,
    saveGatewaySelectedServers,
    migrateLegacyAgyWorkspaceMcp: mcpSecrets.migrateLegacyAgyWorkspaceMcp,
};

// After module.exports: the v5 menu receives it as its host and main() runs before the first await.
if (require.main === module) {
    main().catch(e => reportFatal('the beta installer run', e));
}
