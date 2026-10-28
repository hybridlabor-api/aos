'use strict';
// skillLibrary "lean": only the router skills (lib/lean-skills.json) are installed in the harness skill dirs.
// Every other shipped skill stays in ~/.aos/library and installs on demand with `aos store install <name>`.
// "full" is the normal copy of everything. Retiring reuses lib/retired-skills.js (manifest-aware, backed up).
const fs = require('fs');
const path = require('path');
const core = require('./core-skills');

const MODES = ['lean', 'smart', 'groups', 'full'];
const DEFAULT_MODE = 'full';
const DEFAULT_TOP_N = 25;
const USAGE_DAYS = 30;
const knownMode = (x) => typeof x === 'string' && MODES.includes(x);

function def(root = path.join(__dirname, '..')) {
    return JSON.parse(fs.readFileSync(path.join(root, 'lib', 'lean-skills.json'), 'utf8'));
}

// Routers plus the skills hooks and slash commands name; this is the always-installed set.
function leanSet(root) {
    const d = def(root);
    return new Set([...d.routers, ...Object.values(d.required || {}).flat()]);
}

// Skill dir name -> SKILL.md path.
function skillFiles(root) {
    return new Map(Object.entries(Object.fromEntries(require('./skill-packs').shippedSkillDirs(root))).map(([n, d]) => [n, path.join(d, 'SKILL.md')]));
}

// Group name -> skill names. Groups are the frontmatter `category`, plus playbooks (pb-*) and fabric (fabric*, factory*).
function groupMap(root = path.join(__dirname, '..')) {
    const groups = { playbooks: [], fabric: [] };
    for (const [name, file] of skillFiles(root)) {
        let cat = null;
        try { cat = (fs.readFileSync(file, 'utf8').match(/^category:\s*['"]?([A-Za-z0-9_-]+)/m) || [])[1] || null; } catch { /* unreadable: no category group */ }
        if (cat) (groups[cat] ||= []).push(name);
        if (name.startsWith('pb-')) groups.playbooks.push(name);
        if (name.startsWith('fabric') || name.startsWith('factory')) groups.fabric.push(name);
    }
    for (const g of Object.keys(groups)) groups[g].sort();
    return groups;
}

// Skills outside the lean set that stay installed for a mode: smart = usage picks + groups, groups = groups.
function keepSet(mode, root, { groups = [], picks = [] } = {}) {
    const keep = new Set(leanSet(root));
    if (mode === 'smart') for (const n of picks) keep.add(n);
    if (mode === 'smart' || mode === 'groups') {
        const gm = groupMap(root);
        for (const g of groups) for (const n of gm[g] || []) keep.add(n);
    }
    return keep;
}

// Names the installer must not copy.
function excluded(mode, root, opts = {}) {
    if (!knownMode(mode) || mode === 'full') return [];
    const keep = keepSet(mode, root, opts);
    return core.shippedSkills(root).filter((n) => !keep.has(n));
}

// A fresh install has no install manifest yet.
const isFresh = (home) => !fs.existsSync(path.join(home, '.agents', '.bdb-manifest.json'));

// Mode for a settings object; a missing value keeps today's behaviour (full).
const modeOf = (st) => (st && knownMode(st.skillLibrary) ? st.skillLibrary : DEFAULT_MODE);
const optsOf = (st) => ({ groups: (st && st.skillGroups) || [], picks: (st && st.skillPicks) || [] });

// Usage counts of shipped skills over the last `days` days. Local, read-only. Only Claude Code transcripts
// (~/.claude/projects/*/*.jsonl) carry a documented skill field (Skill tool calls, /name invocations);
// other harnesses are skipped. Returns Map name -> count.
function scanUsage(home, root, { days = USAGE_DAYS, now = Date.now() } = {}) {
    const known = new Set(core.shippedSkills(root));
    const counts = new Map();
    const bump = (raw) => {
        const n = String(raw || '').replace(/^\//, '').split(':').pop();
        if (known.has(n)) counts.set(n, (counts.get(n) || 0) + 1);
    };
    const base = path.join(home, '.claude', 'projects');
    let projects = [];
    try { projects = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { return counts; }
    for (const pr of projects) {
        let files = [];
        try { files = fs.readdirSync(path.join(base, pr.name)).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
        for (const f of files) {
            const file = path.join(base, pr.name, f);
            try {
                const st = fs.lstatSync(file);
                if (!st.isFile() || now - st.mtimeMs > days * 86400000) continue;
                for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
                    if (!line.includes('"Skill"') && !line.includes('command-name')) continue;
                    let j; try { j = JSON.parse(line); } catch { continue; }
                    if (j.timestamp && now - Date.parse(j.timestamp) > days * 86400000) continue;
                    const c = j.message && j.message.content;
                    if (Array.isArray(c)) {
                        for (const part of c) {
                            if (part && part.type === 'tool_use' && part.name === 'Skill' && part.input) bump(part.input.skill);
                            else if (part && part.type === 'text' && typeof part.text === 'string') for (const m of part.text.matchAll(/<command-name>\/?([^<\s]+)<\/command-name>/g)) bump(m[1]);
                        }
                    } else if (typeof c === 'string') for (const m of c.matchAll(/<command-name>\/?([^<\s]+)<\/command-name>/g)) bump(m[1]);
                }
            } catch { /* unreadable transcript: skip */ }
        }
    }
    return counts;
}

// Top N used skills outside the lean set; no usage data gives [].
function topPicks(home, root, n = DEFAULT_TOP_N, opts = {}) {
    const lean = leanSet(root);
    return [...scanUsage(home, root, opts)].filter(([k]) => !lean.has(k))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([k]) => k);
}

// Stores fresh picks in the settings (smart mode only). Returns the picks.
function refreshPicks(home, root, { dryRun = false } = {}) {
    const p = require('./v5/profile');
    const st = p.readSettings(home, () => {});
    if (st.skillLibrary !== 'smart') return st.skillPicks || [];
    const picks = topPicks(home, root, st.skillTopN || DEFAULT_TOP_N);
    if (!dryRun) p.writeSettings(home, { ...st, skillPicks: picks });
    return picks;
}

// Fresh installs without a stored choice become lean; the choice is saved so updates keep it. Returns the mode.
function seedFresh(home, { dryRun = false } = {}) {
    const p = require('./v5/profile');
    const st = p.readSettings(home, () => {});
    if (knownMode(st.skillLibrary)) return st.skillLibrary;
    if (!isFresh(home)) return DEFAULT_MODE;
    if (!dryRun) p.writeSettings(home, { ...st, skillLibrary: 'lean', skillLibraryAsked: true });
    return 'lean';
}

// `aos update` asks once (same pattern as askUpdatesOnce). Never when unattended or without a UI.
async function askOnce({ home, ui, root = path.join(__dirname, '..'), unattended = false } = {}) {
    if (unattended || !ui || typeof ui.select !== 'function') return null;
    const p = require('./v5/profile');
    const st = p.readSettings(home, () => {});
    if (st.skillLibraryAsked === true || knownMode(st.skillLibrary)) return null;
    const v = await ui.select('Skills: smart (recommended: routers + your most-used skills + chosen groups) / lean (routers only, others on demand, saves ~15k tokens) / groups (routers + chosen groups) / full (all skills installed). Asked once, change later in the aos menu under Settings.', [
        { value: 'smart', label: 'smart (recommended)' },
        { value: 'lean', label: 'lean (routers only)' },
        { value: 'groups', label: 'groups (routers + chosen groups)' },
        { value: 'full', label: 'full (all skills installed)' },
    ], 'smart');
    if (!knownMode(v)) return null;
    let groups = [];
    if ((v === 'smart' || v === 'groups') && typeof ui.multi === 'function') {
        const gm = groupMap(root);
        const got = await ui.multi('Skill groups to keep installed:', Object.keys(gm).sort().map((g) => ({ value: g, label: `${g} (${gm[g].length})` })), []);
        groups = Array.isArray(got) ? got.filter((g) => gm[g]) : [];
    }
    p.writeSettings(home, { ...st, skillLibrary: v, skillGroups: groups, skillLibraryAsked: true });
    if (v === 'smart') refreshPicks(home, root);
    return v;
}

// Removes AOS-owned installed copies outside the lean set. Edited/foreign files are backed up first and
// store installs (installs.jsonl) stay. Returns the retired entries.
function pruneLean({ root, home, manifest, roots, backupDir, log = {}, mode = 'lean', opts = {} }) {
    const { pruneRetiredSkills, storeProtectedDirs } = require('./retired-skills');
    // A skill missing from the library would be lost, not moved: keep its installed copy.
    const lib = path.join(home, '.aos', 'library', 'skills');
    const names = excluded(mode, root, opts).filter((n) => fs.existsSync(path.join(lib, n, 'SKILL.md')));
    const res = pruneRetiredSkills({ home, manifest, roots, backupDir, log, names, what: 'lean-library', keep: storeProtectedDirs(home), keepEdited: true });
    return res.removed;
}

// Skill dirs (with SKILL.md) directly under a root; symlinks are counted but never followed.
function countSkills(dir) {
    try {
        return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => (e.isDirectory() || e.isSymbolicLink()) && fs.existsSync(path.join(dir, e.name, 'SKILL.md'))).length;
    } catch { return 0; }
}

// Real installed count for the token estimate: the biggest harness root.
function installedSkillCount(roots) {
    return Math.max(0, ...roots.map(countSkills));
}

// ~17,930 tokens for 287 skills (lib/v5/context-profiles.js baseline).
const TOKENS_PER_SKILL = 17930 / 287;
const tokensFor = (n) => Math.round(n * TOKENS_PER_SKILL);

const flagOf = (args, name) => { const a = args.find((x) => x === name || x.startsWith(`${name}=`)); return a === undefined ? undefined : (a === name ? '' : a.slice(name.length + 1)); };

// `aos skills status|lean|full|smart [--refresh] [--top=N] [--groups=a,b]|groups <a,b>`. host = the installer module.
async function command(args, host, { home, write = (s) => process.stdout.write(s), dryRun = false } = {}) {
    const p = require('./v5/profile');
    const sub = args[0] || 'status';
    const root = host.srcDir ? host.srcDir() : path.join(__dirname, '..');
    const roots = host.skillRoots();
    const st = p.readSettings(home, () => {});
    const gm = groupMap(root);
    if (sub === 'status') {
        const m = modeOf(st);
        const n = installedSkillCount(roots);
        const detail = m === 'lean' ? `lean (${n} routers installed)` : m === 'full' ? `full (${n} skills installed)`
            : `${m} (${n} skills installed; groups: ${(st.skillGroups || []).join(', ') || 'none'}${m === 'smart' ? `; ${(st.skillPicks || []).length} most-used` : ''})`;
        write(`Skill library: ${detail}. Library: ${countSkills(path.join(home, '.aos', 'library', 'skills'))} skills in ~/.aos/library. Skill list cost ~${tokensFor(n).toLocaleString()} tokens.\n`);
        write(`Change: aos skills lean|smart|groups <a,b>|full   Install one: aos store install <name>\nGroups: ${Object.keys(gm).sort().join(', ')}\n`);
        return 0;
    }
    if (!knownMode(sub)) { write('Usage: aos skills status|lean|full|smart [--refresh] [--top=N] [--groups=a,b]|groups <a,b>\n'); return 2; }
    const raw = sub === 'groups' ? (args[1] && !args[1].startsWith('--') ? args[1] : flagOf(args, '--groups')) : flagOf(args, '--groups');
    const groups = raw === undefined ? (st.skillGroups || []) : raw.split(',').map((x) => x.trim()).filter(Boolean);
    const bad = groups.filter((g) => !gm[g]);
    if (bad.length) { write(`Unknown group(s): ${bad.join(', ')}. Groups: ${Object.keys(gm).sort().join(', ')}\n`); return 2; }
    if (sub === 'groups' && !groups.length) { write('aos skills groups <a,b>: name at least one group.\n'); return 2; }
    const top = Number(flagOf(args, '--top')) || st.skillTopN || DEFAULT_TOP_N;
    const next = { ...st, skillLibrary: sub, skillLibraryAsked: true, skillGroups: sub === 'lean' || sub === 'full' ? [] : groups, skillTopN: top };
    next.skillPicks = sub === 'smart' ? topPicks(home, root, top) : [];
    const opts = optsOf(next);
    if (dryRun) {
        write(`[dry-run] would switch the skill library to ${sub}; ${excluded(sub, root, opts).length} skills would be retired from the harness dirs (backup first), ${sub === 'smart' ? `${next.skillPicks.length} most-used kept, ` : ''}the rest stays in ~/.aos/library. Nothing changed.\n`);
        return 0;
    }
    p.writeSettings(home, next);
    const failures = host.applySkillLibrary(sub);
    for (const f of failures) write(`${f}\n`);
    const n = installedSkillCount(roots);
    write(`Skill library is now ${sub}: ${n} skills in the largest harness dir (~${tokensFor(n).toLocaleString()} tokens).\n`);
    return failures.length ? 1 : 0;
}

module.exports = { MODES, DEFAULT_MODE, DEFAULT_TOP_N, knownMode, def, leanSet, groupMap, keepSet, excluded, isFresh, modeOf, optsOf, scanUsage, topPicks, refreshPicks, seedFresh, askOnce, pruneLean, countSkills, installedSkillCount, tokensFor, command };
