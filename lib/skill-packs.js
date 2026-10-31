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
const knownPack = (x, root) => {
    if (typeof x !== 'string') return false;
    const packs = loadPacks(root).packs || {};
    if (packs[x]) return true;
    for (const p of Object.values(packs)) {
        if (p.aliases && p.aliases.includes(x)) return true;
    }
    return false;
};

// Skills of one pack; the "stacks" pack contributes every group (db, python, go, react, repo, shell).
function packSkillNames(root, name) {
    const packs = loadPacks(root).packs || {};
    let resolvedName = name;
    if (!packs[name]) {
        for (const [k, p] of Object.entries(packs)) {
            if (p.aliases && p.aliases.includes(name)) resolvedName = k;
        }
    }
    const p = packs[resolvedName];
    if (!p) return [];
    if (Array.isArray(p.skills)) return [...p.skills];
    if (p.groups && typeof p.groups === 'object') return [...new Set(Object.values(p.groups).flat())];
    return [];
}

// Checkbox shortcut: selecting "app-dev" also brings the "stacks" pack.
function expandSelection(names, root) {
    const packs = loadPacks(root).packs || {};
    const resolveAlias = (n) => {
        if (packs[n]) return n;
        for (const [k, p] of Object.entries(packs)) {
            if (p.aliases && p.aliases.includes(n)) return k;
        }
        return n;
    };
    const out = [];
    for (let n of names) {
        if (typeof n !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(n)) continue;
        n = resolveAlias(n);
        if (!out.includes(n)) out.push(n);
        // Note: stacks is still a pack in this version since we keep it.
        if (n === 'engineering' && !out.includes('stacks') && packNames(root).includes('stacks')) out.push('stacks');
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

// Packs implied by setup choices, on top of any explicit selection. Tier Pro MEDIA brings the
// live-show pack; the Creator Extension and Hardware & PCB modules (and any module id that is
// itself a pack name, the setup checkbox ids) bring theirs. Implied packs only ever ADD: a tier
// or module choice must never deselect anything, so they merge into an explicit selection and
// are ignored while no selection is stored (null = keep every skill).
const TIER_PACKS = { 1: ['live-show'] };
const tierPacks = (tier) => [...(TIER_PACKS[tier] || [])];

// Skills the Basic tier (2) never installs: the media-app guides. Pro MEDIA (1) brings live-show; the
// creator-pack guides (adobe, after-effects, blender, davinci) and bdbmediastorm are Pro MEDIA content too.
const BASIC_TIER_EXCLUDES = Object.freeze([
    'bdb-adobe-suite-mcp', 'bdb-after-effects-mcp', 'bdb-blender-mcp', 'bdb-davinci-mcp', 'bdb-grandma3-mcp',
    'bdb-resolume-mcp', 'bdb-rhino-mcp', 'bdb-touchdesigner-mcp', 'bdb-unreal-mcp', 'bdb-vectorworks-mcp', 'bdbmediastorm',
]);

function impliedPacks(manifest, root) {
    const m = manifest && typeof manifest === 'object' ? manifest : {};
    const out = [];
    for (const p of TIER_PACKS[m.tier] || []) if (knownPack(p, root) && !out.includes(p)) out.push(p);
    for (const id of Array.isArray(m.installedModules) ? m.installedModules : []) {
        if (knownPack(id, root) && !out.includes(id)) out.push(id);
    }
    return out;
}

// Explicit selection (null = everything) plus implied packs; null stays null.
function mergeSelection(explicit, implied, root) {
    if (!Array.isArray(explicit)) return null;
    return normalizeSelection([...explicit, ...(Array.isArray(implied) ? implied : [])], root);
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

// Detect project stack from directory contents:
// - Cargo.toml and src-tauri/tauri.conf.json -> 'tauri' (Tauri v2 desktop, preselects rust group + app-dev)
// - Cargo.toml -> 'rust' (preselects rust group + app-dev)
// - go.mod -> 'go' (preselects go group + app-dev)
// - package.json with vite -> 'vite' (preselects react group + app-dev)
function detectProjectStack(projectDir) {
    if (!projectDir || !fs.existsSync(projectDir)) return { stack: null, groups: [], packs: [], tauri: false };
    const hasTauri = fs.existsSync(path.join(projectDir, 'src-tauri', 'tauri.conf.json'));
    const hasCargo = fs.existsSync(path.join(projectDir, 'Cargo.toml'));
    const hasGo = fs.existsSync(path.join(projectDir, 'go.mod'));
    const pkgJsonPath = path.join(projectDir, 'package.json');
    let hasVite = false;
    if (fs.existsSync(pkgJsonPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
            const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
            hasVite = Boolean(deps.vite);
        } catch { /* ignore parse error */ }
    }
    if (hasTauri || hasCargo) {
        return {
            stack: hasTauri ? 'tauri' : 'rust',
            groups: ['rust'],
            packs: ['app-dev', 'stacks'],
            tauri: hasTauri,
        };
    }
    if (hasGo) {
        return {
            stack: 'go',
            groups: ['go'],
            packs: ['app-dev', 'stacks'],
            tauri: false,
        };
    }
    if (hasVite) {
        return {
            stack: 'vite',
            groups: ['react'],
            packs: ['app-dev', 'stacks', 'web-design'],
            tauri: false,
        };
    }
    return { stack: null, groups: [], packs: [], tauri: false };
}

module.exports = {
    NAME_RE, loadPacks, packNames, knownPack, packSkillNames, expandSelection,
    normalizeSelection, selectedSkillNames, excludedByPacks, impliedPacks, mergeSelection,
    librarySkillsDir, libraryIndexFile, shippedSkillDirs, tierPacks, BASIC_TIER_EXCLUDES,
    detectProjectStack,
};
