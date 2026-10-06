'use strict';
// Switches harness MCP configs between the direct stdio entries of the shared servers and ONE `aos` entry
// pointing at the local gateway. Every path comes in as an argument; nothing here reads HOME or the environment.
// Entry shapes are UNVERIFIED against the harnesses' own docs/behaviour (see stage 2 report).
const fs = require('fs');
const path = require('path');
const { gatewayDir, splitServers } = require('./config');
const { isAosOwned, inlineSecrets, fromOpencode, safeBackup } = require('../mcp-secrets');

const GATEWAY_URL = 'http://127.0.0.1:7790/mcp';
const TOKEN_RE = /^[0-9a-f]{64}$/;
const SUPPORTED = new Set(['claude', 'cursor', 'opencode']);

function classify(file, hint) {
    const base = path.basename(file);
    if (hint === 'opencode') return 'opencode';
    if (hint === 'toml') return 'codex';
    if (base === '.claude.json') return 'claude';
    if (base === 'claude_desktop_config.json') return 'claude-desktop';
    if (base === 'mcp.json' && path.basename(path.dirname(file)) === '.cursor') return 'cursor';
    return 'other';
}

const mapKey = (kind) => (kind === 'opencode' ? 'mcp' : 'mcpServers');
const isAosShaped = (e) => !!e && typeof e === 'object' && e.url === GATEWAY_URL;

function entryFor(kind, token) {
    const headers = { 'X-AOS-Token': token };
    if (kind === 'cursor') return { url: GATEWAY_URL, headers };
    if (kind === 'opencode') return { type: 'remote', url: GATEWAY_URL, headers, enabled: true };
    return { type: 'http', url: GATEWAY_URL, headers };
}

// null = file absent; { bad } = not plain JSON (comments, trailing commas) so it is never rewritten.
function load(file) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    let data;
    try { data = JSON.parse(text); } catch { return { text, bad: 'not plain JSON (comments or invalid); not rewritten' }; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { text, bad: 'top level is not an object' };
    return { text, data };
}

function mapOf(data, kind) {
    const m = data[mapKey(kind)];
    if (m === undefined) return {};
    return m && typeof m === 'object' && !Array.isArray(m) ? m : null;
}

function writeAtomic(file, data, text, tighten = false) {
    file = fs.realpathSync(file);
    const mode = (fs.statSync(file).mode & 0o777) & (tighten ? 0o700 : 0o777);
    const m = /\n([ \t]+)"/.exec(text);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(tmp, JSON.stringify(data, null, m ? m[1] : 2) + '\n', { mode });
        fs.chmodSync(tmp, mode);
        if (fs.readFileSync(file, 'utf8') !== text) throw new Error('config changed while writing (is the harness running?); nothing overwritten, retry');
        fs.renameSync(tmp, file);
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch { /* never created */ }
        throw e;
    }
}

const migrationPath = (home) => path.join(gatewayDir(home), 'migration.json');
function readMigration(home) {
    try { const j = JSON.parse(fs.readFileSync(migrationPath(home), 'utf8')); return Array.isArray(j.records) ? j.records : []; } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw new Error(`cannot read ${migrationPath(home)}: ${e.code || 'invalid JSON'}`);
    }
}
function writeMigration(home, records) {
    const file = migrationPath(home);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(tmp, JSON.stringify({ version: 1, records }, null, 2) + '\n', { mode: 0o600 });
        fs.renameSync(tmp, file);
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch { /* never created */ }
        throw e;
    }
}

const backupName = (file, now) => `${file}.aos-gateway-bak-${now}`;

function enable({ home, token, shipped, files, now = Date.now(), dryRun = false }) {
    if (!dryRun && !TOKEN_RE.test(String(token))) throw new Error('gateway token is empty or invalid');
    const names = Object.keys(splitServers(shipped).gateway);
    const report = [];
    for (const { file, kind: hint } of files) {
        const kind = classify(file, hint);
        let loaded;
        try { loaded = load(file); } catch (e) { report.push({ file, kind, error: e.code || e.message }); continue; }
        if (!loaded) continue;
        if (!SUPPORTED.has(kind)) { report.push({ file, kind, skipped: 'shape unverified' }); continue; }
        if (loaded.bad) { report.push({ file, kind, skipped: loaded.bad }); continue; }
        const orig = mapOf(loaded.data, kind);
        if (!orig) { report.push({ file, kind, skipped: `"${mapKey(kind)}" is not an object` }); continue; }

        const work = { ...orig };
        const r = { file, kind, removed: [], kept: [] };
        const recs = [];
        const next = entryFor(kind, token);
        const cur = work.aos;
        if (cur !== undefined && !isAosShaped(cur)) {
            r.conflict = 'aos: a user-owned entry named "aos" exists; nothing changed';
            report.push(r);
            continue;
        }
        for (const name of names) {
            const e = work[name];
            if (e === undefined) continue;
            const flat = kind === 'opencode' ? fromOpencode(e) : e;
            // The recorded original and the backup must not carry a secret; such an entry stays direct.
            if (inlineSecrets(flat && flat.env).length) { r.kept.push({ name, reason: 'inline-secret' }); continue; }
            if (isAosOwned(name, flat, shipped[name], shipped)) {
                recs.push({ file, kind, key: name, original: e, at: now });
                delete work[name];
                r.removed.push(name);
            } else r.kept.push({ name, reason: 'user-owned' });
        }
        if (cur === undefined) { work.aos = next; r.added = true; recs.push({ file, kind, key: 'aos', added: true, at: now }); } else if (JSON.stringify(cur) !== JSON.stringify(next)) { work.aos = next; r.updated = true; }
        r.changed = recs.length > 0 || !!r.updated;
        if (r.changed && !dryRun) {
            try {
                r.backup = safeBackup(file, backupName(file, now));
                const before = readMigration(home);
                writeMigration(home, [...before.filter((x) => !recs.some((n) => n.file === x.file && n.key === x.key)), ...recs]);
                try { writeAtomic(file, { ...loaded.data, [mapKey(kind)]: work }, loaded.text, true); } catch (e) {
                    writeMigration(home, before);
                    throw e;
                }
            } catch (e) { r.error = e.code || e.message; }
        }
        report.push(r);
    }
    return report;
}

function disable({ home, files, now = Date.now(), dryRun = false }) {
    const records = readMigration(home);
    const kinds = new Map();
    for (const { file, kind } of files) kinds.set(path.resolve(file), { file, kind: classify(file, kind) });
    for (const rec of records) if (!kinds.has(path.resolve(rec.file))) kinds.set(path.resolve(rec.file), { file: rec.file, kind: rec.kind });
    const report = [];
    const done = new Set();
    for (const { file, kind } of kinds.values()) {
        const mine = records.filter((x) => path.resolve(x.file) === path.resolve(file) && !x.added);
        let loaded;
        try { loaded = load(file); } catch (e) { report.push({ file, kind, error: e.code || e.message }); continue; }
        if (!loaded) { if (mine.length) report.push({ file, kind, skipped: 'file is gone; originals stay in the migration record' }); continue; }
        if (!SUPPORTED.has(kind)) continue;
        if (loaded.bad) { report.push({ file, kind, error: loaded.bad }); continue; }
        const orig = mapOf(loaded.data, kind);
        if (!orig) { report.push({ file, kind, error: `"${mapKey(kind)}" is not an object` }); continue; }

        const work = { ...orig };
        const r = { file, kind, restored: [], conflicts: [] };
        if (work.aos !== undefined) {
            if (isAosShaped(work.aos)) { delete work.aos; r.removedAos = true; } else r.conflicts.push('aos: not AOS-shaped, kept');
        }
        for (const rec of mine) {
            if (work[rec.key] !== undefined) { r.conflicts.push(`${rec.key}: an entry exists now, kept`); continue; }
            work[rec.key] = rec.original;
            r.restored.push(rec.key);
            done.add(rec);
        }
        r.changed = !!r.removedAos || r.restored.length > 0;
        if (r.changed && !dryRun) {
            try {
                r.backup = safeBackup(file, backupName(file, now));
                writeAtomic(file, { ...loaded.data, [mapKey(kind)]: work }, loaded.text);
            } catch (e) { r.error = e.code || e.message; mine.forEach((x) => done.delete(x)); }
        }
        report.push(r);
    }
    if (!dryRun && records.length) {
        try {
            // Added-markers are done once their file was handled without error; unrestored originals stay recorded.
            const errored = new Set(report.filter((r) => r.error).map((r) => path.resolve(r.file)));
            const rest = records.filter((x) => !done.has(x) && (!x.added ? true : errored.has(path.resolve(x.file))));
            if (rest.length) writeMigration(home, rest);
            else fs.renameSync(migrationPath(home), `${migrationPath(home)}.restored-${now}`);
        } catch (e) { report.push({ file: migrationPath(home), error: e.code || e.message }); }
    }
    return report;
}

module.exports = { GATEWAY_URL, SUPPORTED, TOKEN_RE, classify, mapKey, mapOf, load, writeAtomic, isAosShaped, entryFor, migrationPath, readMigration, writeMigration, backupName, enable, disable };
