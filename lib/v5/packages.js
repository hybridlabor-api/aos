'use strict';
// Package registry. Contract: { id, name, npm, detect(ctx) -> {installed, version}, install(ctx), update(ctx),
// verify(ctx) -> {ok, detail}, repair?(ctx) }. ctx = { host, home, run, state }; host is installer.js's exports
// (injected so tests and lib/ never require installer.js themselves).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const WIN = process.platform === 'win32';
const readVersion = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || null; } catch { return null; } };
const exits0 = (cmd, args, cwd) => { const r = spawnSync(cmd, args, { cwd, stdio: 'ignore', timeout: 30000 }); return !r.error && r.status === 0; };
const must = (ok, what) => { if (ok === false) throw new Error(`${what} reported a failure`); };

const registry = [];
const register = (entry) => { const i = registry.findIndex((e) => e.id === entry.id); if (i >= 0) registry[i] = entry; else registry.push(entry); return entry; };

// ---- kernel: skills, plugin migration (rules/hooks are the Harnesses step) ----------------------
const kernelUpdate = (c) => c.host.quickUpdateKernel(c.state);
register({
    id: 'kernel', name: 'AOS kernel', npm: '@hybridlabor-api/aos',
    detect: (c) => { const s = c.host.detectInstallState(); return { installed: s.isInstalled, version: s.localVersion }; },
    install: kernelUpdate,
    update: kernelUpdate,
    repair: kernelUpdate,
    verify: (c) => {
        const dir = c.host.resolveTargetPaths('1', null).targetSkillDir;
        let n = 0;
        try { n = fs.readdirSync(dir).length; } catch { /* missing */ }
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

const venvTools = {
    create(c, dir) {
        const uv = c.host.uvBin();
        try { c.run(uv, ['venv', '--seed', '.venv'], { cwd: dir }); } catch { c.run(WIN ? 'python' : 'python3', ['-m', 'venv', '.venv'], { cwd: dir }); }
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
        let reqs = '';
        try { reqs = fs.readFileSync(path.join(dir, 'requirements.txt'), 'utf8'); } catch { /* none */ }
        if (/(^|\n)\s*mcp\s*([<>=!~;[]|$)/.test(reqs) && !exits0(venvPython(dir), ['-c', 'import mcp'], dir)) return { ok: false, detail: 'import mcp fails' };
        const p = copyProblem(c);
        return p ? { ok: false, detail: p } : { ok: true, detail: readVersion(dir) || '' };
    },
    // Rename, never delete: the old venv stays as .venv.broken-<ts> for the user to remove.
    async repair(c) {
        const dir = membDir(c);
        if (venvBroken(dir)) {
            const venv = path.join(dir, '.venv');
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            try { fs.lstatSync(venv); fs.renameSync(venv, `${venv}.broken-${stamp}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
            await (c.venv || venvTools).create(c, dir);
            await (c.venv || venvTools).install(c, dir);
        }
        if (copyProblem(c)) syncMcpCopy(c);
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
        return exits0(bin, ['--version']) ? { ok: true, detail: readVersion(synapseDir(c)) || '' } : { ok: false, detail: 'synapse --version fails' };
    },
});

// ---- OpenWiki -----------------------------------------------------------------------------------
const owVersion = () => { const r = spawnSync('openwiki', ['--version'], { encoding: 'utf8', timeout: 15000 }); return !r.error && r.status === 0 ? (String(r.stdout).match(/\d+\.\d+\.\d+\S*/) || [''])[0] : null; };
// No prompt: a missing key is a Settings action, so the daemon refresh simply reports "skipped".
const owUpdate = async (c) => ((await c.host.refreshOpenWikiSilently()) ? '' : 'no key stored, daemon not refreshed');
register({
    id: 'openwiki', name: 'OpenWiki', npm: 'openwiki',
    detect: (c) => { const v = owVersion(); return { installed: v !== null || fs.existsSync(path.join(c.home, '.openwiki', '.env')), version: v || null }; },
    install: owUpdate,
    update: owUpdate,
    verify: () => (owVersion() !== null ? { ok: true, detail: owVersion() } : { ok: false, detail: 'openwiki CLI does not respond' }),
});

// ---- TODO (mechanical worker): detect() only. Fill install/update/verify per plan section 3. ------
const dirDetect = (dirName) => (c) => { const d = path.join(c.host.moduleBasePath(), dirName); return { installed: fs.existsSync(d), version: readVersion(d) }; };
const notDetected = () => ({ installed: false, version: null });
for (const [id, name, npm, detect] of [
    ['remote', 'BDB OS Remote', '@hybridlabor-api/bdb-os-remote', dirDetect('bdb-os-remote')],
    ['ao', 'Agent Orchestrator', null, dirDetect('bdb-agent-orchestrator')],
    ['creator', 'Creator Extension', '@hybridlabor-api/bdb-dev-creator-extension', dirDetect('bdb-dev-creator-extension')],
    ['hardware', 'Hardware & PCB', '@hybridlabor-api/bdb-hardware-pcb', dirDetect('bdb-hardware-pcb')],
    ['installer', 'Dev Tool Installer', '@hybridlabor-api/bdb-dev-tool-installer', dirDetect('bdb-dev-tool-installer')],
    ['deja', 'deja', null, notDetected], // TODO detect: CLI on PATH
    ['token-saver', 'Token Saver', null, notDetected], // TODO detect
    ['codenotch', 'Codenotch', null, notDetected], // TODO detect: app version readable (lib/codenotch.js)
]) register({ id, name, npm, todo: true, detect });

const syncMembMcp = (c) => { if (copyProblem(c)) syncMcpCopy(c); };

module.exports = { registry, register, syncMembMcp, venvTools, venvBroken, venvPython, readVersion };
