'use strict';
// Registers the bdb-aos Codex plugin through the real `codex plugin` CLI. Writing config entries
// alone does not install a plugin; `plugin add` is what populates the cache. Best effort: never
// throws, never touches ~/.codex/skills (the 263 loose skills stay), no mutation in check/dry-run.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PLUGIN_ID = 'bdb-aos@bdb-aos';
const MARKETPLACE = 'bdb-aos';
const GITHUB_SOURCE = 'hybridlabor-api/aos';

const statePath = (home) => path.join(home, '.agents', '.bdb-codex-plugin.json');
const readState = (home) => { try { return JSON.parse(fs.readFileSync(statePath(home), 'utf8')); } catch { return {}; } };
const writeState = (home, s) => {
    fs.mkdirSync(path.dirname(statePath(home)), { recursive: true });
    fs.writeFileSync(statePath(home), JSON.stringify(s, null, 2) + '\n');
};

function defaultRun(cmd, args) {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 120000 });
    return { status: r.error ? 127 : r.status, stdout: r.stdout || '', stderr: (r.stderr || '') + (r.error ? r.error.message : '') };
}

function onPath(cmd, env = process.env) {
    const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
    for (const dir of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
        for (const ext of exts) {
            try { fs.accessSync(path.join(dir, cmd + ext), fs.constants.X_OK); return true; } catch { /* next */ }
        }
    }
    return false;
}

const reason = (r) => String(r.stderr || r.stdout || `exit ${r.status}`).split('\n').filter((l) => l && !/^WARNING:/.test(l))[0] || `exit ${r.status}`;

// Reads `codex plugin list --json`: whether the bdb-aos marketplace is configured and what is installed.
function inspect(run) {
    const r = run('codex', ['plugin', 'list', '--json']);
    if (r.status !== 0) return { error: reason(r) };
    let data;
    try { data = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))); } catch { return { error: 'unparseable `codex plugin list --json` output' }; }
    const all = [...(data.installed || []), ...(data.available || [])];
    const mine = all.filter((p) => p.marketplaceName === MARKETPLACE);
    const installed = (data.installed || []).find((p) => p.pluginId === PLUGIN_ID) || null;
    return { marketplace: mine.length > 0, marketplaceSource: (mine[0] || {}).marketplaceSource || null, installed };
}

function manualCommands(source) {
    return [`codex plugin marketplace add ${source}`, `codex plugin add ${PLUGIN_ID}`];
}

function installCodexPlugin({ home, pkgRoot, version, mode = 'on', dryRun = false, run = defaultRun, hasCodex = onPath } = {}) {
    const lines = [];
    const say = (m) => lines.push(`Codex plugin: ${m}`);
    const result = { ok: true, changed: false, lines, record: null };
    try {
        if (mode === 'off') return result;
        const local = pkgRoot && fs.existsSync(path.join(pkgRoot, '.agents', 'plugins', 'marketplace.json'));
        const source = local ? pkgRoot : GITHUB_SOURCE;
        const hint = () => { for (const c of manualCommands(source)) say(`  run: ${c}`); };
        if (!hasCodex('codex')) {
            say('codex not found on PATH, skipped. Once Codex is installed, run:');
            hint();
            return result;
        }
        const dry = dryRun || mode === 'check';
        const fail = (step, r) => { result.ok = false; say(`${step} FAILED (${typeof r === 'string' ? r : reason(r)}). Run manually:`); hint(); return result; };

        const state = inspect(run);
        if (state.error) return fail('plugin list', state.error);
        if (state.installed && state.installed.version === version && state.installed.enabled !== false) {
            say(`${PLUGIN_ID} ${version} already installed (skills as $bdb-aos:<cmd>).`);
            return result;
        }
        const verb = dry ? 'would ' : '';
        const stale = state.installed && state.installed.version !== version;
        const srcOf = state.marketplaceSource;
        const repoint = state.marketplace && srcOf && srcOf.sourceType === 'local' && srcOf.source !== source && local;
        const plan = [];
        if (repoint) plan.push(['marketplace remove (stale local source)', ['plugin', 'marketplace', 'remove', MARKETPLACE]]);
        if (!state.marketplace || repoint) plan.push([`marketplace add ${source}`, ['plugin', 'marketplace', 'add', source]]);
        else if (stale && srcOf && srcOf.sourceType === 'git') plan.push(['marketplace upgrade', ['plugin', 'marketplace', 'upgrade', MARKETPLACE], true]);
        plan.push([`plugin add ${PLUGIN_ID}${stale ? ` (${state.installed.version} -> ${version})` : ''}`, ['plugin', 'add', PLUGIN_ID]]);

        if (dry) {
            for (const [label] of plan) say(`${verb}${label}`);
            return result;
        }
        const record = Object.assign({}, readState(home));
        for (const [label, args, soft] of plan) {
            const r = run('codex', args);
            if (r.status !== 0) {
                if (soft) { say(`${label} skipped (${reason(r)}), using the cached snapshot.`); continue; }
                return fail(label, r);
            }
            result.changed = true;
            say(`${label} ok`);
            if (args[2] === 'add' && args[1] === 'marketplace') record.addedMarketplace = true;
            if (args[1] === 'add') record.installedPlugin = true;
        }
        const after = inspect(run);
        if (after.error || !after.installed) return fail('verify (`codex plugin list`)', after.error || `${PLUGIN_ID} not listed as installed`);
        if (after.installed.version !== version) {
            say(`installed ${after.installed.version}, expected ${version} (the marketplace snapshot is older); re-run after the next release or run: codex plugin marketplace upgrade ${MARKETPLACE} && codex plugin add ${PLUGIN_ID}`);
        } else say(`${PLUGIN_ID} ${version} installed and enabled. Use $bdb-aos:<cmd> (for example $bdb-aos:setup); restart Codex to pick it up.`);
        record.version = after.installed.version;
        record.source = source;
        writeState(home, record);
        result.record = record;
    } catch (e) {
        result.ok = false;
        say(`skipped (${e.message})`);
    }
    return result;
}

// Removes only what the installer recorded: the plugin it installed and the marketplace it added.
function uninstallCodexPlugin({ home, run = defaultRun, hasCodex = onPath, dryRun = false } = {}) {
    const state = readState(home);
    if (!state.installedPlugin && !state.addedMarketplace) return { lines: [], changed: false };
    const lines = [];
    if (!hasCodex('codex')) {
        lines.push('Codex plugin: codex not found; to remove by hand run `codex plugin remove bdb-aos@bdb-aos`.');
        return { lines, changed: false };
    }
    const steps = [];
    if (state.installedPlugin) steps.push(['plugin', 'remove', PLUGIN_ID]);
    if (state.addedMarketplace) steps.push(['plugin', 'marketplace', 'remove', MARKETPLACE]);
    let ok = true;
    for (const args of steps) {
        const label = `codex ${args.join(' ')}`;
        if (dryRun) { lines.push(`Codex plugin: would run ${label}`); continue; }
        const r = run('codex', args);
        if (r.status === 0) lines.push(`Codex plugin: ${label} ok`);
        else { ok = false; lines.push(`Codex plugin: ${label} FAILED (${reason(r)}); run it by hand.`); }
    }
    if (!dryRun && ok) { try { fs.rmSync(statePath(home), { force: true }); } catch { /* ignore */ } }
    return { lines, changed: !dryRun && ok };
}

module.exports = { installCodexPlugin, uninstallCodexPlugin, PLUGIN_ID, MARKETPLACE, GITHUB_SOURCE, statePath };
