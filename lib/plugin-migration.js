'use strict';
// Plugin registration and loose-copy migration. Pure of installer state: every
// path derives from `home`, so tests and the uninstaller drive it with a temp HOME.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PLUGIN = 'bdb-aos';
const MARKETPLACE = 'bdb-marketplace';
const OWN_REPO = 'hybridlabor-api/aos';
const EXTERNAL_REPO = 'hybridlabor-api/bdb-marketplace';

// Harness key -> where its removable loose skill copies live. Only Claude's plugin bundles the
// skills. Codex bundles just the command wrappers and agy bundling is unverified, so their copies
// stay, like OpenCode's and the shared ~/.agents/skills.
const LOOSE_ROOTS = {
    claudecode: (home) => path.join(home, '.claude', 'skills'),
};
const KEPT_COPIES = { codex: '~/.codex/skills', antigravity: '~/.gemini/config/skills', opencode: '~/.config/opencode/skills' };

const statePath = (home) => path.join(home, '.agents', '.bdb-plugin-migration.json');
const settingsPath = (home) => path.join(home, '.claude', 'settings.json');
const hashOf = (file) => {
    try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; }
};
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

function readState(home) {
    try { return JSON.parse(fs.readFileSync(statePath(home), 'utf8')); } catch { return { registered: {}, backups: [] }; }
}
function writeState(home, state) {
    fs.mkdirSync(path.dirname(statePath(home)), { recursive: true });
    fs.writeFileSync(statePath(home), JSON.stringify(state, null, 2) + '\n');
}

function writeJsonAtomic(file, data, mode) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode });
    fs.renameSync(tmp, file);
}

const repoOf = (entry) => {
    const s = entry && entry.source;
    if (!s || typeof s !== 'object') return '';
    return String(s.repo || s.url || '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
};

// Claude Code: marketplace entry for THIS repo + enabledPlugins, merged into settings.json.
// Never throws; ok=true only when a re-read shows both keys in place.
function registerClaude({ home, repo = OWN_REPO }) {
    const file = settingsPath(home);
    const pluginId = `${PLUGIN}@${MARKETPLACE}`;
    let data = {};
    let existed = false;
    try {
        if (fs.existsSync(file)) {
            existed = true;
            data = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not a JSON object');
        }
    } catch (e) {
        return { ok: false, error: `${file} is not valid JSON (${e.message}); nothing changed` };
    }
    const record = { marketplace: MARKETPLACE, pluginId, addedMarketplace: false, addedEnabled: false, replaced: null };
    const prev = JSON.parse(JSON.stringify(data));
    const mk = data.extraKnownMarketplaces && typeof data.extraKnownMarketplaces === 'object' ? data.extraKnownMarketplaces : {};
    const plugins = data.enabledPlugins && typeof data.enabledPlugins === 'object' ? data.enabledPlugins : {};

    for (const [key, entry] of Object.entries(mk)) {
        if (repoOf(entry) !== EXTERNAL_REPO) continue;
        record.replaced = { key, entry };
        delete mk[key];
        for (const id of Object.keys(plugins)) {
            if (id.endsWith(`@${key}`) && key !== MARKETPLACE) {
                plugins[`${id.slice(0, -key.length - 1)}@${MARKETPLACE}`] = plugins[id];
                delete plugins[id];
            }
        }
    }
    const own = { source: { source: 'github', repo } };
    if (repoOf(mk[MARKETPLACE]) !== repo) {
        record.addedMarketplace = !mk[MARKETPLACE];
        record.overwroteOther = mk[MARKETPLACE] || null;
        mk[MARKETPLACE] = own;
    }
    if (plugins[pluginId] !== true) {
        record.addedEnabled = !(pluginId in plugins);
        plugins[pluginId] = true;
    }
    data.extraKnownMarketplaces = mk;
    data.enabledPlugins = plugins;
    const changed = JSON.stringify(prev) !== JSON.stringify(data);

    try {
        if (changed) {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            let mode = 0o644;
            if (existed) {
                mode = fs.statSync(file).mode & 0o777;
                fs.copyFileSync(file, `${file}.${process.hrtime.bigint()}.bak`);
            }
            writeJsonAtomic(file, data, mode);
        }
        const check = JSON.parse(fs.readFileSync(file, 'utf8'));
        const ok = repoOf(check.extraKnownMarketplaces && check.extraKnownMarketplaces[MARKETPLACE]) === repo
            && check.enabledPlugins && check.enabledPlugins[pluginId] === true;
        return { ok: !!ok, changed, record, error: ok ? null : 'settings.json re-read did not show the registration' };
    } catch (e) {
        return { ok: false, error: `could not write ${file}: ${e.message}` };
    }
}

function deregisterClaude({ home, record }) {
    const file = settingsPath(home);
    if (!record || !fs.existsSync(file)) return { changed: false };
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { changed: false, error: 'settings.json not readable' }; }
    let changed = false;
    if (data.enabledPlugins && record.addedEnabled && record.pluginId in data.enabledPlugins) {
        delete data.enabledPlugins[record.pluginId]; changed = true;
        if (!Object.keys(data.enabledPlugins).length) delete data.enabledPlugins;
    }
    const mk = data.extraKnownMarketplaces;
    if (mk && (record.addedMarketplace || record.replaced) && repoOf(mk[record.marketplace]) === OWN_REPO) {
        delete mk[record.marketplace]; changed = true;
        if (record.replaced) mk[record.replaced.key] = record.replaced.entry;
        if (!Object.keys(mk).length) delete data.extraKnownMarketplaces;
    }
    if (changed) {
        fs.copyFileSync(file, `${file}.${process.hrtime.bigint()}.bak`);
        writeJsonAtomic(file, data, fs.statSync(file).mode & 0o777);
    }
    return { changed };
}

// Removes only files the manifest recorded whose bytes still match the recorded hash,
// after copying them into backupDir/<path relative to home>. Edited and untracked files stay.
function removeLooseCopies({ home, root, manifest, backupDir }) {
    const prefix = root + path.sep;
    const res = { removed: [], keptEdited: [] };
    for (const [file, entry] of Object.entries(manifest)) {
        if (!file.startsWith(prefix) || !fs.existsSync(file)) continue;
        if (hashOf(file) !== (entry && entry.sha256)) { res.keptEdited.push(file); continue; }
        const dest = path.join(backupDir, path.relative(home, file));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(file, dest);
        fs.unlinkSync(file);
        delete manifest[file];
        res.removed.push(file);
        for (let d = path.dirname(file); d.startsWith(prefix); d = path.dirname(d)) {
            try { fs.rmdirSync(d); } catch { break; }
        }
    }
    return res;
}

// Copies backed-up files back to their original place; never overwrites an existing file.
function restoreBackup({ home, backupDir }) {
    const restored = [];
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { walk(full); continue; }
            const target = path.join(home, path.relative(backupDir, full));
            if (fs.existsSync(target)) continue;
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(full, target);
            restored.push(target);
        }
    };
    if (fs.existsSync(backupDir)) walk(backupDir);
    return restored;
}

const REGISTRARS = { claudecode: registerClaude };

// mode: 'on' | 'check' (report only) | 'off'. Returns { covered:Set, lines:[] }.
function migrate({ home, manifest, detected, mode = 'on', registrars = REGISTRARS, repo = OWN_REPO }) {
    const lines = [];
    const covered = new Set();
    if (mode === 'off') return { covered, lines: ['Plugin migration is off (AOS_PLUGIN_MIGRATION=off); loose copies untouched.'] };
    const state = readState(home);
    const backupDir = path.join(home, '.agents', 'backups', `plugin-migration-${stamp()}`);
    let removedAny = false;

    for (const [key, where] of Object.entries(KEPT_COPIES)) {
        if (detected.includes(key)) lines.push(`${key}: loose copies in ${where} kept (the plugin does not bundle the skills there).`);
    }
    for (const key of Object.keys(LOOSE_ROOTS)) {
        if (!detected.includes(key)) continue;
        const root = LOOSE_ROOTS[key](home);
        const register = registrars[key];
        if (!register) { lines.push(`${key}: no verified plugin registration; loose copies kept.`); continue; }
        if (mode === 'check') {
            const n = Object.keys(manifest).filter((f) => f.startsWith(root + path.sep)).length;
            lines.push(`[check] ${key}: would register the ${PLUGIN} plugin, then back up and remove up to ${n} unmodified own copies from ${root}.`);
            continue;
        }
        const reg = register({ home, repo });
        if (!reg.ok) { lines.push(`${key}: plugin registration failed (${reg.error}); loose copies kept.`); continue; }
        if (reg.record) {
            const prior = state.registered[key];
            state.registered[key] = prior ? { ...reg.record, addedMarketplace: prior.addedMarketplace || reg.record.addedMarketplace, addedEnabled: prior.addedEnabled || reg.record.addedEnabled, replaced: prior.replaced || reg.record.replaced } : reg.record;
            if (reg.record.replaced) lines.push(`${key}: replaced external marketplace "${reg.record.replaced.key}" (${EXTERNAL_REPO}) with ${repo}. Nothing on GitHub was changed.`);
        }
        lines.push(`${key}: ${PLUGIN} plugin registered${reg.changed ? '' : ' (already in place)'}.`);
        covered.add(key);
        const r = removeLooseCopies({ home, root, manifest, backupDir });
        if (r.removed.length) removedAny = true;
        lines.push(`${key}: ${r.removed.length} own loose copies removed from ${root}${r.keptEdited.length ? `, ${r.keptEdited.length} edited kept` : ''}; unknown files untouched.`);
    }
    if (removedAny) {
        state.backups.push(backupDir);
        lines.push(`Backup of removed files: ${backupDir} (restore with: aos-uninstall --restore-plugin-backup).`);
    }
    if (mode === 'on' && (removedAny || Object.keys(state.registered).length)) writeState(home, state);
    return { covered, lines, removedAny };
}

module.exports = {
    PLUGIN, MARKETPLACE, OWN_REPO, EXTERNAL_REPO, LOOSE_ROOTS, REGISTRARS,
    statePath, readState, writeState, registerClaude, deregisterClaude, removeLooseCopies, restoreBackup, migrate,
};
