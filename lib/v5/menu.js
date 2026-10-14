'use strict';
// After install: Status | Update | Repair | Settings | Uninstall, and the same as `aos status|update|repair`.
// host = installer.js exports; o = { home, write, ui: { select(message, options, initial), ask(key) }, npmView, now, logFile, venv }.
// Without o.ui.ask (no TTY) nothing is ever asked, and nothing here ever falls back to a full install.
const fs = require('fs');
const path = require('path');
const versions = require('./versions');
const secrets = require('./secrets');
const { step, logFileFor } = require('./run');
const pk = require('./packages');
const adopt = require('../gateway/adopt');
const { gatewayDir } = require('../gateway/config');
const { harnessMcpFiles, shippedServers } = require('../mcp-secrets');

const PAT = 'GITHUB_PERSONAL_ACCESS_TOKEN';
const { readSettings, writeSettings, PROFILES, knownProfile, profileOf, excludedIds } = require('./profile');

const base = (host, o) => ({ host, home: o.home, state: host.detectInstallState(), venv: o.venv });
const scan = (b) => Promise.all(pk.registry.map(async (p) => {
    let d;
    try { d = (await p.detect(b)) || {}; } catch (e) { return { p, installed: null, version: null, error: e.message }; }
    return { p, installed: Boolean(d.installed), migrate: Boolean(d.migrate), version: d.version || null, enabled: d.enabled };
}));
const checkVersions = (rows, host, o) => versions.checkAll(
    rows.filter((r) => r.installed && r.p.npm && r.version).map((r) => ({ id: r.p.id, npm: r.p.npm, local: r.version, pin: r.p.pin ? r.p.pin(host) : null })),
    { home: o.home, now: o.now, npmView: o.npmView, isNewer: host.isNewerVersion, floor: { '@hybridlabor-api/aos': require('../../package.json').version } },
);
const verifyOf = async (p, c) => {
    if (!p.verify) return { ok: true, detail: 'n/a' };
    try { return await p.verify(c); } catch (e) { return { ok: false, detail: e.message }; }
};
// Ollama needs no key.
const openwikiKeyName = (host) => {
    const env = host.loadExistingEnv(host.resolveTargetPaths('1', null).targetMcpDir);
    const provider = env.OPENWIKI_PROVIDER || 'google';
    return provider === 'ollama' ? null : host.PROVIDER_KEY_ENV_NAMES[provider] || 'OPENWIKI_API_KEY';
};
const secretKeys = (host, rows, b) => {
    const keys = [PAT];
    if (rows.some((r) => r.p.id === 'openwiki' && r.installed)) {
        const name = openwikiKeyName(host);
        if (name) keys.push(name);
    }
    return keys;
};
const askOf = (o) => (o.ui && o.ui.ask) || (async () => null);

// The hub watcher's status file (~/.aos/status.json): { at, services: { id: { up, misses, restarts, failed, lastError } } }.
// Missing or unreadable means the supervisor is not running — that is its own line, not an error.
function readStatusJson(home) {
    try { return JSON.parse(fs.readFileSync(path.join(home, '.aos', 'status.json'), 'utf8')); } catch { return null; }
}

function formatServicesBlock(statusJson, now) {
    if (!statusJson || typeof statusJson !== 'object') return ['Supervisor not running (no ~/.aos/status.json)'];
    const lines = ['Services:'];
    if (typeof statusJson.at === 'number' && now - statusJson.at > 120000) {
        lines.push(`  status is stale (last update ${Math.round((now - statusJson.at) / 60000)} min ago)`);
    }
    const services = statusJson.services && typeof statusJson.services === 'object' ? statusJson.services : {};
    for (const [id, e] of Object.entries(services)) {
        const state = e && e.failed ? 'failed' : e && e.up === true ? 'up' : e && e.up === false ? 'down' : 'unknown';
        const restarts = (e && Array.isArray(e.restarts) ? e.restarts : []).filter((ts) => now - ts < 600000).length;
        lines.push(`  ${state.padEnd(7)}${id}${restarts ? ` · ${restarts} restart${restarts === 1 ? '' : 's'} (10 min)` : ''}${e && e.lastError ? ` · ${e.lastError}` : ''}`);
    }
    if (!Object.keys(services).length) lines.push('  (no services tracked)');
    return lines;
}

async function status(host, o) {
    const b = base(host, o);
    const rows = (await scan(b)).filter((r) => r.installed || r.error);
    const vs = await checkVersions(rows, host, o);
    let broken = 0;
    for (const r of rows) {
        if (r.error) { broken++; o.write(`✖ ${r.p.name.padEnd(20)} detect failed: ${r.error}\n`); continue; }
        const v = vs.find((x) => x.id === r.p.id);
        const ver = !v ? (r.version ? `${r.version}${r.p.npm ? '' : ' (no update check)'}` : 'version unknown') : v.outdated ? `${v.local} -> ${v.remote}` : `${v.local}${v.remote === 'unknown' ? ' (latest unknown)' : ''}`;
        const res = await verifyOf(r.p, { ...b, run: null });
        if (!res.ok) broken++;
        o.write(`${res.ok ? '✔' : '✖'} ${r.p.name.padEnd(20)} ${ver}${res.ok && !res.busy ? '' : ` — ${res.detail}`}\n`);
    }
    const n = vs.filter((v) => v.outdated).length;
    o.write(`${n} update${n === 1 ? '' : 's'} available${broken ? `, ${broken} broken` : ''}\n`);
    const st = readSettings(o.home);
    o.write(`Profile: ${profileOf(st)}${st.noHooks ? ' (context hooks off)' : ''}. Fix: aos repair. Change: aos, Settings. Remove: aos, Uninstall.\n`);
    for (const line of formatServicesBlock(readStatusJson(o.home), o.now ? o.now() : Date.now())) o.write(`${line}\n`);
    return broken ? 1 : 0;
}

// Other local stdio MCP servers join the gateway only when the user picks them here (menu path, o.adopt).
// `aos update` never asks: it prints the hint line instead.
async function adoptGateway(o, logFile) {
    const gw = pk.registry.find((p) => p.id === 'gateway');
    const files = harnessMcpFiles(o.home, process.env, process.platform, o.home);
    const shipped = shippedServers();
    const { adoptable } = adopt.scanAdoptable({ files, shipped });
    if (!adoptable.length) return;
    const names = adoptable.map((a) => a.name);
    const prior = readSettings(o.home).gateway || {};
    const adopted = prior.adopted || [], declined = prior.declined || [];
    const answered = prior.promptedAt !== undefined;
    if (answered && names.every((n) => adopted.includes(n) || declined.includes(n))) return;
    if (!o.adopt || !o.ui || !o.ui.multi) {
        o.write('Other MCP servers can join the gateway: aos-gateway adopt\n');
        return;
    }
    const picked = await o.ui.multi('Move these MCP servers behind the gateway? Their harness entries are removed; aos-gateway direct restores them.',
        adoptable.map((a) => ({ value: a.name, label: `${a.name}  ${[a.entry.command, ...a.entry.args].join(' ')}` })),
        adopted.filter((n) => names.includes(n)));
    const unshown = (list) => list.filter((n) => !names.includes(n));
    const st = readSettings(o.home);
    writeSettings(o.home, { ...st, gateway: {
        adopted: [...new Set([...picked, ...unshown(adopted)])],
        declined: [...new Set([...names.filter((n) => !picked.includes(n)), ...unshown(declined)])],
        promptedAt: new Date().toISOString(),
        mode: picked.length ? 'gateway' : 'direct',
    } });
    if (!picked.length) return;
    await step('Adopt MCP servers', async (run) => {
        const token = fs.readFileSync(path.join(gatewayDir(o.home), 'token'), 'utf8').trim();
        const r = adopt.applyAdopt({ home: o.home, token, files, shipped, only: picked });
        const msgs = [];
        if (r.adopted.length) {
            await gw.update({ home: o.home, run, log: (m) => msgs.push(m) }); // mcp.json is built from adopted.json only here
            run(process.execPath, [path.join(o.home, '.agents', 'bin', 'aos-gateway.mjs'), 'restart']);
        }
        return [r.adopted.join(', ') || 'nothing new', ...msgs].join('; ');
    }, { logFile, out: o.write });
}

// After an update the running servers still hold the old code in memory (seen live: new HTML,
// old router, 404 on new assets). Restart every running service the hub can control; the hub and
// the gateway restart themselves. A failure only warns: it must never fail the update.
// changed (package ids that changed in this run) limits the restart to those services; services without a package id
// follow the kernel step (it ships them). undefined restarts all of them.
async function restartRunningServices(o, deps, changed) {
    const { statusService, controlService } = deps || await import('../hub/services.mjs');
    const ctx = { home: o.home, root: path.join(__dirname, '..', '..') };
    let rows = [];
    try { rows = await statusService(ctx); } catch (e) { o.write(`Service restart skipped: ${e.message}\n`); return []; }
    const done = [];
    for (const r of rows) {
        if (r.up !== true || !['launchd', 'systemd'].includes(r.control) || r.id === 'hub' || r.id === 'gateway') continue;
        if (changed && !changed.has(r.id) && !(changed.has('kernel') && !r.pkg)) continue;
        try { await controlService(ctx, r.id, 'restart'); o.write(`Restarted ${r.id} on the new code\n`); done.push(r.id); }
        catch (e) { o.write(`warning: could not restart ${r.id} (${e.message}); restart it with: aos restart ${r.id}\n`); }
    }
    return done;
}

// Plan 7a: the Claude Code mods are enabled unless opted out (AOS_NO_FLEET=1 for fleet, enabledPlugins false) or disabled;
// pkg-fleet itself skips without Claude Code >= its minimum version. Failures only warn.
const claudeMods = () => pk.registry.filter((p) => p.claudeMod);
// One settings.json write for all mods (pk.enableClaudeMods), not one per mod.
async function enableMods(c, mods, done = []) {
    const warns = [];
    if (!mods.length) return warns;
    let results;
    try { results = await pk.enableClaudeMods(c, mods); } catch (e) { return [`Claude Code mods: ${e.message}`]; }
    for (const { entry: m, msg, error: e } of results) {
        if (!e) done.push(`${m.id} ${msg}`);
        else warns.push(/comments/.test(e.message) ? `${m.id}: settings.json has comments; enable ${m.claudeMod.split('@')[0]} by hand` : `${m.id}: ${e.message}`);
    }
    return warns;
}

// MCP gateway (plan F7): on by default, after the harness MCP configs exist. Linux (systemd unit) and Windows (scheduled task)
// install too; harnesses switch only once verify is green (pkg-gateway), and only darwin treats "not running" as a failure.
async function gatewayStep(S) {
    const gw = pk.registry.find((p) => p.id === 'gateway');
    let verified = true;
    const g = await S('MCP gateway', async (c) => {
        const msgs = [];
        await gw.install({ ...c, log: (m) => msgs.push(m) });
        const v = await gw.verify(c);
        verified = v.ok;
        if (v.ok) return [...msgs, v.busy ? v.detail : 'running'].join('; ');
        if (process.platform === 'darwin') throw new Error([...msgs, 'not running'].join('; '));
        const warn = `gateway installed, service not confirmed on ${process.platform}: harnesses left direct, run aos-gateway enable after aos-gateway status is green`;
        return [...new Set([...msgs, warn])].join('; ');
    });
    return { ...g, verified };
}

// Fresh install (A1): the gateway, the hub service and the Claude Code mods, through the same steps `aos update` uses.
// excluded = profile, --without and the saved disabled list. With o.ui.multi the mods are offered (all ticked); an unticked
// mod is saved as disabled so `aos update` does not add it later. Returns the names of the steps that failed.
async function installDefaults(host, o, excluded) {
    const b = base(host, o);
    const logFile = o.logFile || logFileFor(o.home);
    const S = (label, fn) => step(label, (run) => fn({ ...b, run }, run), { logFile, out: o.write });
    const pkgOf = (id) => (excluded.has(id) ? null : pk.registry.find((p) => p.id === id));
    const mods = claudeMods().filter((m) => !excluded.has(m.id));
    if (o.dryRun) {
        o.write(`DRY-RUN: would install ${[pkgOf('gateway'), pkgOf('hub'), ...mods].filter(Boolean).map((p) => p.id).join(', ') || 'nothing'}\n`);
        return [];
    }
    const failed = [];

    const found = await Promise.all(mods.map(async (m) => ({ m, d: (await m.detect(b).catch(() => null)) || {} })));
    let want = found.some((x) => x.d.claude) ? found.filter((x) => x.d.enabled === null && !x.d.envOptOut).map((x) => x.m) : [];
    if (want.length && o.ui && o.ui.multi) {
        const picked = await o.ui.multi('Claude Code detected. Enable these AOS mods?', want.map((m) => ({ value: m.id, label: `${m.name} (${m.claudeMod.split('@')[0]})` })), want.map((m) => m.id));
        const declined = want.filter((m) => !picked.includes(m.id)).map((m) => m.id);
        if (declined.length) { const st = readSettings(o.home); writeSettings(o.home, { ...st, disabled: [...new Set([...st.disabled, ...declined])] }); }
        want = want.filter((m) => picked.includes(m.id));
    }
    if (want.length) {
        const r = await S('Claude Code mods', async (c) => {
            const done = [];
            const warns = await enableMods(c, want, done);
            return [...done, ...(warns.length ? [`(warning: ${warns.join('; ')})`] : [])].join('; ');
        });
        if (!r.ok) failed.push('Claude Code mods');
    }

    const gw = pkgOf('gateway');
    if (gw && !(await gw.detect(b)).installed) {
        const g = await gatewayStep(S);
        if (!g.ok) failed.push(gw.name);
        else if (g.verified) await adoptGateway(o, logFile);
    }

    const hub = pkgOf('hub');
    if (hub && !(await hub.detect(b)).installed) {
        const h = await S(hub.name, async (c) => {
            const msgs = [];
            const r = await hub.install({ ...c, log: (m) => msgs.push(m) });
            if (r && r.ok === false) throw new Error([r.detail, ...msgs].filter(Boolean).join('; '));
            const v = await verifyOf(hub, c);
            if (v.ok) return [v.detail, ...msgs].join('; ');
            // Same rule as the gateway: only darwin treats a service that does not answer yet as a failure.
            if (process.platform === 'darwin') throw new Error([v.detail, ...msgs].join('; '));
            return [...msgs, `hub service not confirmed on ${process.platform} (${v.detail}): check aos hub status`].join('; ');
        });
        if (!h.ok) failed.push(hub.name);
    }
    return failed;
}

function detectManifestDrift(host, home) {
    const computeHash = host && host.computeFileHash ? host.computeFileHash : (p) => {
        try { const crypto = require('crypto'); return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { return null; }
    };
    const manifestPath = path.join(home, '.agents', '.bdb-install-manifest.json');
    let manifest = {};
    if (host && typeof host.loadInstallManifest === 'function') {
        try { manifest = host.loadInstallManifest(manifestPath); } catch (_) {}
    } else if (fs.existsSync(manifestPath)) {
        try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (_) {}
    }
    if (!manifest || typeof manifest !== 'object') return { drifted: false };
    for (const [filePath, entry] of Object.entries(manifest)) {
        if (!entry || !entry.sha256) continue;
        try {
            if (!fs.existsSync(filePath)) {
                return { drifted: true, reason: `missing ${path.basename(filePath)}` };
            }
            const diskHash = computeHash(filePath);
            if (diskHash && diskHash !== entry.sha256) {
                return { drifted: true, reason: `modified ${path.basename(filePath)}` };
            }
        } catch (_) {}
    }
    return { drifted: false };
}

async function planUpdate(host, o, { rows: rIn, vs: vsIn } = {}) {
    const b = base(host, o);
    const rows = rIn || (await scan(b));
    const vs = vsIn || (await checkVersions(rows, host, o));
    const running = require('../../package.json').version;
    const settings = readSettings(o.home);
    const disabled = excludedIds(settings);
    const force = Boolean(o && (o.force || (Array.isArray(o.argv) && o.argv.includes('--force')) || (process.argv && process.argv.includes('--force'))));
    const plan = [];

    // 1. Kernel: compare installed version against running package version, failed run, and drift
    const kRow = rows.find((r) => r.p.id === 'kernel');
    const kVer = kRow ? kRow.version : null;
    const kOutdated = vs.find((v) => v.id === 'kernel' && v.outdated);
    const lastFailed = Boolean(settings.lastRunFailed);
    const drift = (!force && !kOutdated && kVer && running && (!host.isNewerVersion || !host.isNewerVersion(kVer, running)))
        ? detectManifestDrift(host, o.home)
        : { drifted: false };

    let kChanged = Boolean(force || kOutdated || !kVer || (running && host.isNewerVersion && host.isNewerVersion(kVer, running)));
    let kReason = force ? 'forced' : (kChanged ? (kVer ? `${kVer} -> ${running}` : 'missing') : `current (${kVer || running})`);
    if (!force && !kChanged && lastFailed) {
        kChanged = true;
        kReason = 'retrying failed run';
    } else if (!force && !kChanged && drift.drifted) {
        kChanged = true;
        kReason = drift.reason;
    }

    plan.push({
        id: 'kernel',
        name: 'Kernel',
        changed: kChanged,
        reason: kReason,
    });

    // 2. Harnesses (follows kernel update or drift or failed run or force)
    plan.push({
        id: 'harnesses',
        name: 'Harnesses',
        changed: kChanged,
        reason: force ? 'forced' : (kChanged ? (lastFailed ? 'retrying failed run' : (drift.drifted ? drift.reason : 'kernel updated')) : 'current'),
    });

    // 3. Registered packages
    for (const r of rows) {
        const p = r.p;
        if (p.id === 'kernel' || disabled.has(p.id)) continue;
        if (!r.installed && !r.migrate) continue;

        if (force) {
            plan.push({
                id: p.id,
                name: p.name,
                changed: true,
                reason: 'forced',
            });
            continue;
        }

        if (typeof p.plan === 'function') {
            const vInfo = vs.find((x) => x.id === p.id);
            const pPlan = await p.plan({ ...b, row: r, versionInfo: vInfo, kernelChanged: kChanged });
            let pChanged = Boolean(pPlan.changed);
            let pReason = pPlan.reason || (pPlan.changed ? 'update available' : 'current');
            if (!pChanged && p.alwaysUpdate && kChanged) {
                pChanged = true;
                pReason = 'kernel/harnesses updated';
            }
            plan.push({
                id: p.id,
                name: p.name,
                changed: pChanged,
                reason: pReason,
            });
            continue;
        }

        const vInfo = vs.find((x) => x.id === p.id);
        const isOutdated = Boolean(vInfo && vInfo.outdated);
        let pChanged = isOutdated;
        let reason = 'current';
        if (isOutdated) reason = `${r.version || 'none'} -> ${vInfo.remote}`;
        else if (p.alwaysUpdate && kChanged) {
            pChanged = true;
            reason = 'kernel/harnesses updated';
        }
        else if (r.version) reason = `current (${r.version})`;
        else if (p.alwaysUpdate) reason = 'up to date';

        plan.push({
            id: p.id,
            name: p.name,
            changed: pChanged,
            reason,
        });
    }

    return plan;
}

async function update(host, o) {
    const b = base(host, o);
    const rows = (await scan(b));
    const vs = await checkVersions(rows, host, o);
    const outdated = new Set(vs.filter((v) => v.outdated).map((v) => v.id));
    const logFile = o.logFile || logFileFor(o.home);
    const S = (label, fn) => step(label, (run) => fn({ ...b, run }, run), { logFile, out: o.write });
    const disabled = excludedIds(readSettings(o.home)); // disabled in Settings or excluded by the profile: same for every package
    let broken = 0;
    const okNames = [], badNames = [];
    const changed = new Set(); // packages whose update ran and did change something: only their services restart
    const tally = (name, res) => { (res.ok ? okNames : badNames).push(name); };
    o.write('Existing install detected: Update applies v5 hooks, gate profiles and mods\n');
    o.write(outdated.size ? `${outdated.size} update${outdated.size === 1 ? '' : 's'} available\n` : 'Everything is current\n');

    const plan = await planUpdate(host, o, { rows, vs });
    const plannedChanges = plan.filter((p) => p.changed);
    const plannedIds = new Set(plannedChanges.map((p) => p.id));
    if (plannedChanges.length) {
        o.write(`Plan: ${plannedChanges.map((p) => `${p.name} (${p.reason})`).join(', ')}\n`);
    }

    if (typeof host.applyCodingModeStep === 'function' && plannedIds.has('kernel')) await host.applyCodingModeStep();

    const kernel = pk.registry.find((p) => p.id === 'kernel');
    let k = { ok: true };
    if (plannedIds.has('kernel')) {
        k = await S('Kernel', async (c) => { await kernel.update(c); });
        if (!k.ok) broken++;
        tally('Kernel', k);
        if (k.ok && outdated.has('kernel')) changed.add('kernel'); // plan-canvas, agenttrail, a2a have no package of their own
    }
    let h = { ok: true };
    if (plannedIds.has('harnesses')) {
        h = await S('Harnesses', async (c) => {
            pk.mustList(host.quickUpdateHarnesses(), 'Harnesses');
            // Extras below only warn: they never turn the step into ✖ nor hide a harness failure above.
            const warns = [];
            try { if (rows.some((r) => r.p.id === 'memb' && r.installed)) await pk.syncMembMcp(c); } catch (e) { warns.push(`memB MCP sync: ${e.message}`); }
            warns.push(...await enableMods(c, claudeMods().filter((m) => !disabled.has(m.id) && !rows.some((r) => r.p.id === m.id && r.installed))));
            return warns.length ? `(warning: ${warns.join('; ')})` : '';
        });
        if (!h.ok) broken++;
        tally('Harnesses', h);
    }

    // After Harnesses, which moves inline MCP tokens into the secrets file (an existing install must not be asked
    // for a token it already has); outside any step, whose output goes to the log and would hide the question.
    if (plannedIds.has('kernel') || plannedIds.has('harnesses')) {
        const keys = secretKeys(host, rows, b);
        await secrets.need(keys, { home: o.home, ask: askOf(o), legacy: host.loadExistingEnv(host.resolveTargetPaths('1', null).targetMcpDir) });
        const refused = secrets.refusal(o.home);
        if (refused) o.write(`${refused}\n`);
    }

    const gw = pk.registry.find((p) => p.id === 'gateway');
    let gwReady = !disabled.has('gateway') && rows.some((r) => r.p.id === 'gateway' && r.installed);
    let gwVerified = true;
    if (gw && !disabled.has('gateway') && !gwReady) {
        const g = await gatewayStep(S);
        if (!g.ok) broken++;
        tally('MCP gateway', g);
        gwReady = g.ok;
        gwVerified = g.verified;
    }
    if (gwReady && gwVerified && (o.adopt || plannedIds.has('gateway'))) await adoptGateway(o, logFile);

    for (const r of rows) {
        const p = r.p;
        // migrate: a leftover of an older install (beta.2 hub task XML) that update() converts.
        if (!(r.installed || r.migrate) || p.id === 'kernel' || p.todo || !p.update || disabled.has(p.id)) continue;
        const ran = plannedIds.has(p.id) || outdated.has(p.id) || (p.alwaysUpdate && (plannedIds.has('kernel') || plannedIds.has('harnesses')));
        if (!ran && !r.migrate) continue;
        const res = await S(p.name, async (c) => {
            const remote = (vs.find((x) => x.id === p.id) || {}).remote;
            const msgs = []; // e.g. gateway "harnesses left direct" (F15): shown in the step line like the install path
            const cu = { ...c, target: remote === 'unknown' ? null : remote, log: (m) => msgs.push(m) };
            if (ran) {
                const ret = await p.update(cu);
                if (!(ret && (ret.unchanged === true || ret.skipped))) changed.add(p.id);
            }
            let v = await verifyOf(p, c);
            const fix = p.repair || (!ran && p.update); // no repair: one retry via update(), unless it just ran
            if (!v.ok && fix) { await fix(cu); v = await verifyOf(p, c); }
            if (!v.ok) throw new Error([v.detail, ...msgs].join('; '));
            return [((await p.detect(c)) || {}).version || v.detail, v.busy && v.detail, ...msgs].filter(Boolean).join('; ');
        });
        if (!res.ok) broken++;
        tally(p.name, res);
    }

    // rows were scanned before this run; the gateway step above may have installed it since.
    const missing = rows.filter((r) => r.installed === false && !r.migrate && r.p.id !== 'kernel' && !(r.p.id === 'gateway' && gwReady)).map((r) => r.p.id);
    if (missing.length) o.write(`Optional, not installed: ${missing.join(', ')} (install via Settings)\n`);
    // This run refreshed from the OLD package, so it must neither claim success nor record the old version as current.
    // Old means the registry has something newer than the package that is running now: the recorded kernel version is
    // always older before this run saves it, so comparing it with the registry would call every update stale.
    const running = require('../../package.json').version;
    const stale = vs.find((v) => v.id === 'kernel' && v.outdated && host.isNewerVersion(running, v.remote));
    if (stale) o.write(`AOS ${stale.remote} available: run \`npx @hybridlabor-api/aos@latest\`\n`);
    else if (!o.dryRun && !process.argv.includes('--dry-run')) await restartRunningServices(o, undefined, changed);
    if (!stale) {
        if (okNames.length) o.write(`Verified OK: ${okNames.join(', ')}\n`);
        if (broken) o.write(`Broken: ${badNames.join(', ')}. Next: aos repair (details in ${logFile})\n`);
        o.write(broken ? `Verify: ${broken} step${broken === 1 ? '' : 's'} broken, log ${logFile}\n` : 'Verify: all ok\n');
    }
    // Files the Kernel step wrote must be recorded even when this run is stale or failed: otherwise the next run
    // sees them as user edits. Only the recorded version waits for a clean, current run.
    if (k.ok && !stale) host.saveManifest({ tier: '1', isUniversal: true, installedModules: b.state.installedModules });
    host.flushSessionManifest();

    const finalSettings = readSettings(o.home);
    if (broken > 0) {
        writeSettings(o.home, { ...finalSettings, lastRunFailed: true });
    } else if (!stale && finalSettings.lastRunFailed) {
        writeSettings(o.home, { ...finalSettings, lastRunFailed: false });
    }

    return broken || stale ? 1 : 0;
}

async function repair(host, o) {
    const b = base(host, o);
    const logFile = o.logFile || logFileFor(o.home);
    const disabled = excludedIds(readSettings(o.home));
    let broken = 0;
    for (const r of await scan(b)) {
        const p = r.p;
        if (!r.installed || p.todo || !p.verify || disabled.has(p.id)) continue;
        const res = await step(p.name, async (run) => {
            const c = { ...b, run };
            let v = await verifyOf(p, c);
            if (v.ok) return 'ok';
            const fix = p.repair || p.update;
            if (!fix) throw new Error(v.detail);
            await fix(c);
            v = await verifyOf(p, c);
            if (!v.ok) throw new Error(v.detail);
            return 'repaired';
        }, { logFile, out: o.write });
        if (!res.ok) broken++;
    }
    return broken ? 1 : 0;
}

async function gatewaySettings(host, o, b, gw) {
    const logFile = o.logFile || logFileFor(o.home);
    const subOptions = [
        { value: 'status', label: 'Show status' },
        { value: 'choose', label: 'Choose servers behind the gateway' },
        { value: 'enable', label: 'Enable (all behind gateway)' },
        { value: 'direct', label: 'Direct (restore all to harnesses)' },
        { value: 'restart', label: 'Restart gateway' },
        { value: 'back', label: 'Back' },
    ];
    const sub = await o.ui.select('Gateway settings:', subOptions, 'back');
    if (sub === 'status') {
        const v = await verifyOf(gw, b);
        o.write(`Gateway: ${v.ok ? 'running' : 'not running'}${v.detail ? ` (${v.detail})` : ''}\n`);
        return v.ok ? 0 : 1;
    }
    if (sub === 'choose') {
        return adoptGateway({ ...o, adopt: true }, logFile);
    }
    if (sub === 'enable') {
        const files = harnessMcpFiles(o.home, process.env, process.platform, o.home);
        const shipped = shippedServers();
        const { adoptable } = adopt.scanAdoptable({ files, shipped });
        const allNames = adoptable.map((a) => a.name);
        return step('Adopt all MCP servers', async (run) => {
            const tokenFile = path.join(gatewayDir(o.home), 'token');
            const token = fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : '';
            const report = adopt.applyAdopt({ home: o.home, token, files, shipped, only: allNames });
            if (report.files && report.files.some((f) => f.error)) throw new Error('Failed to adopt all MCP servers');
            await gw.update({ home: o.home, run, log: (m) => o.write(m + '\n') });
            const st = readSettings(o.home);
            writeSettings(o.home, { ...st, gateway: {
                adopted: allNames,
                declined: [],
                promptedAt: new Date().toISOString(),
                mode: 'gateway',
            } });
        }, { logFile, out: o.write });
    }
    if (sub === 'direct') {
        const files = harnessMcpFiles(o.home, process.env, process.platform, o.home);
        const harness = require('../gateway/harness');
        return step('Restore MCP servers direct to harnesses', async () => {
            const report = harness.disable({ home: o.home, files, now: o.now ? o.now() : Date.now() });
            if (report.some((r) => r.error)) throw new Error('Failed to restore all harnesses to direct');
            const st = readSettings(o.home);
            writeSettings(o.home, { ...st, gateway: { ...(st.gateway || {}), mode: 'direct' } });
        }, { logFile, out: o.write });
    }
    if (sub === 'restart') {
        return step('Restart gateway service', async (run) => {
            const fn = gw.restart || gw.update;
            await fn({ home: o.home, run, log: (m) => o.write(m + '\n') });
        }, { logFile, out: o.write });
    }
}

async function settings(host, o) {
    const b = base(host, o);
    const rows = (await scan(b)).filter((r) => r.p.id !== 'kernel' && !r.p.todo);
    const st = readSettings(o.home);
    const keys = secretKeys(host, rows, b);
    const gwRow = rows.find((r) => r.p.id === 'gateway');
    const gwInstalled = gwRow && gwRow.installed;
    const options = [
        ...keys.map((k) => ({ value: `secret:${k}`, label: `Re-enter ${k}${secrets.isSkipped(o.home, k) ? ' (skipped)' : ''}` })),
        ...rows.map((r) => ({ value: `pkg:${r.p.id}`, label: `${!r.installed ? 'Install' : st.disabled.includes(r.p.id) ? 'Enable' : 'Disable'} ${r.p.name}` })),
        ...(gwInstalled ? [{ value: 'gateway', label: `Gateway (mode: ${(st.gateway && st.gateway.mode) || 'gateway'})` }] : []),
        { value: 'profile', label: `Profile (now: ${profileOf(st)})` },
        { value: 'back', label: 'Back' },
    ];
    const choice = await o.ui.select('Settings:', options, 'back');
    if (choice === 'gateway') {
        await gatewaySettings(host, o, b, gwRow.p);
    } else if (choice === 'profile') {
        const next = await o.ui.select('Profile (applies on the next install or update, and update/repair skip what it excludes; choose standard to reset, Uninstall removes it):', Object.keys(PROFILES).map((p) => ({ value: p, label: p })), profileOf(st));
        if (knownProfile(next)) { st.profile = next; st.noHooks = false; writeSettings(o.home, st); }
    } else if (choice.startsWith('secret:')) {
        await secrets.reask(choice.slice(7), { home: o.home, ask: askOf(o) });
        if (secrets.refusal(o.home)) { o.write(`${secrets.refusal(o.home)}\n`); return 1; }
    } else if (choice.startsWith('pkg:')) {
        const r = rows.find((x) => `pkg:${x.p.id}` === choice);
        if (!r.installed) {
            const ctx = { ...b, manual: true };
            if (r.p.claudeMod && r.enabled === false && o.ui.confirm && await o.ui.confirm(`${r.p.claudeMod.split('@')[0]} is opted out (enabledPlugins false). Enable it anyway?`)) ctx.clearOptOut = true;
            if (r.p.id === 'openwiki') { // the question comes BEFORE the step: a step never prompts
                const name = openwikiKeyName(host);
                if (name) {
                    const env = host.loadExistingEnv(host.resolveTargetPaths('1', null).targetMcpDir);
                    ctx.openwikiKey = (await secrets.need([name], { home: o.home, ask: askOf(o), legacy: env }))[name];
                    if (!ctx.openwikiKey) { o.write(`✖ ${r.p.name} — skipped: no key${secrets.refusal(o.home) ? ` (${secrets.refusal(o.home)})` : ` (use "Re-enter ${name}" in Settings)`}\n`); return 1; }
                }
            }
            // log: package messages (gateway conflicts, preset, launchctl) end up in the step line, not lost in the log.
            const res = await step(r.p.name, async (run) => {
                const msgs = [];
                const d = await r.p.install({ ...ctx, run, log: (m) => msgs.push(m) });
                return [typeof d === 'string' ? d : '', ...msgs].filter(Boolean).join('; ');
            }, { logFile: o.logFile || logFileFor(o.home), out: o.write });
            if (!res.ok) return 1;
            st.disabled = st.disabled.filter((id) => id !== r.p.id);
        } else st.disabled = st.disabled.includes(r.p.id) ? st.disabled.filter((id) => id !== r.p.id) : [...st.disabled, r.p.id];
        writeSettings(o.home, st);
    }
    return 0;
}

async function menu(host, o) {
    const b = base(host, o);
    const rows = (await scan(b));
    const vs = await checkVersions(rows, host, o);
    const n = vs.filter((v) => v.outdated).length;
    const choice = await o.ui.select('Select an operation:', [
        { value: 'status', label: 'Status' },
        { value: 'update', label: n ? `Update (${n} available)` : 'Update' },
        { value: 'repair', label: 'Repair' },
        { value: 'settings', label: 'Settings' },
        { value: 'uninstall', label: 'Uninstall' },
        { value: 'exit', label: 'Exit' },
    ], n ? 'update' : 'status');
    if (choice === 'status') return status(host, o);
    if (choice === 'update') return update(host, { ...o, adopt: true });
    if (choice === 'repair') return repair(host, o);
    if (choice === 'settings') return settings(host, o);
    if (choice === 'uninstall') return host.runUninstaller();
    return 0;
}

// `aos status|update|repair`: exit code is the result, never a prompt, never the install wizard.
// `package` (WP4) is routed here by installer.js in WP5; its handler is
// packageCommand below and takes everything after the verb as a second call
// argument (the WP5 routing line passes the remaining argv tokens).
// MCP platform values mirror installer.js resolveTargetPaths():
// 1 Antigravity, 2 Claude, 3 Cursor, 5 Codex, 6 Windsurf, 7 Roo, 8 Aider.
const MCP_PLATFORM_VALUE = { claude: '2', agy: '1', antigravity: '1', codex: '5', cursor: '3', roo: '7', windsurf: '6', aider: '8' };
const MCP_TARGET_KEYS = Object.keys(MCP_PLATFORM_VALUE).join(', ');

// If the host cannot run the one-server MCP install yet, tell the user how to
// enable it instead of copying anything (no fallback write, ever).
const enableMcpInstructions = (name) => [
    `A one-server, non-interactive MCP install for '${name}' is not available in the v5 beta:`,
    'installer.js does not (yet) export installMcpsForTarget and has no per-server verb.',
    'show how to enable:',
    '  - run the full installer (npx @hybridlabor-api/aos), pick this harness under',
    `    "Target AI Platform(s)" and '${name}' under "Select MCP servers"; or`,
    `  - ask your coding agent: "show how to enable the ${name} MCP for this harness".`,
];

async function packageMcp(bt, host, o) {
    const mcpSecrets = require('../mcp-secrets.js');
    const name = bt[1] || '';
    if (!/^[A-Za-z0-9_-]+$/.test(name)) { o.write(`✖ invalid MCP name: ${name}\n`); return 3; }
    const ti = bt.indexOf('--target');
    let target = ti >= 0 ? String(bt[ti + 1] || '').trim() : '';
    if (!target) {
        const inline = bt.find((a) => a.startsWith('--target='));
        if (inline) target = inline.split('=').slice(1).join('=').trim();
    }
    if (!target) {
        o.write(`✖ missing --target <harness> (one of: ${MCP_TARGET_KEYS})\n`);
        return 3;
    }
    const srcRoot = path.resolve(__dirname, '..', '..');
    if (!Object.prototype.hasOwnProperty.call(mcpSecrets.shippedAll(srcRoot), name)) {
        o.write(`✖ '${name}' is not shipped in mcp_config.json/mcp_picks.json; nothing was installed.\n`);
        return 3;
    }
    if (typeof host.installMcpsForTarget !== 'function') {
        for (const line of enableMcpInstructions(name)) o.write(`${line}\n`);
        return 3;
    }
    const pv = MCP_PLATFORM_VALUE[target];
    if (!Object.hasOwn(MCP_PLATFORM_VALUE, target)) {
        // OpenCode (and any other harness without a resolveTargetPaths branch for
        // MCP configs) has no single-server install target today: nothing is
        // copied or merged — the handler only explains how to enable it by hand.
        o.write(`✖ no single-server MCP install target for harness '${target}'. To enable it by hand:\n`);
        o.write(`  add the '${name}' entry to that harness's MCP config (see mcp_config.json for the shape), and the\n`);
        o.write('  launcher sources action values from ~/.aos/secrets.env (0600). Or rerun the full installer with\n');
        o.write(`  '${target}' (or any OpenCode target) selected. Nothing was copied.\n`);
        return 3;
    }
    const paths = host.resolveTargetPaths(pv, null);
    const env = host.loadExistingEnv(paths.targetMcpDir);
    const provider = env.OPENWIKI_PROVIDER || 'google';
    const keyEnvName = host.PROVIDER_KEY_ENV_NAMES[provider] || 'OPENWIKI_API_KEY';
    const gemini = env[keyEnvName] || env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.OPENWIKI_API_KEY || '';
    if (!gemini && provider !== 'ollama') {
        o.write(`✖ no ${keyEnvName} stored for the provider '${provider}'. Store the key with \`aos\` -> Settings, or in ~/.aos/secrets.env (0600), then retry.\n`);
        return 3;
    }
    const creds = {
        gemini,
        github: env.GITHUB_PERSONAL_ACCESS_TOKEN || env.GITHUB_TOKEN || '',
        openwikiProvider: provider,
        openwikiModel: env.OPENWIKI_MODEL_ID || env.OPENWIKI_MODEL || '',
        openwikiBaseUrl: env.OPENWIKI_BASE_URL || '',
        keyEnvName,
    };
    o.write(`Installing '${name}' for ${target} (${paths.mcpConfigPath})...\n`);
    try {
        await host.installMcpsForTarget(paths, { selectedMcps: [name], mode: 'merge', platformValue: pv, creds });
        o.write(`✔ ${name}\n`);
        return 0;
    } catch (e) {
        o.write(`✖ ${name}: ${e.message}\n`);
        return 1;
    }
}

// `aos package <install|update|repair|verify> <id>` and
// `aos package mcp <name> --target <harness>` (WP4 store handler; the
// installer.js routing line is WP5's). Same adapter calls and ctx shape the
// menu builds (c.manual matters to adapter installs). Never prompts.
async function packageCommand(host, o, bt = []) {
    const tokens = (Array.isArray(bt) ? bt : []).filter((t) => typeof t === 'string');
    if (!host.detectInstallState().isInstalled) {
        o.write('AOS is not installed here. Run `aos` to install it.\n');
        return 1;
    }
    if (tokens[0] === 'mcp') return packageMcp(tokens, host, o);
    const [action, id] = tokens;
    if (!['install', 'update', 'repair', 'verify'].includes(action) || !/^[A-Za-z0-9_-]+$/.test(id || '')) {
        o.write(`Usage: aos package <install|update|repair|verify> <id>\n       aos package mcp <name> --target <harness>\n`);
        return 2;
    }
    const p = pk.registry.find((x) => x.id === id);
    if (!p) { o.write(`✖ unknown package id: ${id}\n`); return 2; }
    const b = base(host, o);
    if (action === 'verify') {
        const v = await verifyOf(p, { ...b, run: null });
        o.write(`${v.ok ? '✔' : '✖'} ${p.name}${v.ok ? '' : ` — ${v.detail}`}\n`);
        return v.ok ? 0 : 1;
    }
    const logFile = o.logFile || logFileFor(o.home);
    const res = await step(p.name, (run) => p[action]({ ...b, run, manual: true }), { logFile, out: o.write });
    const v = await verifyOf(p, { ...b, run: null });
    if (!v.ok) o.write(`✖ ${p.name} after ${action} — ${v.detail}\n`);
    return res.ok && v.ok ? 0 : 1;
}

async function runCommand(cmd, host, o) {
    if (!host.detectInstallState().isInstalled) {
        o.write('AOS is not installed here. Run `aos` to install it.\n');
        return 1;
    }
    return { status, update, repair }[cmd](host, o);
}

module.exports = { menu, runCommand, status, update, repair, settings, gatewaySettings, installDefaults, packageCommand, adoptGateway, formatServicesBlock, restartRunningServices, planUpdate, detectManifestDrift };
