'use strict';
// v5 package contract for the fleet mod (plugins/bdb-aos-fleet, needs Claude Code >= MIN_VERSION).
// ctx = { home, claudeBin, run, dryRun, env?, log? }. Nothing here reads HOME or process.env.
// Registration only: settings.json gets the marketplace entry and enabledPlugins[KEY] = true.
const fs = require('fs');
const path = require('path');
const { parseJsonc } = require('../jsonc');

const MARKETPLACE = 'bdb-marketplace';
const OWN_REPO = 'hybridlabor-api/aos';
const KEY = `bdb-aos-fleet@${MARKETPLACE}`;
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
        const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(r.stdout || ''));
        return m ? m[0] : null;
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
    if (!fs.existsSync(file)) return { file, existed: false, data: {} };
    const data = parseJsonc(fs.readFileSync(file, 'utf8'));
    if (!isObj(data)) return { error: `${file} is not a JSON object; nothing changed` };
    for (const k of ['enabledPlugins', 'extraKnownMarketplaces']) {
        if (data[k] !== undefined && !isObj(data[k])) return { error: `${k} in ${file} is not a plain JSON object; nothing changed` };
    }
    return { file, existed: true, data };
}

function writeAtomic(file, data, existed) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const mode = existed ? fs.statSync(file).mode & 0o777 : 0o644;
    if (existed) fs.copyFileSync(file, `${file}.${process.hrtime.bigint()}.bak`);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode });
    fs.renameSync(tmp, file);
}

const optedOut = (ctx, data) => envOf(ctx).AOS_NO_FLEET === '1' || (data.enabledPlugins || {})[KEY] === false;

async function apply(ctx) {
    const v = await claudeVersion(ctx);
    const reason = skipReason(v);
    if (reason) { sayOf(ctx)(`fleet: skipped (${reason})`); return { ok: true, skipped: true, reason, changed: false }; }
    const s = readSettings(ctx);
    if (s.error) return { ok: false, error: s.error, changed: false };
    if (optedOut(ctx, s.data)) return { ok: true, optedOut: true, changed: false };

    const next = { ...s.data, extraKnownMarketplaces: { ...(s.data.extraKnownMarketplaces || {}) }, enabledPlugins: { ...(s.data.enabledPlugins || {}) } };
    const actions = [];
    if (!next.extraKnownMarketplaces[MARKETPLACE]) {
        next.extraKnownMarketplaces[MARKETPLACE] = { source: { source: 'github', repo: OWN_REPO } };
        actions.push(`add marketplace ${MARKETPLACE} (${OWN_REPO}) to ${s.file}`);
    }
    if (next.enabledPlugins[KEY] !== true) {
        next.enabledPlugins[KEY] = true;
        actions.push(`set enabledPlugins["${KEY}"] = true in ${s.file}`);
    }
    if (!actions.length) return { ok: true, changed: false, actions };
    if (ctx.dryRun) return { ok: true, dryRun: true, changed: false, actions };
    try { writeAtomic(s.file, next, s.existed); } catch (e) { return { ok: false, error: `could not write ${s.file}: ${e.message}`, changed: false }; }
    return { ok: true, changed: true, actions };
}

async function detect(ctx) {
    const version = await claudeVersion(ctx);
    const s = readSettings(ctx);
    const enabled = s.error ? null : (s.data.enabledPlugins || {})[KEY];
    return { installed: enabled === true, version, claude: version !== null, enabled: enabled === undefined ? null : enabled };
}

async function verify(ctx) {
    const v = await claudeVersion(ctx);
    const reason = skipReason(v);
    if (reason) return { ok: true, skipped: true, detail: `skipped (${reason})` };
    const s = readSettings(ctx);
    if (s.error) return { ok: false, detail: s.error };
    if (optedOut(ctx, s.data)) return { ok: true, optedOut: true, detail: 'opted out' };
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
    try { writeAtomic(s.file, { ...s.data, enabledPlugins }, s.existed); } catch (e) { return { ok: false, error: `could not write ${s.file}: ${e.message}`, changed: false }; }
    return { ok: true, changed: true, actions };
}

module.exports = { id: 'fleet', name: 'Fleet mod', detect, install: apply, update: apply, verify, uninstall, KEY, MIN_VERSION };
