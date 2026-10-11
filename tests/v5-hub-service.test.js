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
    return { calls, ctx: { home, run, dryRun: false, platform: 'darwin', log: () => {}, nodePath: NODE, aosRoot: realAosRoot, uid: 501, sleep: async () => {}, hubPort: 1, ...extra } };
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

    test('win32 task XML has a logon trigger and RestartOnFailure', () => {
        const x = pkg.buildWinTaskXml({ nodePath: 'C:\\node\\node.exe', aosRoot: 'C:\\aos', home: 'C:\\Users\\u' });
        assert.ok(x.includes('<LogonTrigger>'));
        assert.ok(x.includes('<RestartOnFailure>'));
        assert.ok(x.includes('--serve --watch --port 7900'));
        assert.ok(x.includes('AOS_Hub'));
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

    test('win32 writes the task XML and registers it with schtasks /Create /XML', async () => {
        const home = tmp();
        const { ctx, calls } = mkCtx(home, { platform: 'win32' });
        const r = await pkg.install(ctx);
        assert.equal(r.ok, true);
        const xmlFile = calls.find((c) => c[0] === 'schtasks' && c[1] === '/Create')[3];
        assert.ok(fs.existsSync(xmlFile));
        const raw = fs.readFileSync(xmlFile);
        assert.deepEqual([raw[0], raw[1]], [0xff, 0xfe], 'UTF-16LE BOM, as the XML header declares');
        assert.ok(raw.toString('utf16le').includes('<RestartOnFailure>'));
        assert.deepEqual(calls.find((c) => c[0] === 'schtasks' && c[1] === '/Create'), ['schtasks', '/Create', '/XML', xmlFile, '/TN', 'AOS_Hub', '/F']);
        assert.deepEqual(calls.find((c) => c[0] === 'schtasks' && c[1] === '/Run'), ['schtasks', '/Run', '/TN', 'AOS_Hub']);
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
                    : path.join(home, '.aos', 'hub', 'aos-hub-task.xml');
            assert.ok(fs.existsSync(svcFile), `${platform}: service file should exist before uninstall`);
            await pkg.uninstall(ctx);
            assert.ok(!fs.existsSync(svcFile), `${platform}: service file should be gone`);
        }
        const { ctx, calls } = mkCtx(tmp(), { platform: 'win32' });
        await pkg.uninstall(ctx);
        assert.deepEqual(calls.find((c) => c[0] === 'schtasks' && c[1] === '/Delete'), ['schtasks', '/Delete', '/TN', 'AOS_Hub', '/F']);
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
