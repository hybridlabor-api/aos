'use strict';
// What aos-uninstall needs beyond the file manifest: records of registrations AOS made in
// foreign config (Claude plugin, OpenCode plugin file) and the reversal of every registration
// that would otherwise point at deleted scripts. Pure of installer state: every path derives
// from `home`, tests drive it with a temp HOME and an injected Claude runner.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pluginFile, COMMANDS } = require('./opencode-verify.js');
const { parseJsonc, removeJsoncArrayEntries } = require('./jsonc.js');
const { claudeConfigDir } = require('./plugin-evidence.js');

const PLUGIN_ID = 'bdb-aos@bdb-marketplace';
const MARKETPLACE = 'bdb-marketplace';
const AGY_NAMED = ['aos-go-gate', 'aos-conventional-commits', 'aos-env-protection', 'aos-trail-relay', 'aos-graph-gate', 'aos-context'];
const AOS_SCRIPTS = ['go-gate.mjs', 'graph-gate.mjs', 'memb-inject.mjs', 'startcycle-dispatch.mjs', 'trail-relay.mjs', 'conventional-commits.mjs', 'env-file-protection.mjs'];
const LAUNCHERS = ['aos-config', 'aos-dashboard', 'aos-uninstall', 'aos-store', 'aos-doctor', 'aos-acp', 'aos-bus'];
const LAUNCHER_MARKER = '# aos-launcher';
const OPENCODE_MARKER = 'BDB Agent OS (AOS) plugin for OpenCode';

const recordsPath = (home) => path.join(home, '.agents', '.bdb-uninstall-records.json');
const sha256 = (file) => { try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; } };
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

function readRecords(home) {
    try { return JSON.parse(fs.readFileSync(recordsPath(home), 'utf8')); } catch { return {}; }
}
function writeRecords(home, rec) {
    fs.mkdirSync(path.dirname(recordsPath(home)), { recursive: true });
    fs.writeFileSync(recordsPath(home), JSON.stringify(rec, null, 2) + '\n');
}
function retireRecords(home) { try { fs.rmSync(recordsPath(home), { force: true }); } catch { /* gone */ } }

function recordOpencodePlugin(home, file) {
    const sum = sha256(file);
    if (!sum) return;
    writeRecords(home, { ...readRecords(home), opencodePlugin: { path: file, sha256: sum } });
}

// Wraps the Claude CLI runner of the plugin migration: a successful `marketplace add` / `install`
// means AOS itself added them (the migration only runs those steps when the entry was absent).
function recordingCli(home, cli) {
    if (typeof cli !== 'function') return cli;
    return (args) => {
        const r = cli(args);
        if (r && r.ok) {
            const claude = { ...(readRecords(home).claude || {}) };
            if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') claude.addedMarketplace = true;
            else if (args[0] === 'plugin' && args[1] === 'install' && !/already installed/i.test(`${r.stdout || ''}${r.stderr || ''}`)) claude.installedPlugin = true;
            else return r;
            writeRecords(home, { ...readRecords(home), claude });
        }
        return r;
    };
}

function writeThrough(file, data) {
    let target = file;
    try { target = fs.realpathSync(file); } catch { /* new */ }
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
    fs.renameSync(tmp, target);
}
const isAosCommand = (c) => typeof c === 'string' && AOS_SCRIPTS.some((n) => c.includes(n));
const handlerCommands = (spec) => JSON.stringify(spec || {}).match(/"command":"((?:[^"\\]|\\.)*)"/g) || [];

// ---- (a) Antigravity hooks.json --------------------------------------------------------------
function stripLegacyLump(spec) {
    const flat = ['PreInvocation', 'PostInvocation', 'Stop'];
    const out = {};
    for (const [event, entries] of Object.entries(spec)) {
        if (!Array.isArray(entries)) { out[event] = entries; continue; }
        const kept = [];
        for (const e of entries) {
            if (e && Array.isArray(e.hooks)) {
                const rest = e.hooks.filter((x) => !isAosCommand(x && x.command));
                if (rest.length) { if (flat.includes(event)) kept.push(...rest); else kept.push({ ...e, hooks: rest }); }
            } else if (!isAosCommand(e && e.command)) kept.push(e);
        }
        if (kept.length) out[event] = kept;
    }
    return out;
}

function reverseAgy({ home, dryRun }) {
    const lines = [];
    const seen = new Set();
    for (const f of [path.join(home, '.gemini', 'config', 'hooks.json'), path.join(home, '.gemini', 'antigravity-cli', 'hooks.json')]) {
        let real;
        try { real = fs.realpathSync(f); } catch { continue; }
        if (seen.has(real)) continue;
        seen.add(real);
        let data;
        try { data = JSON.parse(fs.readFileSync(real, 'utf8')); } catch { lines.push(`Antigravity: ${f} nicht lesbar, von Hand prüfen.`); continue; }
        if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
        const gone = AGY_NAMED.filter((n) => data[n] && handlerCommands(data[n]).every(isAosCommand) && handlerCommands(data[n]).length);
        let legacy = false;
        if (data.hooks && typeof data.hooks === 'object' && !Array.isArray(data.hooks)) {
            const rest = stripLegacyLump(data.hooks);
            if (JSON.stringify(rest) !== JSON.stringify(data.hooks)) legacy = true;
            if (legacy) data.hooks = rest;
        }
        if (!gone.length && !legacy) continue;
        for (const n of gone) delete data[n];
        if (data.hooks && !Object.keys(data.hooks).some((k) => Array.isArray(data.hooks[k]) && data.hooks[k].length)) delete data.hooks;
        const what = [...gone, ...(legacy ? ['Legacy-Handler in "hooks"'] : [])].join(', ');
        lines.push(`Antigravity: ${dryRun ? 'würde entfernen' : 'entfernt'} aus ${f}: ${what}`);
        if (!dryRun) writeThrough(f, data);
    }
    return lines;
}

// ---- (b) Codex config.toml AOS:HOOKS block ----------------------------------------------------
const CODEX_AOS_SCRIPTS = ['go-gate.mjs', 'graph-gate.mjs', 'memb-inject.mjs', 'trail-relay.mjs', 'startcycle-dispatch.mjs', 'conventional-commits.mjs', 'env-file-protection.mjs'];

// Drops every [[hooks.X]] group (with its [[hooks.X.hooks]] children) whose command names an AOS script;
// every other table stays untouched. Shared by the installer's merge and the uninstaller.
function dropAosHookGroups(lines, scripts = CODEX_AOS_SCRIPTS) {
    const sections = [];
    for (const l of lines) {
        if (/^\s*\[/.test(l) || !sections.length) sections.push([l]);
        else sections[sections.length - 1].push(l);
    }
    const isHookHeader = (sec) => /^\s*\[\[hooks\.\w+\]\]\s*$/.test(sec[0]);
    const isHookInner = (sec) => /^\s*\[\[hooks\.\w+\.hooks\]\]\s*$/.test(sec[0]);
    const kept = [];
    for (let i = 0; i < sections.length; i++) {
        if (!isHookHeader(sections[i])) { kept.push(sections[i]); continue; }
        let j = i + 1;
        while (j < sections.length && isHookInner(sections[j])) j++;
        const group = sections.slice(i, j);
        const ours = group.some((sec) => sec.some((l) => /^\s*command\s*=/.test(l) && scripts.some((n) => l.includes(n))));
        if (ours) {
            // keep trailing blanks/comments (they may belong to another tool's marker)
            const tail = group.flat();
            let end = tail.length;
            while (end > 0 && /^\s*(#.*)?$/.test(tail[end - 1])) end--;
            if (end < tail.length) kept.push(tail.slice(end));
        } else kept.push(...group);
        i = j - 1;
    }
    return kept.flat();
}


// AOS MCP server names come from the shipped template. Generic names a user may own too
// (github, deja, ...) are only removed from inside an intact AOS:MCP block, never marker-less.
const GENERIC_MCP_NAMES = ['github', 'chrome-devtools', 'deja', 'open_design_mcp'];
function aosMcpNames() {
    try { return Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mcp_config.json'), 'utf8')).mcpServers || {}); } catch { return []; }
}

const MCP_HEADER = /^\s*\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))(\.[^\]]*)?\]\s*$/;
const isMcpMarker = (l) => /^\s*# AOS:MCP:(START|END)\s*$/.test(l);
const isHooksMarker = (l) => /^\s*# AOS:HOOKS:(START|END)\s*$/.test(l);

// Drops [mcp_servers.<name>] tables (and their sub-tables) for which owns(name, bodyLines) is true.
// Trailing blanks/comments after a dropped table stay (they may belong to the next table).
function dropMcpTables(lines, owns) {
    const sections = [];
    for (const l of lines) {
        if (/^\s*\[/.test(l) || !sections.length) sections.push([l]);
        else sections[sections.length - 1].push(l);
    }
    const out = [];
    const dropped = new Set();
    for (const sec of sections) {
        const m = MCP_HEADER.exec(sec[0]);
        const name = m && (m[1] || m[2]);
        // a sub-table ([mcp_servers.x.env]) follows the verdict on its parent table
        const drop = !!m && (m[3] ? dropped.has(name) : owns(name, sec));
        if (!drop) { out.push(sec); continue; }
        dropped.add(name);
        let end = sec.length;
        while (end > 1 && /^\s*(#.*)?$/.test(sec[end - 1])) end--;
        if (end < sec.length) out.push(sec.slice(end));
    }
    return out.flat();
}

function reverseCodex({ home, dryRun }) {
    const file = path.join(home, '.codex', 'config.toml');
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    let ls = raw.split(/\r?\n/);
    const all = aosMcpNames();
    const unique = all.filter((n) => !GENERIC_MCP_NAMES.includes(n));

    // The Codex CLI drops marker comments when it rewrites config.toml, so removal never depends on them.
    const ms = ls.findIndex((l) => /^\s*# AOS:MCP:START\s*$/.test(l));
    const me = ls.findIndex((l, i) => i > ms && /^\s*# AOS:MCP:END\s*$/.test(l));
    if (ms >= 0 && me > ms) {
        const inner = dropMcpTables(ls.slice(ms + 1, me), (n) => all.includes(n));
        ls = [...ls.slice(0, ms), ...inner, ...ls.slice(me + 1)];
    }
    ls = ls.filter((l) => !isMcpMarker(l) && !isHooksMarker(l));
    ls = dropMcpTables(dropAosHookGroups(ls), (n) => unique.includes(n));

    const norm = (arr) => { const o = arr.slice(); while (o.length && o[o.length - 1].trim() === '') o.pop(); return o.join('\n').replace(/\n{3,}/g, '\n\n'); };
    if (norm(ls) === norm(raw.split(/\r?\n/))) return [];
    if (!dryRun) writeThrough(file, norm(ls).split('\n').join(eol) + eol);
    return [`Codex: AOS hooks and MCP entries ${dryRun ? 'would be removed from' : 'removed from'} ${file} (foreign tables stay)`];
}

// ---- (c) OpenCode plugin file, plugin[] entry ------------------------------------------------
function reverseOpencode({ home, dryRun, platform = process.platform, env = process.env }) {
    const lines = [];
    const dirs = [...new Set([path.join(home, '.config', 'opencode'), ...(platform === 'win32' ? [path.join(env.APPDATA || home, 'opencode')] : [])])];
    const rec = readRecords(home).opencodePlugin;
    for (const dir of dirs) {
        const file = path.join(dir, 'plugins', 'bdb-aos.js');
        let removedFile = false;
        let ours = false;
        if (fs.existsSync(file)) {
            let head = '';
            try { head = fs.readFileSync(file, 'utf8').slice(0, 400); } catch { /* unreadable */ }
            const sum = sha256(file);
            const recorded = !!rec && path.resolve(rec.path) === path.resolve(file);
            ours = (recorded && rec.sha256 === sum) || head.includes(OPENCODE_MARKER);
            if (ours) {
                const modified = !(recorded && rec.sha256 === sum);
                lines.push(`OpenCode: Plugin ${file} ${dryRun ? 'würde entfernt' : 'entfernt'}${modified ? ' (Inhalt weicht vom installierten Stand ab, vorher als .bak gesichert)' : ''}`);
                if (!dryRun) {
                    if (modified) fs.copyFileSync(file, `${file}.${stamp()}.bak`);
                    fs.rmSync(file, { force: true });
                }
                removedFile = true;
            } else lines.push(`OpenCode: ${file} stammt nicht von AOS, bleibt samt plugin[]-Eintrag.`);
        } else ours = true; // a plugin[] entry for our own, already deleted file dangles either way
        if (!ours) continue;
        for (const name of ['opencode.jsonc', 'opencode.json', 'config.json']) {
            const cfgFile = path.join(dir, name);
            let conf;
            try { conf = parseJsonc(fs.readFileSync(cfgFile, 'utf8')); } catch { continue; }
            if (!conf || !Array.isArray(conf.plugin)) continue;
            const isOurs = (e) => { const abs = pluginFile(e, home); return !!(abs && path.resolve(abs) === path.resolve(file)); };
            const keep = conf.plugin.filter((e) => !isOurs(e));
            if (keep.length === conf.plugin.length) continue;
            lines.push(`OpenCode: plugin[]-Eintrag für bdb-aos.js ${dryRun ? 'würde entfernt aus' : 'entfernt aus'} ${cfgFile}`);
            if (dryRun) continue;
            fs.copyFileSync(cfgFile, `${cfgFile}.${stamp()}.bak`);
            // Textual edit keeps comments and formatting; a rewrite is the fallback and says so.
            const text = removeJsoncArrayEntries(fs.readFileSync(cfgFile, 'utf8'), 'plugin', isOurs);
            if (text !== null) writeThrough(cfgFile, text);
            else {
                if (keep.length) conf.plugin = keep; else delete conf.plugin;
                writeThrough(cfgFile, conf);
                lines.push(`OpenCode: Kommentare in ${cfgFile} wurden nicht erhalten; Original als ${path.basename(cfgFile)}.<zeitstempel>.bak gesichert.`);
            }
        }
    }
    return lines;
}

// A generated /bdb-aos-* command file is removed only while it still matches the recorded hash.
function editedOpencodeCommands(manifest, home) {
    const dir = path.join(home, '.config', 'opencode', 'commands') + path.sep;
    return Object.keys(manifest || {}).filter((p) => p.startsWith(dir) && COMMANDS.includes(path.basename(p)) && fs.existsSync(p) && sha256(p) !== manifest[p].sha256);
}

// ---- (d) launchers ---------------------------------------------------------------------------
function ownedLauncher(file, home, name) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return false; }
    const targets = [path.join(home, '.agents', 'bin', `${name}.mjs`), path.join(claudeConfigDir(home), 'hooks', `${name}.mjs`)];
    if (!targets.some((t) => text.includes(t))) return false;
    return text.includes(LAUNCHER_MARKER) || targets.some((t) => text === `#!/bin/sh\nexec node "${t}" "$@"\n` || text === `@echo off\r\nnode "${t}" %*\r\n` || text === `node "${t}" $args\r\n`);
}
function reverseLaunchers({ home, dryRun }) {
    const dir = path.join(home, '.local', 'bin');
    const gone = [];
    for (const name of LAUNCHERS) {
        for (const ext of ['', '.cmd', '.ps1']) {
            const f = path.join(dir, name + ext);
            if (!fs.existsSync(f) || !ownedLauncher(f, home, name)) continue;
            if (!dryRun) fs.rmSync(f, { force: true });
            gone.push(name + ext);
        }
    }
    return gone.length ? [`Launcher ${dryRun ? 'würden entfernt' : 'entfernt'} aus ${dir}: ${gone.join(', ')}`] : [];
}

// ---- (e) Claude plugin installed by AOS ------------------------------------------------------
const realHome = (home) => { try { return path.resolve(home) === path.resolve(os.userInfo().homedir); } catch { return false; } };
function reverseClaude({ home, dryRun, runner, injected = false, env = process.env }) {
    const claude = readRecords(home).claude;
    if (!claude || (!claude.installedPlugin && !claude.addedMarketplace)) return [];
    const steps = [];
    if (claude.installedPlugin) steps.push(['plugin', 'uninstall', PLUGIN_ID]);
    if (claude.addedMarketplace) steps.push(['plugin', 'marketplace', 'remove', MARKETPLACE]);
    const lines = [];
    const live = !!runner && env.AOS_PLUGIN_CLI !== 'off' && (env.AOS_PLUGIN_CLI === 'on' || realHome(home) || injected);
    const next = { ...claude };
    for (const args of steps) {
        const label = `claude ${args.join(' ')}`;
        if (dryRun) { lines.push(`Claude Plugin: würde ausführen: ${label}`); continue; }
        if (!live) { lines.push(`Claude Plugin: nicht ausgeführt (kein echtes Home oder CLI abgeschaltet); von Hand ausführen: ${label}`); continue; }
        const r = runner(args);
        if (r && r.ok) {
            lines.push(`Claude Plugin: ${label} ok`);
            if (args[1] === 'uninstall') delete next.installedPlugin; else delete next.addedMarketplace;
        } else lines.push(`Claude Plugin: ${label} FEHLGESCHLAGEN${r && r.missing ? ' (claude nicht gefunden)' : ''}; von Hand ausführen.`);
    }
    if (!dryRun && live) writeRecords(home, { ...readRecords(home), claude: next });
    return lines;
}

// injected: the runner is a test double, so it may run although `home` is not the real home.
function reverseRegistrations({ home, dryRun = false, runner = null, injected = false, platform, env } = {}) {
    return [
        ...reverseClaude({ home, dryRun, runner, injected, env }),
        ...reverseAgy({ home, dryRun }),
        ...reverseCodex({ home, dryRun }),
        ...reverseOpencode({ home, dryRun, platform, env }),
        ...reverseLaunchers({ home, dryRun }),
    ];
}

module.exports = { CODEX_AOS_SCRIPTS, dropAosHookGroups, dropMcpTables, aosMcpNames, recordsPath, readRecords, retireRecords, recordOpencodePlugin, recordingCli, reverseRegistrations, editedOpencodeCommands, LAUNCHERS, AGY_NAMED };
