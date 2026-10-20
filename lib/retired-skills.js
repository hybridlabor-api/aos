'use strict';
// Retires skills that left the package from installed copies. Pure of installer state: every path
// derives from `home` or the passed roots. Only manifest-listed skill dirs are touched, and every
// file that is not a hash-identical installer copy is backed up before its directory is removed.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RETIRED_SKILLS = {
    bdbsaastraining: '4.4.2',
    'bdb-dev-os-skill': '4.4.2',
    bdbsaashost: '4.4.2',
    'bdb-ecosystem-health': '4.4.2',
    'bdbsaas-ops': '4.4.2',
    'visual-edit': '4.17.0',
    'visual-plan': '4.17.0',
    'visual-recap': '4.17.0',
    'agent-orchestrator': '4.18.2',
    'writing-plans-legacy': '5.0.0',
    'notion-automation': '5.0.0',
    'slack-automation': '5.0.0',
    'tdd-workflow': '5.0.0',
    'firecrawl-agent': '5.0.0',
    'firecrawl-build': '5.0.0',
    'firecrawl-build-interact': '5.0.0',
    'firecrawl-build-onboarding': '5.0.0',
    'firecrawl-build-scrape': '5.0.0',
    'firecrawl-build-search': '5.0.0',
    'firecrawl-crawl': '5.0.0',
    'firecrawl-download': '5.0.0',
    'firecrawl-interact': '5.0.0',
    'firecrawl-map': '5.0.0',
    'firecrawl-scrape': '5.0.0',
    'firecrawl-search': '5.0.0',
    'dockerfile-generator': '5.0.0',
    'dockerfile-validator': '5.0.0',
    'bash-script-generator': '5.0.0',
    'bash-script-validator': '5.0.0',
    'makefile-generator': '5.0.0',
    'makefile-validator': '5.0.0',
};

const hashOf = (file) => {
    try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; }
};

// Skill dirs the store wrote itself (installs.jsonl). Protection is per copy, not per name:
// an entry's `targets` name the exact SKILL.md paths the store wrote, so an installer copy of
// the same skill in another harness dir is NOT protected and a deselection may remove it.
// Legacy targetless entries (older logs) protect the store's canonical global root copy.
function storeProtectedDirs(home) {
    const out = new Set();
    try {
        for (const line of fs.readFileSync(path.join(home, '.aos', 'store', 'installs.jsonl'), 'utf8').split('\n')) {
            let j;
            try { j = JSON.parse(line); } catch { continue; }
            if (!j || j.kind !== 'skill' || typeof j.name !== 'string' || !/^[A-Za-z0-9_-]+$/.test(j.name)) continue;
            const targets = Array.isArray(j.targets) ? j.targets.filter((t) => typeof t === 'string' && t.endsWith('SKILL.md')) : [];
            if (targets.length) for (const t of targets) out.add(path.resolve(path.dirname(t)));
            else out.add(path.join(home, '.agents', 'skills', j.name));
        }
    } catch { /* no store log */ }
    return out;
}

const defaultRoots = (home) => [
    path.join(home, '.agents', 'skills'),
    path.join(home, '.claude', 'skills'),
    path.join(home, '.codex', 'skills'),
    path.join(home, '.cursor', 'skills'),
    path.join(home, '.roo', 'skills'),
    path.join(home, '.gemini', 'config', 'skills'),
];

// Regular files of a dir tree; `unsafe` is true when a symlink or special entry is inside.
function walkFiles(dir, out = { files: [], unsafe: false }) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { out.unsafe = true; return out; }
    for (const e of entries) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) walkFiles(abs, out);
        else if (e.isFile()) out.files.push(abs);
        else out.unsafe = true;
    }
    return out;
}

function backupFile(home, backupDir, abs) {
    const rel = path.relative(home, abs);
    const dest = path.join(backupDir, rel.startsWith('..') || path.isAbsolute(rel) ? path.basename(abs) : rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
}

// `names` (optional) replaces the retired list, e.g. skills the "core" skill set moved to the store; `what` words the log lines.
// `keep` (optional) is a Set of absolute skill dir paths never to remove (e.g. store-written copies).
function pruneRetiredSkills({ home, manifest, roots = defaultRoots(home), backupDir, log = {}, names = null, what = 'retired', keep = null }) {
    const listed = names ? new Set(names) : null;
    const isListed = (n) => (listed ? listed.has(n) : Object.hasOwn(RETIRED_SKILLS, n));
    const isKept = (dir) => (keep ? keep.has(path.resolve(dir)) : false);
    const res = { removed: [], backedUp: [] };
    if (!manifest) return res;
    const note = (level, msg) => { if (typeof log[level] === 'function') log[level](msg); };

    const dirs = new Map();
    for (const [file, entry] of Object.entries(manifest)) {
        if (typeof file !== 'string' || !path.isAbsolute(file)) continue;
        const root = roots.find((r) => file.startsWith(r + path.sep));
        if (!root) continue;
        const parts = file.slice(root.length + 1).split(path.sep);
        if (parts.includes('..') || !isListed(parts[0])) continue;
        const dir = path.join(root, parts[0]);
        if (isKept(dir)) continue;
        if (!dirs.has(dir)) dirs.set(dir, new Map());
        dirs.get(dir).set(path.resolve(file), { key: file, sha256: entry && entry.sha256 });
    }

    for (const [dir, owned] of dirs) {
        let st;
        try { st = fs.lstatSync(dir); } catch { for (const o of owned.values()) delete manifest[o.key]; continue; }
        if (!st.isDirectory()) continue;
        const { files, unsafe } = walkFiles(dir);
        if (unsafe) { note('warn', `[retired-skills] ${dir} holds a symlink or special entry; left in place.`); continue; }

        const toBackup = files.filter((f) => {
            const o = owned.get(path.resolve(f));
            return !o || hashOf(f) !== o.sha256;
        });
        try {
            for (const f of toBackup) backupFile(home, backupDir, f);
        } catch (e) {
            note('warn', `[retired-skills] backup of ${dir} failed (${e.code || e.message}); left in place.`);
            continue;
        }
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {
            note('warn', `[retired-skills] could not remove ${dir} (${e.code || e.message}).`);
            continue;
        }
        res.backedUp.push(...toBackup);
        res.removed.push(dir);
        for (const o of owned.values()) delete manifest[o.key];
    }

    if (res.backedUp.length) note('warn', `[retired-skills] ${res.backedUp.length} edited or foreign file(s) from ${what} skills backed up to ${backupDir}.`);
    if (res.removed.length) note('step', `Removed ${res.removed.length} ${what} skill install(s)${listed ? '' : ' no longer shipped'}.`);
    return res;
}

module.exports = { RETIRED_SKILLS, pruneRetiredSkills, defaultRoots, storeProtectedDirs };
