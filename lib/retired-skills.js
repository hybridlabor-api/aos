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
    'visual-edit': 'next',
    'visual-plan': 'next',
    'visual-recap': 'next',
};

const hashOf = (file) => {
    try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; }
};

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

function pruneRetiredSkills({ home, manifest, roots = defaultRoots(home), backupDir, log = {} }) {
    const res = { removed: [], backedUp: [] };
    if (!manifest) return res;
    const note = (level, msg) => { if (typeof log[level] === 'function') log[level](msg); };

    const dirs = new Map();
    for (const [file, entry] of Object.entries(manifest)) {
        if (typeof file !== 'string' || !path.isAbsolute(file)) continue;
        const root = roots.find((r) => file.startsWith(r + path.sep));
        if (!root) continue;
        const parts = file.slice(root.length + 1).split(path.sep);
        if (parts.includes('..') || !Object.hasOwn(RETIRED_SKILLS, parts[0])) continue;
        const dir = path.join(root, parts[0]);
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

    if (res.backedUp.length) note('warn', `[retired-skills] ${res.backedUp.length} edited or foreign file(s) from retired skills backed up to ${backupDir}.`);
    if (res.removed.length) note('step', `Removed ${res.removed.length} retired skill install(s) no longer shipped.`);
    return res;
}

module.exports = { RETIRED_SKILLS, pruneRetiredSkills, defaultRoots };
