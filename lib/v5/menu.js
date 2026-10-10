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

const PAT = 'GITHUB_PERSONAL_ACCESS_TOKEN';
const { readSettings, writeSettings, PROFILES, knownProfile, profileOf, excludedIds } = require('./profile');

const base = (host, o) => ({ host, home: o.home, state: host.detectInstallState(), venv: o.venv });
const scan = (b) => Promise.all(pk.registry.map(async (p) => {
    let d;
    try { d = (await p.detect(b)) || {}; } catch (e) { return { p, installed: null, version: null, error: e.message }; }
    return { p, installed: Boolean(d.installed), version: d.version || null, enabled: d.enabled };
}));
const checkVersions = (rows, host, o) => versions.checkAll(
    rows.filter((r) => r.installed && r.p.npm && r.version).map((r) => ({ id: r.p.id, npm: r.p.npm, local: r.version })),
    { home: o.home, now: o.now, npmView: o.npmView, isNewer: host.isNewerVersion },
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
        o.write(`${res.ok ? '✔' : '✖'} ${r.p.name.padEnd(20)} ${ver}${res.ok ? '' : ` — ${res.detail}`}\n`);
    }
    const n = vs.filter((v) => v.outdated).length;
    o.write(`${n} update${n === 1 ? '' : 's'} available${broken ? `, ${broken} broken` : ''}\n`);
    const st = readSettings(o.home);
    o.write(`Profile: ${profileOf(st)}${st.noHooks ? ' (context hooks off)' : ''}. Fix: aos repair. Change: aos, Settings. Remove: aos, Uninstall.\n`);
    return broken ? 1 : 0;
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
    const tally = (name, res) => { (res.ok ? okNames : badNames).push(name); };
    o.write('Existing install detected: Update applies v5 hooks, gate profiles and mods\n');

    // Before the steps: their output is captured into the log, a question there would be invisible.
    const keys = secretKeys(host, rows, b);
    await secrets.need(keys, { home: o.home, ask: askOf(o), legacy: host.loadExistingEnv(host.resolveTargetPaths('1', null).targetMcpDir) });
    const refused = secrets.refusal(o.home);
    if (refused) o.write(`${refused}\n`);
    o.write(outdated.size ? `${outdated.size} update${outdated.size === 1 ? '' : 's'} available\n` : 'Everything is current\n');

    const kernel = pk.registry.find((p) => p.id === 'kernel');
    const k = await S('Kernel', async (c) => { await kernel.update(c); });
    if (!k.ok) broken++;
    tally('Kernel', k);
    const h = await S('Harnesses', async (c) => {
        pk.mustList(host.quickUpdateHarnesses(), 'Harnesses');
        // Extras below only warn: they never turn the step into ✖ nor hide a harness failure above.
        const warns = [];
        try { if (rows.some((r) => r.p.id === 'memb' && r.installed)) await pk.syncMembMcp(c); } catch (e) { warns.push(`memB MCP sync: ${e.message}`); }
        // Plan 7a: the fleet mod is enabled here unless opted out (AOS_NO_FLEET=1 or enabledPlugins false) or disabled in Settings;
        // pkg-fleet itself skips without Claude Code >= its minimum version.
        const fleet = pk.registry.find((p) => p.id === 'fleet');
        if (fleet && !disabled.has('fleet') && !rows.some((r) => r.p.id === 'fleet' && r.installed)) {
            try { await fleet.install(c); } catch (e) { warns.push(/comments/.test(e.message) ? 'fleet: settings.json has comments; enable bdb-aos-fleet by hand' : `fleet: ${e.message}`); }
        }
        return warns.length ? `(warning: ${warns.join('; ')})` : '';
    });
    if (!h.ok) broken++;
    tally('Harnesses', h);

    for (const r of rows) {
        const p = r.p;
        if (!r.installed || p.id === 'kernel' || p.todo || !p.update || disabled.has(p.id)) continue;
        const res = await S(p.name, async (c) => {
            const remote = (vs.find((x) => x.id === p.id) || {}).remote;
            const cu = { ...c, target: remote === 'unknown' ? null : remote };
            if (outdated.has(p.id)) await p.update(cu);
            let v = await verifyOf(p, c);
            const fix = p.repair || (!outdated.has(p.id) && p.update); // no repair: one retry via update(), unless it just ran
            if (!v.ok && fix) { await fix(cu); v = await verifyOf(p, c); }
            if (!v.ok) throw new Error(v.detail);
            return ((await p.detect(c)) || {}).version || v.detail;
        });
        if (!res.ok) broken++;
        tally(p.name, res);
    }

    const missing = rows.filter((r) => r.installed === false && r.p.id !== 'kernel').map((r) => r.p.id);
    if (missing.length) o.write(`Optional, not installed: ${missing.join(', ')} (install via Settings)\n`);
    // This run refreshed from the OLD package, so it must neither claim success nor record the old version as current.
    const stale = vs.find((v) => v.id === 'kernel' && v.outdated);
    if (stale) o.write(`AOS ${stale.remote} available: run \`npx @hybridlabor-api/aos@latest\`\n`);
    else {
        if (okNames.length) o.write(`Verified OK: ${okNames.join(', ')}\n`);
        if (broken) o.write(`Broken: ${badNames.join(', ')}. Next: aos repair (details in ${logFile})\n`);
        o.write(broken ? `Verify: ${broken} step${broken === 1 ? '' : 's'} broken, log ${logFile}\n` : 'Verify: all ok\n');
    }
    if (k.ok && !stale) {
        host.saveManifest({ tier: '1', isUniversal: true, installedModules: b.state.installedModules });
        host.flushSessionManifest();
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

async function settings(host, o) {
    const b = base(host, o);
    const rows = (await scan(b)).filter((r) => r.p.id !== 'kernel' && !r.p.todo);
    const st = readSettings(o.home);
    const keys = secretKeys(host, rows, b);
    const options = [
        ...keys.map((k) => ({ value: `secret:${k}`, label: `Re-enter ${k}${secrets.isSkipped(o.home, k) ? ' (skipped)' : ''}` })),
        ...rows.map((r) => ({ value: `pkg:${r.p.id}`, label: `${!r.installed ? 'Install' : st.disabled.includes(r.p.id) ? 'Enable' : 'Disable'} ${r.p.name}` })),
        { value: 'profile', label: `Profile (now: ${profileOf(st)})` },
        { value: 'back', label: 'Back' },
    ];
    const choice = await o.ui.select('Settings:', options, 'back');
    if (choice === 'profile') {
        const next = await o.ui.select('Profile (applies on the next install or update, and update/repair skip what it excludes; choose standard to reset, Uninstall removes it):', Object.keys(PROFILES).map((p) => ({ value: p, label: p })), profileOf(st));
        if (knownProfile(next)) { st.profile = next; st.noHooks = false; writeSettings(o.home, st); }
    } else if (choice.startsWith('secret:')) {
        await secrets.reask(choice.slice(7), { home: o.home, ask: askOf(o) });
        if (secrets.refusal(o.home)) { o.write(`${secrets.refusal(o.home)}\n`); return 1; }
    } else if (choice.startsWith('pkg:')) {
        const r = rows.find((x) => `pkg:${x.p.id}` === choice);
        if (!r.installed) {
            const ctx = { ...b, manual: true };
            if (r.p.id === 'fleet' && r.enabled === false && o.ui.confirm && await o.ui.confirm('bdb-aos-fleet is opted out (enabledPlugins false). Enable it anyway?')) ctx.clearOptOut = true;
            if (r.p.id === 'openwiki') { // the question comes BEFORE the step: a step never prompts
                const name = openwikiKeyName(host);
                if (name) {
                    const env = host.loadExistingEnv(host.resolveTargetPaths('1', null).targetMcpDir);
                    ctx.openwikiKey = (await secrets.need([name], { home: o.home, ask: askOf(o), legacy: env }))[name];
                    if (!ctx.openwikiKey) { o.write(`✖ ${r.p.name} — skipped: no key${secrets.refusal(o.home) ? ` (${secrets.refusal(o.home)})` : ` (use "Re-enter ${name}" in Settings)`}\n`); return 1; }
                }
            }
            const res = await step(r.p.name, (run) => r.p.install({ ...ctx, run }), { logFile: o.logFile || logFileFor(o.home), out: o.write });
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
    if (choice === 'update') return update(host, o);
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

module.exports = { menu, runCommand, status, update, repair, settings, packageCommand };
