'use strict';
// Migration on install/update: ensures memory (memb_mcp, deja) stays DIRECT per session in every harness.
//
// Order matters: every verified harness file is written (or confirmed) first. The gateway copy of
// memb_mcp/deja is removed only when every target confirmed its direct entry, so memory is never in
// zero places. A file that cannot be parsed or written keeps the gateway copy and is reported.
//
// Only verified rows of lib/harnesses.json are written, under the row's own root key. Unverified rows,
// project-level files of the current directory and unknown recorded files are never touched.

const fs = require('fs');
const path = require('path');
const { gatewayDir, defaultMcpsDir } = require('./config');
const mcpSecrets = require('../mcp-secrets');
const { safeBackup, parseCodexTables, HARNESS_ROWS, resolveHarnessPath, harnessMcpFiles } = mcpSecrets;
const { writeAtomic, load, readMigration, writeMigration } = require('./harness');
const { withLock } = require('./lock');
const { parseJsonc } = require('../jsonc');
const profile = require('../v5/profile');
const { recordMemoryDirect } = require('../uninstall-records');

const MEMORY = ['memb_mcp', 'deja'];
const memDirectBackupName = (file, now) => `${file}.aos-memdirect-bak-${now}`;
const realKey = (file) => { try { return fs.realpathSync(file); } catch { return path.resolve(file); } };
const sayTo = (log) => (typeof log === 'function' ? log : (m) => (log && log.info ? log.info(m) : null));
const slash = (p) => p.split('\\').join('/');
const argsEq = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);
// Windows: cmd.exe would split or expand a path with these characters (or a space), so the deja entry is not written.
const CMD_UNSAFE = /[\s&|<>^%!"()]/;

// First executable named `name` on PATH (the env given to the harness). Null when absent.
function findOnPath(name, env, platform) {
    const exts = platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
    for (const dir of String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
        for (const ext of exts) {
            const p = path.join(dir, name + ext);
            try {
                if (!fs.statSync(p).isFile()) continue;
                if (platform !== 'win32') fs.accessSync(p, fs.constants.X_OK);
                return p;
            } catch { /* next candidate */ }
        }
    }
    return null;
}

// Absolute commands only: a GUI-launched harness (launchd, desktop PATH) does not find bare `node` or `deja`.
function directEntries({ home, aosRoot, nodePath, env, platform, dejaPath }) {
    const direct = {};
    const unavailable = [];
    const launcher = path.join(aosRoot || path.join(home, '.agents'), 'bin', 'aos-mcp-env.mjs');
    const mcpsDir = defaultMcpsDir(home);
    const pyBin = platform === 'win32'
        ? path.join(mcpsDir, 'memb-mcp', '.venv', 'Scripts', 'python.exe')
        : path.join(mcpsDir, 'memb-mcp', '.venv', 'bin', 'python');
    const runPy = path.join(mcpsDir, 'memb-mcp', 'run.py');
    if (fs.existsSync(launcher) && fs.existsSync(pyBin) && fs.existsSync(runPy)) {
        direct.memb_mcp = { command: nodePath, args: [slash(launcher), '--vars', 'GEMINI_API_KEY', '--memb-llm', '--', slash(pyBin), slash(runPy)] };
    } else {
        unavailable.push(`memb_mcp (${slash(pyBin)} or ${slash(runPy)} is missing)`);
    }
    const deja = dejaPath || findOnPath('deja', env, platform);
    if (deja && platform === 'win32' && CMD_UNSAFE.test(deja)) unavailable.push(`deja (${deja} has spaces or cmd.exe metacharacters)`);
    else if (deja) direct.deja = platform === 'win32' ? { command: 'cmd', args: ['/c', deja, 'mcp'] } : { command: deja, args: ['mcp'] };
    else unavailable.push('deja (not found on PATH)');
    return { direct, unavailable };
}

// Verified rows only, keyed by real path. Workspace paths resolve against HOME, the same as the global ones.
function verifiedRows(home, env, platform) {
    const map = new Map();
    for (const row of HARNESS_ROWS) {
        if (row.verified !== true) continue;
        for (const scope of ['global', 'workspace']) {
            for (const p of (row.mcp && row.mcp[scope]) || []) {
                const f = resolveHarnessPath(p, { home, env, platform, cwd: home });
                if (f && !map.has(realKey(f))) map.set(realKey(f), row);
            }
        }
    }
    return map;
}

// TOML: true when the Codex config already defines [mcp_servers.<name>] (or a sub-table) or a dotted/inline
// key for it inside [mcp_servers] or at the top level. Other tables are ignored.
function codexHas(text, name) {
    let inMcp = false;
    for (const raw of String(text).split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const header = /^\[\[?\s*([^\]]*?)\s*\]/.exec(line);
        if (header) {
            const key = header[1].replace(/\s+/g, '').replace(/"/g, '');
            if (key === `mcp_servers.${name}` || key.startsWith(`mcp_servers.${name}.`)) return true;
            inMcp = key === 'mcp_servers';
            continue;
        }
        if (inMcp && new RegExp(`^"?${name}"?\\s*[.=]`).test(line)) return true;
        if (!inMcp && new RegExp(`^mcp_servers\\s*\\.\\s*"?${name}"?\\s*[.=]`).test(line)) return true;
    }
    return false;
}

// A top-level `mcp_servers = { ... }` inline table: appending [mcp_servers.x] tables after it would be invalid TOML.
function codexTopLevelInline(text) {
    let inTable = false;
    for (const raw of String(text).split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        if (/^\[/.test(line)) { inTable = true; continue; }
        if (!inTable && /^mcp_servers\s*=/.test(line)) return true;
    }
    return false;
}

// Confirmed = the existing entry runs the very command AOS would write (a stale path or an opencode enabled:false
// entry is not memory in that harness; the gateway copy must stay).
const jsonEntryOk = (e, d) => !!e && typeof e === 'object' && e.command === d.command && argsEq(e.args, d.args);
const opencodeEntryOk = (e, d) => !!e && typeof e === 'object' && e.enabled !== false && Array.isArray(e.command)
    && e.command[0] === d.command && argsEq(e.command.slice(1), d.args);
const tomlEntryOk = (raw, n, d) => {
    const t = parseCodexTables(raw)[n];
    return !!t && !!t.fields && t.fields.command === d.command && argsEq(t.fields.args, d.args) && !t.unparsed.length;
};

const tomlBlock = (name, d) => `[mcp_servers.${name}]\ncommand = ${JSON.stringify(d.command)}\nargs = [${d.args.map((a) => JSON.stringify(a)).join(', ')}]\n\n`;

// Each register* returns { added, backup } or throws. `added` is empty when the file already had every entry.
function registerJson({ file, row, direct, names, dryRun, now }) {
    const loaded = load(file);
    if (!loaded) return { added: [] };
    if (loaded.bad) throw new Error(loaded.bad);
    const root = row.root || 'mcpServers';
    const bucket = loaded.data[root] === undefined ? {} : loaded.data[root];
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) throw new Error(`"${root}" is not an object`);
    const missing = names.filter((n) => !bucket[n]);
    const stale = names.filter((n) => bucket[n] && !jsonEntryOk(bucket[n], direct[n]));
    if (!missing.length || dryRun) return { added: missing, stale };
    const backup = safeBackup(file, memDirectBackupName(file, now));
    for (const n of missing) bucket[n] = direct[n];
    loaded.data[root] = bucket;
    writeAtomic(file, loaded.data, loaded.text);
    return { added: missing, stale, backup };
}

function registerOpencode({ file, row, direct, names, dryRun, now }) {
    const loaded = load(file);
    if (!loaded) return { added: [] };
    if (loaded.bad) {
        // Comments are not rewritten (a plain rewrite would drop them); refuse visibly unless the entries are already there.
        const lenient = parseJsonc(loaded.text);
        if (!lenient || typeof lenient !== 'object' || Array.isArray(lenient)) throw new Error(loaded.bad);
        const missing = names.filter((n) => !(lenient.mcp && lenient.mcp[n]));
        const stale = names.filter((n) => lenient.mcp && lenient.mcp[n] && !opencodeEntryOk(lenient.mcp[n], direct[n]));
        if (!missing.length) return { added: [], stale };
        throw new Error('JSONC with comments is not rewritten; add memb_mcp and deja by hand or remove the comments');
    }
    const root = row.root || 'mcp';
    const bucket = loaded.data[root] === undefined ? {} : loaded.data[root];
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) throw new Error(`"${root}" is not an object`);
    const missing = names.filter((n) => !bucket[n]);
    const stale = names.filter((n) => bucket[n] && !opencodeEntryOk(bucket[n], direct[n]));
    if (!missing.length || dryRun) return { added: missing, stale };
    const backup = safeBackup(file, memDirectBackupName(file, now));
    for (const n of missing) bucket[n] = { type: 'local', command: [direct[n].command, ...direct[n].args], enabled: true };
    loaded.data[root] = bucket;
    writeAtomic(file, loaded.data, loaded.text);
    return { added: missing, stale, backup };
}

function registerToml({ file, direct, names, dryRun, now }) {
    const raw = fs.readFileSync(file, 'utf8');
    if (codexTopLevelInline(raw)) throw new Error('config.toml has a top-level inline mcp_servers table; add memb_mcp and deja by hand (config.toml not changed)');
    const missing = names.filter((n) => !codexHas(raw, n));
    const stale = names.filter((n) => !missing.includes(n) && !tomlEntryOk(raw, n, direct[n]));
    if (!missing.length || dryRun) return { added: missing, stale };
    const append = missing.map((n) => tomlBlock(n, direct[n])).join('');
    const blockMatch = /(# AOS:MCP:START[\s\S]*?)(# AOS:MCP:END)/;
    const next = blockMatch.test(raw)
        ? raw.replace(blockMatch, (m, p1, p2) => `${p1}${append}${p2}`)
        : `${raw.trimEnd()}\n\n${append}`;
    // Validate before anything is renamed: exactly one table per added server, with the expected command.
    for (const n of missing) {
        const headers = (next.match(new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*"?${n}"?\\s*\\]`, 'gm')) || []).length;
        const parsed = parseCodexTables(next)[n];
        if (headers !== 1 || !parsed || !parsed.fields || parsed.fields.command !== direct[n].command) {
            throw new Error(`generated TOML for ${n} does not validate; config.toml was not changed`);
        }
    }
    const backup = safeBackup(file, memDirectBackupName(file, now));
    // Write through the symlink target and keep its mode (0600 for config holding tokens).
    const real = fs.realpathSync(file);
    if (fs.readFileSync(real, 'utf8') !== raw) throw new Error('config changed while writing (is the harness running?); retry');
    const mode = fs.statSync(real).mode & 0o777;
    const tmp = `${real}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(tmp, next, { mode });
        fs.chmodSync(tmp, mode);
        fs.renameSync(tmp, real);
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch { /* never created */ }
        throw e;
    }
    return { added: missing, stale, backup };
}

function registerFile({ file, row, direct, names, dryRun, now }) {
    if (row.hint === 'toml') return registerToml({ file, direct, names, dryRun, now });
    if (row.hint === 'opencode') return registerOpencode({ file, row, direct, names, dryRun, now });
    return registerJson({ file, row, direct, names, dryRun, now });
}

// Removes the gateway copy of the given server names: mcp.json (with backup), the gateway server selection, migration records.
function stripGateway({ home, now, dryRun, say, report, names }) {
    const mcpFile = path.join(gatewayDir(home), 'mcp.json');
    if (fs.existsSync(mcpFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(mcpFile, 'utf8'));
            const hit = data && data.mcpServers ? names.filter((n) => data.mcpServers[n] !== undefined) : [];
            if (hit.length) {
                if (!dryRun) {
                    // Through the symlink target, as the harness files do: a rename over a link would replace the link.
                    const real = realKey(mcpFile);
                    safeBackup(real, memDirectBackupName(real, now));
                    for (const n of hit) delete data.mcpServers[n];
                    const tmp = `${real}.${process.pid}.tmp`;
                    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
                    fs.renameSync(tmp, real);
                }
                report.gatewayCleaned = true;
                say(`gateway mcp.json: removed ${hit.join(' and ')} (memory stays direct)`);
            }
        } catch (e) {
            say(`could not migrate gateway mcp.json: ${e.message}`);
        }
    }
    try {
        const st = profile.readSettings(home, () => {});
        if (st && st.gateway && Array.isArray(st.gateway.servers)) {
            const next = st.gateway.servers.filter((n) => !names.includes(n));
            if (next.length !== st.gateway.servers.length && !dryRun) profile.writeSettings(home, { ...st, gateway: { ...st.gateway, servers: next } });
        }
    } catch (e) { say(`could not clean the gateway server selection: ${e.message}`); }
    try {
        const records = readMigration(home);
        const kept = records.filter((r) => !names.includes(r.key));
        if (kept.length !== records.length) {
            report.recordsCleaned = records.length - kept.length;
            if (!dryRun) writeMigration(home, kept);
        }
    } catch (e) { say(`could not clean the migration records: ${e.message}`); }
}

// Serialised with enable/disable/adopt (same gateway dir lock). A lock that cannot be taken changes nothing and keeps
// the gateway copy; install/update continue.
function migrateMemoryDirect(opts = {}) {
    const { home, dryRun = false, log = () => {} } = opts;
    if (dryRun) return migrateUnlocked(opts);
    try {
        return withLock(gatewayDir(home), () => migrateUnlocked(opts));
    } catch (e) {
        const say = sayTo(log);
        say(`memory direct: ${e.message}; nothing changed, gateway copy kept`);
        return { gatewayCleaned: false, harnesses: [], skipped: [], failed: [{ file: gatewayDir(home), error: e.message }], recordsCleaned: 0 };
    }
}

function migrateUnlocked({ home, aosRoot, now = Date.now(), log = () => {}, dryRun = false, harnesses = true, env = process.env, platform = process.platform, nodePath = process.execPath, dejaPath } = {}) {
    const say = sayTo(log);
    const report = { gatewayCleaned: false, harnesses: [], skipped: [], failed: [], stale: [], recordsCleaned: 0 };

    // Opt-out (unified memory off): memory is not wanted anywhere, so the gateway copy goes too.
    const st = profile.readSettings(home, () => {});
    const excluded = profile.excludedIds(st).has('memb');
    let direct = {};
    if (excluded) {
        say('unified memory is excluded/disabled; skipping direct harness registration');
    } else {
        const r = directEntries({ home, aosRoot, nodePath, env, platform, dejaPath });
        direct = r.direct;
        for (const u of r.unavailable) say(`memory direct: ${u}; not registered, gateway copy kept`);
    }
    const names = excluded ? MEMORY : Object.keys(direct);

    // 1. Harness pass first. `confirmed` stays false if any target could not take its entry.
    let confirmed = true;
    if (!excluded) {
        if (!harnesses) {
            confirmed = false;
            say('harness registration is off; gateway copy kept so memory stays reachable');
        } else {
            const rows = verifiedRows(home, env, platform);
            for (const { file } of harnessMcpFiles(home, env, platform, home)) {
                const row = rows.get(realKey(file));
                if (!row) {
                    report.skipped.push(file);
                    say(`harness ${file}: not a verified harness file; left untouched`);
                    continue;
                }
                if (!fs.existsSync(file) || !names.length) continue;
                try {
                    const r = registerFile({ file, row, direct, names, dryRun, now });
                    // An entry that is there but runs another command (stale path, disabled opencode entry) is not
                    // memory in this harness: the gateway copy stays and the user is told.
                    if (r.stale && r.stale.length) {
                        confirmed = false;
                        report.stale.push({ file, names: r.stale });
                        say(`harness ${file}: ${r.stale.join(' and ')} already defined with another command; left as is, gateway copy kept`);
                    }
                    if (r.added.length) report.harnesses.push({ file, kind: row.hint || 'json', backup: r.backup, added: r.added });
                    // Uninstall removes exactly these entries (uninstall-records reverseMemoryDirect).
                    if (!dryRun && r.added.length) {
                        const root = row.hint === 'toml' ? 'mcp_servers' : (row.root || (row.hint === 'opencode' ? 'mcp' : 'mcpServers'));
                        try {
                            recordMemoryDirect(home, { file, kind: row.hint || 'json', root, entries: Object.fromEntries(r.added.map((n) => [n, { command: direct[n].command }])) });
                        } catch (e) {
                            // Written but not recorded would leave an entry uninstall cannot find: put the backup back.
                            if (r.backup) fs.copyFileSync(r.backup, realKey(file));
                            throw new Error(`entry not recorded (${e.message}); file restored from ${r.backup || 'nothing'}`);
                        }
                    }
                } catch (e) {
                    confirmed = false;
                    report.failed.push({ file, error: e.message });
                    say(`harness ${file}: direct memory not registered (${e.message}); gateway copy kept`);
                }
            }
        }
    }

    // 2. Gateway copy goes only when every target confirmed its entry.
    if (confirmed && names.length) stripGateway({ home, now, dryRun, say, report, names });
    else if (!excluded && names.length) say('gateway copy of memory kept: direct registration not confirmed everywhere');
    return report;
}

module.exports = { migrateMemoryDirect, codexHas };
