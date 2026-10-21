'use strict';
// Generates the 1mcp upstream config from the shipped mcp_config.json template. Pure except for
// writeGatewayConfig; no environment reads, so every path comes in as an argument.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { wrapServer, secretKV, shippedMcpTemplatePath } = require('../mcp-secrets');
const { pinNpx } = require('./npx-pin');

// Explicit allow-list: only these shipped servers are shared through the gateway. Everything else stays direct
// (placeholder URLs, *_fallback entries, tool-name length risk with the prefix, per-session state).
// Memory (memB, deja), A2A, mcsc, OpenWiki stay direct per session in every harness (PER_SESSION): never behind the gateway.
const GATEWAY_SERVERS = ['github', 'open_design_mcp', 'bdb_resolume_mcp', 'bdb_grandma3_mcp', 'bdb_blender_mcp', 'bdb_davinci_mcp',
    'adobe_uxp_mcp', 'bdb_unreal_mcp', 'bdb_after_effects_mcp', 'chrome-devtools',
    'bdb_td_backup',
    'codebase_memory_mcp', // stateless stdio over a per-call project path; adoption removed the direct entries, so the gateway must serve it
    // Desktop group (opt-in, selection group `desktop`): one desktop = one shared process is right, a copy per session is not.
    // Checked: 10 + name + 6 + longest tool <= 64 (bdb_windows_computer_use 24+21 -> 61, bdb_remoteos_mcp 17+30 -> 63).
    'zavora_computer_use', 'bdb_windows_computer_use', 'bdb_remoteos_mcp'];
// Checked: mcp__aos__<server>_1mcp_<tool> <= 64 chars (adobe_uxp_mcp 51, bdb_unreal_mcp 52, bdb_after_effects_mcp 59, chrome-devtools 51, bdb_td_backup 54).
// GW-B smoke tests: chrome-devtools in Docker (one shared Chromium for every session); bdb_td_backup
// on the Mac host (tools/list plus one read call). Not added:
// bdb_rhino_mcp (native router binary from a Rhino yak, needs Rhino on the host; not runnable in a container).
// Informational (doctor/info): known servers that stay direct. Membership in GATEWAY_SERVERS decides routing.
const DIRECT_SERVERS = [
    'memb_mcp', // memory stays direct per session in every harness
    'deja', // memory stays direct per session in every harness
    'mcsc', // MCSC_DEPTH recursion guard is per session; one shared process would let delegated agents bypass it
    'bdb_rhino_mcp_fallback', // pick-group duplicate
    'bdb_after_effects_mcp_fallback', // pick-group duplicate
    'bdb_td_minddesigner', // 339 tools, 4 tool names exceed the 64-char limit behind the gateway, uses tdmcp:// resources and elicitation (unverified through 1mcp), cap via TDMCP_TOOL_PROFILE=safe
    'bdb_rhino_mcp', // native router needs Rhino on host
    'bdb_after_effects_mcp_legacy', // pick-group duplicate
    'bdb_blender_official_mcp', // pick-group duplicate
    'bdb_resolume_official_mcp', // pick-group duplicate
    'tauri-pilot', // talks to the socket of the Tauri app this session is debugging: one shared process would mix sessions
    'rea_mcp', // stateful stdio MCP (binary sessions, GDB/Frida loops); 172 tools risk gateway context pressure; keep direct
];
// synapse, openwiki and firecrawl_mcp are on neither list on purpose: `aos-gateway adopt` may take them.
// Alternates of one gateway server: the pick-group duplicates (the DIRECT_SERVERS rows commented
// "pick-group duplicate") that run the same upstream as a GATEWAY_SERVERS entry. Explicit map, no regex.
const ALTERNATES = {
    bdb_after_effects_mcp: ['bdb_after_effects_mcp_fallback', 'bdb_after_effects_mcp_legacy'],
    bdb_blender_mcp: ['bdb_blender_official_mcp'],
    bdb_resolume_mcp: ['bdb_resolume_official_mcp'],
};
const alternatesOf = (name) => ALTERNATES[name] || [];
const gatewayCovered = (name) => GATEWAY_SERVERS.includes(name) || Object.values(ALTERNATES).some((list) => list.includes(name));
// Per-session servers (own state per agent session, A2A identity, memory, wiki) stay direct by design: never adopted, never served.
const PER_SESSION = /^(memb([-_]mcp)?|deja|openwiki|aos-a2a.*|a2a-.*)$/i;
const GATEWAY_PORT = 7790;
// 1mcp 0.38.2 has no static upstream token that was verified in its package source; its only auth is OAuth 2.1
// (--enable-auth), which the forwarder does not speak. The upstream always runs its own Host/Origin loopback guard.
// Only the forwarder on GATEWAY_PORT checks the token, so a local process can still reach this port directly.
const UPSTREAM_PORT = 7791;

const gatewayDir = (home) => path.join(home, '.agents', 'gateway');
// Same directory the installer substitutes for __MCPS_DIR__ (agy's config dir, installMcpsForTarget).
const defaultMcpsDir = (home) => path.join(home, '.gemini', 'config', 'mcps');

function splitServers(shipped) {
    const direct = {};
    const gateway = {};
    for (const [name, cfg] of Object.entries(shipped || {})) {
        (GATEWAY_SERVERS.includes(name) && !(cfg && cfg.shared === false) ? gateway : direct)[name] = cfg;
    }
    return { gateway, direct };
}

// Template "presets": kind -> "all" (no preset, plain URL) or the server names that kind must not see. Returns the
// 1mcp filter (every upstream carries tag 'aos') or null when the kind gets no preset.
// Live 1mcp 0.38.2: a standalone `NOT x` is rejected; `aos AND NOT x` is accepted.
function presetFor(kind, presets) {
    const v = presets && presets[kind];
    if (!Array.isArray(v) || !v.length) return null;
    return ['aos', ...v.map((n) => `NOT ${n}`)].join(' AND ');
}

// launchd and schtasks start with a minimal PATH; upstreams need node, uv and npx.
// Global npm bin: deja and codebase-memory-mcp live only there on Windows (%APPDATA%\npm), which the node dir does not contain.
// POSIX resolves `npm prefix -g` once per process, no shell; null when npm is missing or answers nothing usable.
let npmBinMemo;
function npmGlobalBin({ home, platform, env = process.env, run = spawnSync }) {
    if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm');
    if (npmBinMemo !== undefined && run === spawnSync) return npmBinMemo;
    let bin = null;
    try {
        const r = run('npm', ['prefix', '-g'], { encoding: 'utf8', shell: false, timeout: 5000 });
        const p = String((r && r.stdout) || '').trim();
        if (r && r.status === 0 && path.isAbsolute(p)) bin = path.join(p, 'bin');
    } catch { /* no npm */ }
    if (run === spawnSync) npmBinMemo = bin;
    return bin;
}

// launchd and schtasks start with a minimal PATH; upstreams need node, uv, npx and the global npm bin.
function defaultPathEnv({ home, nodePath, platform, npmBin }) {
    const npm = npmBin || (platform === 'win32' ? npmGlobalBin({ home, platform }) : null);
    if (platform === 'win32') return [...new Set([path.dirname(nodePath), npm, path.join(home, '.local', 'bin'), path.join(home, '.cargo', 'bin'), path.join(home, 'go', 'bin')].filter(Boolean))].join(';');
    const dirs = [path.dirname(nodePath), npm, path.join(home, '.local', 'bin'), path.join(home, '.cargo', 'bin'), path.join(home, 'go', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/local/go/bin', '/usr/bin', '/bin'].filter(Boolean);
    return [...new Set(dirs)].join(':');
}

// @kumoproductions/mcp-aftereffects@0.3.1 declares engines.node >= 24.
const AE_MIN_NODE = 24;
// Major version of the `node` that the upstreams find on PATH (null when there is none); run is injectable for tests.
function nodeMajorOnPath(pathEnv, run = spawnSync) {
    try {
        const r = run('node', ['--version'], { encoding: 'utf8', env: { PATH: pathEnv }, shell: false, timeout: 5000 });
        const m = /^v(\d+)\./.exec(String((r && r.stdout) || '').trim());
        return m ? Number(m[1]) : null;
    } catch { return null; }
}

function resolveValue(v, ctx) {
    if (typeof v === 'string') {
        const out = v.split('__MCPS_DIR__').join(ctx.mcpsDir).split('{{HOME}}').join(ctx.home)
            .split('__PYTHON_BIN__').join(path.join(ctx.mcpsDir, 'memb-mcp', '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python'));
        // __MCPS_DIR__/x.py would keep a '/' after the native-separator prefix on Windows.
        return v.startsWith('__MCPS_DIR__') ? path.normalize(out) : out;
    }
    if (Array.isArray(v)) return v.map((x) => resolveValue(x, ctx));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveValue(x, ctx)]));
    return v;
}

// -> the `mcpServers` object of 1mcp's config. Secrets only ever appear as variable NAMES in the launcher's --vars.
// Adopted servers (optional `adopted` argument; otherwise read from adopted.json when a `home` is given) bypass the launcher.
// `selected` (optional) = the gateway server selection (lib/gateway/selection.js): only those shipped
// servers are put behind the gateway (necessarily a subset of the allow-list); absent keeps the old behaviour (all).
function buildUpstreams({ shipped, home, launcher, pathEnv, mcpsDir = defaultMcpsDir(home), uvPath, passEnv = {}, adopted, pkgDir, selected }) {
    if (!launcher) throw new Error('launcher path required: secrets must go through the launcher');
    const ctx = { home, mcpsDir };
    const out = {};
    for (const [name, template] of Object.entries(splitServers(shipped).gateway)) {
        if (Array.isArray(selected) && !selected.includes(name)) continue;
        const cfg = pinNpx(resolveValue(template, ctx), pkgDir);
        if (uvPath && cfg.command === 'uv') cfg.command = uvPath;
        const w = wrapServer(name, cfg, launcher);
        const env = Object.fromEntries(Object.entries(w.env || {}).filter(([k, v]) => !secretKV(k, v)));
        // tags are the preset vocabulary: `1mcp preset create` filters on them (common tag 'aos' + server name).
        // Presets select which upstreams a client sees (?preset=); the gateway itself serves all of them.
        out[name] = {
            type: 'stdio',
            command: w.command,
            args: Array.isArray(w.args) ? w.args : [],
            ...(w.cwd ? { cwd: w.cwd } : {}),
            env: { ...passEnv, ...env, PATH: pathEnv, HOME: home },
            inheritParentEnv: false,
            tags: ['aos', name],
            restartOnExit: true, maxRestarts: 3, restartDelay: 2000,
        };
    }
    const adoptedServers = adopted !== undefined ? adopted : (home ? readAdopted(home, Object.keys(shipped || {})) : {});
    for (const [name, a] of Object.entries(adoptedServers)) {
        const env = Object.fromEntries(Object.entries(a.env || {}).filter(([k, v]) => !secretKV(k, v)));
        let command = a.command;
        if (uvPath && command === 'uv') command = uvPath;
        out[name] = {
            type: 'stdio',
            command,
            args: Array.isArray(a.args) ? a.args : [],
            ...(a.cwd ? { cwd: a.cwd } : {}),
            env: { ...passEnv, ...env, PATH: pathEnv, HOME: home },
            inheritParentEnv: false,
            tags: ['aos', name],
        };
    }
    return out;
}

// Lazy loading (meta-tools tool_list/tool_schema/tool_invoke) is on unless the user's gateway.json says "lazyLoading": false.
// A missing file keeps the default silently; an unparseable one keeps it and logs one line.
function lazyLoadingOn(dir, log = () => {}) {
    let text;
    try { text = fs.readFileSync(path.join(dir, 'gateway.json'), 'utf8'); } catch { return true; }
    try { return JSON.parse(text.replace(/^\uFEFF/, '')).lazyLoading !== false; } catch (e) {
        log(`aos-gateway: cannot parse ${path.join(dir, 'gateway.json')} (${e.message}); lazy loading stays on`);
        return true;
    }
}

// Async loading (1mcp starts its HTTP listener before every upstream is ready) is OFF unless gateway.json says "asyncLoading": true.
// Default stays off until a live check per harness shows late servers appear via tool_list. Any read or parse problem means off.
function asyncLoadingOn(dir) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, 'gateway.json'), 'utf8').replace(/^\uFEFF/, '')).asyncLoading === true; } catch { return false; }
}

// Flags the running serve process really started 1mcp with (status reports this, not the file).
const RUNTIME_FILE = 'gateway-runtime.json';

// Adopted-server storage (contract point 1): ~/.agents/gateway/adopted.json.
function adoptedPath(home) { return path.join(gatewayDir(home), 'adopted.json'); }

// `reserved` = extra names (e.g. all shipped server names) an adopted entry must never shadow.
function readAdopted(home, reserved = []) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(adoptedPath(home), 'utf8')); } catch { return {}; }
    const servers = parsed && typeof parsed === 'object' ? parsed.servers : null;
    const out = {};
    for (const [name, e] of Object.entries(servers && typeof servers === 'object' ? servers : {})) {
        const env = e && typeof e === 'object' && !Array.isArray(e) ? e.env : null;
        if (!/^[A-Za-z0-9_-]+$/.test(name) || name.length > 26) continue;
        if (DIRECT_SERVERS.includes(name) || PER_SESSION.test(name) || reserved.includes(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) continue;
        if (!e || typeof e !== 'object') continue;
        if (typeof e.command !== 'string' || !e.command) continue;
        if (!Array.isArray(e.args) || !e.args.every((a) => typeof a === 'string')) continue;
        if (!env || typeof env !== 'object' || Array.isArray(env) || !Object.entries(env).every(([k, v]) => typeof k === 'string' && typeof v === 'string')) continue;
        if (e.cwd !== undefined && typeof e.cwd !== 'string') continue;
        out[name] = { command: e.command, args: e.args, ...(Object.keys(env).length ? { env } : {}), ...(e.cwd !== undefined ? { cwd: e.cwd } : {}) };
    }
    return out;
}

// 0600: the file names which secret variables each server receives.
function writeGatewayConfig(dir, servers) {
    const file = path.join(dir, 'mcp.json');
    const tmp = `${file}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(tmp, JSON.stringify({ mcpServers: servers }, null, 2) + '\n', { mode: 0o600 });
        fs.renameSync(tmp, file);
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch { /* never created */ }
        throw e;
    }
    return file;
}

module.exports = { PER_SESSION, lazyLoadingOn, asyncLoadingOn, RUNTIME_FILE, GATEWAY_SERVERS, DIRECT_SERVERS, GATEWAY_PORT, UPSTREAM_PORT, gatewayDir, adoptedPath, readAdopted, defaultMcpsDir, defaultPathEnv, npmGlobalBin, AE_MIN_NODE, nodeMajorOnPath, splitServers, presetFor, buildUpstreams, writeGatewayConfig, alternatesOf, gatewayCovered, shippedMcpTemplatePath };
