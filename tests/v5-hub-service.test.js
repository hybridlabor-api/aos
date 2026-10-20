// AOS Hub as a service (pkg-hub): plist/unit/task text, per-platform install
// commands via a recorded fake ctx.run, uninstall cleanup in a temp HOME, and
// the double-start guard. No real launchctl/systemctl/schtasks, no network:
// verify's port probe is not exercised here.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pkg = require('../lib/v5/pkg-hub.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-hub-svc-'));
const NODE = '/opt/node/bin/node';
// An aosRoot whose bin/aos-hub.mjs exists, so detect() passes its file check.
const realAosRoot = ROOT;

function mkCtx(home, extra = {}) {
    const calls = [];
    const run = async (cmd, args) => { calls.push([cmd, ...args]); return { ok: true, status: 0, stdout: '', stderr: '' }; };
    return { calls, ctx: { home, run, serviceRunner: true, dryRun: false, platform: 'darwin', log: () => {}, nodePath: NODE, aosRoot: realAosRoot, uid: 501, sleep: async () => {}, hubPort: 1, ...extra } };
}

describe('service definitions', () => {
    const home = tmp();

    test('plist contains the label, the serve/watch/port argv, RunAtLoad and KeepAlive', () => {
        const plist = pkg.buildPlist({ nodePath: NODE, aosRoot: realAosRoot, home, pathEnv: '/usr/bin:/bin' });
        assert.ok(plist.includes('<string>com.bdb.aos.hub</string>'));
        assert.ok(plist.includes(`<string>${NODE}</string>`));
        assert.ok(plist.includes(`<string>${path.join(realAosRoot, 'bin', 'aos-hub.mjs')}</string>`));
        assert.ok(plist.includes('<string>--serve</string>'));
        assert.ok(plist.includes('<string>--watch</string>'));
        assert.ok(plist.includes('<string>--port</string>') && plist.includes('<string>7900</string>'));
        assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
        assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
        assert.ok(plist.includes(path.join(home, '.aos', 'hub', 'stdout.log')));
        assert.ok(plist.includes(path.join(home, '.aos', 'hub', 'stderr.log')));
    });

    test('unit contains Restart=always and the same argv', () => {
        const unit = pkg.buildUnit({ nodePath: NODE, aosRoot: realAosRoot, pathEnv: '/usr/bin:/bin' });
        assert.ok(unit.includes('Restart=always'));
        assert.ok(unit.includes('RestartSec=5'));
        assert.ok(unit.includes(NODE));
        assert.ok(unit.includes('--serve --watch --port 7900'));
    });
});

describe('install commands per platform', () => {
    test('darwin writes the plist and bootstraps via launchctl', async () => {
        const home = tmp();
        const { ctx, calls } = mkCtx(home);
        const r = await pkg.install(ctx);
        assert.equal(r.ok, true);
        const plistFile = path.join(home, 'Library', 'LaunchAgents', 'com.bdb.aos.hub.plist');
        assert.ok(fs.existsSync(plistFile));
        assert.deepEqual(calls.find((c) => c[0] === 'launchctl' && c[1] === 'bootout'), ['launchctl', 'bootout', 'gui/501/com.bdb.aos.hub']);
        assert.deepEqual(calls.find((c) => c[0] === 'launchctl' && c[1] === 'bootstrap'), ['launchctl', 'bootstrap', 'gui/501', plistFile]);
    });

    test('linux writes the unit and enables it via systemctl --user', async () => {
        const home = tmp();
        const { ctx, calls } = mkCtx(home, { platform: 'linux' });
        const r = await pkg.install(ctx);
        assert.equal(r.ok, true);
        const unitFile = path.join(home, '.config', 'systemd', 'user', 'com.bdb.aos.hub.service');
        assert.ok(fs.existsSync(unitFile));
        assert.ok(fs.readFileSync(unitFile, 'utf8').includes('Restart=always'));
        assert.deepEqual(calls.find((c) => c[0] === 'systemctl' && c[1] === '--user' && c[2] === 'daemon-reload'), ['systemctl', '--user', 'daemon-reload']);
        assert.deepEqual(calls.find((c) => c[0] === 'systemctl' && c[2] === 'enable'), ['systemctl', '--user', 'enable', '--now', 'com.bdb.aos.hub.service']);
    });

    test('win32 migrates a beta.2 task to a Startup .vbs (no admin) and starts the vbs once', async () => {
        const home = tmp();
        const appData = tmp();
        const { ctx, calls } = mkCtx(home, { platform: 'win32', env: { APPDATA: appData } });
        assert.equal(pkg.detect(ctx), false);
        const legacyXml = path.join(home, '.aos', 'hub', 'aos-hub-task.xml');
        fs.mkdirSync(path.dirname(legacyXml), { recursive: true });
        fs.writeFileSync(legacyXml, 'old');
        assert.equal(pkg.detect(ctx), false, 'a beta.2 task XML alone is not an install');
        assert.equal(pkg.needsMigration(ctx), true, 'but update migrates it');
        const r = await pkg.update(ctx);
        assert.equal(r.ok, true);
        assert.equal(r.started, true);
        const vbs = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'com.bdb.aos.hub.vbs');
        const text = fs.readFileSync(vbs, 'utf8');
        assert.ok(text.includes(`""${NODE}"" ""${path.join(realAosRoot, 'bin', 'aos-hub.mjs')}"" ""--serve"" ""--watch"" ""--port"" ""7900""`), text);
        assert.ok(text.includes(', 0, False'), 'hidden window, no wait');
        assert.deepEqual(calls.filter((c) => c[0] === 'wscript.exe'), [['wscript.exe', vbs]]);
        assert.deepEqual(calls.filter((c) => c[0] === 'schtasks').map((c) => c[1]), ['/End', '/Delete']);
        assert.ok(!calls.some((c) => c[0] === 'schtasks' && c[1] === '/Create'), 'no schtasks /Create: it needs admin rights');
        // stopArgs lower-cases and uses backslashes on both sides of the match.
        const lcWin = (s) => s.toLowerCase().replace(/\//g, '\\');
        assert.ok(lcWin(calls.find((c) => c[0] === 'powershell').join(' ')).includes(lcWin(path.join(realAosRoot, 'bin', 'aos-hub.mjs'))));
        assert.ok(!fs.existsSync(legacyXml), 'legacy task XML removed');
        assert.equal(pkg.detect(ctx), true, 'the .vbs is the install record');
        assert.equal(pkg.needsMigration(ctx), false);
    });

    test('darwin and linux never report a migration', () => {
        for (const platform of ['darwin', 'linux']) {
            const home = tmp();
            fs.mkdirSync(path.join(home, '.aos', 'hub'), { recursive: true });
            fs.writeFileSync(path.join(home, '.aos', 'hub', 'aos-hub-task.xml'), 'old');
            const { ctx } = mkCtx(home, { platform });
            assert.deepEqual(pkg.detectRow(ctx), { installed: false, migrate: false, version: null }, platform);
        }
    });

    test('win32: a failing wscript is reported, not hidden', async () => {
        const say = [];
        const { ctx } = mkCtx(tmp(), { platform: 'win32', env: { APPDATA: tmp() }, log: (m) => say.push(m), run: async (cmd) => (cmd === 'wscript.exe' ? { status: 1, stderr: 'boom' } : { status: 0 }) });
        const r = await pkg.install(ctx);
        assert.equal(r.started, false);
        assert.ok(say.some((m) => /wscript\.exe failed: boom/.test(m)), say.join(' | '));
    });
});

describe('uninstall', () => {
    test('removes the service files it wrote (temp HOME only)', async () => {
        const home = tmp();
        for (const platform of ['darwin', 'linux', 'win32']) {
            const { ctx } = mkCtx(home, { platform });
            await pkg.install(ctx);
            const svcFile = platform === 'darwin'
                ? path.join(home, 'Library', 'LaunchAgents', 'com.bdb.aos.hub.plist')
                : platform === 'linux'
                    ? path.join(home, '.config', 'systemd', 'user', 'com.bdb.aos.hub.service')
                    : path.join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'com.bdb.aos.hub.vbs');
            assert.ok(fs.existsSync(svcFile), `${platform}: service file should exist before uninstall`);
            await pkg.uninstall(ctx);
            assert.ok(!fs.existsSync(svcFile), `${platform}: service file should be gone`);
            assert.equal(pkg.detect(ctx), false, `${platform}: not detected after uninstall`);
        }
        const { ctx, calls } = mkCtx(tmp(), { platform: 'win32' });
        await pkg.uninstall(ctx);
        assert.deepEqual(calls.find((c) => c[0] === 'schtasks' && c[1] === '/Delete'), ['schtasks', '/Delete', '/TN', 'AOS_Hub', '/F']);
        const stop = calls.find((c) => c[0] === 'powershell');
        const lcWin = (s) => s.toLowerCase().replace(/\//g, '\\');
        assert.ok(stop && lcWin(stop.join(' ')).includes(lcWin(path.join(realAosRoot, 'bin', 'aos-hub.mjs'))) && stop.join(' ').includes('Stop-Process'), 'running hub stopped by its script path');
    });
});

describe('double-start guard', () => {
    test('reports and does not install when a manual hub answers on the hub port', async () => {
        const home = tmp();
        // Fake the health answer at the network boundary: pkg-hub's probe is
        // module-private, so stub the smallest seam — the hub.json marker — and
        // force the probe itself via a local HTTP server.
        const http = require('http');
        const server = http.createServer((req, res) => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true, service: 'aos-hub' }));
        });
        await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
        try {
            const say = [];
            const { ctx, calls } = mkCtx(home, { log: (m) => say.push(m), hubPort: server.address().port });
            const r = await pkg.install(ctx);
            assert.equal(r.ok, false);
            assert.equal(r.skipped, true);
            assert.ok(say.some((m) => /already answering/.test(m)));
            assert.ok(!calls.some((c) => c[0] === 'launchctl'), 'no launchctl call when a manual hub holds the port');
            assert.ok(!fs.existsSync(path.join(home, 'Library', 'LaunchAgents', 'com.bdb.aos.hub.plist')));
        } finally {
            await new Promise((ok) => server.close(ok));
        }
    });

    test('installs normally when nothing answers on the hub port', async () => {
        const home = tmp();
        const { ctx, calls } = mkCtx(home);
        const r = await pkg.install(ctx);
        assert.equal(r.ok, true);
        assert.ok(calls.some((c) => c[0] === 'launchctl'));
    });
});

// The installer's defaults step and `aos update` over a beta.2 Windows install that left only the task XML.
// The real registry entry pins process.platform, so a same-id stub wires pkg-hub with a win32 ctx the same way.
describe('beta.2 Windows hub migration through the menu', () => {
    const menu = require('../lib/v5/menu');
    const pk = require('../lib/v5/packages');

    function beta2() {
        const home = tmp();
        const appData = tmp();
        const xml = path.join(home, '.aos', 'hub', 'aos-hub-task.xml');
        fs.mkdirSync(path.dirname(xml), { recursive: true });
        fs.writeFileSync(xml, 'old');
        // Everything but the kernel and the hub is disabled: no other package, mod or the gateway runs here.
        fs.writeFileSync(path.join(home, '.aos', 'v5-settings.json'), JSON.stringify({ disabled: pk.registry.map((p) => p.id).filter((id) => id !== 'kernel' && id !== 'hub') }));
        const { ctx, calls } = mkCtx(home, { platform: 'win32', env: { APPDATA: appData } });
        const vbs = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'com.bdb.aos.hub.vbs');
        const out = [];
        const o = { home, write: (s) => out.push(s), ui: {}, logFile: path.join(home, 'install.log'), npmView: async () => { throw new Error('offline'); } };
        return { home, xml, vbs, ctx, calls, out, o };
    }
    const hubStub = (ctx) => ({ id: 'hub', name: 'AOS Hub', alwaysUpdate: true, detect: () => pkg.detectRow(ctx), install: () => pkg.install(ctx), update: () => pkg.update(ctx), verify: async () => ({ ok: true, detail: 'up' }) });
    const withHub = async (entry, fn) => { const real = pk.registry.find((e) => e.id === 'hub'); pk.register(entry); try { return await fn(); } finally { pk.register(real); } };
    const assertMigrated = (m) => {
        assert.ok(fs.existsSync(m.vbs), m.out.join(''));
        assert.equal(m.calls.filter((c) => c[0] === 'wscript.exe').length, 1);
        assert.ok(!fs.existsSync(m.xml), 'beta.2 task XML removed');
    };

    test('the fresh-install defaults step installs the hub', async () => {
        const m = beta2();
        const host = { detectInstallState: () => ({ isInstalled: true }) };
        const excluded = new Set(pk.registry.map((p) => p.id).filter((id) => id !== 'hub'));
        const failed = await withHub(hubStub(m.ctx), () => menu.installDefaults(host, m.o, excluded));
        assert.deepEqual(failed, []);
        assert.match(m.out.join(''), /✔ AOS Hub/);
        assertMigrated(m);
    });

    test('aos update migrates the hub to the .vbs', async () => {
        const m = beta2();
        const skills = path.join(m.home, 'skills');
        fs.mkdirSync(path.join(skills, 'x'), { recursive: true });
        const host = {
            detectInstallState: () => ({ isInstalled: true, localVersion: '5.0.0', installedModules: [] }),
            resolveTargetPaths: () => ({ targetSkillDir: skills, targetMcpDir: path.join(m.home, 'mcp') }),
            moduleBasePath: () => path.join(m.home, '.agents'),
            quickUpdateKernel: () => [],
            quickUpdateHarnesses: () => [],
            loadExistingEnv: () => ({}),
            PROVIDER_KEY_ENV_NAMES: {},
            isNewerVersion: (l, r) => l !== r,
            saveManifest: () => {},
            flushSessionManifest: () => {},
        };
        await withHub(hubStub(m.ctx), () => menu.update(host, { ...m.o, dryRun: true }));
        assert.match(m.out.join(''), /✔ AOS Hub/);
        assert.doesNotMatch(m.out.join(''), /Optional, not installed: .*hub/);
        assertMigrated(m);
    });
});

describe('uninstall after the hub bin is gone', () => {
    for (const platform of ['linux', 'darwin']) {
        test(`${platform}: present() sees the AOS unit without the bin and uninstall removes it`, async () => {
            const home = tmp();
            const { ctx } = mkCtx(home, { platform });
            await pkg.install(ctx);
            const gone = { ...ctx, aosRoot: path.join(home, 'no-such-root') };
            assert.equal(pkg.detect(gone), false);
            assert.equal(pkg.present(gone), true);
            await pkg.uninstall(gone);
            assert.equal(pkg.present(gone), false);
            const left = platform === 'linux' ? path.join(home, '.config', 'systemd', 'user', 'com.bdb.aos.hub.service') : path.join(home, 'Library', 'LaunchAgents', 'com.bdb.aos.hub.plist');
            assert.ok(!fs.existsSync(left));
        });
    }

    test('a foreign file at the unit path is not ours', () => {
        const home = tmp();
        const f = path.join(home, '.config', 'systemd', 'user', 'com.bdb.aos.hub.service');
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, '[Service]\nExecStart=/bin/true # my-aos-hub.mjs\n');
        assert.equal(pkg.present({ home, platform: 'linux' }), false);
    });
});
