'use strict';
// v5 package contract for the local MCP gateway. ctx = { home, run, dryRun, platform, log, nodePath, aosRoot, env?, uvPath? }.
// Every process goes through ctx.run(cmd, args, opts); nothing here reads HOME or other environment variables
// (ctx.env is the caller's environment, only a fixed allow-list of keys is passed on to the upstreams).
const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const { gatewayDir, defaultMcpsDir, GATEWAY_PORT, defaultPathEnv, buildUpstreams, writeGatewayConfig } = require('../gateway/config');
const { shippedServers, launcherPath } = require('../mcp-secrets');

const PIN = '@1mcp/agent@0.38.2';
const LABEL = 'com.bdb.aos.gateway';

const plistPath = (home) => path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
const oneMcpBin = (dir, platform) => path.join(dir, 'node_modules', '.bin', platform === 'win32' ? '1mcp.cmd' : '1mcp');
const cliPath = (aosRoot) => path.join(aosRoot, 'bin', 'aos-gateway.mjs');
const uidOf = (ctx) => (ctx.uid !== undefined ? ctx.uid : process.getuid());
const sayOf = (ctx) => (typeof ctx.log === 'function' ? ctx.log : ctx.log && ctx.log.step ? (m) => ctx.log.step(m) : () => {});
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

// ctx.run may reject or return a failing status; both count as "did not work", never as an exception.
async function launchctl(ctx, args) {
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
    return a;
}

async function apply(ctx, verb) {
    const { home, run, platform, nodePath, aosRoot } = ctx;
    const say = sayOf(ctx);
    const actions = planActions(ctx, verb);
    if (ctx.dryRun) return { ok: true, dryRun: true, actions };

    const dir = gatewayDir(home);
    // 1mcp refuses a config dir owned by another user or readable by others.
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (platform !== 'win32') fs.chmodSync(dir, 0o700);

    const npm = await run('npm', ['install', '--prefix', dir, '--no-audit', '--no-fund', PIN]);
    if (failed(npm)) throw new Error(`npm install ${PIN} failed`);

    ensureToken(path.join(dir, 'token'), platform);

    const pathEnv = defaultPathEnv({ home, nodePath, platform });
    const launcher = launcherPath(home);
    const upstreams = buildUpstreams({ shipped: shippedServers(aosRoot), home, launcher, pathEnv, passEnv: passEnvOf(ctx), ...(ctx.uvPath ? { uvPath: ctx.uvPath } : {}) });
    writeGatewayConfig(dir, upstreams);

    if (!fs.existsSync(launcher)) say(`secret launcher missing: ${launcher}; gateway servers that need secrets will fail until it is installed`);
    const mcpsPrefix = defaultMcpsDir(home) + path.sep;
    for (const [name, u] of Object.entries(upstreams)) {
        const missing = u.args.filter((a) => typeof a === 'string' && a.startsWith(mcpsPrefix) && !fs.existsSync(a));
        for (const m of missing) say(`gateway server ${name}: ${m} does not exist; it will fail to start`);
    }

    if (platform === 'darwin') {
        const plist = plistPath(home);
        fs.mkdirSync(path.dirname(plist), { recursive: true });
        fs.writeFileSync(plist, buildPlist({ nodePath, aosRoot, dir, home, pathEnv }), { mode: 0o644 });
        const domain = `gui/${uidOf(ctx)}`;
        const target = `${domain}/${LABEL}`;
        // bootout can return before launchd has fully unloaded the job; one delayed retry covers that race.
        const reload = async () => {
            await launchctl(ctx, ['bootout', target]);
            if (await launchctl(ctx, ['bootstrap', domain, plist])) return true;
            await (ctx.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))))(500);
            return launchctl(ctx, ['bootstrap', domain, plist]);
        };
        // verify() decides whether the service answers; a launchctl error here is reported, not fatal.
        const ok = verb === 'update' ? (await launchctl(ctx, ['kickstart', '-k', target])) || (await reload()) : await reload();
        if (!ok) say(`launchctl ${verb === 'update' ? 'kickstart/bootstrap' : 'bootstrap'} reported an error; run "aos-gateway status"`);
    } else {
        say('no service is registered on this platform yet (UNVERIFIED on Windows); start it with "aos-gateway serve"');
    }
    return { ok: true, actions };
}

function detect(ctx) {
    return fs.existsSync(oneMcpBin(gatewayDir(ctx.home), ctx.platform)) && (ctx.platform !== 'darwin' || fs.existsSync(plistPath(ctx.home)));
}

const install = (ctx) => apply(ctx, 'install');
// Reinstalls the pinned 1mcp and regenerates mcp.json; the token and the user's gateway.json stay.
const update = (ctx) => apply(ctx, 'update');

// launchd needs a moment after bootstrap/kickstart: retry for ~5 s (ctx.sleep is injectable for tests).
// v5's run() sends stdout to the update log, so status is read in-process instead of parsed from a subprocess.
const defaultStatusFn = (ctx) => async () => {
    const { pathToFileURL } = require('url');
    const mod = await import(pathToFileURL(cliPath(ctx.aosRoot)).href);
    const opts = { dir: gatewayDir(ctx.home) };
    if (ctx.statusPorts) Object.assign(opts, ctx.statusPorts);
    return mod.gatewayStatus(opts);
};

async function verify(ctx) {
    const sleep = ctx.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const statusFn = ctx.statusFn || defaultStatusFn(ctx);
    let last;
    for (let i = 0; i < 10; i++) {
        try {
            const s = await statusFn();
            last = { ok: s.running === true && s.port === GATEWAY_PORT, status: s };
        } catch (e) {
            last = { ok: false, error: `status check failed: ${e.message}` };
        }
        if (last.ok) return last;
        if (i < 9) await sleep(500);
    }
    return last;
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
    const files = [plistPath(home), path.join(dir, 'mcp.json'), path.join(dir, 'token'), path.join(dir, 'gateway.pid')];
    const actions = [`launchctl bootout gui/<uid>/${LABEL}`, ...files.map((f) => `remove ${f}`), `rename ${path.join(dir, 'node_modules')} -> node_modules.removed-<ts>`];
    if (ctx.dryRun) return { ok: true, dryRun: true, actions };

    // gateway.json (user overrides) and migration.json (harness entries to restore) are never touched.
    if (platform === 'darwin') await launchctl(ctx, ['bootout', `gui/${uidOf(ctx)}/${LABEL}`]);
    files.forEach(unlinkIfPresent);
    const retired = retireNodeModules(dir, home, ctx.now);
    return { ok: true, actions, retired };
}

module.exports = { id: 'gateway', name: 'MCP gateway', detect, install, update, verify, uninstall, buildPlist, retireNodeModules, PIN, LABEL };
