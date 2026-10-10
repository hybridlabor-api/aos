'use strict';
// Switches harness MCP configs between the direct stdio entries of the shared servers and ONE `aos` entry
// pointing at the local gateway. Every path comes in as an argument; nothing here reads HOME or the environment.
// Kinds, paths, entry shapes and sources live in lib/harnesses.json; SUPPORTED = rows with verified: true.
const fs = require('fs');
const path = require('path');
const { gatewayDir, splitServers } = require('./config');
const { isAosOwned, inlineSecrets, fromOpencode, safeBackup, parseCodexTables, HARNESS_ROWS } = require('../mcp-secrets');

const GATEWAY_URL = 'http://127.0.0.1:7790/mcp';
const TOKEN_RE = /^[0-9a-f]{64}$/;
const ROWS = new Map(HARNESS_ROWS.map((r) => [r.id, r]));
const SUPPORTED = new Set(HARNESS_ROWS.filter((r) => r.verified).map((r) => r.id));

function classify(file, hint) {
    const byHint = HARNESS_ROWS.find((r) => r.hint && r.hint === hint);
    if (byHint) return byHint.id;
    const norm = path.resolve(file).split(path.sep).join('/');
    const row = HARNESS_ROWS.find((r) => r.match.some((m) => norm.endsWith(`/${m}`)));
    return row ? row.id : 'other';
}

const mapKey = (kind) => (ROWS.has(kind) ? ROWS.get(kind).root : 'mcpServers');
const isGatewayUrl = (u) => u === GATEWAY_URL || u.startsWith(`${GATEWAY_URL}?`);
const isAosShaped = (e) => !!e && typeof e === 'object' && [e.url, e.serverUrl].some((u) => typeof u === 'string' && isGatewayUrl(u));

const fill = (v, vars) => (typeof v === 'string' ? v.replace(/URL|TOKEN/g, (m) => vars[m])
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, vars)])) : v);

// preset (optional) = 1mcp preset name; the client then sees only that preset's upstreams (?preset=).
function entryFor(kind, token, preset) {
    const url = preset ? `${GATEWAY_URL}?preset=${encodeURIComponent(preset)}` : GATEWAY_URL;
    const row = ROWS.get(kind);
    return fill(row && row.entry.remote ? row.entry.remote : ROWS.get('claude').entry.remote, { URL: url, TOKEN: token });
}

// Codex config.toml: only the [mcp_servers.aos] table and the AOS-owned tables of the gateway servers are
// rewritten; the rest of the file stays as it is. Comment lines always stay (the installer's AOS:MCP markers).
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tableRe = (name) => new RegExp(`^\\s*\\[mcp_servers\\.(?:${reEsc(name)}|"${reEsc(name)}")(\\.[^\\]]*)?\\]\\s*$`);
function tomlSplit(text, re) {
    const kept = [];
    const hit = [];
    let inHit = false;
    for (const line of text.split('\n')) {
        if (/^\s*\[/.test(line)) inHit = re.test(line);
        (inHit && !/^\s*#/.test(line) ? hit : kept).push(line);
    }
    return { kept: kept.join('\n'), hit: hit.join('\n').trim() };
}
const tomlSplitAos = (text) => { const { kept, hit } = tomlSplit(text, tableRe('aos')); return { kept, aos: hit }; };
const tomlAosShaped = (aos) => { const m = /^\s*url\s*=\s*"([^"]*)"/m.exec(aos); return !!m && isAosShaped({ url: m[1] }); };
const tomlHasGateway = (text) => { const { aos } = tomlSplitAos(String(text)); return !!aos && tomlAosShaped(aos); };
const tomlAosTable = (token) => fill(ROWS.get('codex').entry.toml, { URL: GATEWAY_URL, TOKEN: token });
const readOptional = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };

function enableToml({ home, file, token, names, shipped, now, dryRun }) {
    const text = readOptional(file);
    if (text === null) return null;
    let { kept, aos } = tomlSplitAos(text);
    const r = { file, kind: 'codex', changed: false, removed: [], kept: [] };
    if (aos && !tomlAosShaped(aos)) return { ...r, conflict: 'aos: a user-owned table [mcp_servers.aos] exists; nothing changed' };
    const recs = [];
    for (const name of names) {
        const { kept: rest, hit } = tomlSplit(kept, tableRe(name));
        if (!hit) continue;
        const t = parseCodexTables(hit)[name];
        // Same rule as JSON: only an AOS-owned table without inline secrets moves; the raw text is the recorded original.
        if (!t || t.unparsed.length || inlineSecrets(t.env).length) { r.kept.push({ name, reason: t && inlineSecrets(t.env).length ? 'inline-secret' : 'unparsed' }); continue; }
        if (!isAosOwned(name, { command: t.fields.command, args: t.fields.args }, shipped[name], shipped)) { r.kept.push({ name, reason: 'user-owned' }); continue; }
        recs.push({ file, kind: 'codex', key: name, original: hit, at: now });
        r.removed.push(name);
        kept = rest;
    }
    const want = tomlAosTable(token);
    if (aos !== want) { r[aos ? 'updated' : 'added'] = true; if (!aos) recs.push({ file, kind: 'codex', key: 'aos', added: true, at: now }); }
    r.changed = recs.length > 0 || !!r.updated;
    if (r.changed && !dryRun) {
        r.backup = safeBackup(file, backupName(file, now));
        const before = readMigration(home);
        writeMigration(home, [...before.filter((x) => !recs.some((n) => n.file === x.file && n.key === x.key)), ...recs]);
        try { writeAtomic(file, (kept.trim() ? `${kept.trimEnd()}\n\n` : '') + want + '\n', text, true); } catch (e) {
            writeMigration(home, before);
            throw e;
        }
    }
    return r;
}

// mine = this file's recorded originals (raw tables); each restored one is added to done.
function disableToml({ file, mine, done, now, dryRun }) {
    const text = readOptional(file);
    if (text === null) return mine.length ? { file, kind: 'codex', skipped: 'file is gone; originals stay in the migration record' } : null;
    let { kept, aos } = tomlSplitAos(text);
    const r = { file, kind: 'codex', restored: [], conflicts: [] };
    if (aos) { if (tomlAosShaped(aos)) r.removedAos = true; else { r.conflicts.push('aos: not AOS-shaped, kept'); kept = text; } }
    const restored = [];
    for (const rec of mine) {
        if (tomlSplit(kept, tableRe(rec.key)).hit) { r.conflicts.push(`${rec.key}: a table exists now, kept`); continue; }
        kept = `${kept.trimEnd()}\n\n${rec.original}`;
        r.restored.push(rec.key);
        restored.push(rec);
    }
    r.changed = !!r.removedAos || r.restored.length > 0;
    if (!r.changed) return r.conflicts.length ? r : null;
    if (!dryRun) {
        r.backup = safeBackup(file, backupName(file, now));
        writeAtomic(file, kept.trim() ? `${kept.trimEnd()}\n` : '', text, true);
    }
    restored.forEach((x) => done.add(x));
    return r;
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
        fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, m ? m[1] : 2) + '\n', { mode });
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

// presets = template "presets"; a kind with an entry there gets ?preset=<kind>.
function enable({ home, token, shipped, files, presets = {}, now = Date.now(), dryRun = false }) {
    if (!dryRun && !TOKEN_RE.test(String(token))) throw new Error('gateway token is empty or invalid');
    const names = Object.keys(splitServers(shipped).gateway);
    const report = [];
    for (const { file, kind: hint } of files) {
        const kind = classify(file, hint);
        if (kind === 'codex') {
            try { const r = enableToml({ home, file, token, names, shipped, now, dryRun }); if (r) report.push(r); } catch (e) { report.push({ file, kind, error: e.code || e.message }); }
            continue;
        }
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
        const next = entryFor(kind, token, presets[kind] !== undefined ? kind : undefined);
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
        if (kind === 'codex') {
            try { const r = disableToml({ file, mine, done, now, dryRun }); if (r) report.push(r); } catch (e) { report.push({ file, kind, error: e.code || e.message }); }
            continue;
        }
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
    if (!dryRun && done.size) {
        // Restored originals run direct again, so the gateway must stop spawning them (adopted.json).
        const adoptedFile = path.join(gatewayDir(home), 'adopted.json');
        try {
            const cur = JSON.parse(fs.readFileSync(adoptedFile, 'utf8'));
            const keys = [...done].map((x) => x.key).filter((k) => cur && cur.servers && Object.prototype.hasOwnProperty.call(cur.servers, k));
            if (keys.length) {
                for (const k of keys) delete cur.servers[k];
                const tmp = `${adoptedFile}.${process.pid}.tmp`;
                fs.writeFileSync(tmp, JSON.stringify(cur, null, 2) + '\n', { mode: 0o600 });
                fs.renameSync(tmp, adoptedFile);
            }
        } catch (e) { if (e.code !== 'ENOENT') report.push({ file: adoptedFile, error: e.code || e.message }); }
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

module.exports = { GATEWAY_URL, SUPPORTED, TOKEN_RE, classify, mapKey, mapOf, load, writeAtomic, isAosShaped, tomlHasGateway, entryFor, migrationPath, readMigration, writeMigration, backupName, enable, disable };
