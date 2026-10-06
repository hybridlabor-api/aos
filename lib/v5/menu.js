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

try { require('./pkg-fleet'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND' || !/pkg-fleet/.test(e.message)) throw e; }

const PAT = 'GITHUB_PERSONAL_ACCESS_TOKEN';
const settingsFile = (home) => path.join(home, '.aos', 'v5-settings.json');
const readSettings = (home) => { try { return { disabled: [], ...JSON.parse(fs.readFileSync(settingsFile(home), 'utf8')) }; } catch { return { disabled: [] }; } };
function writeSettings(home, s) {
    fs.mkdirSync(path.dirname(settingsFile(home)), { recursive: true, mode: 0o700 });
    fs.writeFileSync(settingsFile(home), JSON.stringify(s, null, 2));
}

const base = (host, o) => ({ host, home: o.home, state: host.detectInstallState(), venv: o.venv });
const scan = (b) => pk.registry.map((p) => {
    let d;
    try { d = p.detect(b); } catch { d = { installed: false, version: null }; }
    return { p, installed: Boolean(d.installed), version: d.version || null };
});
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
    const rows = scan(b).filter((r) => r.installed);
    const vs = await checkVersions(rows, host, o);
    let broken = 0;
    for (const r of rows) {
        const v = vs.find((x) => x.id === r.p.id);
        const ver = !v ? (r.version ? `${r.version}${r.p.npm ? '' : ' (no update check)'}` : 'version unknown') : v.outdated ? `${v.local} -> ${v.remote}` : `${v.local}${v.remote === 'unknown' ? ' (latest unknown)' : ''}`;
        const res = await verifyOf(r.p, { ...b, run: null });
        if (!res.ok) broken++;
        o.write(`${res.ok ? '✔' : '✖'} ${r.p.name.padEnd(20)} ${ver}${res.ok ? '' : ` — ${res.detail}`}\n`);
    }
    const n = vs.filter((v) => v.outdated).length;
    o.write(`${n} update${n === 1 ? '' : 's'} available${broken ? `, ${broken} broken` : ''}\n`);
    return broken ? 1 : 0;
}

async function update(host, o) {
    const b = base(host, o);
    const rows = scan(b);
    const vs = await checkVersions(rows, host, o);
    const outdated = new Set(vs.filter((v) => v.outdated).map((v) => v.id));
    const logFile = o.logFile || logFileFor(o.home);
    const S = (label, fn) => step(label, (run) => fn({ ...b, run }, run), { logFile, out: o.write });
    const disabled = readSettings(o.home).disabled;
    let broken = 0;

    // Before the steps: their output is captured into the log, a question there would be invisible.
    const keys = secretKeys(host, rows, b);
    await secrets.need(keys, { home: o.home, ask: askOf(o), legacy: host.loadExistingEnv(host.resolveTargetPaths('1', null).targetMcpDir) });
    const refused = secrets.refusal(o.home);
    if (refused) o.write(`${refused}\n`);
    o.write(outdated.size ? `${outdated.size} update${outdated.size === 1 ? '' : 's'} available\n` : 'Everything is current\n');

    const kernel = pk.registry.find((p) => p.id === 'kernel');
    const k = await S('Kernel', async (c) => { await kernel.update(c); });
    if (!k.ok) broken++;
    const h = await S('Harnesses', async (c) => {
        const failed = host.quickUpdateHarnesses();
        if (rows.some((r) => r.p.id === 'memb' && r.installed)) await pk.syncMembMcp(c);
        pk.mustList(failed, 'Harnesses');
    });
    if (!h.ok) broken++;

    for (const r of rows) {
        const p = r.p;
        if (!r.installed || p.id === 'kernel' || p.todo || !p.update || disabled.includes(p.id)) continue;
        const res = await S(p.name, async (c) => {
            if (outdated.has(p.id)) await p.update(c);
            let v = await verifyOf(p, c);
            const fix = p.repair || (!outdated.has(p.id) && p.update); // no repair: one retry via update(), unless it just ran
            if (!v.ok && fix) { await fix(c); v = await verifyOf(p, c); }
            if (!v.ok) throw new Error(v.detail);
            return (p.detect(c).version) || v.detail;
        });
        if (!res.ok) broken++;
    }

    const missing = rows.filter((r) => !r.installed && r.p.id !== 'kernel').map((r) => r.p.id);
    if (missing.length) o.write(`Optional, not installed: ${missing.join(', ')} (install via Settings)\n`);
    // This run refreshed from the OLD package, so it must neither claim success nor record the old version as current.
    const stale = vs.find((v) => v.id === 'kernel' && v.outdated);
    if (stale) o.write(`AOS ${stale.remote} available: run \`npx @hybridlabor-api/aos@latest\`\n`);
    else o.write(broken ? `Verify: ${broken} step${broken === 1 ? '' : 's'} broken, log ${logFile}\n` : 'Verify: all ok\n');
    if (k.ok && !stale) {
        host.saveManifest({ tier: '1', isUniversal: true, installedModules: b.state.installedModules });
        host.flushSessionManifest();
    }
    return broken || stale ? 1 : 0;
}

async function repair(host, o) {
    const b = base(host, o);
    const logFile = o.logFile || logFileFor(o.home);
    let broken = 0;
    for (const r of scan(b)) {
        const p = r.p;
        if (!r.installed || p.todo || !p.verify) continue;
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
    const rows = scan(b).filter((r) => r.p.id !== 'kernel' && !r.p.todo);
    const st = readSettings(o.home);
    const keys = secretKeys(host, scan(b), b);
    const options = [
        ...keys.map((k) => ({ value: `secret:${k}`, label: `Re-enter ${k}${secrets.isSkipped(o.home, k) ? ' (skipped)' : ''}` })),
        ...rows.map((r) => ({ value: `pkg:${r.p.id}`, label: `${!r.installed ? 'Install' : st.disabled.includes(r.p.id) ? 'Enable' : 'Disable'} ${r.p.name}` })),
        { value: 'back', label: 'Back' },
    ];
    const choice = await o.ui.select('Settings:', options, 'back');
    if (choice.startsWith('secret:')) {
        await secrets.reask(choice.slice(7), { home: o.home, ask: askOf(o) });
        if (secrets.refusal(o.home)) { o.write(`${secrets.refusal(o.home)}\n`); return 1; }
    } else if (choice.startsWith('pkg:')) {
        const r = rows.find((x) => `pkg:${x.p.id}` === choice);
        if (!r.installed) {
            const ctx = { ...b };
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
    const rows = scan(b);
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
async function runCommand(cmd, host, o) {
    if (!host.detectInstallState().isInstalled) {
        o.write('AOS is not installed here. Run `aos` to install it.\n');
        return 1;
    }
    return { status, update, repair }[cmd](host, o);
}

module.exports = { menu, runCommand, status, update, repair, settings };
