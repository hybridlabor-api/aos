'use strict';
// v5 package contract for the local MCP gateway. ctx = { home, run, dryRun, platform, log, nodePath, aosRoot, env?, uvPath? }.
// Every process goes through ctx.run(cmd, args, opts); nothing here reads HOME or other environment variables
// (ctx.env is the caller's environment, only a fixed allow-list of keys is passed on to the upstreams).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { randomBytes } = require('crypto');
const { gatewayDir, defaultMcpsDir, GATEWAY_PORT, defaultPathEnv, presetFor, buildUpstreams, writeGatewayConfig, readAdopted } = require('../gateway/config');
const { shippedServers, shippedPicks, launcherPath, harnessMcpFiles, shippedMcpTemplatePath, migrateLegacyAgyWorkspaceMcp } = require('../mcp-secrets');
const harness = require('../gateway/harness');
const { gatewayFiles, dupeLabel, directGatewayNames } = require('../gateway/doctor');
const { resolveGatewayServers, validStoredServers } = require('../gateway/selection');
const profile = require('./profile');
const { contextProfileOf } = require('./context-profiles');
const win = require('./win-startup');
const { GATEWAY_1MCP_PIN } = require('./pins');

// Unified memory off (memb excluded in the saved settings): memb_mcp and deja are not shared either.
const withoutMemory = (servers, home) => (profile.excludedIds(profile.readSettings(home, () => {})).has('memb')
    ? profile.filterMcpServers(servers, profile.MEMORY_MCPS).servers : servers);

// The current shipped gateway upstreams from the live mcp.json (adopted names and fallback direct copies excluded).
const currentShippedUpstreams = (dir) => {
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8'));
        const picked = Object.entries(cfg.mcpServers || {})
            .filter(([n, e]) => e && typeof e === 'object' && Array.isArray(e.tags) && e.tags.includes(n))
            .map(([n]) => n);
        return picked.filter((n) => validStoredServers([n]) ? true : false);
    } catch { return []; }
};

// Resolve (and persist when it was absent) which shipped servers the gateway runs.
// keep = current upstreams + still-direct names in harness configs + adopted: nothing the user uses is dropped.
// Returns null when the gateway should run no shipped servers at all (callers skip the selection).
function resolveAndSaveSelection(ctx, say) {
    const st = profile.readSettings(ctx.home, () => {});
    const dir = gatewayDir(ctx.home);
    const current = currentShippedUpstreams(dir);
    let adopted = [];
    try { adopted = Object.keys(readAdopted(ctx.home)); } catch { /* no adopted.json yet */ }
    let seen = [];
    try { seen = directGatewayNames({ files: harnessFiles(ctx), shipped: withoutMemory(shippedServers(ctx.aosRoot), ctx.home) }); } catch { /* scan failure never blocks */ }
    const r = resolveGatewayServers({
        settingServers: st.gateway && st.gateway.servers,
        creator: !(st.disabled && st.disabled.includes('creator')),
        keep: [...current, ...seen, ...adopted],
    });
    if (!(st.gateway && validStoredServers(st.gateway.servers)) || JSON.stringify(st.gateway.servers) !== JSON.stringify(r.servers)) {
        try {
            const next = { ...profile.readSettings(ctx.home, () => {}) };
            next.gateway = { ...(next.gateway || {}), servers: r.servers };
            profile.writeSettings(ctx.home, next);
            say(`gateway servers selection: ${r.servers.length ? r.servers.join(', ') : 'none'}${r.fromSetting ? '' : ' (derived, saved to ~/.aos/v5-settings.json)'}`);
        } catch (e) { say(`could not save the gateway server selection: ${e.message}`); }
    }
    return r.servers;
}

// cwd = home: the project-level .cursor/mcp.json of whatever directory the installer runs in is never touched.
const harnessFiles = (ctx) => harnessMcpFiles(ctx.home, ctx.env && typeof ctx.env === 'object' ? ctx.env : {}, ctx.platform, ctx.home);
const harnessOn = (ctx) => {
    if (ctx.harnesses === false) return false;
    const st = profile.readSettings(ctx.home, () => {});
    if (st && st.gateway && st.gateway.mode === 'direct') return false;
    return true;
};
const describeReport = (report) => report.filter((r) => r.changed || r.skipped || r.conflict || r.error).map((r) => `harness ${r.file} [${r.kind}]: ${r.error ? `ERROR ${r.error}` : r.skipped ? `skipped (${r.skipped})` : r.conflict ? r.conflict : [...(r.removed || []), ...(r.restored || [])].join(',') + (r.added || r.updated ? ' +aos' : '') + (r.removedAos ? ' -aos' : '')}`);

const PIN = GATEWAY_1MCP_PIN;
const LABEL = 'com.bdb.aos.gateway';
const UNIT = `${LABEL}.service`;
const WIN_TASK = 'AOS MCP Gateway';
const NO_SERVICE = 'no service is registered on this platform yet; start it with "aos-gateway serve"';
const PRESETS_OK = 'aos-presets-ok.json';
// 1mcp took up to ~114 s after a kickstart while the old upstream tree still held its ports (F15b).
const RESTART_GRACE_MS = 180000;
const RESTART_AT = 'restart.at';
const nowOf = (ctx) => (typeof ctx.now === 'number' ? ctx.now : Date.now());

const plistPath = (home) => path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
const unitPath = (home) => path.join(home, '.config', 'systemd', 'user', UNIT);
const oneMcpBin = (dir, platform) => path.join(dir, 'node_modules', '.bin', platform === 'win32' ? '1mcp.cmd' : '1mcp');
const cliPath = (aosRoot) => path.join(aosRoot, 'bin', 'aos-gateway.mjs');
const uidOf = (ctx) => (ctx.uid !== undefined ? ctx.uid : process.getuid());
const sayOf = (ctx) => (typeof ctx.log === 'function' ? ctx.log : ctx.log && ctx.log.step ? (m) => ctx.log.step(m) : () => {});
// Template "presets" (kind -> "all" | excluded names).
const shippedPresets = (aosRoot) => {
    try {
        const file = shippedMcpTemplatePath(aosRoot);
        return JSON.parse(fs.readFileSync(file, 'utf8')).presets || {};
    } catch {
        return {};
    }
};
// Upserts one 1mcp preset per kind with an exclusion list ("all" kinds get none); returns the kinds created.
const presetPlan = (presets) => Object.keys(presets).map((k) => [k, presetFor(k, presets)]).filter(([, expr]) => expr);
const plannedPresets = (presets) => Object.fromEntries(presetPlan(presets).map(([k]) => [k, presets[k]]));
async function createPresets(ctx, dir, presets) {
    const made = [];
    for (const [name, expr] of presetPlan(presets)) {
        try { if (!failed(await ctx.run(oneMcpBin(dir, ctx.platform), ['preset', 'create', name, '--filter', expr, '--config-dir', dir]))) made.push(name); } catch { /* not created: that kind gets the plain URL */ }
    }
    return made;
}
// Only the kinds whose preset was created; the rest are switched to the plain URL.
function livePresets(dir, presets) {
    let made = [];
    try { made = JSON.parse(fs.readFileSync(path.join(dir, PRESETS_OK), 'utf8')); } catch { /* none created */ }
    return Object.fromEntries(Object.entries(presets).filter(([k]) => made.includes(k)));
}
const failed = (r) => !!r && typeof r === 'object' && (r.ok === false || r.status > 0 || r.code > 0 || !!r.error);

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function buildPlist({ nodePath, aosRoot, dir, home, pathEnv }) {
    const str = (s) => `<string>${xml(s)}</string>`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    ${str(LABEL)}
    <key>ProgramArguments</key>
    <array>
        ${str(nodePath)}
        ${str(cliPath(aosRoot))}
        ${str('serve')}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <key>StandardOutPath</key>
    ${str(path.join(dir, 'gateway.log'))}
    <key>StandardErrorPath</key>
    ${str(path.join(dir, 'gateway.log'))}
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        ${str(home)}
        <key>PATH</key>
        ${str(pathEnv)}
    </dict>
</dict>
</plist>
`;
}

// Systemd quoting: ExecStart arguments in double quotes, backslash and quote escaped.
function buildUnit({ nodePath, aosRoot, dir, pathEnv }) {
    const q = (s) => `"${String(s).replace(/["\\]/g, '\\$&')}"`;
    return `[Unit]
Description=AOS MCP gateway

[Service]
ExecStart=${q(nodePath)} ${q(cliPath(aosRoot))} serve
Environment=${q(`PATH=${pathEnv}`)}
Restart=on-failure
StandardOutput=append:${dir}/gateway.log
StandardError=append:${dir}/gateway.log

[Install]
WantedBy=default.target
`;
}

// Null on success, otherwise the failure line for the user.
async function svc(ctx, bin, args) {
    if (ctx && ctx.serviceRunner) {
        try {
            const runner = typeof ctx.serviceRunner === 'function' ? ctx.serviceRunner : ctx.run;
            const r = await runner(bin, args);
            if (!failed(r)) return null;
            return `${bin} failed: ${String(r.stderr || (r.error && r.error.message) || r.error || '').trim().split('\n')[0] || 'no output'}`;
        } catch (e) { return `${bin} failed: ${e.message}`; }
    }
    if (profile.isTestSandbox(ctx && ctx.home)) return null;
    try {
        const r = await ctx.run(bin, args);
        if (!failed(r)) return null;
        return `${bin} failed: ${String(r.stderr || (r.error && r.error.message) || r.error || '').trim().split('\n')[0] || 'no output'}`;
    } catch (e) { return `${bin} failed: ${e.message}`; }
}
const systemctl = (ctx, args) => svc(ctx, 'systemctl', ['--user', ...args]);
const schtasks = (ctx, args) => svc(ctx, 'schtasks', args);

// ctx.run may reject or return a failing status; both count as "did not work", never as an exception.
async function launchctl(ctx, args) {
    if (ctx && ctx.serviceRunner) {
        try {
            const runner = typeof ctx.serviceRunner === 'function' ? ctx.serviceRunner : ctx.run;
            return !failed(await runner('launchctl', args));
        } catch { return false; }
    }
    if (profile.isTestSandbox(ctx && ctx.home)) return true;
    try { return !failed(await ctx.run('launchctl', args)); } catch { return false; }
}

const PASS_ENV = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'LANG', 'LC_ALL', 'TMPDIR'];
const PASS_ENV_WIN = ['SystemRoot', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT'];
function passEnvOf(ctx) {
    const src = ctx.env && typeof ctx.env === 'object' ? ctx.env : {};
    const keys = ctx.platform === 'win32' ? [...PASS_ENV, ...PASS_ENV_WIN] : PASS_ENV;
    return Object.fromEntries(keys.filter((k) => typeof src[k] === 'string' && src[k] !== '').map((k) => [k, src[k]]));
}

const TOKEN_RE = /^[0-9a-f]{64}$/;
function ensureToken(file, platform) {
    let cur = '';
    try { cur = fs.readFileSync(file, 'utf8').trim(); } catch { /* missing */ }
    if (!TOKEN_RE.test(cur)) {
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, randomBytes(32).toString('hex'), { mode: 0o600 });
        fs.renameSync(tmp, file);
    }
    if (platform !== 'win32') fs.chmodSync(file, 0o600);
}

function planActions(ctx, verb) {
    const dir = gatewayDir(ctx.home);
    const a = [`mkdir ${dir} (0700)`, `npm install --prefix ${dir} ${PIN}`, `create ${path.join(dir, 'token')} if absent or invalid (0600)`, `write ${path.join(dir, 'mcp.json')}`];
    if (ctx.platform === 'darwin') a.push(`write ${plistPath(ctx.home)}`, verb === 'update' ? `launchctl kickstart -k gui/<uid>/${LABEL} (fallback: bootout + bootstrap)` : `launchctl bootout gui/<uid>/${LABEL} (ignored if not loaded)`, ...(verb === 'update' ? [] : [`launchctl bootstrap gui/<uid> ${plistPath(ctx.home)}`]));
    if (ctx.platform === 'linux') a.push(`write ${unitPath(ctx.home)}`, 'systemctl --user daemon-reload', `systemctl --user enable --now ${UNIT}`);
    else if (ctx.platform === 'win32') a.push(`schtasks /Delete /TN "${WIN_TASK}" /F (legacy task, ignored if absent)`, 'stop the running gateway (powershell Stop-Process by script path)', `write ${win.vbsPath(ctx, LABEL)}`, `wscript.exe ${win.vbsPath(ctx, LABEL)}`);
    if (harnessOn(ctx)) a.push(...describeReport(harness.enable({ home: ctx.home, token: '', shipped: shippedServers(ctx.aosRoot), presets: plannedPresets(shippedPresets(ctx.aosRoot)), files: harnessFiles(ctx), contextProfile: contextProfileOf(profile.readSettings(ctx.home, () => {})), dryRun: true })));
    return a;
}

const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const pinName = PIN.slice(0, PIN.lastIndexOf('@'));
const pinVersion = PIN.slice(PIN.lastIndexOf('@') + 1);
const pinnedOnDisk = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', pinName, 'package.json'), 'utf8')).version === pinVersion; } catch { return false; } };

// True when every file apply() would write, and the pinned 1mcp, already match disk: the install, rewrite and restart are then skipped.
function upToDate(ctx, { dir, upstreams, presets, pathEnv }) {
    const { home, platform, nodePath, aosRoot } = ctx;
    const svc = platform === 'darwin' ? [plistPath(home), buildPlist({ nodePath, aosRoot, dir, home, pathEnv })]
        : platform === 'linux' ? [unitPath(home), buildUnit({ nodePath, aosRoot, dir, pathEnv })]
            : platform === 'win32' ? [win.vbsPath(ctx, LABEL), win.buildVbs(home, [nodePath, cliPath(aosRoot), 'serve'])] : null;
    if (!svc) return false;
    return pinnedOnDisk(dir)
        && TOKEN_RE.test(String(readText(path.join(dir, 'token')) || '').trim())
        && readText(path.join(dir, 'mcp.json')) === JSON.stringify({ mcpServers: upstreams }, null, 2) + '\n'
        && readText(path.join(dir, PRESETS_OK)) === JSON.stringify(presetPlan(presets).map(([k]) => k))
        && readText(svc[0]) === svc[1];
}

async function syncHarnesses(ctx, dir, presets) {
    if (!harnessOn(ctx)) return undefined;
    const say = sayOf(ctx);
    // Without a registered service nothing listens on the port: harness configs are only switched where one runs.
    // The entries are config only, so the forwarder answering is enough; 1mcp may need minutes after a restart (F15b).
    if (!(await verify(ctx, { tries: 60, forwarderOnly: true })).ok) {
        say(`gateway installed, service not confirmed on ${ctx.platform}: harnesses left direct, run aos-gateway enable after aos-gateway status is green`);
        return undefined;
    }
    const report = harness.enable({ home: ctx.home, token: fs.readFileSync(path.join(dir, 'token'), 'utf8').trim(), shipped: shippedServers(ctx.aosRoot), presets: livePresets(dir, presets), files: harnessFiles(ctx), contextProfile: contextProfileOf(profile.readSettings(ctx.home, () => {})), now: ctx.now });
    describeReport(report).forEach((m) => say(m));
    return report;
}

async function restartService(ctx) {
    const { home, platform, nodePath, aosRoot } = ctx;
    const say = sayOf(ctx);
    const dir = gatewayDir(home);
    const pathEnv = defaultPathEnv({ home, nodePath, platform });
    let started = false;
    if (platform === 'darwin') {
        const plist = plistPath(home);
        if (!fs.existsSync(plist)) {
            fs.mkdirSync(path.dirname(plist), { recursive: true });
            fs.writeFileSync(plist, buildPlist({ nodePath, aosRoot, dir, home, pathEnv }), { mode: 0o644 });
        }
        const domain = `gui/${uidOf(ctx)}`;
        const target = `${domain}/${LABEL}`;
        const reload = async () => {
            await launchctl(ctx, ['bootout', target]);
            if (await launchctl(ctx, ['bootstrap', domain, plist])) return true;
            await (ctx.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))))(500);
            return launchctl(ctx, ['bootstrap', domain, plist]);
        };
        const ok = (await launchctl(ctx, ['kickstart', '-k', target])) || (await reload());
        started = !!ok;
        if (!ok) say('launchctl kickstart/bootstrap reported an error; run "aos-gateway status"');
    } else if (platform === 'linux') {
        const unit = unitPath(home);
        if (!fs.existsSync(unit)) {
            fs.mkdirSync(path.dirname(unit), { recursive: true });
            fs.writeFileSync(unit, buildUnit({ nodePath, aosRoot, dir, pathEnv }), { mode: 0o644 });
            await systemctl(ctx, ['daemon-reload']);
            await systemctl(ctx, ['enable', '--now', UNIT]);
        }
        const err = await systemctl(ctx, ['restart', UNIT]);
        started = !err;
        if (err) say(`${err}; start it with aos-gateway serve`);
    } else if (platform === 'win32') {
        await schtasks(ctx, ['/Delete', '/TN', WIN_TASK, '/F']);
        await svc(ctx, 'powershell', win.stopArgs([cliPath(aosRoot)]));
        const vbs = win.vbsPath(ctx, LABEL);
        if (!fs.existsSync(vbs)) {
            fs.mkdirSync(path.dirname(vbs), { recursive: true });
            fs.writeFileSync(vbs, win.buildVbs(home, [nodePath, cliPath(aosRoot), 'serve']));
        }
        const err = await svc(ctx, 'wscript.exe', [vbs]);
        started = !err;
        if (err) say(`${err}; start it with aos-gateway serve`);
    } else say(NO_SERVICE);
    if (started) fs.writeFileSync(path.join(dir, RESTART_AT), String(nowOf(ctx)));
    return { ok: started };
}

const restart = (ctx) => restartService(ctx);

async function apply(ctx, verb) {
    const { home, run, platform, nodePath, aosRoot } = ctx;
    const say = sayOf(ctx);
    const actions = planActions(ctx, verb);
    if (ctx.dryRun) return { ok: true, dryRun: true, actions };

    migrateLegacyAgyWorkspaceMcp(home, aosRoot, { log: say });

    const dir = gatewayDir(home);
    const pathEnv = defaultPathEnv({ home, nodePath, platform });
    const launcher = launcherPath(home);
    const picked = shippedPicks(aosRoot, { platform: ctx.platform, env: ctx.env });
    const selection = resolveAndSaveSelection(ctx, say);
    const upstreams = buildUpstreams({ shipped: withoutMemory(picked.servers, home), selected: selection, home, launcher, pathEnv, passEnv: passEnvOf(ctx), ...(ctx.uvPath ? { uvPath: ctx.uvPath } : {}) });
    const presets = shippedPresets(aosRoot);
    if (upToDate(ctx, { dir, upstreams, presets, pathEnv })) {
        const v = await verify(ctx, { tries: 1, forwarderOnly: true });
        if (v.ok) {
            say('gateway unchanged: pinned 1mcp, config and service definition match; not reinstalled or restarted');
            const harnessReport = await syncHarnesses(ctx, dir, presets);
            return { ok: true, unchanged: true, actions, ...(harnessReport ? { harness: harnessReport } : {}) };
        }
        await restartService(ctx);
        const harnessReport = await syncHarnesses(ctx, dir, presets);
        return { ok: true, actions, ...(harnessReport ? { harness: harnessReport } : {}) };
    }

    // 1mcp refuses a config dir owned by another user or readable by others.
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (platform !== 'win32') fs.chmodSync(dir, 0o700);

    const npm = await run('npm', ['install', '--prefix', dir, '--no-audit', '--no-fund', PIN]);
    if (failed(npm)) throw new Error(`npm install ${PIN} failed`);

    ensureToken(path.join(dir, 'token'), platform);

    writeGatewayConfig(dir, upstreams);
    const made = await createPresets(ctx, dir, presets);
    fs.writeFileSync(path.join(dir, PRESETS_OK), JSON.stringify(made));
    const fellBack = Object.keys(presets).filter((k) => presetFor(k, presets) && !made.includes(k));
    if (fellBack.length) say(`gateway presets not created: ${fellBack.join(', ')}; these kinds fall back to the plain URL (all upstreams, no exclusions)`);

    if (!fs.existsSync(launcher)) say(`secret launcher missing: ${launcher}; gateway servers that need secrets will fail until it is installed`);
    const mcpsPrefix = defaultMcpsDir(home) + path.sep;
    for (const [name, u] of Object.entries(upstreams)) {
        const missing = u.args.filter((a) => typeof a === 'string' && a.startsWith(mcpsPrefix) && !fs.existsSync(a));
        for (const m of missing) say(`gateway server ${name}: ${m} does not exist; it will fail to start`);
    }

    let started = false;
    if (verb === 'install') {
        if (platform === 'darwin') {
            const plist = plistPath(home);
            fs.mkdirSync(path.dirname(plist), { recursive: true });
            fs.writeFileSync(plist, buildPlist({ nodePath, aosRoot, dir, home, pathEnv }), { mode: 0o644 });
            const domain = `gui/${uidOf(ctx)}`;
            const target = `${domain}/${LABEL}`;
            const reload = async () => {
                await launchctl(ctx, ['bootout', target]);
                if (await launchctl(ctx, ['bootstrap', domain, plist])) return true;
                await (ctx.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))))(500);
                return launchctl(ctx, ['bootstrap', domain, plist]);
            };
            const ok = await reload();
            started = !!ok;
            if (!ok) say('launchctl bootstrap reported an error; run "aos-gateway status"');
        } else if (platform === 'linux') {
            const unit = unitPath(home);
            fs.mkdirSync(path.dirname(unit), { recursive: true });
            fs.writeFileSync(unit, buildUnit({ nodePath, aosRoot, dir, pathEnv }), { mode: 0o644 });
            const err = (await systemctl(ctx, ['daemon-reload'])) || (await systemctl(ctx, ['enable', '--now', UNIT]));
            started = !err;
            if (err) say(`${err}; start it with aos-gateway serve`);
        } else if (platform === 'win32') {
            await schtasks(ctx, ['/Delete', '/TN', WIN_TASK, '/F']);
            await svc(ctx, 'powershell', win.stopArgs([cliPath(aosRoot)]));
            const vbs = win.vbsPath(ctx, LABEL);
            fs.mkdirSync(path.dirname(vbs), { recursive: true });
            fs.writeFileSync(vbs, win.buildVbs(home, [nodePath, cliPath(aosRoot), 'serve']));
            const err = await svc(ctx, 'wscript.exe', [vbs]);
            started = !err;
            if (err) say(`${err}; start it with aos-gateway serve`);
        } else say(NO_SERVICE);
        if (started) fs.writeFileSync(path.join(dir, RESTART_AT), String(nowOf(ctx)));
    } else {
        const r = await restartService(ctx);
        started = r.ok;
    }

    const harnessReport = await syncHarnesses(ctx, dir, presets);
    return { ok: true, actions, ...(harnessReport ? { harness: harnessReport } : {}) };
}

function detect(ctx) {
    const svc = ctx.platform === 'darwin' ? plistPath(ctx.home) : ctx.platform === 'linux' ? unitPath(ctx.home) : ctx.platform === 'win32' ? win.vbsPath(ctx, LABEL) : null;
    return !!svc && fs.existsSync(oneMcpBin(gatewayDir(ctx.home), ctx.platform)) && fs.existsSync(svc);
}

const install = (ctx) => apply(ctx, 'install');
// Reinstalls the pinned 1mcp and regenerates mcp.json; the token and the user's gateway.json stay.
const update = (ctx) => apply(ctx, 'update');

// launchd needs a moment after bootstrap/kickstart: retry for ~5 s by default (ctx.sleep is injectable for tests).
// v5's run() sends stdout to the update log, so status is read in-process instead of parsed from a subprocess.
const defaultStatusFn = (ctx) => async () => {
    const { pathToFileURL } = require('url');
    const mod = await import(pathToFileURL(cliPath(ctx.aosRoot)).href);
    const opts = { dir: gatewayDir(ctx.home) };
    if (ctx.statusPorts) Object.assign(opts, ctx.statusPorts);
    return mod.gatewayStatus(opts);
};

const inRestartGrace = (ctx) => {
    try {
        const age = nowOf(ctx) - Number(fs.readFileSync(path.join(gatewayDir(ctx.home), RESTART_AT), 'utf8'));
        return age >= 0 && age < RESTART_GRACE_MS; // a future stamp (clock skew, bad file) must not mean busy forever
    } catch { return false; }
};

async function verify(ctx, { tries = 10, forwarderOnly = false } = {}) {
    const sleep = ctx.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const statusFn = ctx.statusFn || defaultStatusFn(ctx);
    const grace = inRestartGrace(ctx);
    let last;
    for (let i = 0; i < tries; i++) {
        try {
            const s = await statusFn();
            // The forwarder answering is not enough: with 1mcp (upstream port) down every tool call fails (F14).
            // A busy 1mcp (catalog refresh) is not down.
            const down = (s.upstreams || []).find((u) => !u.ok && !u.busy);
            const fw = s.running === true && s.port === GATEWAY_PORT;
            // Shortly after a restart a refused 1mcp is still starting, not down.
            const busy = fw && !!down && grace;
            const ok = fw && (!down || forwarderOnly || busy);
            let notRunningDetail = 'gateway not running';
            if (!fw && (ctx.platform === 'darwin' || ctx.launchctl) && fs.existsSync(plistPath(ctx.home))) {
                let isLoaded = false;
                if (typeof ctx.launchctl === 'function') {
                    const r = ctx.launchctl(['list', LABEL]) || ctx.launchctl();
                    isLoaded = r && r.status === 0;
                } else if (!profile.isTestSandbox(ctx.home) || ctx.serviceRunner) {
                    const r = spawnSync('launchctl', ['list', LABEL], { encoding: 'utf8', stdio: 'pipe', timeout: 5000 });
                    isLoaded = r && r.status === 0;
                }
                if (!isLoaded) {
                    notRunningDetail = 'service not loaded';
                }
            }
            last = { ok, status: s, ...(busy ? { busy } : {}), detail: !fw ? notRunningDetail : !down ? 'running' : busy ? 'BUSY: 1mcp still starting after a restart; check aos-gateway status in a minute' : forwarderOnly ? 'forwarder running' : down.error };
        } catch (e) {
            last = { ok: false, error: `status check failed: ${e.message}`, detail: `status check failed: ${e.message}` };
        }
        if (last.ok) break;
        if (i < tries - 1) await sleep(500);
    }
    if (!last.ok || forwarderOnly) return last;
    // A running gateway next to AOS-owned direct copies of its servers spawns every upstream once per session.
    let dupes = [];
    try {
        dupes = gatewayFiles({ files: harnessFiles(ctx), shipped: shippedServers(ctx.aosRoot) }).flatMap((r) => r.dupes.map((d) => `${dupeLabel(d)} in ${r.file}`));
    } catch { /* a scan failure never fails verify; aos-doctor reports it */ }
    return dupes.length ? { ...last, ok: false, dupes, detail: `direct duplicates next to the gateway: ${dupes.join('; ')}; run aos-gateway enable` } : last;
}

// No recursive delete (the gateway dir is HOME-derived): node_modules is renamed aside and aos-doctor offers the cleanup.
function retireNodeModules(dir, home, now = Date.now()) {
    const p = path.join(dir, 'node_modules');
    if (!path.isAbsolute(home) || path.resolve(home) === path.parse(path.resolve(home)).root) throw new Error(`refusing to touch ${home}`);
    if (dir !== gatewayDir(home)) throw new Error(`refusing to touch ${p}`);
    if (!fs.existsSync(p)) return null;
    const target = path.join(dir, `node_modules.removed-${now}`);
    fs.renameSync(p, target);
    return target;
}

const unlinkIfPresent = (file) => {
    try { fs.unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
};

async function uninstall(ctx) {
    const { home, platform } = ctx;
    const dir = gatewayDir(home);
    const files = [plistPath(home), unitPath(home), win.vbsPath(ctx, LABEL),path.join(dir, 'mcp.json'), path.join(dir, 'token'), path.join(dir, 'gateway.pid'), path.join(dir, PRESETS_OK), path.join(dir, RESTART_AT)];
    const actions = [`launchctl bootout gui/<uid>/${LABEL}`, ...files.map((f) => `remove ${f}`), `rename ${path.join(dir, 'node_modules')} -> node_modules.removed-<ts>`];
    const fileList = harnessFiles(ctx);
    if (ctx.dryRun) return { ok: true, dryRun: true, actions: [...describeReport(harness.disable({ home, files: fileList, dryRun: true })), ...actions] };

    // First: the harness entries must be back to direct before the gateway they point at disappears.
    const restored = harness.disable({ home, files: fileList, now: ctx.now });
    const bad = restored.filter((r) => r.error);
    if (bad.length) throw new Error(`gateway harness restore failed: ${bad.map((r) => `${r.file} (${r.error})`).join('; ')}`);
    describeReport(restored).forEach((m) => sayOf(ctx)(m));

    // gateway.json (user overrides) and the renamed migration.json.restored-* are never touched.
    if (platform === 'darwin') await launchctl(ctx, ['bootout', `gui/${uidOf(ctx)}/${LABEL}`]);
    else if (platform === 'linux') await systemctl(ctx, ['disable', '--now', UNIT]);
    else if (platform === 'win32') {
        await schtasks(ctx, ['/Delete', '/TN', WIN_TASK, '/F']);
        // 1mcp is a child of serve and survives Stop-Process; it holds node_modules open, so the rename below would fail.
        await svc(ctx, 'powershell', win.stopArgs([cliPath(ctx.aosRoot), path.join(dir, 'node_modules')]));
    }
    files.forEach(unlinkIfPresent);
    if (platform === 'linux') await systemctl(ctx, ['daemon-reload']);
    const retired = retireNodeModules(dir, home, ctx.now);
    return { ok: true, actions, retired, harness: restored };
}

module.exports = { withoutMemory, id: 'gateway', name: 'MCP gateway', detect, install, update, restart, verify, uninstall, buildPlist, retireNodeModules, shippedPresets, livePresets, shippedMcpTemplatePath, migrateLegacyAgyWorkspaceMcp, PIN, LABEL };
