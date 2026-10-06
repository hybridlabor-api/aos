'use strict';
// Generates the 1mcp upstream config from the shipped mcp_config.json template. Pure except for
// writeGatewayConfig; no environment reads, so every path comes in as an argument.
const fs = require('fs');
const path = require('path');
const { wrapServer, secretKV } = require('../mcp-secrets');

// Explicit allow-list: only these shipped servers are shared through the gateway. Everything else stays direct
// (placeholder URLs, *_fallback entries, tool-name length risk with the prefix, per-session state).
const GATEWAY_SERVERS = ['github', 'open_design_mcp', 'bdb_resolume_mcp', 'bdb_grandma3_mcp', 'bdb_blender_mcp', 'bdb_davinci_mcp',
    'adobe_uxp_mcp', 'bdb_unreal_mcp', 'bdb_after_effects_mcp'];
// Checked: mcp__aos__<server>_1mcp_<tool> <= 64 chars (adobe_uxp_mcp 51, bdb_unreal_mcp 52, bdb_after_effects_mcp 59). Not added:
// bdb_rhino_mcp (native router binary from a Rhino yak, needs Rhino on the host; not runnable in a container).
// Informational (doctor/info): known servers that stay direct. Membership in GATEWAY_SERVERS decides routing.
const DIRECT_SERVERS = ['deja', 'memb_mcp', 'mcsc', 'chrome-devtools', 'bdb_windows_computer_use', 'zavora_computer_use', 'synapse', 'openwiki',
    'bdb_remoteos_mcp', 'bdb_rhino_mcp_fallback', 'bdb_after_effects_mcp_fallback', 'bdb_td_minddesigner', 'bdb_td_backup',
    'bdb_rhino_mcp', 'bdb_after_effects_mcp_legacy'];
const GATEWAY_PORT = 7790;
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

// launchd and schtasks start with a minimal PATH; upstreams need node, uv and npx.
function defaultPathEnv({ home, nodePath, platform }) {
    if (platform === 'win32') return [path.dirname(nodePath), path.join(home, '.local', 'bin'), path.join(home, '.cargo', 'bin'), path.join(home, 'go', 'bin')].join(';');
    const dirs = [path.dirname(nodePath), path.join(home, '.local', 'bin'), path.join(home, '.cargo', 'bin'), path.join(home, 'go', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/local/go/bin', '/usr/bin', '/bin'];
    return [...new Set(dirs)].join(':');
}

function resolveValue(v, ctx) {
    if (typeof v === 'string') {
        return v.split('__MCPS_DIR__').join(ctx.mcpsDir).split('{{HOME}}').join(ctx.home)
            .split('__PYTHON_BIN__').join(path.join(ctx.mcpsDir, 'memb-mcp', '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python'));
    }
    if (Array.isArray(v)) return v.map((x) => resolveValue(x, ctx));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveValue(x, ctx)]));
    return v;
}

// -> the `mcpServers` object of 1mcp's config. Secrets only ever appear as variable NAMES in the launcher's --vars.
// Adopted servers (optional `adopted` argument; otherwise read from adopted.json when a `home` is given) bypass the launcher.
function buildUpstreams({ shipped, home, launcher, pathEnv, mcpsDir = defaultMcpsDir(home), uvPath, passEnv = {}, adopted }) {
    if (!launcher) throw new Error('launcher path required: secrets must go through the launcher');
    const ctx = { home, mcpsDir };
    const out = {};
    for (const [name, template] of Object.entries(splitServers(shipped).gateway)) {
        const cfg = resolveValue(template, ctx);
        if (uvPath && cfg.command === 'uv') cfg.command = uvPath;
        const w = wrapServer(name, cfg, launcher);
        const env = Object.fromEntries(Object.entries(w.env || {}).filter(([k, v]) => !secretKV(k, v)));
        out[name] = {
            type: 'stdio',
            command: w.command,
            args: Array.isArray(w.args) ? w.args : [],
            ...(w.cwd ? { cwd: w.cwd } : {}),
            env: { ...passEnv, ...env, PATH: pathEnv, HOME: home },
            inheritParentEnv: false,
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
        };
    }
    return out;
}

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
        if (GATEWAY_SERVERS.includes(name) || DIRECT_SERVERS.includes(name) || reserved.includes(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) continue;
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

module.exports = { GATEWAY_SERVERS, DIRECT_SERVERS, GATEWAY_PORT, UPSTREAM_PORT, gatewayDir, adoptedPath, readAdopted, defaultMcpsDir, defaultPathEnv, splitServers, buildUpstreams, writeGatewayConfig };
