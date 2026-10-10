'use strict';
// v5 package contract for the AOS Hub service. Same shape as pkg-gateway:
// launchd plist on macOS, systemd user unit on Linux, Task Scheduler XML on
// Windows. ctx = { home, run, dryRun, platform, log, nodePath, aosRoot }.
const fs = require('fs');
const path = require('path');
const http = require('http');

const LABEL = 'com.bdb.aos.hub';
const UNIT = `${LABEL}.service`;
const WIN_TASK = 'AOS_Hub';
const HUB_PORT = 7900;
const WIN_XML_NAME = 'aos-hub-task.xml';

const plistPath = (home) => path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
const unitPath = (home) => path.join(home, '.config', 'systemd', 'user', UNIT);
const hubBin = (aosRoot) => path.join(aosRoot, 'bin', 'aos-hub.mjs');
const uidOf = (ctx) => (ctx.uid !== undefined ? ctx.uid : process.getuid());
const sayOf = (ctx) => (typeof ctx.log === 'function' ? ctx.log : ctx.log && ctx.log.step ? (m) => ctx.log.step(m) : () => {});
const failed = (r) => !!r && typeof r === 'object' && (r.ok === false || r.status > 0 || r.code > 0 || !!r.error);

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function buildPlist({ nodePath, aosRoot, home, pathEnv }) {
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
        ${str(hubBin(aosRoot))}
        ${str('--serve')}
        ${str('--watch')}
        ${str('--port')}
        ${str(String(HUB_PORT))}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    ${str(path.join(home, '.aos', 'hub', 'stdout.log'))}
    <key>StandardErrorPath</key>
    ${str(path.join(home, '.aos', 'hub', 'stderr.log'))}
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
function buildUnit({ nodePath, aosRoot, pathEnv }) {
    const q = (s) => `"${String(s).replace(/["\\]/g, '\\$&')}"`;
    return `[Unit]
Description=AOS Hub

[Service]
ExecStart=${q(nodePath)} ${q(hubBin(aosRoot))} --serve --watch --port ${HUB_PORT}
Environment=${q(`PATH=${pathEnv}`)}
Restart=always
RestartSec=5
StandardOutput=append:%h/.aos/hub/stdout.log
StandardError=append:%h/.aos/hub/stderr.log

[Install]
WantedBy=default.target
`;
}

// Task Scheduler XML: logon trigger + RestartOnFailure (exit code 3 counts as
// a failure), like lib/hub/services-win.mjs. Pure text, written to a temp file
// and registered with schtasks /Create /XML.
function buildWinTaskXml({ nodePath, aosRoot, home }) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    const bad = /["\r\n\0<>|&%^]|[\u0000-\u001f\u007f]/;
    for (const [name, v] of [['nodePath', nodePath], ['aosRoot', aosRoot], ['home', home]]) {
        if (typeof v !== 'string' || !v.trim() || bad.test(v)) throw new Error(`${name} is missing or contains forbidden characters`);
    }
    return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <URI>\\${esc(WIN_TASK)}</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${esc(nodePath)}</Command>
      <Arguments>"${esc(hubBin(aosRoot))}" --serve --watch --port ${HUB_PORT}</Arguments>
      <WorkingDirectory>${esc(home)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

// Probe /api/health; true only when an aos-hub answers.
const hubAnswers = (port = HUB_PORT, timeoutMs = 800) => new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: timeoutMs }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { text += c; });
        res.on('end', () => {
            try { resolve(res.statusCode === 200 && JSON.parse(text).ok === true && JSON.parse(text).service === 'aos-hub'); }
            catch { resolve(false); }
        });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
});

// A manual hub (no --watch, no service manager) already bound to 7900: a
// second hub would only lose the port race. Install skips instead.
async function manualHubRunning(ctx) {
    // Once the service is installed, the hub on the port is the service's own: an update must go through.
    if (detect(ctx)) return false;
    if (!await hubAnswers(ctx.hubPort || HUB_PORT)) return false; // hubPort: tests only
    try {
        const rec = JSON.parse(fs.readFileSync(path.join(ctx.home, '.aos', 'hub', 'hub.json'), 'utf8'));
        if (Number.isInteger(rec.pid) && rec.pid > 0 && rec.pid !== process.pid) return true;
    } catch { /* no hub.json: still a foreign listener, report it */ }
    return true;
}

async function svc(ctx, bin, args) {
    try {
        const r = await ctx.run(bin, args);
        if (!failed(r)) return null;
        return `${bin} failed: ${String(r.stderr || (r.error && r.error.message) || r.error || '').trim().split('\n')[0] || 'no output'}`;
    } catch (e) { return `${bin} failed: ${e.message}`; }
}
const systemctl = (ctx, args) => svc(ctx, 'systemctl', ['--user', ...args]);
const schtasks = (ctx, args) => svc(ctx, 'schtasks', args);
async function launchctl(ctx, args) {
    try { return !failed(await ctx.run('launchctl', args)); } catch { return false; }
}

function planActions(ctx, verb) {
    const a = ctx.platform !== 'darwin' ? [] : [`write ${plistPath(ctx.home)}`, verb === 'update' ? `launchctl kickstart -k gui/<uid>/${LABEL} (fallback: bootout + bootstrap)` : `launchctl bootout gui/<uid>/${LABEL} (ignored if not loaded)`, ...(verb === 'update' ? [] : [`launchctl bootstrap gui/<uid> ${plistPath(ctx.home)}`])];
    if (ctx.platform === 'linux') a.push(`write ${unitPath(ctx.home)}`, 'systemctl --user daemon-reload', `systemctl --user enable --now ${UNIT}`);
    if (ctx.platform === 'win32') a.push(`schtasks /Create /XML <${WIN_XML_NAME}> /TN ${WIN_TASK} /F`, 'schtasks /Run /TN ' + WIN_TASK);
    return a;
}

async function apply(ctx, verb) {
    const { home, platform, nodePath, aosRoot } = ctx;
    const say = sayOf(ctx);
    const actions = planActions(ctx, verb);
    if (ctx.dryRun) return { ok: true, dryRun: true, actions };

    const doubleStart = await manualHubRunning(ctx);
    if (doubleStart) {
        say(`an AOS Hub is already answering on 127.0.0.1:${HUB_PORT} but was not started by the service; stop it first (aos-hub stop), nothing installed`);
        return { ok: false, skipped: true, actions, detail: 'manual hub already running on the port' };
    }

    let started = false;
    if (platform === 'darwin') {
        const plist = plistPath(home);
        fs.mkdirSync(path.dirname(plist), { recursive: true });
        fs.writeFileSync(plist, buildPlist({ nodePath, aosRoot, home, pathEnv: pathEnvOf(ctx) }), { mode: 0o644 });
        const domain = `gui/${uidOf(ctx)}`;
        const target = `${domain}/${LABEL}`;
        // bootout can return before launchd has fully unloaded the job; one delayed retry covers that race.
        const reload = async () => {
            await launchctl(ctx, ['bootout', target]);
            if (await launchctl(ctx, ['bootstrap', domain, plist])) return true;
            await (ctx.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))))(500);
            return launchctl(ctx, ['bootstrap', domain, plist]);
        };
        const ok = verb === 'update' ? (await launchctl(ctx, ['kickstart', '-k', target])) || (await reload()) : await reload();
        started = !!ok;
        if (!ok) say(`launchctl ${verb === 'update' ? 'kickstart/bootstrap' : 'bootstrap'} reported an error; check "launchctl list | grep ${LABEL}"`);
    } else if (platform === 'linux') {
        const unit = unitPath(home);
        fs.mkdirSync(path.dirname(unit), { recursive: true });
        fs.writeFileSync(unit, buildUnit({ nodePath, aosRoot, pathEnv: pathEnvOf(ctx) }), { mode: 0o644 });
        const err = (await systemctl(ctx, ['daemon-reload'])) || (await systemctl(ctx, ['enable', '--now', UNIT])) || (verb === 'install' ? null : await systemctl(ctx, ['restart', UNIT]));
        started = !err;
        if (err) say(`${err}; start it with "aos-hub start"`);
    } else if (platform === 'win32') {
        const xmlFile = path.join(home, '.aos', 'hub', WIN_XML_NAME);
        fs.mkdirSync(path.dirname(xmlFile), { recursive: true });
        fs.writeFileSync(xmlFile, buildWinTaskXml({ nodePath, aosRoot, home }), { mode: 0o600 });
        let err = await schtasks(ctx, ['/Create', '/XML', xmlFile, '/TN', WIN_TASK, '/F']);
        if (!err) err = await schtasks(ctx, ['/Run', '/TN', WIN_TASK]);
        started = !err;
        if (err) say(`${err}; start it with "aos-hub start"`);
    } else say('no service is registered on this platform yet; start it with "aos-hub start"');

    return { ok: true, actions, started };
}

// PATH for the service environment: node's dir plus the usual local bins, so
// the service finds git/npm like a login shell would.
function pathEnvOf(ctx) {
    if (typeof ctx.pathEnv === 'string' && ctx.pathEnv) return ctx.pathEnv;
    const parts = [path.dirname(ctx.nodePath || process.execPath), path.join(ctx.home, '.local', 'bin'), '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
    return [...new Set(parts)].join(path.delimiter);
}

function detect(ctx) {
    // Windows: the task XML install writes is the record (schtasks /F keeps re-registering idempotent).
    const svcFile = ctx.platform === 'darwin' ? plistPath(ctx.home) : ctx.platform === 'linux' ? unitPath(ctx.home) : path.join(ctx.home, '.aos', 'hub', WIN_XML_NAME);
    return !!svcFile && fs.existsSync(svcFile) && fs.existsSync(hubBin(ctx.aosRoot));
}

const install = (ctx) => apply(ctx, 'install');
// Regenerates the service definition; the hub's own data (hub.json, logs) stays.
const update = (ctx) => apply(ctx, 'update');

// The hub answering /api/health is the whole contract; a short retry covers the launchd/systemd start delay.
async function verify(ctx, { tries = 10 } = {}) {
    const sleep = ctx.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    let last = { ok: false, detail: 'not probed' };
    for (let i = 0; i < tries; i++) {
        const up = await hubAnswers(HUB_PORT);
        last = up ? { ok: true, detail: `hub answers on 127.0.0.1:${HUB_PORT}` } : { ok: false, detail: `no hub on 127.0.0.1:${HUB_PORT}` };
        if (last.ok) return last;
        if (i < tries - 1) await sleep(500);
    }
    return last;
}

const unlinkIfPresent = (file) => {
    try { fs.unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
};

async function uninstall(ctx) {
    const { home, platform } = ctx;
    const files = [plistPath(home), unitPath(home), path.join(home, '.aos', 'hub', WIN_XML_NAME)];
    const actions = [`launchctl bootout gui/<uid>/${LABEL}`, ...files.map((f) => `remove ${f}`)];
    if (ctx.dryRun) return { ok: true, dryRun: true, actions };

    if (platform === 'darwin') await launchctl(ctx, ['bootout', `gui/${uidOf(ctx)}/${LABEL}`]);
    else if (platform === 'linux') {
        await systemctl(ctx, ['disable', '--now', UNIT]);
        await systemctl(ctx, ['daemon-reload']);
    } else if (platform === 'win32') await schtasks(ctx, ['/Delete', '/TN', WIN_TASK, '/F']);
    files.forEach(unlinkIfPresent);
    return { ok: true, actions };
}

module.exports = { id: 'hub', name: 'AOS Hub', detect, install, update, verify, uninstall, buildPlist, buildUnit, buildWinTaskXml, LABEL, UNIT, WIN_TASK, HUB_PORT };
