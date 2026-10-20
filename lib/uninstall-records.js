'use strict';
// What aos-uninstall needs beyond the file manifest: records of registrations AOS made in
// foreign config (Claude plugin, OpenCode plugin file) and the reversal of every registration
// that would otherwise point at deleted scripts. Pure of installer state: every path derives
// from `home`, tests drive it with a temp HOME and an injected Claude runner.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { pluginFile, COMMANDS } = require('./opencode-verify.js');
const { parseJsonc, removeJsoncArrayEntries } = require('./jsonc.js');
const { claudeConfigDir } = require('./plugin-evidence.js');
const mcpSecrets = require('./mcp-secrets.js');
const { backupOnce } = require('./backup-once');

const PLUGIN_ID = 'bdb-aos@bdb-marketplace';
const MARKETPLACE = 'bdb-marketplace';
const AGY_NAMED = ['aos-go-gate', 'aos-conventional-commits', 'aos-env-protection', 'aos-trail-relay', 'aos-graph-gate', 'aos-context', 'aos-a2a-inbox', 'aos-memb-save'];
const v5Profile = require('./v5/profile.js');
const AOS_SCRIPTS = v5Profile.HOOK_SCRIPTS;
const LAUNCHERS = ['aos-config', 'aos-dashboard', 'aos-uninstall', 'aos-store', 'aos-doctor', 'aos-acp', 'aos-bus', 'aos-gateway', 'aos-a2a', 'aos-gate', 'aos-hub', 'aos-gogate', 'aos-go-ref', 'aos-sessions', 'aos-trail', 'aos-router', 'aos-team', 'aos-plan-canvas', 'aos-archify', 'aos'];
const LAUNCHER_MARKER = '# aos-launcher';
// `aos` has no target file: the installer itself only lives in the npx cache, so its launcher runs npx.
const AOS_NPX_SPEC = '@hybridlabor-api/aos@';
// aos-bus ships as a hook (it imports ./go-gate.mjs); aos-trail, aos-plan-canvas and aos-archify ship
// inside the agenttrail, plan-canvas and archify skills (global_config/ is merged into ~/.agents/skills).
function launcherTarget(home, name) {
    if (name === 'aos-bus') return path.join(claudeConfigDir(home), 'hooks', 'aos-bus.mjs');
    if (name === 'aos-trail') return path.join(home, '.agents', 'skills', 'agenttrail', 'bin', 'agenttrail.mjs');
    if (name === 'aos-plan-canvas') return path.join(home, '.agents', 'skills', 'plan-canvas', 'scripts', 'plan-canvas.js');
    if (name === 'aos-archify') return path.join(home, '.agents', 'skills', 'archify', 'bin', 'archify.mjs');
    return path.join(home, '.agents', 'bin', `${name}.mjs`);
}
const OPENCODE_MARKER = 'BDB Agent OS (AOS) plugin for OpenCode';

const recordsPath = (home) => path.join(home, '.agents', '.bdb-uninstall-records.json');
const sha256 = (file) => { try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; } };
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

function readRecords(home) {
    try { return JSON.parse(fs.readFileSync(recordsPath(home), 'utf8').replace(/^﻿/, '')); } catch { return {}; }
}
function writeRecords(home, rec) {
    fs.mkdirSync(path.dirname(recordsPath(home)), { recursive: true });
    fs.writeFileSync(recordsPath(home), JSON.stringify(rec, null, 2) + '\n');
}
// Custom MCP config paths the installer wrote (platform 4, project .cursor): migration, doctor and uninstall look there too.
function recordMcpConfig(home, file) {
    if (!path.isAbsolute(file) || mcpSecrets.defaultHarnessMcpFiles(home).some((f) => path.resolve(f.file) === path.resolve(file))) return;
    const rec = readRecords(home);
    const list = Array.isArray(rec.mcpConfigs) ? rec.mcpConfigs : [];
    if (list.includes(file)) return;
    writeRecords(home, { ...rec, mcpConfigs: [...list, file] });
}
// Reversals that failed leave their entries behind; the record file goes only when nothing is pending.
function hasPending(home) {
    const nonEmpty = (v) => (Array.isArray(v) ? v.length > 0 : v && typeof v === 'object' ? Object.values(v).some(nonEmpty) : !!v);
    return Object.values(readRecords(home)).some(nonEmpty);
}
function retireRecords(home) { if (hasPending(home)) return; try { fs.rmSync(recordsPath(home), { force: true }); } catch { /* gone */ } }

function recordOpencodePlugin(home, file) {
    const sum = sha256(file);
    if (!sum) return;
    writeRecords(home, { ...readRecords(home), opencodePlugin: { path: file, sha256: sum } });
}

function recordOpencodeProfile(home, file) {
    const sum = sha256(file);
    if (!sum) return;
    writeRecords(home, { ...readRecords(home), opencodeProfile: { path: file, sha256: sum } });
}

// The profile flag is AOS-owned and tiny: removed when recorded (hash may differ after a profile switch) or exactly our shape.
function reverseOpencodeProfile({ home, dir, dryRun }) {
    const file = path.join(dir, 'plugins', 'aos-hooks', 'aos-profile.json');
    if (!fs.existsSync(file)) return [];
    let ours = false;
    try {
        const j = JSON.parse(fs.readFileSync(file, 'utf8'));
        ours = !!j && typeof j.contextHooks === 'boolean' && Object.keys(j).length === 1;
    } catch { /* not ours */ }
    const rec = readRecords(home).opencodeProfile;
    if (!ours && !(rec && path.resolve(rec.path) === path.resolve(file) && rec.sha256 === sha256(file))) return [];
    if (!dryRun) {
        fs.rmSync(file, { force: true });
        const { opencodeProfile, ...rest } = readRecords(home);
        writeRecords(home, rest);
    }
    return [`OpenCode: profile flag ${file} ${dryRun ? 'would be removed' : 'removed'}`];
}

// A2A lib copies under ~/.agents/lib: path + sha256, so uninstall removes exactly what AOS wrote.
function recordA2aLibCopies(home, files) {
    const entries = (files || []).map((f) => ({ path: f, sha256: sha256(f) })).filter((e) => e.sha256);
    if (!entries.length) return;
    const rec = readRecords(home);
    const byPath = new Map((Array.isArray(rec.a2aLibCopies) ? rec.a2aLibCopies : []).map((e) => [e.path, e]));
    for (const e of entries) byPath.set(e.path, e);
    writeRecords(home, { ...rec, a2aLibCopies: [...byPath.values()] });
}

// An edited copy is backed up before removal, like the manifest-driven uninstall does.
function reverseA2aLibCopies({ home, dryRun }) {
    const list = readRecords(home).a2aLibCopies;
    if (!Array.isArray(list) || !list.length) return [];
    const libDir = path.join(home, '.agents', 'lib') + path.sep;
    const gone = [];
    for (const e of list) {
        if (!e || typeof e.path !== 'string' || !path.resolve(e.path).startsWith(libDir) || !fs.existsSync(e.path)) continue;
        if (!dryRun) {
            if (sha256(e.path) !== e.sha256) fs.copyFileSync(e.path, `${e.path}.${stamp()}.bak`);
            fs.rmSync(e.path, { force: true });
        }
        gone.push(path.basename(e.path));
    }
    if (!dryRun) {
        const { a2aLibCopies, ...rest } = readRecords(home);
        writeRecords(home, rest);
    }
    return gone.length ? [`A2A lib copies ${dryRun ? 'would be removed from' : 'removed from'} ${libDir}: ${gone.join(', ')}`] : [];
}

// Global npm packages AOS installed itself (deja-vu): uninstall touches them only when listed here.
function recordNpmGlobal(home, pkg) {
    const rec = readRecords(home);
    const list = Array.isArray(rec.npmGlobal) ? rec.npmGlobal : [];
    if (list.includes(pkg)) return;
    writeRecords(home, { ...rec, npmGlobal: [...list, pkg] });
}
function forgetNpmGlobal(home, pkg) {
    const rec = readRecords(home);
    writeRecords(home, { ...rec, npmGlobal: (Array.isArray(rec.npmGlobal) ? rec.npmGlobal : []).filter((p) => p !== pkg) });
}

// Skill folders a package copied into harness skill dirs (path + sha256 of SKILL.md) and the cargo
// crates AOS built for it: uninstall removes exactly these, and only while the skill is still unedited.
function recordSkillCopies(home, pkg, dirs) {
    const rec = readRecords(home);
    const rust = rec[pkg] || { skillCopies: [], cargoCrates: [] };
    const fresh = (dirs || []).map((d) => ({ path: d, sha256: sha256(path.join(d, 'SKILL.md')) })).filter((e) => e.sha256);
    const kept = rust.skillCopies.filter((e) => !fresh.some((f) => f.path === e.path));
    writeRecords(home, { ...rec, [pkg]: { ...rust, skillCopies: [...kept, ...fresh] } });
}
function recordCargoCrate(home, pkg, crate) {
    const rec = readRecords(home);
    const rust = rec[pkg] || { skillCopies: [], cargoCrates: [] };
    if (rust.cargoCrates.includes(crate)) return;
    writeRecords(home, { ...rec, [pkg]: { ...rust, cargoCrates: [...rust.cargoCrates, crate] } });
}
function reverseRustauri({ home, dryRun = false, runCargo = () => false }) {
    const rec = readRecords(home);
    const mine = rec.rustauri || { skillCopies: [], cargoCrates: [] };
    const notes = [];
    let changed = false;
    for (const e of mine.skillCopies) {
        if (!e || typeof e.path !== 'string' || !fs.existsSync(e.path)) continue;
        if (sha256(path.join(e.path, 'SKILL.md')) !== e.sha256) { notes.push(`${e.path} was edited after install and is kept`); continue; }
        changed = true;
        if (!dryRun) fs.rmSync(e.path, { recursive: true, force: true });
    }
    const failedCrates = [];
    for (const crate of mine.cargoCrates) {
        changed = true;
        if (!dryRun && !runCargo(crate)) failedCrates.push(crate);
    }
    if (failedCrates.length) notes.push(`cargo uninstall ${failedCrates.join(', ')} failed; run it by hand`);
    if (!dryRun) {
        const { rustauri, ...others } = rec;
        const left = failedCrates.length ? { rustauri: { skillCopies: [], cargoCrates: failedCrates } } : {};
        writeRecords(home, { ...others, ...left });
    }
    return { changed, error: notes.join('; ') || undefined };
}

// Files the installer generates outside the file manifest (compiled agents, ~/.aos/router.json): path + sha256.
function recordGeneratedFiles(home, files) {
    const fresh = (files || []).map((f) => ({ path: f, sha256: sha256(f) })).filter((e) => e.sha256);
    if (!fresh.length) return;
    const rec = readRecords(home);
    const byPath = new Map((Array.isArray(rec.generatedFiles) ? rec.generatedFiles : []).map((e) => [e.path, e]));
    for (const e of fresh) byPath.set(e.path, e);
    writeRecords(home, { ...rec, generatedFiles: [...byPath.values()] });
}

// path -> sha256 of the generated files AOS recorded.
function generatedMap(home) {
    const list = readRecords(home).generatedFiles;
    return new Map((Array.isArray(list) ? list : []).filter((e) => e && typeof e.path === 'string').map((e) => [path.resolve(e.path), e.sha256]));
}

const CODEX_AGENT_MARKER = '# aos-managed: generated by the AOS installer, rewritten on update';
const CODEX_LEGACY_MARKER = /^# Codex subagent configuration for /;
function isAosCodexAgentFile(file) {
    try {
        const first = fs.readFileSync(file, 'utf8').split('\n', 1)[0];
        return first === CODEX_AGENT_MARKER || CODEX_LEGACY_MARKER.test(first);
    } catch { return false; }
}

// Removes empty directories under dir (and dir itself); never touches a file.
function pruneEmptyDirs(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory()) pruneEmptyDirs(path.join(dir, e.name));
    try { fs.rmdirSync(dir); } catch { /* not empty */ }
}

// Recorded files still matching their hash go; an edited one is the user's now and stays. Codex agents
// also carry a marker, which covers installs from before the record existed.
function reverseGeneratedFiles({ home, dryRun = false }) {
    const root = path.resolve(home) + path.sep;
    const rec = readRecords(home);
    const gone = new Set();
    const kept = [];
    const recorded = new Set();
    for (const e of Array.isArray(rec.generatedFiles) ? rec.generatedFiles : []) {
        if (!e || typeof e.path !== 'string' || !path.resolve(e.path).startsWith(root)) continue;
        recorded.add(path.resolve(e.path));
        if (!fs.existsSync(e.path)) continue;
        if (sha256(e.path) === e.sha256) gone.add(e.path); else kept.push(e.path);
    }
    // Marker-only Codex agents (no record) are never deleted: the marker proves nothing about edits. They are
    // listed instead, and become recorded (so removable) once `aos update` rewrites them.
    const unrecorded = [];
    const codexDir = path.join(home, '.codex', 'agents');
    try {
        for (const f of fs.readdirSync(codexDir)) {
            const full = path.join(codexDir, f);
            if (f.endsWith('.toml') && !recorded.has(path.resolve(full)) && isAosCodexAgentFile(full)) unrecorded.push(full);
        }
    } catch { /* no codex agents */ }
    const failed = [];
    if (!dryRun) {
        for (const f of gone) {
            try {
                fs.rmSync(f, { force: true });
                if (path.basename(f) === 'agent.md') { try { fs.rmdirSync(path.dirname(f)); } catch { /* not empty */ } }
            } catch { failed.push(f); }
        }
        const { generatedFiles, ...rest } = rec;
        const left = (Array.isArray(generatedFiles) ? generatedFiles : []).filter((e) => e && failed.includes(e.path));
        if (generatedFiles) writeRecords(home, left.length ? { ...rest, generatedFiles: left } : rest);
        pruneEmptyDirs(path.join(home, '.aos', 'library'));
    }
    const lines = gone.size ? [`Generated agent and router files ${dryRun ? 'would be removed' : 'removed'}: ${gone.size}`] : [];
    for (const f of kept) lines.push(`${f} was edited after install and is kept`);
    if (unrecorded.length) lines.push(`${unrecorded.length} Codex agent file(s) in ${codexDir} carry the AOS marker but were never recorded and are kept; run aos update once, then uninstall again, or delete them by hand`);
    for (const f of failed) lines.push(`${f} could not be removed; the record is kept, run aos-uninstall again`);
    return lines;
}

function recordAoService(home, bin) { writeRecords(home, { ...readRecords(home), aoService: { bin } }); }
function recordTokenSaver(home) { writeRecords(home, { ...readRecords(home), tokenSaver: true }); }

// `ao service uninstall` removes AO's own autostart on every OS; only after AOS registered it.
function reverseAoService({ home, dryRun = false, run = (cmd, args) => cp.spawnSync(cmd, args, { stdio: 'ignore', timeout: 60000, windowsHide: true }) }) {
    const rec = readRecords(home);
    const bin = rec.aoService && rec.aoService.bin;
    if (typeof bin !== 'string' || !fs.existsSync(bin)) return [];
    if (!dryRun) {
        const r = run(bin, ['service', 'uninstall']);
        if (r && r.status === 0) { const { aoService, ...rest } = rec; writeRecords(home, rest); }
        else return [`AO service could not be removed; run: ${bin} service uninstall`];
    }
    return [`AO service ${dryRun ? 'would be removed' : 'removed'} (ao service uninstall)`];
}

// Token Saver's own uninstaller (Claude plugin, hooks); its data directory (stats, config) always stays, --purge does not cover it.
function reverseTokenSaver({ home, dryRun = false, vendorDir, run = (cmd, args, cwd) => cp.spawnSync(cmd, args, { cwd, stdio: 'ignore', timeout: 120000, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } }) }) {
    const rec = readRecords(home);
    if (!rec.tokenSaver || !vendorDir || !fs.existsSync(path.join(vendorDir, 'install.py'))) return [];
    if (!dryRun) {
        const r = run(process.platform === 'win32' ? 'python' : 'python3', ['install.py', '--uninstall', '--target', 'all', '--keep-data'], vendorDir);
        if (!r || r.status !== 0) return ['Token Saver could not be removed; run: python3 install.py --uninstall in its vendor folder'];
        const { tokenSaver, ...rest } = rec;
        writeRecords(home, rest);
    }
    return [`Token Saver ${dryRun ? 'would be removed' : 'removed'} (stats and config kept)`];
}

// The retired launchpad: login item (macOS plist, Windows Startup .vbs) and the generated page. Named files only.
function reverseLaunchpad({ home, dryRun = false, platform = process.platform, env = process.env, run = (cmd, args) => cp.spawnSync(cmd, args, { stdio: 'ignore', timeout: 30000, windowsHide: true }) }) {
    // Each file goes only when it is exactly what the old generator wrote; anything else is the user's and is only reported.
    const page = path.join(home, '.agents', 'bdb-launchpad.html');
    const plistFile = path.join(home, 'Library', 'LaunchAgents', 'com.bdb.launchpad.plist');
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bdb.launchpad</string>
    <key>ProgramArguments</key>
    <array>
        <string>open</string>
        <string>${page}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>`;
    const vbsFile = path.join((env && env.APPDATA) || path.join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'com.bdb.launchpad.vbs');
    const vbs = `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.Run """${page}""", 1, False\r\n`;
    const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
    const isPage = (t) => t !== null && t.split(/\r?\n/).includes('  <title>BDB Agent OS \u2013 Launchpad</title>');
    const files = [];
    const foreign = [];
    for (const [f, ok] of [[page, isPage(read(page))], [plistFile, read(plistFile) === plist], [vbsFile, read(vbsFile) === vbs]]) {
        if (!fs.existsSync(f)) continue;
        (ok ? files : foreign).push(f);
    }
    if (!dryRun) {
        for (const f of files) {
            if (platform === 'darwin' && f.endsWith('.plist')) run('launchctl', ['unload', f]);
            fs.rmSync(f, { force: true });
        }
    }
    const out = files.length ? [`Launchpad leftovers ${dryRun ? 'would be removed' : 'removed'} (replaced by the AOS Hub): ${files.map((f) => path.basename(f)).join(', ')}`] : [];
    for (const f of foreign) out.push(`${f} looks like a launchpad file but was changed; kept, delete it by hand if unwanted`);
    return out;
}

// Wraps the Claude CLI runner of the plugin migration: a successful `marketplace add` / `install`
// means AOS itself added them (the migration only runs those steps when the entry was absent).
function recordingCli(home, cli) {
    if (typeof cli !== 'function') return cli;
    return (args, opts) => {
        const r = cli(args, opts);
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
    let mode = null;
    try { mode = fs.statSync(target).mode & 0o777; } catch { /* new file */ }
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n', { mode: mode === null ? 0o666 : mode });
    if (mode !== null) fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, target);
}
// Exact script basename among the command's words; a user's my-go-gate.mjs or a path that merely contains the name does not match.
const commandRunsScript = (c, names) => typeof c === 'string' && c.split(/[\s"']+/).some((t) => names.includes(path.basename(t.replace(/\\/g, '/'))));
const isAosCommand = (c) => commandRunsScript(c, AOS_SCRIPTS);
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
        try { data = JSON.parse(fs.readFileSync(real, 'utf8').replace(/^﻿/, '')); } catch { lines.push(`Antigravity: ${f} unreadable, check it by hand.`); continue; }
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
        lines.push(`Antigravity: ${dryRun ? 'would remove' : 'removed'} from ${f}: ${what}`);
        if (!dryRun) writeThrough(f, data);
    }
    return lines;
}

// ---- (b) Codex config.toml AOS:HOOKS block ----------------------------------------------------
const CODEX_AOS_SCRIPTS = v5Profile.HOOK_SCRIPTS;

// Drops the AOS handlers ([[hooks.X.hooks]] tables whose command runs one of our scripts, matched by exact
// basename); a [[hooks.X]] group goes only when none of its handlers is left. Every other table stays.
// Shared by the installer's merge and the uninstaller.
function dropAosHookGroups(lines, scripts = CODEX_AOS_SCRIPTS, dropped = []) {
    const sections = [];
    for (const l of lines) {
        if (/^\s*\[/.test(l) || !sections.length) sections.push([l]);
        else sections[sections.length - 1].push(l);
    }
    const isHookHeader = (sec) => /^\s*\[\[hooks\.\w+\]\]\s*$/.test(sec[0]);
    const isHookInner = (sec) => /^\s*\[\[hooks\.\w+\.hooks\]\]\s*$/.test(sec[0]);
    const runsOurs = (sec) => sec.some((l) => /^\s*command\s*=/.test(l) && commandRunsScript(l.slice(l.indexOf('=') + 1), scripts));
    // keep trailing blanks/comments of a dropped table (they may belong to another tool's marker)
    const dropSection = (sec, kept) => {
        dropped.push(...sec);
        let end = sec.length;
        while (end > 0 && /^\s*(#.*)?$/.test(sec[end - 1])) end--;
        if (end < sec.length) kept.push(sec.slice(end));
    };
    const kept = [];
    for (let i = 0; i < sections.length; i++) {
        if (!isHookHeader(sections[i])) { kept.push(sections[i]); continue; }
        let j = i + 1;
        while (j < sections.length && isHookInner(sections[j])) j++;
        const header = sections[i];
        const inners = sections.slice(i + 1, j);
        if (runsOurs(header)) {
            dropSection(header, kept);
            for (const sec of inners) dropSection(sec, kept);
        } else if (inners.some(runsOurs)) {
            const left = inners.filter((sec) => !runsOurs(sec));
            if (left.length) {
                kept.push(header);
                for (const sec of inners) { if (runsOurs(sec)) dropSection(sec, kept); else kept.push(sec); }
            } else {
                dropSection(header, kept);
                for (const sec of inners) dropSection(sec, kept);
            }
        } else kept.push(header, ...inners);
        i = j - 1;
    }
    return kept.flat();
}

// Hash of the AOS hook groups in a Codex config.toml, comments and blank lines ignored: Codex drops
// the markers on rewrite, so only the groups themselves say whether the hooks changed.
function codexAosHookHash(text) {
    const dropped = [];
    dropAosHookGroups(String(text || '').split(/\r?\n/), CODEX_AOS_SCRIPTS, dropped);
    const body = dropped.map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).join('\n');
    return body ? crypto.createHash('sha256').update(body).digest('hex') : '';
}

// Every sha256 trust value Codex recorded in config.toml (its trusted_hash entries), sorted.
function codexTrustedHashes(text) {
    return [...new Set(String(text || '').match(/sha256:[0-9a-f]+/gi) || [])].sort();
}


// AOS MCP server names come from the shipped template. Generic names a user may own too
// (github, deja, ...) are only removed from inside an intact AOS:MCP block, never marker-less.
const GENERIC_MCP_NAMES = ['github', 'chrome-devtools', 'deja', 'open_design_mcp'];
function aosMcpNames() {
    try { return Object.keys(mcpSecrets.shippedAll(path.join(__dirname, '..'))); } catch { return []; }
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

// Codex merges ~/.codex/hooks.json and config.toml hooks and warns at startup. AOS keeps its hooks in
// config.toml only, so AOS entries in hooks.json are removed (foreign ones stay) and the original is kept
// as hooks.json.aos-bak-<ts>; a file left without hooks is renamed, never deleted.
function migrateCodexHooksJson({ file, dryRun = false, now = stamp } = {}) {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
    let data;
    try { data = JSON.parse(raw.replace(/^﻿/, '')); } catch { return [`Codex: ${file} is not valid JSON; AOS hooks in it were not migrated, check it by hand.`]; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
    if (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks)) return [];
    let removed = 0;
    const kept = {};
    for (const [event, entries] of Object.entries(data.hooks)) {
        if (!Array.isArray(entries)) { kept[event] = entries; continue; }
        const rest = [];
        for (const e of entries) {
            if (e && Array.isArray(e.hooks)) {
                const hs = e.hooks.filter((x) => !isAosCommand(x && x.command));
                removed += e.hooks.length - hs.length;
                if (hs.length) rest.push(hs.length === e.hooks.length ? e : { ...e, hooks: hs });
            } else if (isAosCommand(e && e.command)) removed++;
            else rest.push(e);
        }
        if (rest.length) kept[event] = rest;
    }
    if (!removed) return [];
    const { hooks, ...others } = data;
    const empty = !Object.keys(kept).length;
    const bak = `${file}.aos-bak-${now()}`;
    if (!dryRun) {
        if (empty && !Object.keys(others).length) fs.renameSync(file, bak);
        else {
            fs.copyFileSync(file, bak);
            writeThrough(file, empty ? others : { ...others, hooks: kept });
        }
    }
    return [`Codex: ${removed} AOS hook(s) ${dryRun ? 'would be moved' : 'moved'} out of ${file} into config.toml (original kept as ${path.basename(bak)})`];
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
    const shipped = mcpSecrets.shippedAll(path.join(__dirname, '..'));
    const ownedLauncherTable = (n, sec) => {
        const t = mcpSecrets.parseCodexTables(sec.join('\n'))[n];
        const e = t && { command: t.fields.command, args: t.fields.args };
        return !!e && mcpSecrets.isLauncherEntry(e) && mcpSecrets.isAosOwned(n, e, null, shipped);
    };
    ls = dropMcpTables(dropAosHookGroups(ls), (n, sec) => unique.includes(n) || ownedLauncherTable(n, sec));

    const norm = (arr) => { const o = arr.slice(); while (o.length && o[o.length - 1].trim() === '') o.pop(); return o.join('\n').replace(/\n{3,}/g, '\n\n'); };
    if (norm(ls) === norm(raw.split(/\r?\n/))) return [];
    if (!dryRun) {
        mcpSecrets.safeBackup(file, `${file}.${stamp()}.bak`);
        writeThrough(file, norm(ls).split('\n').join(eol) + eol);
    }
    return [`Codex: AOS hooks and MCP entries ${dryRun ? 'would be removed from' : 'removed from'} ${file} (foreign tables stay)`];
}

// ---- (b2) Codex execution-policy rules file ------------------------------------------------------
// <codex home>/rules/aos-gate.rules is AOS-owned only while it starts with the header; a file without it is the user's.
const CODEX_RULES_HEADER = '# AOS-OWNED: written by the AOS installer, removed by aos-uninstall. Edit your own rules in another file.';

function recordCodexRules(home, { dirCreated }) {
    const rec = readRecords(home);
    writeRecords(home, { ...rec, codexRules: { dirCreated: !!(dirCreated || (rec.codexRules && rec.codexRules.dirCreated)) } });
}

function reverseCodexRules({ home, dryRun }) {
    const dir = path.join(home, '.codex', 'rules');
    const file = path.join(dir, 'aos-gate.rules');
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
    if (!text.startsWith(CODEX_RULES_HEADER)) return [`Codex: ${file} is not from AOS, kept.`];
    if (!dryRun) {
        fs.rmSync(file, { force: true });
        const { codexRules, ...rest } = readRecords(home);
        if (codexRules && codexRules.dirCreated) { try { fs.rmdirSync(dir); } catch { /* not empty: not ours to remove */ } }
        writeRecords(home, rest);
    }
    return [`Codex: rules file ${file} ${dryRun ? 'would be removed' : 'removed'}`];
}

// ---- (c) OpenCode plugin file, plugin[] entry ------------------------------------------------
function reverseOpencode({ home, dryRun, platform = process.platform, env = process.env }) {
    const lines = [];
    const dirs = [...new Set([path.join(home, '.config', 'opencode'), ...(platform === 'win32' ? [path.join(env.APPDATA || home, 'opencode')] : [])])];
    const rec = readRecords(home).opencodePlugin;
    for (const dir of dirs) {
        lines.push(...reverseOpencodeProfile({ home, dir, dryRun }));
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
                lines.push(`OpenCode: plugin ${file} ${dryRun ? 'would be removed' : 'removed'}${modified ? ' (content differs from the installed version, backed up as .bak first)' : ''}`);
                if (!dryRun) {
                    if (modified) fs.copyFileSync(file, `${file}.${stamp()}.bak`);
                    fs.rmSync(file, { force: true });
                }
                removedFile = true;
            } else lines.push(`OpenCode: ${file} is not from AOS, kept together with its plugin[] entry.`);
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
            lines.push(`OpenCode: plugin[] entry for bdb-aos.js ${dryRun ? 'would be removed from' : 'removed from'} ${cfgFile}`);
            if (dryRun) continue;
            fs.copyFileSync(cfgFile, `${cfgFile}.${stamp()}.bak`);
            // Textual edit keeps comments and formatting; a rewrite is the fallback and says so.
            const text = removeJsoncArrayEntries(fs.readFileSync(cfgFile, 'utf8'), 'plugin', isOurs);
            if (text !== null) writeThrough(cfgFile, text);
            else {
                if (keep.length) conf.plugin = keep; else delete conf.plugin;
                writeThrough(cfgFile, conf);
                lines.push(`OpenCode: comments in ${cfgFile} were not preserved; original backed up as ${path.basename(cfgFile)}.<timestamp>.bak.`);
            }
            // Nothing but AOS content was in it (the backup above keeps a copy): the file goes, not an empty shell.
            try {
                const raw = fs.readFileSync(cfgFile, 'utf8');
                const left = parseJsonc(raw);
                // JSON.parse throws while a comment (or trailing comma) is left: such a file is the user's, it stays.
                JSON.parse(raw);
                if (left && typeof left === 'object' && !Object.keys(left).some((k) => k !== '$schema')) {
                    fs.rmSync(cfgFile, { force: true });
                    lines.push(`OpenCode: ${cfgFile} held only AOS content and was removed (backup kept as ${path.basename(cfgFile)}.<timestamp>.bak).`);
                }
            } catch { /* unreadable or still has comments: leave it */ }
        }
    }
    if (!dryRun) { const { opencodePlugin, ...rest } = readRecords(home); if (opencodePlugin) writeRecords(home, rest); }
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
    if (name === 'aos') return text.includes(LAUNCHER_MARKER) && text.includes(AOS_NPX_SPEC);
    // aos-uninstall runs from the package (npx -p), so its launcher names no file under ~/.agents/bin.
    if (name === 'aos-uninstall' && text.includes(LAUNCHER_MARKER) && text.includes(AOS_NPX_SPEC)) return true;
    const targets = [launcherTarget(home, name), path.join(home, '.agents', 'bin', `${name}.mjs`), path.join(claudeConfigDir(home), 'hooks', `${name}.mjs`)];
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
    return gone.length ? [`Launchers ${dryRun ? 'would be removed from' : 'removed from'} ${dir}: ${gone.join(', ')}`] : [];
}

// ---- (d2) MCP entries in launcher form (aos-mcp-env) -------------------------------------------
// Only entries that run through the AOS launcher under a shipped name are removed; the secrets file is user data and stays.
function reverseMcpLaunchers({ home, dryRun, env = process.env, platform = process.platform }) {
    const lines = [];
    const shipped = mcpSecrets.shippedAll(path.join(__dirname, '..'));
    const isOurs = (n, e) => mcpSecrets.isLauncherEntry(e) && mcpSecrets.isAosOwned(n, e, null, shipped);
    for (const { file, kind } of mcpSecrets.harnessMcpFiles(home, env, platform)) {
        if (kind === 'toml') continue;
        let data;
        try { data = parseJsonc(fs.readFileSync(file, 'utf8')); } catch { continue; }
        const map = data && data[kind === 'opencode' ? 'mcp' : 'mcpServers'];
        if (!map || typeof map !== 'object') continue;
        const gone = Object.keys(map).filter((n) => isOurs(n, kind === 'opencode' ? mcpSecrets.fromOpencode(map[n]) : map[n]));
        if (!gone.length) continue;
        lines.push(`MCP: launcher entries ${dryRun ? 'would be removed from' : 'removed from'} ${file}: ${gone.join(', ')}`);
        if (dryRun) continue;
        const mode = fs.statSync(file).mode & 0o777;
        const bak = `${file}.${stamp()}.bak`;
        mcpSecrets.safeBackup(file, bak);
        for (const n of gone) delete map[n];
        if (kind === 'opencode' && !Object.keys(map).length) delete data.mcp;
        // Only $schema left: AOS created the file (the backup above keeps a copy), so it goes, not an empty shell.
        if (kind === 'opencode' && !Object.keys(data).some((k) => k !== '$schema')) {
            fs.rmSync(file, { force: true });
            lines.push(`OpenCode: ${file} held only AOS content and was removed (backup kept as ${path.basename(file)}.<timestamp>.bak).`);
            continue;
        }
        writeThrough(file, data);
        try { fs.chmodSync(file, mode); } catch { /* best effort */ }
    }
    const secrets = mcpSecrets.secretsPath(home);
    if (fs.existsSync(secrets)) lines.push(`Secrets file ${secrets} is kept (user data, AOS does not remove it).`);
    if (!dryRun) { const { mcpConfigs, ...rest } = readRecords(home); if (mcpConfigs) writeRecords(home, rest); }
    return lines;
}

// ---- (e) Claude plugin installed by AOS ------------------------------------------------------
const realHome = (home) => { try { return path.resolve(home) === path.resolve(os.userInfo().homedir); } catch { return false; } };
// null = safe to remove; 'gone' = already absent; otherwise the reason it must stay.
function marketplaceInUse(runner) {
    const pm = require('./plugin-migration.js');
    const mk = runner(['plugin', 'marketplace', 'list']);
    if (!mk || !mk.ok) return 'could not list marketplaces';
    const mine = pm.parseEntries(mk.stdout).find((e) => e.name === MARKETPLACE);
    if (!mine) return 'gone';
    if (pm.sourceRepo(mine) !== pm.OWN_REPO) return 'it points at another source';
    const pl = runner(['plugin', 'list']);
    if (!pl || !pl.ok) return 'could not list plugins';
    return pm.parseEntries(pl.stdout).some((e) => e.name.endsWith(`@${MARKETPLACE}`) && e.name !== PLUGIN_ID) ? 'other plugins use it' : null;
}
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
        if (dryRun) { lines.push(`Claude plugin: would run: ${label}`); continue; }
        if (!live) { lines.push(`Claude plugin: not run (no real home or CLI disabled); run it by hand: ${label}`); continue; }
        if (args[1] === 'marketplace') {
            // Only an AOS-sourced marketplace that no other plugin uses; anything else is the user's.
            const why = marketplaceInUse(runner);
            if (why === 'gone') { delete next.addedMarketplace; continue; }
            if (why) { lines.push(`Claude plugin: ${MARKETPLACE} kept (${why})`); if (!why.startsWith('could not')) delete next.addedMarketplace; continue; }
        }
        const r = runner(args);
        if (r && r.ok) {
            lines.push(`Claude plugin: ${label} ok`);
            if (args[1] === 'uninstall') delete next.installedPlugin; else delete next.addedMarketplace;
        } else lines.push(`Claude plugin: ${label} FAILED${r && r.missing ? ' (claude not found)' : ''}; run it by hand.`);
    }
    if (!dryRun && live) writeRecords(home, { ...readRecords(home), claude: next });
    return lines;
}

// ---- (f) permissions.deny rules AOS added to Claude settings.json ---------------------------------
// The record holds only rules AOS itself added (absent before); a rule the user already had is never
// recorded and therefore never removed.
function addClaudeDeny({ home, settingsPath, rules }) {
    let s;
    try { s = parseJsonc(fs.readFileSync(settingsPath, 'utf8')); } catch { return []; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return [];
    if (s.permissions !== undefined && (!s.permissions || typeof s.permissions !== 'object' || Array.isArray(s.permissions))) return [];
    const perms = s.permissions || {};
    if (perms.deny !== undefined && !Array.isArray(perms.deny)) return [];
    const deny = perms.deny || [];
    const added = rules.filter((r) => !deny.includes(r));
    if (added.length) {
        try { backupOnce(settingsPath, () => mcpSecrets.safeBackup(settingsPath, `${settingsPath}.${stamp()}.bak`)); } catch (e) { return []; }
        writeThrough(settingsPath, { ...s, permissions: { ...perms, deny: [...deny, ...added] } });
        const prev = readRecords(home).claudeDeny;
        const prior = prev && prev.file === settingsPath && Array.isArray(prev.rules) ? prev.rules : [];
        writeRecords(home, { ...readRecords(home), claudeDeny: { file: settingsPath, rules: [...new Set([...prior, ...added])] } });
    }
    return added;
}

function reverseClaudeDeny({ home, dryRun }) {
    const rec = readRecords(home).claudeDeny;
    if (!rec || !rec.file || !Array.isArray(rec.rules) || !rec.rules.length) return [];
    let s;
    try { s = parseJsonc(fs.readFileSync(rec.file, 'utf8')); } catch { return []; }
    const deny = s && s.permissions && Array.isArray(s.permissions.deny) ? s.permissions.deny : [];
    const kept = deny.filter((r) => !rec.rules.includes(r));
    if (kept.length === deny.length) return [];
    if (!dryRun) {
        const perms = { ...s.permissions };
        if (kept.length) perms.deny = kept; else delete perms.deny;
        const next = { ...s };
        if (Object.keys(perms).length) next.permissions = perms; else delete next.permissions;
        writeThrough(rec.file, next);
        const { claudeDeny, ...rest } = readRecords(home);
        writeRecords(home, rest);
    }
    return [`Claude: ${deny.length - kept.length} AOS permissions.deny rule(s) ${dryRun ? 'would be removed from' : 'removed from'} ${rec.file} (your own rules stay)`];
}

// ---- (g) saved install options ---------------------------------------------------------------------
// ~/.aos/v5-settings.json holds the profile, noHooks and disabled keys AOS owns. The file is moved aside, never
// deleted; keys that are not ours stay in a fresh file. After this a reinstall starts from the standard profile.
// Written without validation, but still AOS state: a reinstall must ask again and not point at a removed ingest job.
const UNVALIDATED_KEYS = ['codingMode', 'memoryIngest', 'memory'];
function resetV5Settings({ home, dryRun }) {
    const ours = [...v5Profile.OWNED_KEYS, ...UNVALIDATED_KEYS];
    const file = v5Profile.settingsFile(home);
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
    let rest = {};
    try {
        const data = JSON.parse(raw.replace(/^﻿/, ''));
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            if (!ours.some((k) => Object.hasOwn(data, k))) return []; // nothing of ours in it
            for (const [k, v] of Object.entries(data)) if (!ours.includes(k) && k !== '__proto__') rest[k] = v;
        }
    } catch { rest = {}; } // unreadable: ours to move aside too
    const aside = `${file}.removed-${stamp()}`;
    if (!dryRun) {
        fs.renameSync(file, aside);
        if (Object.keys(rest).length) fs.writeFileSync(file, JSON.stringify(rest, null, 2) + '\n');
    }
    return [`Saved install options (profile, no-hooks, disabled packages) ${dryRun ? 'would be moved' : 'moved'} to ${aside}`];
}

// injected: the runner is a test double, so it may run although `home` is not the real home.
function reverseRegistrations({ home, dryRun = false, runner = null, injected = false, platform, env, failures = [] } = {}) {
    // One failing reversal (EPERM, locked file) must not skip the rest; its record stays for a rerun.
    const steps = [
        ['claude', () => reverseClaude({ home, dryRun, runner, injected, env })],
        ['claude deny rules', () => reverseClaudeDeny({ home, dryRun })],
        ['agy', () => reverseAgy({ home, dryRun })],
        ['codex', () => reverseCodex({ home, dryRun })],
        ['codex rules', () => reverseCodexRules({ home, dryRun })],
        ['opencode', () => reverseOpencode({ home, dryRun, platform, env })],
        ['mcp launchers', () => reverseMcpLaunchers({ home, dryRun, env, platform })],
        ['launchers', () => reverseLaunchers({ home, dryRun })],
        ['a2a lib copies', () => reverseA2aLibCopies({ home, dryRun })],
        ['generated files', () => reverseGeneratedFiles({ home, dryRun })],
        ['ao service', () => reverseAoService({ home, dryRun })],
        ['launchpad', () => reverseLaunchpad({ home, dryRun, platform, env })],
        ['token saver', () => reverseTokenSaver({ home, dryRun, vendorDir: path.join(__dirname, '..', 'vendor', 'token-saver') })],
        ['v5 settings', () => resetV5Settings({ home, dryRun })],
    ];
    return steps.flatMap(([label, fn]) => {
        try { return fn(); } catch (e) { failures.push(`${label}: ${e.message}`); return [`FAILED ${label}: ${e.message}; run aos-uninstall again`]; }
    });
}

module.exports = { CODEX_RULES_HEADER, recordCodexRules, reverseCodexRules, migrateCodexHooksJson, resetV5Settings, recordMcpConfig, recordNpmGlobal, forgetNpmGlobal, recordSkillCopies, recordCargoCrate, reverseRustauri, recordA2aLibCopies, reverseA2aLibCopies, recordGeneratedFiles, generatedMap, reverseGeneratedFiles, recordAoService, reverseAoService, reverseLaunchpad, recordTokenSaver, reverseTokenSaver, CODEX_AGENT_MARKER, CODEX_LEGACY_MARKER, isAosCodexAgentFile, addClaudeDeny, reverseClaudeDeny, CODEX_AOS_SCRIPTS, dropAosHookGroups, codexAosHookHash, codexTrustedHashes, dropMcpTables, aosMcpNames, recordsPath, readRecords, retireRecords, commandRunsScript, hasPending, recordOpencodePlugin, recordOpencodeProfile, recordingCli, reverseRegistrations, editedOpencodeCommands, LAUNCHERS, LAUNCHER_MARKER, AOS_NPX_SPEC, launcherTarget, AGY_NAMED };
