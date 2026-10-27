'use strict';
// The only gateway code that deletes anything: uninstall removes what AOS generated. Install, update and repair
// (pkg-gateway.js, lib/gateway) never delete a tree; a test keeps those files free of delete primitives.
const fs = require('fs');
const path = require('path');
const { gatewayDir } = require('../gateway/config');
const { CACHE_FILE } = require('../gateway-npm-cache');

const PRESETS_OK = 'aos-presets-ok.json';

const GENERATED = (n) => n === 'node_modules' || n === 'mcp-pkgs' || n === 'gateway.log' || n === 'gateway.log.1' || n.startsWith('node_modules.removed-') || n === CACHE_FILE
    || /\.(pid|flock)$/.test(n) || ['admin', 'runtime.owner', 'gateway-runtime.json', 'sessions', 'package.json', 'package-lock.json', 'runtime-identity.json', 'template-context-capability.json'].includes(n);

// createPresets only filters of the form `aos AND NOT x ...`; such a preset is ours even when PRESETS_OK lacks its name
// (a failed run overwrote the record, or an older release created it).
const hasAosShape = (p) => {
    const q = p && p.tagQuery && p.tagQuery.$and;
    return Array.isArray(q) && q.length > 1 && q[0] && q[0].tag === 'aos' && q.slice(1).every((c) => c && c.$not && typeof c.$not.tag === 'string');
};

// presets.json belongs to 1mcp and may hold the user's own presets: only the names AOS created (PRESETS_OK) leave it.
// The file goes when nothing else is in it; otherwise a backup is kept next to it.
function stripAosPresets(dir) {
    const file = path.join(dir, 'presets.json');
    let made = [];
    try { made = JSON.parse(fs.readFileSync(path.join(dir, PRESETS_OK), 'utf8')); } catch { /* none recorded: nothing is ours */ }
    let text; let conf;
    try { text = fs.readFileSync(file, 'utf8'); conf = JSON.parse(text); } catch { return 'none'; }
    const all = conf && conf.presets && typeof conf.presets === 'object' ? conf.presets : null;
    if (!all) return 'kept';
    const ours = [...new Set([...made, ...Object.keys(all).filter((n) => hasAosShape(all[n]))])].filter((n) => Object.prototype.hasOwnProperty.call(all, n));
    // 1mcp writes an empty {presets:{}} on every start that finds no file; nothing of the user's is in it.
    if (!ours.length && Object.keys(all).length) return 'kept';
    for (const n of ours) delete all[n];
    if (!Object.keys(all).length) { fs.rmSync(file, { force: true }); return 'removed'; }
    fs.writeFileSync(`${file}.${Date.now()}.bak`, text, { mode: 0o600 });
    fs.writeFileSync(file, JSON.stringify(conf, null, 2) + '\n', { mode: 0o600 });
    return 'stripped';
}

// AOS-generated trees of the gateway dir (1mcp install, pinned MCP packages, retired copies, log). gateway.json and
// migration.json* are user data and stay; the dir itself goes when nothing else is left in it.
function removeGenerated(dir, home) {
    if (!path.isAbsolute(home) || path.resolve(home) === path.parse(path.resolve(home)).root) throw new Error(`refusing to touch ${home}`);
    if (dir !== gatewayDir(home)) throw new Error(`refusing to touch ${dir}`);
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return []; }
    const gone = names.filter(GENERATED);
    gone.forEach((n) => fs.rmSync(path.join(dir, n), { recursive: true, force: true }));
    try { fs.rmdirSync(dir); } catch { /* user files left in it */ }
    return gone;
}

// Backups of the gateway's mcp.json (upstream env, tokens) that AOS wrote during a memory-direct migration or a
// gateway enable/disable run. They hold the same secrets as mcp.json, so uninstall removes them with it.
const MCP_BACKUP = /^mcp\.json\.aos-(?:memdirect|gateway)-bak-\d+(?:\.\d+)?$/;
function removeMcpBackups(dir, home) {
    if (!path.isAbsolute(home) || path.resolve(home) === path.parse(path.resolve(home)).root) throw new Error(`refusing to touch ${home}`);
    if (dir !== gatewayDir(home)) throw new Error(`refusing to touch ${dir}`);
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return []; }
    const gone = names.filter((n) => MCP_BACKUP.test(n));
    gone.forEach((n) => fs.rmSync(path.join(dir, n), { force: true }));
    return gone;
}

module.exports = { PRESETS_OK, GENERATED, stripAosPresets, removeGenerated, removeMcpBackups, MCP_BACKUP };
