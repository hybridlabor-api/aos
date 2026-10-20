'use strict';
// Skill packs: base + opt-in packs (lib/skill-packs.json). A stored selection decides which
// shipped skills the installer copies into the harness skill dirs. Everything the package ships
// is always copied into the local library (~/.aos/library), which NO harness reads directly —
// "installing" a skill or pack means copying from the library into each harness skill dir.
const fs = require('fs');
const path = require('path');
const coreSkills = require('./core-skills');

const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

function loadPacks(root = path.join(__dirname, '..')) {
    return JSON.parse(fs.readFileSync(path.join(root, 'lib', 'skill-packs.json'), 'utf8'));
}

const packNames = (root) => Object.keys(loadPacks(root).packs || {});
const knownPack = (x, root) => typeof x === 'string' && packNames(root).includes(x);

// Skills of one pack; the "stacks" pack contributes every group (db, python, go, react, repo, shell).
function packSkillNames(root, name) {
    const p = (loadPacks(root).packs || {})[name];
    if (!p) return [];
    if (Array.isArray(p.skills)) return [...p.skills];
    if (p.groups && typeof p.groups === 'object') return [...new Set(Object.values(p.groups).flat())];
    return [];
}

// Checkbox shortcut: selecting "app-dev" also brings the "stacks" pack.
function expandSelection(names, root) {
    const out = [];
    for (const n of names) {
        if (typeof n !== 'string' || !NAME_RE.test(n)) continue;
        if (!out.includes(n)) out.push(n);
        if (n === 'app-dev' && !out.includes('stacks') && packNames(root).includes('stacks')) out.push('stacks');
    }
    return out;
}

// Clean a stored/flag selection: unknown names dropped, order kept, app-dev expands.
function normalizeSelection(names, root) {
    if (!Array.isArray(names)) return null;
    const known = new Set(packNames(root));
    return expandSelection(names.filter((n) => known.has(n)), root);
}

// Base + every selected pack.
function selectedSkillNames(root, packs) {
    const def = loadPacks(root);
    const sel = normalizeSelection(packs, root) || [];
    return [...new Set([...(def.base || []), ...sel.flatMap((p) => packSkillNames(root, p))])];
}

// Shipped skills the installer must not copy. A missing selection (`null` — nothing stored
// in the settings file) excludes nothing: existing users keep every skill, no silent removal.
function excludedByPacks(root, packs) {
    if (!Array.isArray(packs)) return [];
    const selected = new Set(selectedSkillNames(root, packs));
    return coreSkills.shippedSkills(root).filter((n) => !selected.has(n));
}

const librarySkillsDir = (home) => path.join(home, '.aos', 'library', 'skills');
const libraryIndexFile = (home) => path.join(home, '.aos', 'library', 'index.json');

// Every shipped skill dir with its absolute source path; nested category dirs flatten by name.
function shippedSkillDirs(root = path.join(__dirname, '..')) {
    const out = new Map();
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (!e.isDirectory()) continue;
            const abs = path.join(d, e.name);
            if (fs.existsSync(path.join(abs, 'SKILL.md'))) out.set(e.name, abs);
            else walk(abs);
        }
    };
    const base = path.join(root, 'skills');
    if (fs.existsSync(base)) walk(base);
    return out;
}

module.exports = {
    NAME_RE, loadPacks, packNames, knownPack, packSkillNames, expandSelection,
    normalizeSelection, selectedSkillNames, excludedByPacks,
    librarySkillsDir, libraryIndexFile, shippedSkillDirs,
};
