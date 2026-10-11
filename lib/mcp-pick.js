'use strict';
// App-aware MCP picking: for app groups that ship both an official MCP and an AOS one, exactly one
// candidate per machine is kept. Pure except for detectApps' optional fsImpl default (node fs).
const fs = require('fs');
const os = require('os');
const path = require('path');

// Dotted numeric compare: non-numeric parts -> false. '5.1' >= '5.1.2' is false, '5.1' >= '5.1' true.
function versionGte(a, b) {
    const parse = (v) => String(v || '').split('.').map((x) => (/^\d+$/.test(x) ? Number(x) : null));
    const av = parse(a);
    const bv = parse(b);
    const len = Math.max(av.length, bv.length);
    for (let i = 0; i < len; i++) {
        const x = av[i] === undefined ? 0 : av[i];
        const y = bv[i] === undefined ? 0 : bv[i];
        if (x === null || y === null) return false;
        if (x !== y) return x > y;
    }
    return true;
}

// Returns detect(app) -> null | { version?, path? }. Never throws; any fs error yields null.
function detectApps({ platform, env, fsImpl, home } = {}) {
    const f = fsImpl || fs;
    const fsExists = (p) => { try { return f.existsSync(p); } catch { return false; } };
    const progFiles = (env && env.ProgramFiles) || 'C:\\Program Files';
    const readdir = (p) => {
        try {
            const files = f.readdirSync(p);
            return Array.isArray(files) ? files.map(String) : [];
        } catch { return null; }
    };
    const detect = (app) => {
        if (app === 'blender') {
            if (platform === 'darwin') {
                const entries = readdir('/Applications/Blender.app/Contents/Resources');
                if (!entries) return null;
                const versions = entries.filter((e) => /^\d+\.\d+$/.test(e));
                if (!versions.length) return null;
                return { version: versions.sort((x, y) => (versionGte(x, y) ? 1 : -1)).pop() };
            }
            if (platform === 'win32') {
                const entries = readdir(path.win32.join(progFiles, 'Blender Foundation'));
                if (!entries) return null;
                const dirs = entries.map((e) => /^Blender (\d+\.\d+)$/.exec(e)).filter((m) => m).map((m) => m[1]);
                if (!dirs.length) return null;
                return { version: dirs.sort((x, y) => (versionGte(x, y) ? 1 : -1)).pop() };
            }
            return null;
        }
        if (app === 'resolume') {
            if (platform === 'darwin') {
                const p = '/Applications/Resolume Arena/mcp/resolume_arena_mcp_server';
                return fsExists(p) ? { path: p } : null;
            }
            if (platform === 'win32') {
                const p = path.win32.join(progFiles, 'Resolume Arena', 'mcp', 'resolume_arena_mcp_server.exe');
                return fsExists(p) ? { path: p } : null;
            }
            return null;
        }
        if (app === 'rustauri') {
            // The optional Rust + Tauri package counts as installed once its tauri-pilot skill is in ~/.agents/skills.
            const p = path.join(home || os.homedir(), '.agents', 'skills', 'tauri-pilot', 'SKILL.md');
            return fsExists(p) ? { path: p } : null;
        }
        if (app === 'codebase-memory') {
            // The upstream codebase-memory-mcp binary must be installed by the user; the pick
            // only registers the MCP server where the binary is actually present. Probe the
            // PATH plus the upstream install locations with plain fs (never a spawn).
            const { cmbAppStatus } = require('./codebase-memory');
            const s = cmbAppStatus({ platform, env, fsImpl: f });
            return s.found ? { path: s.path } : null;
        }
        return null;
    };
    return detect;
}

const isSatisfied = (requires, detect, env = {}) => {
    if (!requires) return true;
    // requires.env: opt-in by environment variable (e.g. the AE rollback entry), every pair must match exactly.
    if (requires.env && typeof requires.env === 'object' && !Object.entries(requires.env).every(([k, v]) => env && env[k] === v)) return false;
    if (!requires.app) return true;
    const d = detect(requires.app);
    if (!d) return false;
    if (typeof d.version === 'undefined' && typeof d.path === 'undefined') return false;
    if (requires.minVersion) {
        if (!d.version && !d.path) return false;
        if (!versionGte(d.version, requires.minVersion)) return false;
    }
    return true;
};

// Per group: first satisfied candidate wins; the other candidate names of the group are removed from the
// returned servers copy (only names present in servers) and listed in `retired`. Input never mutated.
function applyPicks(servers, picks, detect, env = {}) {
    const out = { ...(servers || {}) };
    const retired = [];
    for (const group of Array.isArray(picks) ? picks : []) {
        if (!group || !Array.isArray(group.candidates)) continue;
        const names = group.candidates.filter((c) => c && typeof c.name === 'string').map((c) => c.name);
        let winner = null;
        for (const cand of group.candidates) {
            if (!cand || typeof cand.name !== 'string') continue;
            if (!isSatisfied(cand.requires, detect, env)) continue;
            // A candidate carries its own `entry` (kept out of mcp_config.json so no installer sees both) or is
            // an ordinary mcpServers entry; a winner without any definition is skipped, never leaves the app unserved.
            const entry = cand.entry && typeof cand.entry === 'object' ? cand.entry : out[cand.name];
            if (!entry || typeof entry !== 'object') continue;
            let resolved = entry;
            if (entry.command === '__RESOLUME_MCP__') {
                const d = detect(cand.requires ? cand.requires.app : null);
                if (!d || !d.path) continue;
                resolved = { ...entry, command: d.path };
            }
            if (cand.entry || resolved !== entry) out[cand.name] = resolved;
            winner = cand.name;
            break;
        }
        if (!winner) continue;
        for (const n of names) {
            if (n === winner || n === undefined) continue;
            if (Object.prototype.hasOwnProperty.call(out, n)) { delete out[n]; retired.push(n); }
        }
    }
    return { servers: out, retired };
}

module.exports = { versionGte, detectApps, applyPicks };
