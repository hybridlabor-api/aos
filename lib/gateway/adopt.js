'use strict';
// `aos-gateway adopt`: moves the user's OTHER local stdio MCP servers (not on the shipped allow list)
// behind the 1mcp gateway. Entries are removed from the harness files and recorded in adopted.json
// (mode 0600) so harness.disable can restore them via the existing migration records.
// Every path comes in as an argument; nothing here reads HOME or the environment.
const fs = require('fs');
const path = require('path');
const { gatewayDir, GATEWAY_SERVERS, DIRECT_SERVERS } = require('./config');
const harness = require('./harness');
const { inlineSecrets, fromOpencode, isLauncherEntry, safeBackup, parseCodexTables } = require('../mcp-secrets');

const NAME_RE = /^[A-Za-z0-9_-]+$/;
const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
// Secrets are never copied into adopted.json, migration.json, mcp.json or backups: env (any secret-looking name with a
// literal or unresolvable reference value) and argument/URL forms (--api-key=..., Bearer ..., user:pass@host, ?token=...).
const SECRET_ENV_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|API_?KEY|ACCESS_?KEY|AUTH)/i;
const SECRET_ARG = [/(api[-_]?key|token|secret|passw(or)?d|bearer|authorization|credential)\s*[=:]\s*\S/i, /:\/\/[^/\s:@]+:[^/\s@]+@/, /[?&](token|key|api_?key|access_token|secret)=/i, /^--?(api-?key|token|secret|password)$/i, /^bearer\s+\S/i];
// Positional tokens: well-known key prefixes, and long mixed-case alphanumeric values (no path separators, dots or @).
const TOKEN_PREFIX = /^(sk-|sk_|ghp_|gho_|ghs_|github_pat_|xox[abprs]-|AKIA[0-9A-Z]{8}|AIza[0-9A-Za-z_-]{10}|glpat-|npm_[A-Za-z0-9]{10})/;
const looksLikeTokenArg = (a) => TOKEN_PREFIX.test(a) || (a.length >= 32 && /^[A-Za-z0-9_+=-]+$/.test(a) && /[a-z]/.test(a) && /[A-Z]/.test(a) && /[0-9]/.test(a));
const argSecret = (args) => (Array.isArray(args) ? args : []).some((a) => typeof a === 'string' && (SECRET_ARG.some((re) => re.test(a)) || looksLikeTokenArg(a)));
const envSecret = (env) => Object.entries(env && typeof env === 'object' && !Array.isArray(env) ? env : {})
    .some(([k, v]) => typeof v === 'string' && v !== '' && (SECRET_ENV_NAME.test(k) || /:\/\/[^/\s:@]+:[^/\s@]+@/.test(v)));

// Canonical form used for deep-equality between harness files and adopted.json entries.
const keyOf = (e) => JSON.stringify({
    command: e.command,
    args: [...(Array.isArray(e.args) ? e.args : [])],
    env: Object.fromEntries(Object.entries(e.env && typeof e.env === 'object' && !Array.isArray(e.env) ? e.env : {}).sort(([a], [b]) => (a < b ? -1 : 1))),
    ...(typeof e.cwd === 'string' && e.cwd ? { cwd: e.cwd } : {}),
});

const entryOf = (e) => ({
    command: e.command,
    args: Array.isArray(e.args) ? [...e.args] : [],
    env: { ...(e.env && typeof e.env === 'object' && !Array.isArray(e.env) ? e.env : {}) },
    ...(typeof e.cwd === 'string' && e.cwd ? { cwd: e.cwd } : {}),
});

// Eligibility of one harness entry (name N, normalized entry E) per the shared contract.
// `raw` is the entry as written in the harness file (OpenCode's command-array form drops type/enabled when normalized).
function reasonToSkip(name, E, shippedNames, raw = E) {
    const R = raw && typeof raw === 'object' ? raw : {};
    if (R.url !== undefined || (E && E.url !== undefined) || ['http', 'sse', 'remote', 'streamable-http'].includes(R.type)) return 'remote entry';
    if (!E || typeof E !== 'object' || typeof E.command !== 'string' || !E.command) return 'not a stdio command';
    if (R.disabled === true || R.enabled === false) return 'disabled';
    if (name === 'aos') return 'aos gateway entry';
    if (GATEWAY_SERVERS.includes(name) || DIRECT_SERVERS.includes(name) || shippedNames.has(name)) return 'handled by AOS install';
    if (!NAME_RE.test(name) || name.length > 26 || RESERVED_NAMES.has(name)) return 'invalid server name';
    if (inlineSecrets(E.env).length || envSecret(E.env)) return 'inline-secret';
    if (argSecret(E.args)) return 'inline-secret in arguments';
    if (isLauncherEntry(E)) return 'already managed';
    return null;
}

// Server entries of one supported harness file: [{ name, project?, raw, E, unparsed }]. Codex TOML tables are read
// with the TOML reader; Claude's per-project mcpServers blocks are listed with their project. { reason } = not readable.
function harnessEntries(file, kind) {
    if (kind === 'codex') {
        const text = harness.readOptional(file);
        if (text === null) return { reason: 'shape unverified' };
        return { entries: Object.entries(parseCodexTables(text)).map(([name, t]) => ({
            name,
            raw: t.fields,
            E: { command: t.fields.command, args: t.fields.args, env: t.env, ...(typeof t.fields.cwd === 'string' ? { cwd: t.fields.cwd } : {}) },
            unparsed: t.unparsed.length > 0 || (t.fields.args !== undefined && !Array.isArray(t.fields.args)),
        })) };
    }
    const loaded = harness.load(file);
    if (!loaded || loaded.bad || !harness.SUPPORTED.has(kind)) return { reason: loaded && loaded.bad ? loaded.bad : 'shape unverified' };
    const map = harness.mapOf(loaded.data, kind);
    if (!map) return { reason: `"${harness.mapKey(kind)}" is not an object` };
    const entries = Object.entries(map).map(([name, raw]) => ({ name, raw, E: kind === 'opencode' ? fromOpencode(raw) : raw }));
    const projects = kind === 'claude' && loaded.data.projects && typeof loaded.data.projects === 'object' && !Array.isArray(loaded.data.projects) ? loaded.data.projects : {};
    for (const [project, p] of Object.entries(projects)) {
        const pm = projectServers(loaded.data, project);
        if (pm) for (const [name, raw] of Object.entries(pm)) entries.push({ name, project, raw, E: raw });
    }
    return { entries };
}

// Pure read: returns { adoptable, skipped } for the SUPPORTED harness kinds only.
function scanAdoptable({ files, shipped }) {
    const shippedNames = new Set(Object.keys(shipped || {}));
    const skipped = [];
    const byName = new Map(); // name -> [{ file, kind, E, project? }]
    for (const { file, kind: hint } of files) {
        const kind = harness.classify(file, hint);
        let found;
        try { found = harnessEntries(file, kind); } catch (e) { skipped.push({ file, kind, name: null, reason: e.code || e.message }); continue; }
        if (found.reason) { skipped.push({ file, kind, name: null, reason: found.reason }); continue; }
        for (const { name, project, raw, E, unparsed } of found.entries) {
            const reason = unparsed ? 'unparsed TOML table' : reasonToSkip(name, E, shippedNames, raw);
            if (reason) { skipped.push({ file, kind, name, reason, ...(project === undefined ? {} : { project }) }); continue; }
            const list = byName.get(name) || [];
            list.push({ file, kind, E, project });
            byName.set(name, list);
        }
    }
    const adoptable = [];
    for (const [name, list] of byName) {
        const first = keyOf(list[0].E);
        if (!list.every((x) => keyOf(x.E) === first)) {
            for (const x of list) skipped.push({ file: x.file, kind: x.kind, name, reason: 'conflicting definitions' });
            continue;
        }
        adoptable.push({ name, entry: entryOf(list[0].E), sources: list.map((x) => ({ file: x.file, kind: x.kind, project: x.project })) });
    }
    return { adoptable, skipped };
}

const adoptedPath = (home) => path.join(gatewayDir(home), 'adopted.json');
const projectServers = (data, proj) => {
    const m = data.projects && data.projects[proj] && data.projects[proj].mcpServers;
    return m && typeof m === 'object' && !Array.isArray(m) ? m : null;
};

// Same atomic-write pattern as harness.writeMigration: tmp + rename, mode 0600.
function writeAdopted(home, servers) {
    const file = adoptedPath(home);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(tmp, JSON.stringify({ version: 1, servers }, null, 2) + '\n', { mode: 0o600 });
        fs.renameSync(tmp, file);
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch { /* never created */ }
        throw e;
    }
}

// Codex config.toml: same safety sequence as the JSON files (backup, migration record first, atomic write, record rolled back on failure).
function adoptTomlFile({ home, file, token, names, now }) {
    const r = { file, kind: 'codex', removed: [], kept: [] };
    let text;
    try { text = harness.readOptional(file); } catch (e) { r.error = e.code || e.message; return r; }
    if (text === null) { r.error = 'file is gone'; return r; }
    const next = harness.tomlAdopt(text, names.map((x) => x.name), token);
    if (!next) { r.conflict = 'aos: a user-owned table [mcp_servers.aos] exists; nothing changed'; return r; }
    r.removed = next.removed.map((x) => x.name);
    const recs = next.removed.map((x) => ({ file, kind: 'codex', key: x.name, original: x.original, at: now }));
    if (next.aosAdded) recs.push({ file, kind: 'codex', key: 'aos', added: true, at: now });
    r.changed = recs.length > 0;
    if (!r.changed) return r;
    try {
        r.backup = safeBackup(file, harness.backupName(file, now));
        const before = harness.readMigration(home);
        harness.writeMigration(home, [...before.filter((x) => !recs.some((n) => harness.sameSlot(n, x))), ...recs]);
        try { harness.writeAtomic(file, next.text, text, true); } catch (e) {
            harness.writeMigration(home, before);
            throw e;
        }
    } catch (e) { r.error = e.code || e.message; }
    return r;
}

function applyAdopt({ home, token, files, shipped, now = Date.now(), dryRun = false, only }) {
    const scan = scanAdoptable({ files, shipped });
    if (only) scan.adoptable = scan.adoptable.filter((a) => only.includes(a.name));
    const skipped = scan.skipped.slice();
    const out = { adopted: [], files: [], skipped };
    if (dryRun) {
        return { ...out, adoptable: scan.adoptable, dryRun: true };
    }
    if (!harness.TOKEN_RE.test(String(token))) throw new Error('gateway token is empty or invalid');

    // Phase 1: every source file of a name must be rewritable before anything is written. A name with an unreadable,
    // unsupported or aos-conflicting source is skipped as a whole, so no harness keeps launching a server that the
    // gateway also runs (an IO error in phase 2 heals on the next run: identical definitions are retried).
    const kindOf = new Map(files.map((f) => [path.resolve(f.file), f.kind]));
    const readiness = new Map();
    const unreadyReason = (abs) => {
        if (readiness.has(abs)) return readiness.get(abs);
        let why = null;
        try {
            const kind = harness.classify(abs, kindOf.get(abs));
            const loaded = kind === 'codex' ? null : harness.load(abs);
            if (kind === 'codex') {
                const text = harness.readOptional(abs);
                why = text === null ? 'not rewritable' : (harness.tomlAdopt(text, [], token) ? null : 'a user-owned "aos" entry exists');
            } else if (!loaded || loaded.bad || !harness.SUPPORTED.has(kind)) why = loaded && loaded.bad ? loaded.bad : 'not rewritable';
            else {
                const map = harness.mapOf(loaded.data, kind);
                if (!map) why = `"${harness.mapKey(kind)}" is not an object`;
                else if (map.aos !== undefined && !harness.isAosShaped(map.aos)) why = 'a user-owned "aos" entry exists';
            }
        } catch (e) { why = e.code || e.message; }
        readiness.set(abs, why);
        return why;
    };
    scan.adoptable = scan.adoptable.filter((a) => {
        const bad = a.sources.map((s) => ({ s, why: unreadyReason(path.resolve(s.file)) })).find((x) => x.why);
        if (!bad) return true;
        skipped.push({ file: bad.s.file, kind: bad.s.kind, name: a.name, reason: `a source file cannot be rewritten (${bad.why}); nothing adopted for this server` });
        return false;
    });

    // Merge into adopted.json: existing entries of other names are kept; a same name with a different
    // definition is never overwritten.
    const existing = harness.load(adoptedPath(home));
    if (existing && existing.bad) throw new Error(`${adoptedPath(home)} is not valid JSON; fix or move it first (nothing was changed)`);
    const servers = existing && existing.data && existing.data.servers && typeof existing.data.servers === 'object' && !Array.isArray(existing.data.servers) ? { ...existing.data.servers } : {};
    const newly = [];
    const retry = []; // already in adopted.json with the same definition but still present in a harness file (an earlier write failed)
    for (const a of scan.adoptable) {
        const cur = servers[a.name];
        if (cur !== undefined) {
            if (keyOf(cur) !== keyOf(a.entry)) skipped.push({ file: adoptedPath(home), kind: 'adopted', name: a.name, reason: 'already adopted with a different definition' });
            else retry.push(a.name);
            continue;
        }
        servers[a.name] = { ...a.entry, from: a.sources.map((s) => path.resolve(s.file)), at: now };
        newly.push(a.name);
    }
    if (newly.length) writeAdopted(home, servers);
    out.adopted = newly;

    // Remove the adopted entries from their harness files, same safety sequence as harness.enable.
    const wanted = new Map(); // file -> [{ name, project? }] to remove there
    for (const a of scan.adoptable) if (newly.includes(a.name) || retry.includes(a.name)) for (const s of a.sources) {
        const list = wanted.get(path.resolve(s.file)) || [];
        list.push({ name: a.name, project: s.project });
        wanted.set(path.resolve(s.file), list);
    }
    if (newly.length || retry.length) {
        const allRecs = []; // shared rollback already in migration.json via per-file writes below
        for (const { file, kind: hint } of files) {
            if (!wanted.has(path.resolve(file))) continue;
            const kind = harness.classify(file, hint);
            if (kind === 'codex') { out.files.push(adoptTomlFile({ home, file, token, names: wanted.get(path.resolve(file)), now })); continue; }
            const r = { file, kind, removed: [], kept: [] };
            let loaded;
            try { loaded = harness.load(file); } catch (e) { r.error = e.code || e.message; out.files.push(r); continue; }
            if (!loaded || loaded.bad) { r.error = loaded && loaded.bad ? loaded.bad : 'file is gone'; out.files.push(r); continue; }
            const map = harness.mapOf(loaded.data, kind);
            if (!map) { r.error = `"${harness.mapKey(kind)}" is not an object`; out.files.push(r); continue; }
            if (!harness.SUPPORTED.has(kind)) { r.error = 'shape unverified'; out.files.push(r); continue; }

            const work = { ...map };
            const recs = [];
            for (const { name, project } of wanted.get(path.resolve(file))) {
                const target = project === undefined ? work : projectServers(loaded.data, project);
                if (!target || target[name] === undefined) continue;
                recs.push({ file, kind, key: name, original: target[name], at: now, ...(project === undefined ? {} : { project }) });
                delete target[name];
                r.removed.push(project === undefined ? name : `${name} (project ${project})`);
            }
            if (work.aos === undefined) { work.aos = harness.entryFor(kind, token); r.added = true; recs.push({ file, kind, key: 'aos', added: true, at: now }); } else if (!harness.isAosShaped(work.aos)) {
                r.conflict = 'aos: a user-owned entry named "aos" exists; nothing changed';
                r.removed = [];
                out.files.push(r);
                continue;
            }
            r.changed = recs.length > 0;
            allRecs.push(...recs);
            if (r.changed) {
                try {
                    r.backup = safeBackup(file, harness.backupName(file, now));
                    const before = harness.readMigration(home);
                    const dedup = [...before.filter((x) => !recs.some((n) => harness.sameSlot(n, x))), ...recs];
                    harness.writeMigration(home, dedup);
                    try { harness.writeAtomic(file, { ...loaded.data, [harness.mapKey(kind)]: work }, loaded.text, true); } catch (e) {
                        harness.writeMigration(home, before);
                        throw e;
                    }
                } catch (e) { r.error = e.code || e.message; }
            }
            out.files.push(r);
        }
        // Undo the adopted.json addition of newly added names for which no source file was rewritten (every file
        // failed, conflicted or was unreadable): the entry is then still in place in the harness files.
        const ok = new Set(out.files.filter((f) => !f.error && !f.conflict).map((f) => path.resolve(f.file)));
        const stillBad = newly.filter((n) => scan.adoptable.find((a) => a.name === n).sources.every((s) => !ok.has(path.resolve(s.file))));
        if (stillBad.length) {
            const cur = harness.load(adoptedPath(home));
            const keep = {};
            const base = cur && cur.data && cur.data.servers && typeof cur.data.servers === 'object' ? cur.data.servers : {};
            for (const [n, v] of Object.entries(base)) if (!stillBad.includes(n)) keep[n] = v;
            writeAdopted(home, keep);
            out.adopted = out.adopted.filter((n) => !stillBad.includes(n));
        }
    }
    return out;
}

module.exports = { scanAdoptable, applyAdopt, adoptedPath, reasonToSkip };
