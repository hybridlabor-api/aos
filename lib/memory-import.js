'use strict';
// Memory import (nightly memB ingest of project docs and wikis), configured per machine in ~/.aos/v5-settings.json:
//   memoryIngest: { paths: [absolute dirs], time: "HH:MM" }
// Nothing ships with a value: no paths = nothing is ingested, no time = no schedule. Projects found under a path are
// directories with .openwiki or AGENTS.md (worktrees "-wt-" skipped), looked for up to two levels below it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readSettings, writeSettings, isTestSandbox } = require('./v5/profile');
const nightly = require('./memb-nightly');

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const validTime = (t) => typeof t === 'string' && TIME_RE.test(t);
const expand = (p, home) => (p === '~' ? home : String(p).startsWith('~/') ? path.join(home, p.slice(2)) : p);

function read(home) {
    const raw = readSettings(home).memoryIngest;
    const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const paths = [...new Set((Array.isArray(o.paths) ? o.paths : []).filter((p) => typeof p === 'string' && path.isAbsolute(p)))];
    return { paths, time: validTime(o.time) ? o.time : null, off: raw === 'off' || o.enabled === false };
}

function save(home, cfg) {
    const st = readSettings(home);
    const next = { paths: cfg.paths };
    if (cfg.time) next.time = cfg.time;
    writeSettings(home, { ...st, memoryIngest: next });
}

function addPath(home, dir) {
    const abs = path.resolve(expand(dir, home));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`not a directory: ${abs}`);
    const cfg = read(home);
    if (cfg.paths.includes(abs)) return { cfg, changed: false, path: abs };
    cfg.paths.push(abs);
    save(home, cfg);
    return { cfg, changed: true, path: abs };
}

function removePath(home, dir) {
    const abs = path.resolve(expand(dir, home));
    const cfg = read(home);
    if (!cfg.paths.includes(abs)) return { cfg, changed: false, path: abs };
    cfg.paths = cfg.paths.filter((p) => p !== abs);
    save(home, cfg);
    return { cfg, changed: true, path: abs };
}

function setTime(home, time) {
    if (time !== null && !validTime(time)) throw new Error(`time must be HH:MM (24h), got "${time}"`);
    const cfg = read(home);
    cfg.time = time;
    save(home, cfg);
    return cfg;
}

const isProject = (d) => fs.existsSync(path.join(d, '.openwiki')) || fs.existsSync(path.join(d, 'AGENTS.md'));
function findProjects(paths, { maxDepth = 2 } = {}) {
    const found = new Set();
    const walk = (d, depth) => {
        if (isProject(d)) { found.add(d); return; }
        if (depth >= maxDepth) return;
        let entries = [];
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && !e.name.includes('-wt-')) walk(path.join(d, e.name), depth + 1);
        }
    };
    for (const p of paths) walk(p, 0);
    return [...found].sort();
}

// Rewrites the scheduled job to match the settings: with a time it is (re)installed, without one it is removed.
const defaultRun = (home) => (isTestSandbox(home) ? null : async (cmd, args) => { require('child_process').execFileSync(cmd, args, { stdio: 'ignore', windowsHide: true }); return { ok: true }; });

async function applyJob(home, { run = defaultRun(home), platform = process.platform, node = process.execPath } = {}) {
    const cfg = read(home);
    if (!cfg.time || cfg.off) { await nightly.remove({ home, platform, run }); return { scheduled: false }; }
    const [hour, minute] = cfg.time.split(':').map(Number);
    const job = await nightly.install({ home, platform, node, run, hour, minute });
    return { scheduled: Boolean(job.file), file: job.file };
}

// Settings row and `aos setup` step: o = { home, write, ui: { select, text } }. Every change rewrites the job.
async function interactive(o) {
    if (!o.ui || !o.ui.select || !o.ui.text) { await command(['list'], { home: o.home, write: o.write }); return 0; }
    for (;;) {
        const cfg = read(o.home);
        const choice = await o.ui.select(`Memory import: ${cfg.paths.length} path${cfg.paths.length === 1 ? '' : 's'}, ${cfg.time ? `daily at ${cfg.time}` : 'no schedule'}`, [
            { value: 'add', label: 'Add a folder (its projects are imported)' },
            ...(cfg.paths.length ? [{ value: 'remove', label: 'Remove a folder' }] : []),
            { value: 'time', label: cfg.time ? 'Change the time' : 'Set a daily time (HH:MM)' },
            ...(cfg.time ? [{ value: 'off', label: 'Remove the schedule' }] : []),
            { value: 'back', label: 'Back' },
        ], 'back');
        if (choice === 'back' || !choice) return 0;
        let args;
        if (choice === 'add') { const v = await o.ui.text('Folder (absolute, or ~/...):'); args = v ? ['add-path', v] : null; }
        else if (choice === 'remove') { const v = await o.ui.select('Remove which folder?', cfg.paths.map((p) => ({ value: p, label: p })), cfg.paths[0]); args = v ? ['remove-path', v] : null; }
        else if (choice === 'time') { const v = await o.ui.text('Time (HH:MM, 24h):', cfg.time || ''); args = v ? ['set-time', v] : null; }
        else args = ['set-time', 'off'];
        if (args) await command(args, { home: o.home, write: o.write });
    }
}

const HOW_TO = 'Add a folder with `aos memory add-path <dir>` (e.g. your projects folder) and a schedule with `aos memory set-time HH:MM`.';

// `aos memory <list|show|deja-context <on|off>|add-path|remove-path|set-time|run>`. Returns the exit code.
async function command(args, { home = os.homedir(), write = (s) => process.stdout.write(s), apply = (h) => applyJob(h), runIngest = null } = {}) {
    const [sub, arg] = args;
    try {
        if (!sub || sub === 'list') {
            const cfg = read(home);
            write(`Memory import: ${cfg.off ? 'off' : cfg.time ? `daily at ${cfg.time}` : 'no schedule'}\n`);
            if (!cfg.paths.length) { write(`No paths set. ${HOW_TO}\n`); return 0; }
            for (const p of cfg.paths) write(`  ${p}\n`);
            const projects = findProjects(cfg.paths);
            write(`${projects.length} project${projects.length === 1 ? '' : 's'} found (.openwiki or AGENTS.md).\n`);
            return 0;
        }
        if (sub === 'add-path' || sub === 'remove-path') {
            if (!arg) { write(`usage: aos memory ${sub} <dir>\n`); return 2; }
            const r = sub === 'add-path' ? addPath(home, arg) : removePath(home, arg);
            write(`${r.changed ? (sub === 'add-path' ? 'Added' : 'Removed') : 'Unchanged'}: ${r.path}\n`);
            if (r.changed) await apply(home);
            return 0;
        }
        if (sub === 'set-time') {
            if (!arg) { write('usage: aos memory set-time <HH:MM|off>\n'); return 2; }
            setTime(home, arg === 'off' ? null : arg);
            const r = await apply(home);
            write(arg === 'off' ? 'Schedule removed.\n' : `Scheduled daily at ${arg}${r && r.scheduled === false ? ' (job not written on this platform)' : ''}.\n`);
            return 0;
        }
        if (sub === 'deja-context') {
            if (arg !== 'on' && arg !== 'off') { write('usage: aos memory deja-context <on|off>\n'); return 2; }
            const st = readSettings(home);
            writeSettings(home, { ...st, memory: { ...(st.memory || {}), dejaContext: arg } });
            write(`deja session digest at session start: ${arg}\n`);
            return 0;
        }
        if (sub === 'show') {
            // The start context a new session in this folder would get (same code path as the hooks).
            const hook = path.join(__dirname, '..', '.claude', 'hooks', 'memb-inject.mjs');
            const { buildMemoryBlock } = await import(require('url').pathToFileURL(hook).href);
            const block = await buildMemoryBlock({ event: 'SessionStart', cwd: process.cwd(), onStatus: (line) => write(`${line}\n\n`) });
            write(block ? `${block}\n` : 'No memory context for this folder.\n');
            return 0;
        }
        if (sub === 'run') {
            const script = path.join(home, '.agents', 'bin', 'aos-memb-ingest.mjs');
            if (!runIngest) return require('child_process').spawnSync(process.execPath, [script], { stdio: 'inherit' }).status || 0;
            return runIngest(script);
        }
        write('usage: aos memory <list|show|deja-context <on|off>|add-path <dir>|remove-path <dir>|set-time <HH:MM|off>|run>\n');
        return 2;
    } catch (e) {
        write(`aos memory: ${e.message}\n`);
        return 1;
    }
}

module.exports = { interactive, validTime, read, save, addPath, removePath, setTime, findProjects, applyJob, command, HOW_TO };
