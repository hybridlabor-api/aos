'use strict';
// skillSet "core": install only the skills named in lib/core-skills.json; the rest stay in the package
// and install on demand with `aos store install <name>` (local "aos" source, works offline).
const fs = require('fs');
const path = require('path');

const SKILL_SETS = ['all', 'core'];
const DEFAULT_SKILL_SET = 'all';
const knownSkillSet = (x) => typeof x === 'string' && SKILL_SETS.includes(x);

function coreList(root = path.join(__dirname, '..')) {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'lib', 'core-skills.json'), 'utf8'));
    return new Set(j.skills);
}

// Names of every shipped skill dir (a dir holding SKILL.md), at any depth under skills/.
function shippedSkills(root = path.join(__dirname, '..')) {
    const out = [];
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (!e.isDirectory()) continue;
            const abs = path.join(d, e.name);
            if (fs.existsSync(path.join(abs, 'SKILL.md'))) out.push(e.name);
            else walk(abs);
        }
    };
    const base = path.join(root, 'skills');
    if (fs.existsSync(base)) walk(base);
    return out.sort();
}

// Skills the "core" set leaves to the store.
function movedSkills(root = path.join(__dirname, '..')) {
    const core = coreList(root);
    return shippedSkills(root).filter((n) => !core.has(n));
}

// Names the installer must not copy. Empty for "all".
const excludedBySkillSet = (skillSet, root) => (skillSet === 'core' ? movedSkills(root) : []);

function announceLines(moved, removed = 0, max = 25) {
    if (!moved.length) return [];
    const shown = moved.slice(0, max).join(', ') + (moved.length > max ? `, and ${moved.length - max} more` : '');
    return [
        `Skill set "core": ${moved.length} skill(s) are not installed and stay available in the AOS store${removed ? `; ${removed} installed copy/copies were removed (edited files backed up first)` : ''}.`,
        `  Moved: ${shown}`,
        '  Install one: aos store install <name>   Browse: aos store list --source aos   Back to everything: aos --skill-set=all',
    ];
}

// Removes installed copies of moved skills (manifest-listed dirs only; edited or foreign files are backed up first,
// skills installed from the store are left alone) and announces the move. Returns { moved, removed }.
function pruneMoved({ root = path.join(__dirname, '..'), home, manifest, roots, backupDir, log = {} }) {
    const { pruneRetiredSkills } = require('./retired-skills');
    const moved = movedSkills(root);
    const storeOwned = new Set();
    try {
        for (const line of fs.readFileSync(path.join(home, '.aos', 'store', 'installs.jsonl'), 'utf8').split('\n')) {
            try { const j = JSON.parse(line); if (j && j.kind === 'skill' && typeof j.name === 'string') storeOwned.add(j.name); } catch { /* bad line */ }
        }
    } catch { /* no store log */ }
    const res = pruneRetiredSkills({ home, manifest, roots, backupDir, log, names: moved.filter((n) => !storeOwned.has(n)), what: 'moved-to-store' });
    if (typeof log.step === 'function') for (const line of announceLines(moved, res.removed.length)) log.step(line);
    return { moved, removed: res.removed };
}

module.exports = { pruneMoved, SKILL_SETS, DEFAULT_SKILL_SET, knownSkillSet, coreList, shippedSkills, movedSkills, excludedBySkillSet, announceLines };
