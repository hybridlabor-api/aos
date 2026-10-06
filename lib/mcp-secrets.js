'use strict';
// Secrets for MCP servers live in ONE file (~/.aos/secrets.env, mode 0600), never inline in a harness
// config. A harness entry holds only `node aos-mcp-env.mjs --vars A,B -- <real command>`; the launcher
// (bin/aos-mcp-env.mjs) reads this file and hands the child just the declared variables.
// Values are never logged or returned in messages: callers only ever see variable NAMES.
const fs = require('fs');
const path = require('path');
const { parseJsonc } = require('./jsonc');
const { detectApps, applyPicks } = require('./mcp-pick');

const LAUNCHER_FILE = 'aos-mcp-env.mjs';
const MAX_BYTES = 64 * 1024;
const secretsPath = (home) => path.join(home, '.aos', 'secrets.env');
const launcherPath = (home) => path.join(home, '.agents', 'bin', LAUNCHER_FILE);

// Variables each shipped server needs even when its template carries no env entry.
const SERVER_VARS = {
    github: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    memb_mcp: ['GEMINI_API_KEY'],
    bdb_remoteos_mcp: ['REMOTEOS_API_KEY'],
};
const KNOWN_SECRET_VARS = new Set(['GITHUB_PERSONAL_ACCESS_TOKEN', 'GITHUB_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'GROQ_API_KEY', 'XAI_API_KEY', 'NVIDIA_API_KEY', 'OPENROUTER_API_KEY', 'OPENWIKI_API_KEY', 'REMOTEOS_API_KEY']);
const SECRET_NAME = /(^|_)(TOKEN|API_?KEY|SECRET|PASSWORD|PASSWD|PAT)$/i;
const TOKEN_VALUE = /^(ghp_|gho_|ghu_|ghs_|github_pat_|AIza|sk-)/;
const isSecretName = (k) => KNOWN_SECRET_VARS.has(k) || SECRET_NAME.test(k);
const isReference = (v) => typeof v === 'string' && (/^\$\{?[A-Za-z_]\w*\}?$/.test(v) || /^__[A-Z0-9_]+__$/.test(v));
const looksLikeToken = (v) => typeof v === 'string' && TOKEN_VALUE.test(v);
const secretKV = (k, v) => isSecretName(k) || looksLikeToken(v);
const envOf = (env) => (env && typeof env === 'object' && !Array.isArray(env) ? env : {});
// Real secret values only: not empty, not a ${VAR} / __PLACEHOLDER__ reference.
const inlineSecrets = (env) => Object.entries(envOf(env)).filter(([k, v]) => typeof v === 'string' && v !== '' && !isReference(v) && secretKV(k, v));

// ---- launcher form -----------------------------------------------------------------------------
const isLauncherEntry = (e) => !!e && typeof e === 'object' && Array.isArray(e.args) && /(^|[\\/])aos-mcp-env\.mjs$/.test(String(e.args[0] || ''));
function unwrap(e) {
    if (!isLauncherEntry(e)) return { command: e && e.command, args: Array.isArray(e && e.args) ? e.args : [], vars: [] };
    const i = e.args.indexOf('--');
    const vi = e.args.indexOf('--vars');
    return { command: e.args[i + 1], args: e.args.slice(i + 2), vars: vi >= 0 && vi < i ? String(e.args[vi + 1] || '').split(',').filter(Boolean) : [] };
}

// Moves every secret env variable of a server into the launcher's --vars list. Idempotent.
function wrapServer(name, cfg, launcher, extra = []) {
    if (!launcher || !cfg || typeof cfg !== 'object' || typeof cfg.command !== 'string') return cfg;
    const vars = new Set();
    let base = cfg;
    if (isLauncherEntry(cfg)) {
        const u = unwrap(cfg);
        u.vars.forEach((v) => vars.add(v));
        base = { ...cfg, command: u.command, args: u.args };
    }
    (SERVER_VARS[name] || []).forEach((v) => vars.add(v));
    extra.forEach((v) => vars.add(v));
    const env = { ...envOf(cfg.env) };
    for (const [k, v] of Object.entries(env)) if (secretKV(k, v)) { vars.add(k); delete env[k]; }
    if (!vars.size) return cfg;
    const out = { ...base, command: 'node', args: [launcher, '--vars', [...vars].join(','), '--', base.command, ...(Array.isArray(base.args) ? base.args : [])] };
    if (Object.keys(env).length) out.env = env; else delete out.env;
    return out;
}
const wrapServers = (servers, launcher) => Object.fromEntries(Object.entries(servers || {}).map(([n, c]) => [n, wrapServer(n, c, launcher)]));

// ---- ownership ---------------------------------------------------------------------------------
function readShippedConfig(root = path.join(__dirname, '..')) {
    let cfg = null;
    try { cfg = JSON.parse(fs.readFileSync(path.join(root, 'mcp_config.json'), 'utf8')); } catch { return null; }
    // Pick groups live in their own file: installers read mcp_config.json verbatim and must never see both candidates.
    try { cfg.mcpPicks = JSON.parse(fs.readFileSync(path.join(root, 'mcp_picks.json'), 'utf8')).groups || []; } catch { cfg.mcpPicks = []; }
    return cfg;
}
// Every shipped definition regardless of the pick (our own and both official ones, placeholders unresolved):
// the template set for ownership checks (isAosOwned) so an installed entry of the pick's loser is still recognised.
function shippedAll(root = path.join(__dirname, '..')) {
    const cfg = readShippedConfig(root) || { mcpServers: {}, mcpPicks: [] };
    const out = { ...(cfg.mcpServers || {}) };
    for (const g of cfg.mcpPicks || []) for (const c of (g && g.candidates) || []) if (c && c.entry && c.name) out[c.name] = c.entry;
    return out;
}
// Shipped servers with the mcpPicks applied. Without options nothing is detected, so the official
// entries are dropped and our own stay; a caller can inject a detect function (or a platform/env/fsImpl trio).
function shippedServers(root = path.join(__dirname, '..'), opts = null) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const detect = typeof o.detect === 'function' ? o.detect
        : (o.platform || o.env || o.fsImpl ? detectApps({ platform: o.platform, env: o.env, fsImpl: o.fsImpl }) : () => null);
    const cfg = readShippedConfig(root) || { mcpServers: {}, mcpPicks: [] };
    const res = applyPicks(cfg.mcpServers || {}, cfg.mcpPicks || [], detect, o.env);
    return res.servers;
}
// Full pick result for the installer: winners applied and retired AOS-owned names it must remove
// from harness configs. Same default semantics as shippedServers.
function shippedPicks(root = path.join(__dirname, '..'), opts = null) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const detect = typeof o.detect === 'function' ? o.detect
        : (o.platform || o.env || o.fsImpl ? detectApps({ platform: o.platform, env: o.env, fsImpl: o.fsImpl }) : () => null);
    const cfg = readShippedConfig(root) || { mcpServers: {}, mcpPicks: [] };
    return applyPicks(cfg.mcpServers || {}, cfg.mcpPicks || [], detect, o.env);
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sameArgs = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
function argMatches(t, a) {
    if (typeof a !== 'string') return false;
    if (!/__MCPS_DIR__|\{\{HOME\}\}|__PYTHON_BIN__/.test(t)) return t === a;
    const re = esc(t).replace(/\//g, '[\\\\/]').replace(/__MCPS_DIR__/g, '.+?[\\\\/]mcps').replace(/\\\{\\\{HOME\\\}\\\}/g, '.+').replace(/__PYTHON_BIN__/g, '.+');
    return new RegExp(`^${re}$`).test(a);
}
// Command shapes older AOS releases wrote (git log -p -- mcp_config.json): unpinned npx packages (before 375fa3b),
// the retired computer-use entry, and earlier uv/go/sh arguments. Same placeholders as the template.
const LEGACY_SHAPES = {
    github: [['npx', ['-y', '@modelcontextprotocol/server-github']]],
    'chrome-devtools': [['npx', ['-y', '@modelcontextprotocol/server-puppeteer']]],
    open_design_mcp: [
        ['npx', ['-y', 'open-design-mcp', '__MCPS_DIR__/open-design']],
        ['npx', ['-y', '@nexu-io/open-design-mcp', '__MCPS_DIR__/open-design']],
    ],
    zavora_computer_use: [['node', ['__MCPS_DIR__/computer-use-mcp/dist/server.js']]],
    bdb_after_effects_mcp: [
        ['node', ['__MCPS_DIR__/after-effects-mcp/build/index.js']],
    ],
    bdb_after_effects_mcp_fallback: [
        ['sh', ['-c', 'cd __MCPS_DIR__/ae-mcp && go run ./cmd/ae-mcp']],
        ['go', ['run', '__MCPS_DIR__/ae-mcp/cmd/ae-mcp']],
    ],
    bdb_grandma3_mcp: [['uv', ['run', '__MCPS_DIR__/grandma3_mcp.py']], ['uv', ['run', '__MCPS_DIR__/grandma3_mcp.py', '--ip', '127.0.0.1', '--port', '8080', '--mode', 'webapi_only']]],
    bdb_resolume_mcp: [['uv', ['run', '__MCPS_DIR__/resolume_mcp.py']]],
    bdb_davinci_mcp: [['uv', ['run', '-r', '__MCPS_DIR__/davinci-resolve-mcp-free/requirements.txt', '__MCPS_DIR__/davinci-resolve-mcp-free/src/resolve_mcp_bridge.py']]],
};
function templateMatches(t, u) {
    const tArgs = Array.isArray(t.args) ? t.args : [];
    if (t.command === 'deja' && u.command === 'cmd' && sameArgs(u.args, ['/c', 'deja', 'mcp'])) return true;
    const cmdOk = t.command === u.command || t.command === '__PYTHON_BIN__' || (t.command === 'uv' && /(^|[\\/])uv(\.exe)?$/i.test(String(u.command)));
    return cmdOk && tArgs.length === u.args.length && tArgs.every((x, i) => argMatches(x, u.args[i]));
}
// AOS-owned = the name is in the shipped template AND command/args are what AOS writes: the entry it
// is about to write (`incoming`) or the shipped command, with or without the launcher in front.
function isAosOwned(name, entry, incoming, shipped) {
    if (!entry || typeof entry !== 'object' || !shipped || !shipped[name]) return false;
    const u = unwrap(entry);
    if (typeof u.command !== 'string') return false;
    if (incoming) { const i = unwrap(incoming); if (u.command === i.command && sameArgs(u.args, i.args)) return true; }
    return [shipped[name], ...(LEGACY_SHAPES[name] || []).map(([command, args]) => ({ command, args }))].some((t) => templateMatches(t, u));
}

// ---- secrets file ------------------------------------------------------------------------------
function parseEnvText(text) {
    const out = {};
    for (const raw of String(text).split(/\r?\n/)) {
        const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(raw);
        if (!m) continue;
        // Values are never altered: only the double-quote pair storeSecrets adds (with \\ and \" escapes) or a
        // hand-written single-quoted literal is unwrapped; anything else is taken verbatim.
        let v = m[2];
        const dq = /^"((?:[^"\\]|\\.)*)"$/.exec(v);
        const sq = /^'([^']*)'$/.exec(v);
        if (dq) v = dq[1].replace(/\\(["\\])/g, '$1'); else if (sq) v = sq[1];
        out[m[1]] = v;
    }
    return out;
}
const formatEnvLine = (k, v) => `${k}="${v.replace(/[\\"]/g, '\\$&')}"\n`;

// Backup created with `wx` and mode 0600 at open time: no world-readable window, never overwrites. When the
// target name is taken by an identical copy that copy counts; otherwise a numeric suffix is tried.
function safeBackup(file, bak) {
    const data = fs.readFileSync(file);
    for (let i = 0; i < 20; i++) {
        const target = i ? `${bak}.${i}` : bak;
        try {
            const fd = fs.openSync(target, 'wx', 0o600);
            try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
            return target;
        } catch (e) {
            if (e.code !== 'EEXIST') throw e;
            try { if (fs.readFileSync(target).equals(data)) return target; } catch { /* try the next name */ }
        }
    }
    throw new Error(`no free backup name for ${file}`);
}
// Bounded read of the secrets file. Refuses anything but a private regular file of this user.
function readSecretsFile(file) {
    let fd;
    try { fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0)); } catch (e) {
        return e.code === 'ENOENT' ? { state: 'missing', vars: {} } : { state: 'refused', reason: `cannot be opened (${e.code})`, vars: {} };
    }
    try {
        const st = fs.fstatSync(fd);
        const refuse = (reason) => ({ state: 'refused', reason, vars: {} });
        if (!st.isFile()) return refuse('not a regular file');
        if (process.platform !== 'win32') {
            if (st.mode & 0o077) return refuse(`mode is ${(st.mode & 0o777).toString(8)}, must be 600 (chmod 600 ${file})`);
            if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return refuse('owned by another user');
        }
        if (st.size > MAX_BYTES) return refuse(`larger than ${MAX_BYTES} bytes`);
        const buf = Buffer.alloc(st.size);
        let off = 0;
        while (off < buf.length) { const n = fs.readSync(fd, buf, off, buf.length - off, off); if (!n) break; off += n; }
        return { state: 'ok', vars: parseEnvText(buf.subarray(0, off).toString('utf8')) };
    } finally { try { fs.closeSync(fd); } catch { /* closed */ } }
}

function createCollector() {
    const values = {};
    const conflicts = new Set();
    return {
        values, conflicts,
        add(k, v) { if (!(k in values)) values[k] = v; else if (values[k] !== v) conflicts.add(k); },
        size: () => Object.keys(values).length,
    };
}

// Adds variables the file does not hold yet; an existing value is never replaced.
// Returns names only: { added, kept (stored value differs from the offered one), same }.
function storeSecrets(file, values) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    let text = '';
    if (fs.existsSync(file)) {
        if (!fs.statSync(file).isFile()) throw new Error(`${file} is not a regular file`);
        if (fs.statSync(file).size > MAX_BYTES) throw new Error(`${file} is larger than ${MAX_BYTES} bytes`);
        text = fs.readFileSync(file, 'utf8');
    }
    const cur = parseEnvText(text);
    const res = { added: [], kept: [], same: [] };
    let add = '';
    for (const [k, v] of Object.entries(values)) {
        if (/[\r\n]/.test(v)) throw new Error(`value of ${k} contains a line break`);
        if (k in cur) (cur[k] === v ? res.same : res.kept).push(k);
        else { res.added.push(k); add += formatEnvLine(k, v); }
    }
    if (add) {
        const tmp = `${file}.${process.pid}.tmp`;
        const fd = fs.openSync(tmp, 'wx', 0o600);
        try {
            try { fs.writeSync(fd, text + (text && !text.endsWith('\n') ? '\n' : '') + add); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
            fs.renameSync(tmp, file);
        } catch (e) {
            // our own half-written temp file only
            try { fs.unlinkSync(tmp); } catch { /* already gone */ }
            throw e;
        }
    }
    if (process.platform !== 'win32') { try { fs.chmodSync(file, 0o600); } catch { /* best effort */ } }
    return res;
}

// Sets one key, replacing its line (every duplicate dropped) or appending it. Same tmp+rename as storeSecrets.
function setSecret(file, key, value) {
    if (/[\r\n]/.test(value)) throw new Error(`value of ${key} contains a line break`);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    let text = '';
    if (fs.existsSync(file)) {
        const st = fs.statSync(file);
        if (!st.isFile() || st.size > MAX_BYTES) throw new Error(`${file} is not a regular file under ${MAX_BYTES} bytes`);
        text = fs.readFileSync(file, 'utf8');
    }
    const own = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
    const lines = text ? text.split(/\r?\n/) : [];
    if (lines[lines.length - 1] === '') lines.pop();
    const i = lines.findIndex((l) => own.test(l));
    const out = lines.filter((l, j) => j === i || !own.test(l));
    const line = formatEnvLine(key, value).trimEnd();
    if (i >= 0) out[out.indexOf(lines[i])] = line; else out.push(line);
    const tmp = `${file}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
        try { fs.writeSync(fd, out.join('\n') + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(tmp, file);
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch { /* our own temp file */ }
        throw e;
    }
}

// ---- merging into a harness's own server map -------------------------------------------------------
// Overwrites an entry only when AOS owns it; a same-named entry with another command stays (onSkip).
// Inline secrets of an owned entry go to the collector, the entry is rewritten in launcher form.
function mergeServers(existing, incoming, { shipped, collector, launcher, onSkip }) {
    let changed = false;
    for (const [name, inc] of Object.entries(incoming || {})) {
        const prev = existing[name];
        let next = wrapServer(name, inc, launcher);
        if (prev !== undefined) {
            if (!isAosOwned(name, prev, next, shipped)) { if (onSkip) onSkip(name); continue; }
            const prevEnv = envOf(prev.env);
            // No launcher on disk: the inline value is the only working copy, leave the entry alone.
            if (!launcher && inlineSecrets(prevEnv).length) continue;
            if (collector) for (const [k, v] of inlineSecrets(prevEnv)) collector.add(k, v);
            const secretKeys = Object.keys(prevEnv).filter((k) => secretKV(k, prevEnv[k]));
            next = wrapServer(name, next, launcher, secretKeys);
            const keep = Object.fromEntries(Object.entries(prevEnv).filter(([k, v]) => !secretKV(k, v)));
            if (!next.env && Object.keys(keep).length) next = { ...next, env: keep };
        }
        if (JSON.stringify(prev) !== JSON.stringify(next)) { existing[name] = next; changed = true; }
    }
    return changed;
}

// OpenCode keeps `command` as one array and `environment` instead of `env`.
const fromOpencode = (e) => (Array.isArray(e && e.command) ? { command: e.command[0], args: e.command.slice(1), env: e.environment } : e);
function toOpencode(orig, w) {
    const out = { ...orig, command: [w.command, ...(w.args || [])] };
    if (w.env && Object.keys(w.env).length) out.environment = w.env; else delete out.environment;
    return out;
}

// ---- Codex config.toml -------------------------------------------------------------------------
// Reads every [mcp_servers.x] table (command, args, other plain fields, env inline or as sub-table).
// `unparsed` lists lines this reader does not understand: such a table is never rewritten.
function parseCodexTables(text) {
    const out = {};
    let cur = null;
    let sub = null;
    const STR = /"(?:[^"\\]|\\.)*"|'[^']*'/g;
    // Basic strings, literal strings and arrays of them; anything else is undefined (= unparsed).
    const val = (s) => {
        s = s.trim();
        try { return JSON.parse(s); } catch { /* maybe a TOML literal */ }
        const lit = /^'([^']*)'$/.exec(s);
        if (lit) return lit[1];
        if (s.startsWith('[') && s.endsWith(']')) {
            const inner = s.slice(1, -1);
            if (inner.replace(STR, '').replace(/[\s,]/g, '') !== '') return undefined;
            return (inner.match(STR) || []).map(val);
        }
        return undefined;
    };
    for (const raw of String(text).split(/\r?\n/)) {
        const m = /^\s*\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))(?:\.([A-Za-z0-9_-]+))?\]\s*$/.exec(raw);
        if (m) {
            cur = m[1] || m[2];
            sub = m[3] || null;
            out[cur] = out[cur] || { fields: {}, env: {}, unparsed: [] };
            if (sub && sub !== 'env') out[cur].unparsed.push(raw.trim());
            continue;
        }
        if (/^\s*\[/.test(raw)) { cur = null; continue; }
        const t = raw.trim();
        if (!cur || !t || t.startsWith('#')) continue;
        const e = out[cur];
        if (sub && sub !== 'env') { e.unparsed.push(t); continue; }
        const kv = /^(["']?)([A-Za-z0-9_.-]+)\1\s*=\s*(.*)$/.exec(t);
        if (!kv) { e.unparsed.push(t); continue; }
        if (sub === 'env') { const v = val(kv[3]); if (typeof v === 'string') e.env[kv[2]] = v; else e.unparsed.push(t); continue; }
        if (kv[2] === 'env' && kv[3].startsWith('{')) {
            // Every pair must be understood: whatever the pairs do not account for makes the table unparsed.
            const pairRe = /(["']?)([A-Za-z0-9_.-]+)\1\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/g;
            const body = kv[3].trim();
            for (const p of body.matchAll(pairRe)) e.env[p[2]] = val(p[3]);
            if (!body.endsWith('}') || body.slice(1, -1).replace(pairRe, '').replace(/[\s,]/g, '') !== '') e.unparsed.push(t);
            continue;
        }
        const v = val(kv[3]);
        if (v === undefined) e.unparsed.push(t); else e.fields[kv[2]] = v;
    }
    return out;
}
const codexEntry = (t) => ({ ...t.fields, ...(Object.keys(t.env).length ? { env: t.env } : {}) });

// ---- where harnesses keep their MCP servers --------------------------------------------------------
// Known harness locations, `<cwd>/.cursor/mcp.json` (the installer writes it for the project) and every
// custom path the installer recorded in ~/.agents/.bdb-uninstall-records.json (mcpConfigs).
function harnessMcpFiles(home, env = process.env, platform = process.platform, cwd = process.cwd()) {
    const files = defaultHarnessMcpFiles(home, env, platform);
    files.push({ file: path.join(cwd, '.cursor', 'mcp.json'), kind: 'json' });
    let recorded = [];
    try { recorded = JSON.parse(fs.readFileSync(path.join(home, '.agents', '.bdb-uninstall-records.json'), 'utf8')).mcpConfigs; } catch { /* none */ }
    for (const f of Array.isArray(recorded) ? recorded : []) if (typeof f === 'string' && path.isAbsolute(f)) files.push({ file: f, kind: kindOfFile(f) });
    return dedupe(files);
}
const kindOfFile = (f) => (f.toLowerCase().endsWith('.toml') ? 'toml' : /^opencode\./i.test(path.basename(f)) ? 'opencode' : 'json');
const dedupe = (files) => { const seen = new Set(); return files.filter((f) => { const k = path.resolve(f.file); if (seen.has(k)) return false; seen.add(k); return true; }); };

function defaultHarnessMcpFiles(home, env = process.env, platform = process.platform) {
    const files = [];
    const json = (f) => files.push({ file: f, kind: 'json' });
    const appBase = (app) => (platform === 'win32' ? path.join(env.APPDATA || home, app) : platform === 'darwin' ? path.join(home, 'Library', 'Application Support', app) : path.join(home, '.config', app));
    json(path.join(home, '.claude.json'));
    if (env.CLAUDE_CONFIG_DIR) json(path.join(path.resolve(env.CLAUDE_CONFIG_DIR), '.claude.json'));
    json(path.join(appBase('Claude'), 'claude_desktop_config.json'));
    json(path.join(home, '.gemini', 'config', 'mcp_config.json'));
    json(path.join(home, '.gemini', 'antigravity-cli', 'mcp_config.json'));
    for (const f of ['.cursor/mcp.json', '.windsurf/mcp.json', '.aider/mcp.json', '.roo/mcp.json', '.roo/mcp_settings.json', '.cline/mcp_settings.json']) json(path.join(home, ...f.split('/')));
    for (const app of ['Cursor', 'Windsurf', 'Code']) for (const f of ['User/globalStorage/mcp.json', 'User/mcp.json', 'mcp.json']) json(path.join(appBase(app), ...f.split('/')));
    json(path.join(appBase('Code'), 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json'));
    json(path.join(appBase('Code'), 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'));
    const oc = platform === 'win32' ? path.join(env.APPDATA || home, 'opencode') : path.join(home, '.config', 'opencode');
    for (const f of ['opencode.jsonc', 'opencode.json']) files.push({ file: path.join(oc, f), kind: 'opencode' });
    files.push({ file: path.join(home, '.codex', 'config.toml'), kind: 'toml' });
    if (env.CODEX_HOME) files.push({ file: path.join(path.resolve(env.CODEX_HOME), 'config.toml'), kind: 'toml' });
    return files;
}

// ---- doctor ------------------------------------------------------------------------------------
// [{ file, server, variable }] for every inline value of a secret variable or token-looking value.
function findInlineSecrets(home, env = process.env, platform = process.platform) {
    const found = [];
    for (const { file, kind } of harnessMcpFiles(home, env, platform)) {
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        const servers = [];
        if (kind === 'toml') {
            for (const [name, t] of Object.entries(parseCodexTables(text))) servers.push([name, t.env, t.fields.args]);
        } else {
            let data;
            try { data = parseJsonc(text); } catch { continue; }
            const map = envOf(kind === 'opencode' ? data && data.mcp : data && data.mcpServers);
            for (const [name, c] of Object.entries(map)) if (c && typeof c === 'object') servers.push([name, c.env || c.environment, Array.isArray(c.command) ? c.command : c.args]);
        }
        for (const [server, e, args] of servers) {
            for (const [variable] of inlineSecrets(e)) found.push({ file, server, variable });
            if (Array.isArray(args) && args.some(looksLikeToken)) found.push({ file, server, variable: '(command arguments)' });
        }
    }
    return found;
}

module.exports = {
    LAUNCHER_FILE, SERVER_VARS, secretsPath, launcherPath, isSecretName, looksLikeToken, inlineSecrets, secretKV,
    isLauncherEntry, unwrap, wrapServer, wrapServers, shippedServers, shippedPicks, shippedAll, isAosOwned,
    parseEnvText, readSecretsFile, createCollector, storeSecrets, setSecret, mergeServers,
    fromOpencode, toOpencode, parseCodexTables, codexEntry, harnessMcpFiles, defaultHarnessMcpFiles, kindOfFile, findInlineSecrets,
    safeBackup, formatEnvLine,
};
