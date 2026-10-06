'use strict';
// Generates the 1mcp upstream config from the shipped mcp_config.json template. Pure except for
// writeGatewayConfig; no environment reads, so every path comes in as an argument.
const fs = require('fs');
const path = require('path');
const { wrapServer, secretKV } = require('../mcp-secrets');

// Stay direct: per-session state, harness-specific registration, or already HTTP.
const DIRECT_SERVERS = ['deja', 'memb_mcp', 'mcsc', 'chrome-devtools', 'bdb_windows_computer_use', 'zavora_computer_use', 'synapse', 'openwiki'];
const GATEWAY_PORT = 7790;
const UPSTREAM_PORT = 7791;

const gatewayDir = (home) => path.join(home, '.agents', 'gateway');
// Same directory the installer substitutes for __MCPS_DIR__ (agy's config dir, installMcpsForTarget).
const defaultMcpsDir = (home) => path.join(home, '.gemini', 'config', 'mcps');

function splitServers(shipped) {
    const direct = {};
    const gateway = {};
    for (const [name, cfg] of Object.entries(shipped || {})) {
        (DIRECT_SERVERS.includes(name) || (cfg && cfg.shared === false) ? direct : gateway)[name] = cfg;
    }
    return { gateway, direct };
}

// launchd and schtasks start with a minimal PATH; upstreams need node, uv and npx.
function defaultPathEnv({ home, nodePath, platform }) {
    if (platform === 'win32') return [path.dirname(nodePath), path.join(home, '.local', 'bin'), path.join(home, '.cargo', 'bin')].join(';');
    const dirs = [path.dirname(nodePath), path.join(home, '.local', 'bin'), path.join(home, '.cargo', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
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
function buildUpstreams({ shipped, home, launcher, pathEnv, mcpsDir = defaultMcpsDir(home), uvPath }) {
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
            env: { ...env, PATH: pathEnv, HOME: home },
            inheritParentEnv: false,
        };
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

module.exports = { DIRECT_SERVERS, GATEWAY_PORT, UPSTREAM_PORT, gatewayDir, defaultMcpsDir, defaultPathEnv, splitServers, buildUpstreams, writeGatewayConfig };
