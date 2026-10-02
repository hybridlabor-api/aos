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

// A symlinked settings.json is written through to its real file so the link survives.
function settingsTarget(home) {
    const link = settingsPath(home);
    let st;
    try { st = fs.lstatSync(link); } catch { return link; }
    if (!st.isSymbolicLink()) return link;
    return fs.realpathSync(link);
}

// Evidence that Claude Code itself installed the plugin, readable without network.
// installed_plugins.json ({version, plugins: {"<name>@<marketplace>": [{installPath, ...}]}}) is the
// shape seen locally for other plugins. The cache fallback (cache/<marketplace>/<plugin>/<version>/skills)
// is inferred from the installPath layout seen there, not confirmed for this plugin.
function pluginInstalled(home) {
    const dir = path.join(home, '.claude', 'plugins');
    try {
        const doc = JSON.parse(fs.readFileSync(path.join(dir, 'installed_plugins.json'), 'utf8'));
        const entries = doc && doc.plugins && doc.plugins[`${PLUGIN}@${MARKETPLACE}`];
        if (Array.isArray(entries) && entries.some((e) => e && typeof e.installPath === 'string' && fs.existsSync(e.installPath))) return true;
    } catch { /* no evidence */ }
    try {
        const base = path.join(dir, 'cache', MARKETPLACE, PLUGIN);
        return fs.readdirSync(base).some((v) => fs.existsSync(path.join(base, v, 'skills')));
    } catch { return false; }
}

// Claude Code: marketplace entry for THIS repo + enabledPlugins, merged into settings.json.
// Never throws; ok=true only when a re-read shows both keys in place (or the human opted out).
function registerClaude({ home, repo = OWN_REPO }) {
    let file;
    try { file = settingsTarget(home); } catch (e) {
        return { ok: false, error: `${settingsPath(home)} is a broken symlink (${e.message}); nothing changed` };
    }
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
    const optOut = { ok: true, optedOut: true, changed: false, record: null };
    const record = { marketplace: MARKETPLACE, pluginId, addedMarketplace: false, addedEnabled: false, replaced: null, renames: [], keptForeign: null };
    const prev = JSON.parse(JSON.stringify(data));
    const mk = data.extraKnownMarketplaces && typeof data.extraKnownMarketplaces === 'object' ? data.extraKnownMarketplaces : {};
    const plugins = data.enabledPlugins && typeof data.enabledPlugins === 'object' ? data.enabledPlugins : {};
    if (plugins[pluginId] === false) return optOut;

    for (const [key, entry] of Object.entries(mk)) {
        if (repoOf(entry) !== EXTERNAL_REPO) continue;
        const id = `${PLUGIN}@${key}`;
        if (plugins[id] === false) return optOut;
        const others = Object.keys(plugins).filter((i) => i.endsWith(`@${key}`) && i !== id);
        if (key === MARKETPLACE && others.length) {
            return { ok: false, error: `marketplace "${MARKETPLACE}" in ${file} is the external ${EXTERNAL_REPO} and ${others.join(', ')} use it; not replacing it, nothing changed` };
        }
        if (id in plugins && key !== MARKETPLACE) {
            record.renames.push({ from: id, to: pluginId, value: plugins[id], merged: pluginId in plugins });
            if (!(pluginId in plugins)) plugins[pluginId] = plugins[id];
            delete plugins[id];
        }
        if (!others.length && !record.replaced) {
            record.replaced = { key, entry };
            delete mk[key];
        } else if (!record.keptForeign && key !== MARKETPLACE) {
            record.keptForeign = key;
        }
    }
    if (mk[MARKETPLACE] && repoOf(mk[MARKETPLACE]) !== repo) {
        return { ok: false, error: `marketplace "${MARKETPLACE}" in ${file} points at another source (${repoOf(mk[MARKETPLACE]) || 'unknown'}); not overwriting it, nothing changed` };
    }
    if (!mk[MARKETPLACE]) {
        record.addedMarketplace = true;
        mk[MARKETPLACE] = { source: { source: 'github', repo } };
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

// Reverses exactly what the record lists: added keys, the replaced marketplace, every rename.
function deregisterClaude({ home, record }) {
    let file;
    try { file = settingsTarget(home); } catch { return { changed: false, error: 'settings.json is a broken symlink' }; }
    if (!record || !fs.existsSync(file)) return { changed: false };
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { changed: false, error: 'settings.json not readable' }; }
    let changed = false;
    const plugins = data.enabledPlugins && typeof data.enabledPlugins === 'object' ? data.enabledPlugins : null;
    if (plugins) {
        const renamedIn = (record.renames || []).some((r) => !r.merged);
        if ((record.addedEnabled || renamedIn) && record.pluginId in plugins) { delete plugins[record.pluginId]; changed = true; }
        for (const r of record.renames || []) {
            if (r.from in plugins) continue;
            plugins[r.from] = r.value; changed = true;
        }
    } else if ((record.renames || []).length) {
        data.enabledPlugins = Object.fromEntries(record.renames.map((r) => [r.from, r.value]));
        changed = true;
    }
    if (data.enabledPlugins && !Object.keys(data.enabledPlugins).length) delete data.enabledPlugins;
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

// Removes only files the manifest recorded whose bytes still match the recorded hash, after
// copying them into backupDir/<path relative to home>. Edited and untracked files stay. Every
// candidate must resolve (path.resolve and realpath) to a regular file under the real root; a
// symlinked root is refused outright.
function removeLooseCopies({ home, root, manifest, backupDir }) {
    const res = { removed: [], keptEdited: [], skipped: [], refused: null };
    let rootStat;
    try { rootStat = fs.lstatSync(root); } catch { return res; }
    if (rootStat.isSymbolicLink()) { res.refused = `${root} is a symlink`; return res; }
    const prefix = path.resolve(root) + path.sep;
    const realPrefix = fs.realpathSync(root) + path.sep;
    for (const [file, entry] of Object.entries(manifest)) {
        if (typeof file !== 'string' || !path.isAbsolute(file)) continue;
        if (file.split(/[\\/]/).includes('..')) { if (file.startsWith(prefix)) res.skipped.push(file); continue; }
        const abs = path.resolve(file);
        if (!abs.startsWith(prefix)) continue;
        let st;
        try { st = fs.lstatSync(abs); } catch { continue; }
        let real = null;
        try { real = fs.realpathSync(abs); } catch { /* skipped below */ }
        if (!st.isFile() || !real || !real.startsWith(realPrefix)) { res.skipped.push(file); continue; }
        if (hashOf(abs) !== (entry && entry.sha256)) { res.keptEdited.push(file); continue; }
        const dest = path.join(backupDir, path.relative(home, abs));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(abs, dest);
        fs.unlinkSync(abs);
        delete manifest[file];
        res.removed.push(file);
        for (let d = path.dirname(abs); d.startsWith(prefix); d = path.dirname(d)) {
            try { fs.rmdirSync(d); } catch { break; }
        }
    }
    return res;
}

const installManifestPath = (home) => path.join(home, '.agents', '.bdb-install-manifest.json');

// Plugin-migration backup dirs, newest first: the state file's list plus a scan, so they are
// found even after uninstall removed or reset the state.
function listBackups(home) {
    const found = new Set(readState(home).backups.filter((d) => fs.existsSync(d)));
    const dir = path.join(home, '.agents', 'backups');
    try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.isDirectory() && e.name.startsWith('plugin-migration-')) found.add(path.join(dir, e.name));
        }
    } catch { /* none */ }
    return [...found].sort().reverse();
}

// Copies backed-up files back to their original place; never overwrites an existing file.
// Restored files are recorded in the install manifest so a later migration can retire them again.
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
    if (restored.length) {
        let manifest = {};
        try { manifest = JSON.parse(fs.readFileSync(installManifestPath(home), 'utf8')); } catch { /* new */ }
        for (const f of restored) manifest[f] = { path: f, sha256: hashOf(f), restoredAt: new Date().toISOString() };
        fs.mkdirSync(path.dirname(installManifestPath(home)), { recursive: true });
        fs.writeFileSync(installManifestPath(home), JSON.stringify(manifest, null, 2) + '\n');
    }
    return restored;
}

// Restores every backup, then deregisters the plugin it registered so Claude does not load the
// restored skills a second time. stillEnabled is true when the plugin remains enabled anyway.
function restorePluginBackups({ home }) {
    const dirs = listBackups(home);
    const files = [];
    for (const d of dirs) files.push(...restoreBackup({ home, backupDir: d }));
    const state = readState(home);
    const record = state.registered.claudecode;
    let deregistered = false;
    if (files.length && record) {
        deregistered = !!deregisterClaude({ home, record }).changed;
        delete state.registered.claudecode;
        writeState(home, state);
    }
    let stillEnabled = false;
    try { stillEnabled = JSON.parse(fs.readFileSync(settingsTarget(home), 'utf8')).enabledPlugins[`${PLUGIN}@${MARKETPLACE}`] === true; } catch { /* not enabled */ }
    return { dirs, files, deregistered, stillEnabled };
}

// After uninstall: keep the backup index, drop the registration record.
function retireState(home) {
    const backups = listBackups(home);
    if (!backups.length) { try { fs.rmSync(statePath(home)); } catch { /* already gone */ } return; }
    writeState(home, { registered: {}, backups });
}

const REGISTRARS = { claudecode: registerClaude };

// mode: 'on' | 'check' (report only) | 'off'. Returns { covered:Set, lines:[] }.
// covered = harnesses whose loose copies are retired: the plugin is registered AND Claude Code
// itself shows it installed. Registered but not yet installed keeps the copies for a later run.
function migrate({ home, manifest, detected, mode = 'on', registrars = REGISTRARS, repo = OWN_REPO }) {
    const lines = [];
    const covered = new Set();
    if (mode === 'off') return { covered, lines: ['Plugin migration is off (AOS_PLUGIN_MIGRATION=off); loose copies untouched.'] };
    const state = readState(home);
    const before = JSON.stringify(state);
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
            lines.push(`[check] ${key}: would register the ${PLUGIN} plugin and, once Claude Code shows it installed, back up and remove up to ${n} unmodified own copies from ${root}.`);
            continue;
        }
        const reg = register({ home, repo });
        if (!reg.ok) { lines.push(`${key}: plugin registration failed (${reg.error}); loose copies kept.`); continue; }
        if (reg.optedOut) { lines.push(`${key}: ${PLUGIN}@${MARKETPLACE} is set to false in settings.json (opt-out); nothing registered, loose copies untouched.`); continue; }
        if (reg.record) {
            const prior = state.registered[key];
            state.registered[key] = prior ? {
                ...reg.record,
                addedMarketplace: prior.addedMarketplace || reg.record.addedMarketplace,
                addedEnabled: prior.addedEnabled || reg.record.addedEnabled,
                replaced: prior.replaced || reg.record.replaced,
                renames: [...(prior.renames || []), ...(reg.record.renames || [])],
                keptForeign: prior.keptForeign || reg.record.keptForeign,
            } : reg.record;
            if (reg.record.replaced) lines.push(`${key}: replaced external marketplace "${reg.record.replaced.key}" (${EXTERNAL_REPO}) with ${repo}. Nothing on GitHub was changed.`);
            if (reg.record.keptForeign) lines.push(`${key}: external marketplace "${reg.record.keptForeign}" also lists other plugins and stays in place; only ${PLUGIN}@${reg.record.keptForeign} moved to ${MARKETPLACE}.`);
        }
        lines.push(`${key}: ${PLUGIN} plugin registered${reg.changed ? '' : ' (already in place)'}.`);
        if (!pluginInstalled(home)) {
            lines.push(`${key}: Claude Code does not show the plugin as installed yet; loose copies kept: restart Claude Code, then run the installer again to retire the loose copies.`);
            continue;
        }
        const r = removeLooseCopies({ home, root, manifest, backupDir });
        if (r.refused) { lines.push(`${key}: ${r.refused}; loose copies kept.`); continue; }
        covered.add(key);
        if (r.removed.length) removedAny = true;
        lines.push(`${key}: ${r.removed.length} own loose copies removed from ${root}${r.keptEdited.length ? `, ${r.keptEdited.length} edited kept` : ''}${r.skipped.length ? `, ${r.skipped.length} unsafe paths skipped` : ''}; unknown files untouched.`);
    }
    if (removedAny) {
        state.backups.push(backupDir);
        lines.push(`Backup of removed files: ${backupDir} (restore with: aos-uninstall --restore-plugin-backup).`);
    }
    if (mode === 'on' && JSON.stringify(state) !== before) writeState(home, state);
    return { covered, lines, removedAny };
}

module.exports = {
    PLUGIN, MARKETPLACE, OWN_REPO, EXTERNAL_REPO, LOOSE_ROOTS, REGISTRARS,
    statePath, readState, writeState, registerClaude, deregisterClaude, removeLooseCopies, restoreBackup, listBackups,
    restorePluginBackups, retireState, pluginInstalled, migrate,
};
