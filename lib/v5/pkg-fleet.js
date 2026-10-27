'use strict';
// v5 package contract for the Claude Code mods (plugins/bdb-aos-fleet, -sessions, -alert, -control; need Claude Code >= MIN_VERSION).
// ctx = { home, claudeBin, run, dryRun, env?, log? }. Nothing here reads HOME or process.env.
// Registration only: settings.json gets the marketplace entry and enabledPlugins[KEY] = true.
// The module itself is the fleet mod; `mods` lists all four.
const fs = require('fs');
const path = require('path');
const { parseJsonc } = require('../jsonc');
const { backupOnce } = require('../backup-once');

const MARKETPLACE = 'bdb-marketplace';
const OWN_REPO = 'hybridlabor-api/aos';
const MIN_VERSION = '2.1.287';

const sayOf = (ctx) => (typeof ctx.log === 'function' ? ctx.log : ctx.log && ctx.log.step ? (m) => ctx.log.step(m) : () => {});
const envOf = (ctx) => (ctx.env && typeof ctx.env === 'object' ? ctx.env : {});
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

const configDir = (ctx) => (envOf(ctx).CLAUDE_CONFIG_DIR ? path.resolve(envOf(ctx).CLAUDE_CONFIG_DIR) : path.join(ctx.home, '.claude'));
const settingsPath = (ctx) => path.join(configDir(ctx), 'settings.json');

async function claudeVersion(ctx) {
    try {
        const r = await ctx.run(ctx.claudeBin || 'claude', ['--version']);
        if (!r || r.error || r.ok === false || r.status > 0 || r.code > 0) return null;
        // `claude --version` prints "2.1.289 (Claude Code)"; a line that does not start with the version is noise.
        const m = /^\s*(\d+)\.(\d+)\.(\d+)/m.exec(String(r.stdout || ''));
        return m ? m.slice(1).join('.') : null;
    } catch { return null; }
}
const tooOld = (v) => cmp(v.split('.').map(Number), MIN_VERSION.split('.').map(Number)) < 0;
const skipReason = (v) => (v === null ? 'Claude Code not found' : tooOld(v) ? `Claude Code < ${MIN_VERSION}` : null);

// A symlinked settings.json is written through to its real file; a broken link is an error.
function readSettings(ctx) {
    const link = settingsPath(ctx);
    let file = link;
    let st = null;
    try { st = fs.lstatSync(link); } catch { /* absent */ }
    if (st && st.isSymbolicLink()) {
        try { file = fs.realpathSync(link); } catch (e) { return { error: `${link} is a broken symlink (${e.message}); nothing changed` }; }
    }
    let text;
    try {
        if (!fs.existsSync(file)) return { file, existed: false, data: {}, mtimeMs: null };
        text = fs.readFileSync(file, 'utf8');
    } catch (e) { return { error: `cannot read ${file} (${e.code || e.message}); nothing changed` }; }
    let data;
    try { data = parseJsonc(text); } catch (e) { return { error: `${file} is not valid JSON (${e.message}); nothing changed` }; }
    if (!isObj(data)) return { error: `${file} is not a JSON object; nothing changed` };
    for (const k of ['enabledPlugins', 'extraKnownMarketplaces']) {
        if (data[k] !== undefined && !isObj(data[k])) return { error: `${k} in ${file} is not a plain JSON object; nothing changed` };
    }
    let hasComments = false;
    try { JSON.parse(text); } catch { hasComments = true; }
    return { file, existed: true, data, hasComments, mtimeMs: fs.statSync(file).mtimeMs };
}

// Refuses a file with comments (a rewrite would drop them) and one that changed since it was read.
function writeAtomic(s, data, keys) {
    const { file, existed } = s;
    if (s.hasComments) throw new Error(`it has comments a rewrite would drop; add ${keys.map((k) => `"${k}": true`).join(', ')} under enabledPlugins by hand`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const mode = existed ? fs.statSync(file).mode & 0o777 : 0o600;
    const tmp = `${file}.${process.pid}.${process.hrtime.bigint()}.tmp`;
    try {
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode });
        if (existed && fs.statSync(file).mtimeMs !== s.mtimeMs) throw new Error('it changed while AOS was editing it; run the installer again');
        if (existed) backupOnce(file, () => { const b = `${file}.${process.hrtime.bigint()}.bak`; fs.copyFileSync(file, b); return b; });
        fs.renameSync(tmp, file);
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch { /* never written */ }
        throw e;
    }
}

const repoOf = (entry) => (isObj(entry) && isObj(entry.source) ? entry.source.repo : undefined);

function makeMod({ id, name, plugin, optOutEnv = null }) {
    const KEY = `${plugin}@${MARKETPLACE}`;
    const envOptOut = (ctx) => !!optOutEnv && envOf(ctx)[optOutEnv] === '1';
    const optedOut = (data) => (data.enabledPlugins || {})[KEY] === false;

    // Edits `next` (the copy enable() writes once for all mods); changed: true means this mod added something to it.
    function stage(ctx, s, next) {
        if (optedOut(s.data) && !ctx.clearOptOut) return { ok: true, optedOut: true, changed: false };
        const existing = (s.data.extraKnownMarketplaces || {})[MARKETPLACE];
        if (existing && repoOf(existing) !== OWN_REPO) {
            const why = `${MARKETPLACE} points at ${repoOf(existing) || 'an unknown source'}, which has no ${KEY.split('@')[0]}`;
            sayOf(ctx)(`${id}: skipped (${why})`);
            return { ok: true, skipped: true, reason: why, changed: false };
        }
        const actions = [];
        if (!next.extraKnownMarketplaces[MARKETPLACE]) {
            next.extraKnownMarketplaces[MARKETPLACE] = { source: { source: 'github', repo: OWN_REPO } };
            actions.push(`add marketplace ${MARKETPLACE} (${OWN_REPO}) to ${s.file}`);
        }
        if (next.enabledPlugins[KEY] !== true) {
            next.enabledPlugins[KEY] = true;
            actions.push(`set enabledPlugins["${KEY}"] = true in ${s.file}`);
        }
        return { ok: true, changed: actions.length > 0, actions };
    }

    const mod = { id, name, plugin, detect, install: apply, update: apply, verify, uninstall, KEY, MIN_VERSION, envOptOut, stage };
    async function apply(ctx) { return (await enable(ctx, [mod]))[0]; }

    const pluginVersion = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'plugins', plugin, '.claude-plugin', 'plugin.json'), 'utf8')).version || null; } catch { return null; } };

    async function detect(ctx) {
        const claude = await claudeVersion(ctx);
        const s = readSettings(ctx);
        const enabled = s.error ? null : (s.data.enabledPlugins || {})[KEY];
        return { installed: enabled === true, version: pluginVersion(), claude: claude !== null, claudeVersion: claude, enabled: enabled === undefined ? null : enabled, envOptOut: envOptOut(ctx) };
    }

    async function verify(ctx) {
        if (envOptOut(ctx)) return { ok: true, optedOut: true, detail: `opted out (${optOutEnv}=1)` };
        const v = await claudeVersion(ctx);
        const reason = skipReason(v);
        if (reason) return { ok: true, skipped: true, detail: `skipped (${reason})` };
        const s = readSettings(ctx);
        if (s.error) return { ok: false, detail: s.error };
        if (optedOut(s.data)) return { ok: true, optedOut: true, detail: 'opted out' };
        const mk = repoOf((s.data.extraKnownMarketplaces || {})[MARKETPLACE]);
        if (mk && mk !== OWN_REPO) return { ok: true, skipped: true, detail: `skipped (${MARKETPLACE} points at ${mk})` };
        return (s.data.enabledPlugins || {})[KEY] === true ? { ok: true, detail: `enabled (Claude Code ${v})` } : { ok: false, detail: `${KEY} is not enabled in ${s.file}` };
    }

    async function uninstall(ctx) {
        const s = readSettings(ctx);
        if (s.error) return { ok: false, error: s.error, changed: false };
        if ((s.data.enabledPlugins || {})[KEY] !== true) return { ok: true, changed: false, actions: [] };
        const actions = [`remove enabledPlugins["${KEY}"] from ${s.file}`];
        if (ctx.dryRun) return { ok: true, dryRun: true, changed: false, actions };
        const enabledPlugins = { ...s.data.enabledPlugins };
        delete enabledPlugins[KEY];
        // The marketplace entry stage() added goes with the last plugin that uses it (same repo only).
        const next = { ...s.data, enabledPlugins };
        const inUse = Object.entries(enabledPlugins).some(([k, v]) => v === true && k.endsWith(`@${MARKETPLACE}`));
        if (!inUse && repoOf((s.data.extraKnownMarketplaces || {})[MARKETPLACE]) === OWN_REPO) {
            const { [MARKETPLACE]: dropped, ...others } = s.data.extraKnownMarketplaces;
            next.extraKnownMarketplaces = others;
            actions.push(`remove extraKnownMarketplaces["${MARKETPLACE}"] from ${s.file}`);
        }
        try { writeAtomic(s, next, [KEY]); } catch (e) { return { ok: false, error: `could not write ${s.file}: ${e.message}`, changed: false }; }
        return { ok: true, changed: true, actions };
    }

    return mod;
}

// Enables several mods with one read-modify-write of settings.json (one backup at most); one result per mod, in order.
async function enable(ctx, list) {
    const res = list.map((m) => (m.envOptOut(ctx) ? { ok: true, optedOut: true, changed: false } : null));
    if (res.every(Boolean)) return res;
    const found = await claudeVersion(ctx);
    const reason = skipReason(found);
    const fix = 'then `aos package install fleet|sessions|alert|control`';
    const hint = found === null ? `Claude Code not found in PATH: install it, ${fix}` : `Claude Code in PATH is ${found}, mods need >= ${MIN_VERSION}: run \`claude update\`, ${fix}`;
    const s = reason ? null : readSettings(ctx);
    const next = s && !s.error ? { ...s.data, extraKnownMarketplaces: { ...(s.data.extraKnownMarketplaces || {}) }, enabledPlugins: { ...(s.data.enabledPlugins || {}) } } : null;
    list.forEach((m, i) => {
        if (res[i]) return;
        if (reason) { sayOf(ctx)(`${m.id}: skipped (${reason})`); res[i] = { ok: true, skipped: true, reason, hint, changed: false }; }
        else if (s.error) res[i] = { ok: false, error: s.error, changed: false };
        else res[i] = m.stage(ctx, s, next);
    });
    const keys = list.filter((m, i) => res[i].changed).map((m) => m.KEY);
    if (!keys.length) return res;
    if (ctx.dryRun) return res.map((r) => (r.changed ? { ...r, dryRun: true, changed: false } : r));
    try { writeAtomic(s, next, keys); } catch (e) { return res.map((r) => (r.changed ? { ok: false, error: `could not write ${s.file}: ${e.message}`, changed: false } : r)); }
    return res;
}

const fleet = makeMod({ id: 'fleet', name: 'Fleet mod', plugin: 'bdb-aos-fleet', optOutEnv: 'AOS_NO_FLEET' });
const mods = [
    fleet,
    makeMod({ id: 'sessions', name: 'Sessions mod', plugin: 'bdb-aos-sessions' }),
    makeMod({ id: 'alert', name: 'Alert mod', plugin: 'bdb-aos-alert' }),
    makeMod({ id: 'control', name: 'Control mod', plugin: 'bdb-aos-control' }),
];

module.exports = { ...fleet, mods, enable };
