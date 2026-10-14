'use strict';
// Package registry. Contract: { id, name, npm, detect(ctx) -> {installed, version}, install(ctx), update(ctx),
// verify(ctx) -> {ok, detail}, repair?(ctx) }. ctx = { host, home, run, state }; host is installer.js's exports
// (injected so tests and lib/ never require installer.js themselves).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const cliSpawn = require('../cli-spawn');
const uninstallRecords = require('../uninstall-records.js');

const WIN = process.platform === 'win32';
const readVersion = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || null; } catch { return null; } };
const exits0 = (cmd, args, cwd) => { const r = spawnSync(cmd, args, { cwd, stdio: 'ignore', timeout: 30000 }); return !r.error && r.status === 0; };
const { takeLockedReason } = require('../rename-retry.js');
const must = (ok, what) => { if (ok === false) throw new Error(takeLockedReason() || `${what} reported a failure`); };
// quickUpdate* return the list of failed sub-steps; empty or non-array means ok.
const mustList = (r, what) => { if (Array.isArray(r) && r.length) throw new Error(`${what}: ${r.join('; ')}`); };

const registry = [];
const register = (entry) => { const i = registry.findIndex((e) => e.id === entry.id); if (i >= 0) registry[i] = entry; else registry.push(entry); return entry; };

// ---- kernel: skills, plugin migration (rules/hooks are the Harnesses step) ----------------------
const kernelUpdate = (c) => mustList(c.host.quickUpdateKernel(c.state), 'Kernel');
register({
    id: 'kernel', name: 'AOS kernel', npm: '@hybridlabor-api/aos',
    detect: (c) => { const s = c.host.detectInstallState(); return { installed: s.isInstalled, version: s.localVersion }; },
    install: kernelUpdate,
    update: kernelUpdate,
    repair: kernelUpdate,
    verify: (c) => {
        // The primary target is whatever the install wrote for the detected harnesses (Claude Code only on a
        // Claude-only machine), not always Antigravity; ~/.agents/skills is written for every install.
        const value = typeof c.host.defaultPlatformValue === 'function' ? c.host.defaultPlatformValue() : '1';
        const dir = c.host.resolveTargetPaths(value, null).targetSkillDir;
        const shared = path.join(c.home, '.agents', 'skills');
        let n = 0;
        for (const d of [dir, shared]) { try { n = Math.max(n, fs.readdirSync(d).length); } catch { /* missing */ } }
        return n ? { ok: true, detail: `${n} skills` } : { ok: false, detail: `no skills in ${dir}` };
    },
});

// ---- memB ---------------------------------------------------------------------------------------
const membDir = (c) => path.join(c.host.moduleBasePath(), 'memB');
const venvPython = (dir) => (WIN ? path.join(dir, '.venv', 'Scripts', 'python.exe') : path.join(dir, '.venv', 'bin', 'python'));
const mcpCopyDir = (c) => path.join(c.host.resolveTargetPaths('1', null).targetMcpDir, 'mcps', 'memb-mcp');

// fs.existsSync is false for a dangling link, which is exactly the broken state this has to catch.
const venvBroken = (dir) => { const py = venvPython(dir); return !fs.existsSync(py) || !exits0(py, ['-c', 'import sys'], dir); };

function copyProblem(c) {
    const copy = mcpCopyDir(c);
    if (!fs.existsSync(copy)) return null;
    const want = readVersion(membDir(c));
    const have = readVersion(copy);
    return want && have !== want ? `memb-mcp copy ${have || 'unversioned'} != memB ${want}` : null;
}

function syncMcpCopy(c) {
    if (!fs.existsSync(mcpCopyDir(c))) return;
    must(c.host.downloadOrUpdateModule('@hybridlabor-api/memb', mcpCopyDir(c), 'memB MCP'), 'memb-mcp copy sync');
}

// A runnable venv whose imports fail: { detail, dir } of the venv whose requirements need reinstalling.
function depProblem(c) {
    const dir = membDir(c);
    let reqs = '';
    try { reqs = fs.readFileSync(path.join(dir, 'requirements.txt'), 'utf8'); } catch { /* none */ }
    if (/(^|\n)\s*mcp\s*([<>=!~;[]|$)/.test(reqs) && !exits0(venvPython(dir), ['-c', 'import mcp'], dir)) return { detail: 'import mcp fails', dir };
    const copy = mcpCopyDir(c);
    const py = venvPython(copy);
    if (fs.existsSync(copy) && fs.existsSync(py) && !exits0(py, ['-c', 'import run'], copy)) return { detail: 'memb-mcp import run fails', dir: copy };
    // run.py does `from memb import Memory`; `import run` alone does not prove the server can start.
    if (fs.existsSync(copy) && fs.existsSync(py) && !exits0(py, ['-c', 'from memb import Memory'], copy)) return { detail: 'memb-mcp: `from memb import Memory` fails (entry run.py)', dir: copy };
    return null;
}

// The WebUI LaunchAgent runs server.py with the memB venv; fastapi/uvicorn are installed by installMemB, not
// requirements.txt, so a replaced memB tree (new .venv) loses them and the agent exits 256 forever.
function webuiProblem(c) {
    const dir = membDir(c);
    if (!fs.existsSync(path.join(dir, 'src', 'backend', 'server.py'))) return null;
    return exits0(venvPython(dir), ['-c', 'from fastapi import FastAPI; import uvicorn'], dir) ? null : 'memB WebUI: fastapi/uvicorn missing in the memB venv';
}

// Config files the installers write MCP entries into (relative to home).
const MCP_CONFIG_FILES = [
    ['.claude.json'], ['.gemini', 'config', 'mcp_config.json'], ['.gemini', 'antigravity-cli', 'mcp_config.json'],
    ['.codex', 'config.toml'], ['.config', 'opencode', 'opencode.jsonc'], ['.config', 'opencode', 'opencode.json'],
];
const MEMB_PY_RE = /(?<![\w~.$}])(?:[A-Za-z]:)?[\\/][^\s"'`,\]]*?[\\/]memb-mcp[\\/]\.venv[\\/](?:bin[\\/]python|Scripts[\\/]python\.exe)/g;

// Read-only: only the matched venv paths are ever surfaced, never file contents.
function harnessProblem(c) {
    const files = MCP_CONFIG_FILES.map((p) => path.join(c.home, ...p));
    try { files.push(path.join(c.host.resolveTargetPaths('1', null).targetMcpDir, 'mcp_config.json')); } catch { /* host without target paths */ }
    for (const file of new Set(files)) {
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        for (const m of text.match(MEMB_PY_RE) || []) {
            const py = m.replace(/\\\\/g, '\\');
            if (!fs.existsSync(py)) return `memb_mcp config points at a missing venv python: ${file} -> ${py}`;
        }
    }
    return null;
}

const venvTools = {
    create(c, dir) {
        if (c.host.ensurePythonVenv) { c.host.ensurePythonVenv(dir); return; }
        const uv = c.host.uvBin();
        // --clear: a venv whose interpreter is gone (python upgraded, or copied from a package) is "already there" to uv.
        try { c.run(uv, ['venv', '--clear', '--seed', '.venv'], { cwd: dir }); } catch { c.run(WIN ? 'python' : 'python3', ['-m', 'venv', '--clear', '.venv'], { cwd: dir }); }
    },
    install(c, dir) {
        const py = venvPython(dir);
        if (!fs.existsSync(path.join(dir, 'requirements.txt'))) return;
        const uv = c.host.uvBin();
        if (c.run(uv, ['--version'], { soft: true }).status === 0) c.run(uv, ['pip', 'install', '--python', py, '-r', 'requirements.txt'], { cwd: dir });
        else c.run(py, ['-m', 'pip', 'install', '-r', 'requirements.txt', '--timeout', '30', '--no-input'], { cwd: dir });
    },
};

register({
    id: 'memb', name: 'memB', npm: '@hybridlabor-api/memb',
    detect: (c) => ({ installed: Boolean(readVersion(membDir(c))), version: readVersion(membDir(c)) }),
    install: async (c) => { must(await c.host.installMemB(false), 'memB install'); syncMcpCopy(c); },
    update: async (c) => { must(await c.host.installMemB(false), 'memB update'); syncMcpCopy(c); },
    verify(c) {
        const dir = membDir(c);
        if (venvBroken(dir)) return { ok: false, detail: 'venv python missing or not runnable' };
        const dep = depProblem(c);
        if (dep) return { ok: false, detail: dep.detail };
        const hp = harnessProblem(c);
        if (hp) return { ok: false, detail: hp };
        const wp = webuiProblem(c);
        if (wp) return { ok: false, detail: wp };
        if (process.platform === 'darwin' || c.launchctl) {
            const launchctlCheck = c.launchctl || (() => spawnSync('launchctl', ['list', 'com.bdb.memb.webui'], { encoding: 'utf8', stdio: 'pipe', timeout: 10000 }));
            const r = launchctlCheck();
            // launchctl list <label> prints plist-style text ("LastExitStatus" = 256;), not JSON.
            const m = r && r.status === 0 && /"LastExitStatus"\s*=\s*(-?\d+);/.exec(String(r.stdout || ''));
            if (m && Number(m[1]) !== 0) return { ok: false, detail: `memb WebUI LaunchAgent last exit status: ${m[1]}` };
        }
        const p = copyProblem(c);
        return p ? { ok: false, detail: p } : { ok: true, detail: readVersion(dir) || '' };
    },
    // Rename, never delete: the old venv stays as .venv.broken-<ts> for the user to remove.
    async repair(c) {
        const dir = membDir(c);
        const tools = c.venv || venvTools;
        const rebuild = async (d) => {
            const venv = path.join(d, '.venv');
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            try { fs.lstatSync(venv); fs.renameSync(venv, `${venv}.broken-${stamp}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
            await tools.create(c, d);
            await tools.install(c, d);
        };
        if (venvBroken(dir)) {
            await rebuild(dir);
        } else {
            const dep = depProblem(c);
            if (dep) {
                await tools.install(c, dep.dir);
                const again = dep.dir !== dir && depProblem(c);
                if (again && again.dir === dep.dir) {
                    await rebuild(dep.dir);
                    const last = depProblem(c);
                    if (last && last.dir === dep.dir) throw new Error(`memB repair: ${last.detail}`);
                }
            }
        }
        if (copyProblem(c)) syncMcpCopy(c);
        // installMemB reinstalls fastapi+uvicorn into the venv and reloads the WebUI LaunchAgent.
        if (webuiProblem(c)) must(await c.host.installMemB(false), 'memB WebUI dependency repair');
    },
});

// ---- Synapse ------------------------------------------------------------------------------------
const synapseDir = (c) => path.join(c.host.moduleBasePath(), 'bdb-synapse');
const synapseUpdate = async (c) => must(await c.host.installSynapse(), 'Synapse install');
register({
    id: 'synapse', name: 'Synapse', npm: '@hybridlabor-api/bdb-synapse',
    detect: (c) => ({ installed: Boolean(readVersion(synapseDir(c))), version: readVersion(synapseDir(c)) }),
    install: synapseUpdate,
    update: synapseUpdate,
    verify(c) {
        const bin = c.host.findSynapseBinary(synapseDir(c));
        if (!bin) return { ok: false, detail: 'no synapse binary' };
        // The synapse binary has no --version ("unknown command"); --help exits 0 and proves it starts.
        return exits0(bin, ['--help']) ? { ok: true, detail: readVersion(synapseDir(c)) || '' } : { ok: false, detail: 'synapse --help fails' };
    },
});

// ---- OpenWiki -----------------------------------------------------------------------------------
// openwiki has no --version ("Unknown option"); --help exits 0 and its banner reads "OpenWiki v0.5.0".
// cliSpawn resolves npm's .cmd shim on Windows; a bare spawnSync('openwiki') there fails with ENOENT.
const owVersion = () => { const r = cliSpawn.run('openwiki', ['--help'], { timeout: 15000 }); return !r.error && r.status === 0 ? (String(r.stdout).match(/OpenWiki v(\d+\.\d+\.\d+\S*)/) || [, 'ok'])[1] : null; };
// The CLI itself is upgraded first: refreshing only the daemon left it outdated, so every update redid the work.
// No prompt: a missing key is a Settings action, so the daemon refresh simply reports "skipped".
const owUpdate = async (c) => {
    const want = /^\d+\.\d+\.\d+[\w.-]*$/.test(c.target || '') ? c.target : 'latest';
    c.run('npm', ['install', '-g', `openwiki@${want}`], { shell: WIN });
    return (await c.host.refreshOpenWikiSilently()) ? '' : 'no key stored, daemon not refreshed';
};
register({
    id: 'openwiki', name: 'OpenWiki', npm: 'openwiki',
    detect: (c) => { const v = owVersion(); return { installed: v !== null || fs.existsSync(path.join(c.home, '.openwiki', '.env')), version: v || null }; },
    install: async (c) => { if (!(await c.host.refreshOpenWikiSilently({ key: c.openwikiKey }))) throw new Error('skipped: no key'); },
    update: owUpdate,
    verify: () => (owVersion() !== null ? { ok: true, detail: owVersion() } : { ok: false, detail: 'openwiki CLI does not respond' }),
});

// ---- Remote Gateway -----------------------------------------------------------------------
register({
    id: 'remote', name: 'BDB OS Remote', npm: '@hybridlabor-api/bdb-os-remote',
    detect: (c) => { const d = path.join(c.host.moduleBasePath(), 'bdb-os-remote'); return { installed: fs.existsSync(d), version: readVersion(d) }; },
    install: async (c) => must(await c.host.installOSRemoteGateway(), 'Remote install'),
    update: async (c) => must(await c.host.installOSRemoteGateway(), 'Remote update'),
    verify: (c) => {
        // The module ships bin/cli.js (npm bins bdb-remote/bdb-os-remote); nothing installs a `remote` binary.
        const d = path.join(c.host.moduleBasePath(), 'bdb-os-remote');
        return exits0(process.execPath, [path.join(d, 'bin', 'cli.js'), '--version']) ? { ok: true, detail: readVersion(d) || '' } : { ok: false, detail: 'bdb-os-remote bin/cli.js --version fails' };
    },
});

// ---- Agent Orchestrator -------------------------------------------------------------------
const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
const aoBin = () => (WIN ? path.join(process.env.LOCALAPPDATA || homeDir, 'Programs', 'ao', 'ao.exe') : path.join(homeDir, '.local', 'bin', 'ao'));
register({
    id: 'ao', name: 'Agent Orchestrator', npm: '@hybridlabor-api/bdb-agent-orchestrator',
    detect: (c) => { const d = path.join(c.host.moduleBasePath(), 'bdb-agent-orchestrator'); return { installed: fs.existsSync(d), version: readVersion(d) }; },
    install: async (c) => must(await c.host.installOSAgentWorkspace(), 'AO install'),
    update: async (c) => must(await c.host.installOSAgentWorkspace(), 'AO update'),
    verify: (c) => exits0(aoBin(), ['--version']) ? { ok: true, detail: readVersion(path.join(c.host.moduleBasePath(), 'bdb-agent-orchestrator')) || '' } : { ok: false, detail: 'ao --version fails' },
});

// ---- Creator Extension -------------------------------------------------------------------
const creatorPkg = register({
    id: 'creator', name: 'Creator Extension', npm: '@hybridlabor-api/bdb-dev-creator-extension',
    detect: (c) => { const d = path.join(c.host.moduleBasePath(), 'bdb-dev-creator-extension'); return { installed: fs.existsSync(d), version: readVersion(d) }; },
    install: async (c) => must(await c.host.installCreatorExtension(), 'Creator Extension install'),
    // c.target = npm version the outdated check compared against; same comparison, so an equal version skips the reinstall.
    update: async (c) => {
        if (c.target) {
            const have = readVersion(path.join(c.host.moduleBasePath(), 'bdb-dev-creator-extension'));
            if (have && !c.host.isNewerVersion(have, c.target) && creatorPkg.verify(c).ok) return;
        }
        must(await c.host.installCreatorExtension(), 'Creator Extension update');
    },
    verify: (c) => {
        const dir = path.join(c.host.moduleBasePath(), 'bdb-dev-creator-extension');
        const installerScript = path.join(dir, 'installer.js');
        return fs.existsSync(installerScript) ? { ok: true, detail: readVersion(dir) || '' } : { ok: false, detail: 'installer.js not found' };
    },
});

// ---- Hardware & PCB -----------------------------------------------------------------------
register({
    id: 'hardware', name: 'Hardware & PCB', npm: '@hybridlabor-api/bdb-hardware-pcb',
    detect: (c) => { const d = path.join(c.host.moduleBasePath(), 'bdb-hardware-pcb'); return { installed: fs.existsSync(d), version: readVersion(d) }; },
    install: async (c) => must(await c.host.installHardwarePcb(), 'Hardware & PCB install'),
    update: async (c) => must(await c.host.installHardwarePcb(), 'Hardware & PCB update'),
    verify: (c) => {
        const dir = path.join(c.host.moduleBasePath(), 'bdb-hardware-pcb');
        const installerScript = path.join(dir, 'installer.js');
        return fs.existsSync(installerScript) ? { ok: true, detail: readVersion(dir) || '' } : { ok: false, detail: 'installer.js not found' };
    },
});

// ---- Rust + Tauri (optional; skills ship inside the kernel under vendor/rustauri, no download) --
const rustauriSkills = ['tauri-pilot', 'rust-pro'];
const agentsSkillFile = (c, s) => path.join(c.home, '.agents', 'skills', s, 'SKILL.md');
const nonEmptyFile = (f) => { try { return fs.statSync(f).size > 0; } catch { return false; } };
const tauriPilotOnPath = (home) => [...String(process.env.PATH || '').split(path.delimiter), path.join(home, '.cargo', 'bin')]
    .some((d) => d && (WIN ? ['.exe', ''] : ['']).some((ext) => fs.existsSync(path.join(d, `tauri-pilot${ext}`))));
register({
    id: 'rustauri', name: 'Rust + Tauri', npm: null,
    detect: (c) => {
        const installed = rustauriSkills.every((s) => fs.existsSync(agentsSkillFile(c, s)));
        return { installed, version: installed ? readVersion(c.host.rustauriSourceDir()) : null };
    },
    install: async (c) => must(await c.host.installRustauri(), 'Rust + Tauri install'),
    update: async (c) => must(await c.host.installRustauri(), 'Rust + Tauri update'),
    uninstall: (c) => uninstallRecords.reverseRustauri({
        home: c.home,
        dryRun: c.dryRun,
        runCargo: (crate) => spawnSync('cargo', ['uninstall', crate], { stdio: 'ignore', timeout: 10 * 60 * 1000 }).status === 0,
    }),
    // The skills are the package; the tauri-pilot CLI (also the MCP server) needs cargo and only warns when missing.
    verify: (c) => {
        const missing = rustauriSkills.find((s) => !nonEmptyFile(agentsSkillFile(c, s)));
        if (missing) return { ok: false, detail: `${missing} missing` };
        const version = readVersion(c.host.rustauriSourceDir()) || '';
        if (tauriPilotOnPath(c.home)) return { ok: true, detail: version };
        return { ok: true, detail: `${version} (warning: tauri-pilot CLI not found on PATH or in ~/.cargo/bin, so the tauri-pilot MCP server cannot start; install it with: ${c.host.TAURI_PILOT_INSTALL_CMD})`.trim() };
    },
});

// ---- StyleSeed (optional; Toss design-language skills ship inside the kernel under vendor/styleseed) --
const styleseedSkills = ['ui-component', 'ui-page', 'ui-pattern', 'ui-review', 'ui-tokens', 'ux-audit', 'ux-feedback', 'ux-flow'];
register({
    id: 'styleseed', name: 'StyleSeed', npm: null,
    detect: (c) => {
        const installed = styleseedSkills.every((s) => fs.existsSync(agentsSkillFile(c, s)));
        return { installed, version: installed ? readVersion(c.host.styleseedSourceDir()) : null };
    },
    install: async (c) => must(await c.host.installStyleseed(), 'StyleSeed install'),
    update: async (c) => must(await c.host.installStyleseed(), 'StyleSeed update'),
    verify: (c) => {
        const missing = styleseedSkills.find((s) => !nonEmptyFile(agentsSkillFile(c, s)));
        return missing ? { ok: false, detail: `${missing} missing` } : { ok: true, detail: readVersion(c.host.styleseedSourceDir()) || '' };
    },
});

// ---- Dev Tool Installer -------------------------------------------------------------------
register({
    id: 'installer', name: 'Dev Tool Installer', npm: '@hybridlabor-api/bdb-dev-tool-installer',
    detect: (c) => { const d = path.join(c.host.moduleBasePath(), 'bdb-dev-tool-installer'); return { installed: fs.existsSync(d), version: readVersion(d) }; },
    install: async (c) => must(await c.host.installDevToolInstaller(), 'Dev Tool Installer install'),
    update: async (c) => must(await c.host.installDevToolInstaller(), 'Dev Tool Installer update'),
    verify: (c) => {
        const dir = path.join(c.host.moduleBasePath(), 'bdb-dev-tool-installer');
        return fs.existsSync(dir) ? { ok: true, detail: readVersion(dir) || '' } : { ok: false, detail: 'not installed' };
    },
});

// ---- deja (Deja Vu) -----------------------------------------------------------------------
const dejaVersion = () => {
    const r = cliSpawn.run('deja', ['--version'], { timeout: 15000 });
    return !r.error && r.status === 0 ? (String(r.stdout).match(/\d+\.\d+\.\d+/) || [''])[0] : null;
};
register({
    id: 'deja', name: 'deja', npm: '@vshulcz/deja-vu',
    detect: () => { const v = dejaVersion(); return { installed: v !== null, version: v }; },
    install: async (c) => must(await c.host.installDeja(), 'deja install'),
    update: async (c) => must(await c.host.installDeja(), 'deja update'),
    verify: () => dejaVersion() !== null ? { ok: true, detail: dejaVersion() } : { ok: false, detail: 'deja CLI does not respond' },
});

// ---- Token Saver --------------------------------------------------------------------------
// install.py registers a Claude plugin (settings.json enabledPlugins) and a core copy at ~/.token-saver/src/cli.py.
const TS_PLUGIN_KEY = 'token-saver@token-saver-marketplace';
const tokenSaverVerify = (c) => {
    const home = c.home || homeDir;
    const run = (cmd, args) => cliSpawn.run(cmd, args, { timeout: 10000, env: c.env || process.env });
    let r = run('token-saver', ['stats']);
    if (r.error && r.error.code === 'ENOENT') {
        const cli = tsCliPath(home);
        r = fs.existsSync(cli) ? run(WIN ? 'python' : 'python3', [cli, 'stats']) : r;
    }
    if (r.error) return { ok: false, detail: r.error.code === 'ENOENT' ? 'CLI missing (token-saver not on PATH, no ~/.token-saver/src/cli.py)' : `CLI failed (${r.error.code || r.error.message})` };
    if (r.status !== 0) return { ok: false, detail: `CLI failed (exit ${r.status})` };
    const settings = claudeSettings(home, c.env);
    let on = false;
    try { on = JSON.parse(fs.readFileSync(settings, 'utf8')).enabledPlugins[TS_PLUGIN_KEY] === true; } catch { /* unreadable or absent */ }
    return on ? { ok: true, detail: 'CLI runs, hook registered' } : { ok: false, detail: `hook not registered in ${settings}` };
};
const tsCliPath = (home) => (WIN ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'token-saver', 'src', 'cli.py') : path.join(home, '.token-saver', 'src', 'cli.py'));
const onPath = (name, env) => String((env || process.env).PATH || '').split(path.delimiter).filter(Boolean)
    .some((d) => (WIN ? ['.exe', '.cmd', '.bat', ''] : ['']).some((ext) => fs.existsSync(path.join(d, name + ext))));
const claudeSettings = (home, env) => path.join((env || process.env).CLAUDE_CONFIG_DIR ? path.resolve((env || process.env).CLAUDE_CONFIG_DIR) : path.join(home, '.claude'), 'settings.json');
function tokenSaverDetect(c = {}) {
    const home = c.home || homeDir;
    let plugin = false;
    try { plugin = JSON.parse(fs.readFileSync(claudeSettings(home, c.env), 'utf8')).enabledPlugins[TS_PLUGIN_KEY] === true; } catch { /* unreadable or absent */ }
    return { installed: onPath('token-saver', c.env) || fs.existsSync(tsCliPath(home)) || plugin, version: null };
}
register({
    id: 'token-saver', name: 'Token Saver', npm: '@hybridlabor-api/heimdall-token-saver',
    detect: tokenSaverDetect,
    install: async (c) => must(await c.host.installTokenSaver('all'), 'Token Saver install'),
    update: async (c) => must(await c.host.installTokenSaver('all'), 'Token Saver update'),
    verify: (c) => tokenSaverVerify(c),
});

// ---- Codenotch (macOS/Windows) ----------------------------------------------------------
const codenotchVersion = () => {
    if (process.platform !== 'darwin' && process.platform !== 'win32') return null;
    if (process.platform === 'darwin') {
        const appPath = path.join(process.env.HOME || os.homedir(), 'Applications', 'Codenotch.app');
        if (!fs.existsSync(appPath)) return null;
        try {
            const plist = path.join(appPath, 'Contents', 'Info.plist');
            const v = spawnSync('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist], { encoding: 'utf8', timeout: 5000 });
            return !v.error && v.status === 0 ? v.stdout.trim() : null;
        } catch { return null; }
    }
    return null;
};
register({
    id: 'codenotch', name: 'Codenotch', npm: null,
    detect: () => { const v = codenotchVersion(); return { installed: v !== null, version: v }; },
    install: async (c) => must(await c.host.maybeInstallCodenotch(), 'Codenotch install'),
    update: async (c) => must(await c.host.maybeInstallCodenotch(), 'Codenotch update'),
    verify: () => { const v = codenotchVersion(); return v ? { ok: true, detail: v } : { ok: false, detail: 'Codenotch app not installed or version not readable' }; },
});

// ---- MCP gateway (block 3): default profile installs it; minimal excludes it via profile.js ----
const gateway = require('./pkg-gateway');
// aosRoot is the persistent ~/.agents tree (bin/, lib/), never the npx cache the installer runs from.
const gwCtx = (c) => ({ ...c, dryRun: !!c.dryRun, platform: process.platform, log: c.log || (() => {}), nodePath: process.execPath, aosRoot: path.join(c.home, '.agents'), uid: typeof process.getuid === 'function' ? process.getuid() : undefined, env: process.env });
register({
    id: gateway.id, name: gateway.name,
    // No npm version of its own: update regenerates mcp.json, presets and harness entries on every run (idempotent, F13).
    alwaysUpdate: true,
    detect: (c) => { const on = gateway.detect(gwCtx(c)); return { installed: on, version: on ? gateway.PIN.split('@').pop() : null }; },
    install: (c) => gateway.install(gwCtx(c)),
    update: (c) => gateway.update(gwCtx(c)),
    verify: (c) => gateway.verify(gwCtx(c), { tries: 60 }), // ~30 s, then a restart grace window (F15/F15b)
    uninstall: (c) => gateway.uninstall(gwCtx(c)),
});

// ---- AOS Hub service: same default-profile treatment as the gateway ----
const hubPkg = require('./pkg-hub');
const hubCtx = (c) => ({ ...c, dryRun: !!c.dryRun, platform: process.platform, log: c.log || (() => {}), nodePath: process.execPath, aosRoot: path.join(c.home, '.agents'), uid: typeof process.getuid === 'function' ? process.getuid() : undefined, env: process.env });
register({
    id: hubPkg.id, name: hubPkg.name,
    // No npm version of its own: update regenerates the service definition (idempotent).
    alwaysUpdate: true,
    detect: (c) => hubPkg.detectRow(hubCtx(c)),
    install: (c) => hubPkg.install(hubCtx(c)),
    update: (c) => hubPkg.update(hubCtx(c)),
    verify: (c) => hubPkg.verify(hubCtx(c)),
    uninstall: (c) => hubPkg.uninstall(hubCtx(c)),
});

// ---- Claude Code mods: fleet (plan 7a), sessions, alert --------------------------------------------
// pkg-fleet reads `claude --version` from stdout, so it gets its own run that pipes output
// instead of the step's log-only run.
const fleet = require('./pkg-fleet');
const fleetCtx = (c) => ({ ...c, dryRun: !!c.dryRun, log: c.log || (() => {}), env: process.env,
    run: (cmd, args = [], o = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 10000, ...o, stdio: ['ignore', 'pipe', 'pipe'] }) });
// c.manual (Settings -> Install): an explicit request must not report a skip as success.
const modOutcome = (mod, r, c) => {
    if (!r.ok && !r.skipped && !r.optedOut) throw new Error(r.error || r.reason || `${mod.id} install failed`);
    if (c.manual && r.optedOut) throw new Error(mod.id === 'fleet' ? 'opted out (AOS_NO_FLEET / enabledPlugins false)' : 'opted out (enabledPlugins false)');
    if (c.manual && r.skipped) throw new Error(r.hint || (/^Claude Code/.test(r.reason) ? `Claude Code ≥ ${fleet.MIN_VERSION} not found` : r.reason));
    return r.hint ? `skipped: ${r.hint}` : r.reason || (r.changed ? 'enabled' : 'unchanged');
};
// Fresh install and `aos update`: all mods in one settings.json write. Per entry: { entry, msg } or { entry, error }.
async function enableClaudeMods(c, entries) {
    const mods = entries.map((e) => fleet.mods.find((m) => m.id === e.id));
    const rs = await fleet.enable({ ...fleetCtx(c), clearOptOut: !!c.clearOptOut }, mods);
    return rs.map((r, i) => { try { return { entry: entries[i], msg: modOutcome(mods[i], r, c) }; } catch (error) { return { entry: entries[i], error }; } });
}
for (const mod of fleet.mods) {
    register({
        id: mod.id, name: mod.name, claudeMod: mod.KEY,
        detect: (c) => mod.detect(fleetCtx(c)),
        install: async (c) => modOutcome(mod, await mod.install({ ...fleetCtx(c), clearOptOut: !!c.clearOptOut }), c),
        update: async (c) => { const r = await mod.update(fleetCtx(c)); if (!r.ok && !r.skipped && !r.optedOut) throw new Error(r.error || r.reason || `${mod.id} update failed`); },
        verify: (c) => mod.verify(fleetCtx(c)),
        uninstall: (c) => mod.uninstall(fleetCtx(c)),
    });
}

const syncMembMcp = (c) => { if (copyProblem(c)) syncMcpCopy(c); };

module.exports = { registry, register, syncMembMcp, enableClaudeMods, mustList, venvTools, venvBroken, venvPython, readVersion };
