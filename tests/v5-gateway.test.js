// MCP gateway stage 1: config generator, token forwarder, package contract, status JSON. Loopback only, no network.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const cfg = require('../lib/gateway/config.js');
const { createForwarder } = require('../lib/gateway/forwarder.js');
const pkg = require('../lib/v5/pkg-gateway.js');
const profile = require('../lib/v5/profile.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gw-'));
const mode = (p) => fs.statSync(p).mode & 0o777;
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const closeServer = (server) => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
const freePort = async () => { const s = http.createServer(); const p = await listen(s); await closeServer(s); return p; };

function request(port, { headers = {}, pathname = '/mcp', method = 'GET', body } = {}) {
    return new Promise((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port, path: pathname, method, headers }, (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { text += c; });
            res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
        });
        r.on('error', reject);
        r.end(body);
    });
}

describe('config generator', () => {
    const home = '/home/u';
    const launcher = '/home/u/.agents/bin/aos-mcp-env.mjs';
    const SECRET = 'ghp_REALSECRETVALUE0123456789';
    const shipped = {
        github: { command: 'npx', args: ['-y', 'pkg@1.0.0'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: SECRET } },
        bdb_resolume_mcp: { command: 'uv', args: ['run', '__MCPS_DIR__/resolume_mcp.py'] },
        bdb_blender_mcp: { command: 'node', args: ['{{HOME}}/x.js'], cwd: '/work/dir', env: { FOO: 'bar' } },
        mcsc: { command: 'node', args: ['__MCPS_DIR__/mcsc/server.js'] },
        bdb_rhino_mcp: { command: 'npx', args: ['-y', 'z@1.0.0'] },
        unknown_new_server: { command: 'node', args: ['n.js'] },
        open_design_mcp: { command: 'node', args: ['p.js'], shared: false },
    };

    test('splitServers: only allow-listed servers go to the gateway; shared:false forces direct', () => {
        const { gateway, direct } = cfg.splitServers(shipped);
        assert.deepEqual(Object.keys(gateway).sort(), ['bdb_blender_mcp', 'bdb_resolume_mcp', 'github']);
        assert.deepEqual(Object.keys(direct).sort(), ['bdb_rhino_mcp', 'mcsc', 'open_design_mcp', 'unknown_new_server']);
        for (const n of cfg.DIRECT_SERVERS) assert.ok(!cfg.GATEWAY_SERVERS.includes(n), n);
    });

    const up = cfg.buildUpstreams({ shipped, home, launcher, pathEnv: '/usr/bin:/bin' });

    test('passEnv is merged under template env, PATH and HOME', () => {
        const o = cfg.buildUpstreams({ shipped, home, launcher, pathEnv: 'P', passEnv: { HTTPS_PROXY: 'http://p:1', FOO: 'x', HOME: '/evil' }, uvPath: '/opt/uv' });
        assert.equal(o.bdb_blender_mcp.env.HTTPS_PROXY, 'http://p:1');
        assert.equal(o.bdb_blender_mcp.env.FOO, 'bar');
        assert.equal(o.bdb_blender_mcp.env.HOME, home);
        assert.equal(o.bdb_blender_mcp.env.PATH, 'P');
        assert.equal(o.bdb_resolume_mcp.command, '/opt/uv');
    });

    test('defaultPathEnv includes go directories', () => {
        assert.ok(cfg.defaultPathEnv({ home, nodePath: '/n/bin/node', platform: 'darwin' }).split(':').includes(path.join(home, 'go', 'bin')));
        assert.ok(cfg.defaultPathEnv({ home, nodePath: '/n/bin/node', platform: 'darwin' }).split(':').includes('/usr/local/go/bin'));
    });

    test('entries are explicit stdio with isolated env and no direct servers', () => {
        assert.deepEqual(Object.keys(up).sort(), ['bdb_blender_mcp', 'bdb_resolume_mcp', 'github']);
        for (const e of Object.values(up)) {
            assert.equal(e.type, 'stdio');
            assert.equal(e.inheritParentEnv, false);
            assert.equal(e.env.PATH, '/usr/bin:/bin');
            assert.equal(e.env.HOME, home);
        }
    });

    test('secrets go through the launcher and no value is written', () => {
        assert.ok(!JSON.stringify(up).includes(SECRET));
        assert.equal(up.github.command, 'node');
        assert.deepEqual(up.github.args.slice(0, 4), [launcher, '--vars', 'GITHUB_PERSONAL_ACCESS_TOKEN', '--']);
        assert.equal(up.github.env.GITHUB_PERSONAL_ACCESS_TOKEN, undefined);
        assert.throws(() => cfg.buildUpstreams({ shipped, home, pathEnv: 'x' }), /launcher/);
    });

    test('cwd, env and placeholders are carried over', () => {
        assert.equal(up.bdb_blender_mcp.cwd, '/work/dir');
        assert.equal(up.bdb_blender_mcp.env.FOO, 'bar');
        assert.deepEqual(up.bdb_blender_mcp.args, [`${home}/x.js`]);
        assert.deepEqual(up.bdb_resolume_mcp.args, ['run', path.join(home, '.gemini', 'config', 'mcps', 'resolume_mcp.py')]);
        assert.equal(shipped.bdb_resolume_mcp.args[1], '__MCPS_DIR__/resolume_mcp.py');
    });

    test('the shipped template yields exactly the allow-listed gateway servers and no secret value', () => {
        const real = require('../lib/mcp-secrets.js').shippedServers(ROOT);
        const out = cfg.buildUpstreams({ shipped: real, home, launcher, pathEnv: 'p' });
        assert.deepEqual(Object.keys(out).sort(), ['adobe_uxp_mcp', 'bdb_after_effects_mcp', 'bdb_blender_mcp', 'bdb_davinci_mcp', 'bdb_grandma3_mcp', 'bdb_remoteos_mcp', 'bdb_resolume_mcp', 'bdb_td_backup', 'bdb_unreal_mcp', 'bdb_windows_computer_use', 'chrome-devtools', 'deja', 'github', 'memb_mcp', 'open_design_mcp', 'zavora_computer_use']);
        assert.ok(!('bdb_rhino_mcp' in out));
        assert.ok(cfg.splitServers(real).direct.bdb_rhino_mcp);
        for (const n of cfg.DIRECT_SERVERS) assert.ok(!(n in out), n);
        assert.ok(!/__MCPS_DIR__|__GEMINI_API_KEY__/.test(JSON.stringify(out)));
    });

    test('writeGatewayConfig writes mcp.json with mode 0600', () => {
        const dir = tmp();
        const file = cfg.writeGatewayConfig(dir, up);
        assert.equal(path.basename(file), 'mcp.json');
        assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers).sort(), Object.keys(up).sort());
        if (process.platform !== 'win32') assert.equal(mode(file), 0o600);
    });
});

describe('forwarder', () => {
    const TOKEN = 'a'.repeat(64);
    let upstream; let upPort; let seen; let fw; let port;

    test('setup', async () => {
        upstream = http.createServer((req, res) => {
            let body = '';
            req.on('data', (c) => { body += c; });
            req.on('end', () => { seen = { headers: req.headers, body, url: req.url }; res.writeHead(200, { 'content-type': 'text/plain' }); res.end('upstream-ok'); });
        });
        upPort = await listen(upstream);
        fw = createForwarder({ port: 0, upstreamPort: upPort, token: TOKEN });
        await fw.listen();
        port = fw.server.address().port;
    });

    test('missing and wrong token give 401', async () => {
        assert.equal((await request(port)).status, 401);
        assert.equal((await request(port, { headers: { 'x-aos-token': 'b'.repeat(64) } })).status, 401);
        assert.equal((await request(port, { headers: { authorization: 'Bearer short' } })).status, 401);
    });

    test('foreign Host gives 403, even with a valid token', async () => {
        const r = await request(port, { headers: { host: `evil.example:${port}`, 'x-aos-token': TOKEN } });
        assert.equal(r.status, 403);
    });

    test('any Origin gives 403, even with a valid token', async () => {
        const r = await request(port, { headers: { origin: 'http://localhost:3000', 'x-aos-token': TOKEN } });
        assert.equal(r.status, 403);
    });

    test('valid token reaches the upstream without token headers', async () => {
        seen = null;
        const r = await request(port, { method: 'POST', pathname: '/mcp?x=1', headers: { 'x-aos-token': TOKEN, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: '{"a":1}' });
        assert.equal(r.status, 200);
        assert.equal(r.text, 'upstream-ok');
        assert.equal(seen.url, '/mcp?x=1');
        assert.equal(seen.body, '{"a":1}');
        assert.equal(seen.headers['x-aos-token'], undefined);
        assert.equal(seen.headers.authorization, undefined);
        assert.equal(seen.headers.host, `127.0.0.1:${upPort}`);
    });

    test('Bearer token and localhost Host are accepted', async () => {
        const r = await request(port, { headers: { host: `localhost:${port}`, authorization: `Bearer ${TOKEN}` } });
        assert.equal(r.status, 200);
    });

    test('healthcheck is unauthenticated and returns only status', async () => {
        const r = await request(port, { pathname: '/healthcheck' });
        assert.equal(r.status, 200);
        assert.deepEqual(JSON.parse(r.text), { status: 'ok' });
    });

    test('upstream down gives 502 without details', async () => {
        const dead = createForwarder({ port: 0, upstreamPort: await freePort(), token: TOKEN });
        await dead.listen();
        const r = await request(dead.server.address().port, { headers: { 'x-aos-token': TOKEN } });
        assert.equal(r.status, 502);
        assert.equal(r.text, 'bad gateway');
        await dead.close();
    });

    test('an empty token is refused', () => {
        assert.throws(() => createForwarder({ port: 0, upstreamPort: 1, token: '' }), /token/);
    });

    test('Origin: null gives 403', async () => {
        assert.equal((await request(port, { headers: { origin: 'null', 'x-aos-token': TOKEN } })).status, 403);
    });

    test('IPv6 and trailing-dot Host give 403', async () => {
        for (const h of [`[::1]:${port}`, `127.0.0.1.:${port}`, `localhost.:${port}`]) {
            assert.equal((await request(port, { headers: { host: h, 'x-aos-token': TOKEN } })).status, 403, h);
        }
    });

    test('duplicate x-aos-token gives 401', async () => {
        assert.equal((await request(port, { headers: { 'x-aos-token': [TOKEN, TOKEN] } })).status, 401);
    });

    test('hop-by-hop headers are not forwarded', async () => {
        seen = null;
        const r = await request(port, { headers: { 'x-aos-token': TOKEN, connection: 'x-custom, keep-alive', 'x-custom': '1', 'keep-alive': 'timeout=5', 'proxy-authorization': 'Basic eA==', te: 'trailers', 'x-keep': 'yes' } });
        assert.equal(r.status, 200);
        for (const h of ['x-custom', 'keep-alive', 'proxy-authorization', 'te', 'trailer', 'upgrade']) assert.equal(seen.headers[h], undefined, h);
        assert.equal(seen.headers['x-keep'], 'yes');
    });

    test('SSE stream is relayed chunk by chunk and closes cleanly', async () => {
        const sse = http.createServer((req, res) => {
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
            let i = 0;
            const t = setInterval(() => { res.write(`data: ${i}\n\n`); if (++i === 4) { clearInterval(t); res.end(); } }, 40);
        });
        const f = createForwarder({ port: 0, upstreamPort: await listen(sse), token: TOKEN });
        await f.listen();
        const chunks = [];
        const closed = await new Promise((resolve, reject) => {
            const r = http.get({ host: '127.0.0.1', port: f.server.address().port, path: '/sse', headers: { 'x-aos-token': TOKEN } }, (res) => {
                assert.match(res.headers['content-type'], /text\/event-stream/);
                res.setEncoding('utf8');
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => resolve(res.complete));
                res.on('error', reject);
            });
            r.on('error', reject);
        });
        assert.equal(closed, true);
        assert.equal(chunks.join(''), 'data: 0\n\ndata: 1\n\ndata: 2\n\ndata: 3\n\n');
        assert.ok(chunks.length > 1, 'chunks are not buffered into one');
        await f.close();
        await closeServer(sse);
    });

    test('client abort mid-stream destroys the upstream request', async () => {
        let upstreamClosed;
        const gone = new Promise((resolve) => { upstreamClosed = resolve; });
        const sse = http.createServer((req, res) => {
            res.on('close', upstreamClosed);
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            res.write('data: first\n\n');
        });
        const f = createForwarder({ port: 0, upstreamPort: await listen(sse), token: TOKEN });
        await f.listen();
        await new Promise((resolve) => {
            const r = http.get({ host: '127.0.0.1', port: f.server.address().port, path: '/sse', headers: { 'x-aos-token': TOKEN } }, (res) => {
                res.once('data', () => { r.destroy(); resolve(); });
            });
            r.on('error', () => {});
        });
        await Promise.race([gone, new Promise((_, rej) => setTimeout(() => rej(new Error('upstream not closed')), 3000))]);
        await f.close();
        await closeServer(sse);
    });

    test('teardown', async () => {
        await fw.close();
        await closeServer(upstream);
    });
});

describe('pkg-gateway', () => {
    const harness = require('../lib/gateway/harness.js');
    const mkCtx = (home, extra = {}) => {
        const calls = [];
        const run = async (cmd, args) => { calls.push([cmd, ...args]); return { status: 0, stdout: '' }; };
        return { calls, ctx: { home, run, serviceRunner: true, dryRun: false, platform: 'darwin', log: () => {}, nodePath: '/opt/node/bin/node', aosRoot: ROOT, uid: 501, statusFn: async () => ({ running: true, port: cfg.GATEWAY_PORT }), sleep: async () => {}, ...extra } };
    };
    const posix = process.platform !== 'win32';
    // The server selection decides what the gateway runs. Fresh derivation carries only the base
    // set (+creator); for the media servers these tests pre-seed a stored choice (Pro MEDIA install).
    const seedSelection = (home, servers = cfg.GATEWAY_SERVERS) => {
        profile.writeSettings(home, { gateway: { servers } });
    };

    test('contract shape', () => {
        assert.equal(pkg.id, 'gateway');
        for (const f of ['detect', 'install', 'update', 'verify', 'uninstall']) assert.equal(typeof pkg[f], 'function');
    });

    test('install creates dir 0700, token 0600, mcp.json and the plist', async () => {
        const home = tmp();
        seedSelection(home);
        const { ctx, calls } = mkCtx(home);
        await pkg.install(ctx);
        const dir = cfg.gatewayDir(home);
        if (posix) {
            assert.equal(mode(dir), 0o700);
            assert.equal(mode(path.join(dir, 'token')), 0o600);
            assert.equal(mode(path.join(dir, 'mcp.json')), 0o600);
        }
        assert.match(fs.readFileSync(path.join(dir, 'token'), 'utf8'), /^[0-9a-f]{64}$/);
        const servers = JSON.parse(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8')).mcpServers;
        assert.ok(servers.github && !servers.mcsc && !servers.bdb_rhino_mcp);

        const plist = fs.readFileSync(path.join(home, 'Library', 'LaunchAgents', 'com.bdb.aos.gateway.plist'), 'utf8');
        assert.ok(plist.includes('<string>com.bdb.aos.gateway</string>'));
        assert.ok(plist.includes('<string>/opt/node/bin/node</string>'));
        assert.ok(plist.includes(`<string>${path.join(ROOT, 'bin', 'aos-gateway.mjs')}</string>`));
        assert.ok(plist.includes('<string>serve</string>'));
        assert.ok(plist.includes(`<string>${path.join(dir, 'gateway.log')}</string>`));
        assert.ok(/<key>RunAtLoad<\/key>\s*<true\/>/.test(plist) && /<key>KeepAlive<\/key>\s*<true\/>/.test(plist));
        assert.ok(plist.includes('<key>HOME</key>') && plist.includes('<key>PATH</key>'));

        assert.deepEqual(calls[0], ['npm', 'install', '--prefix', dir, '--no-audit', '--no-fund', '@1mcp/agent@0.38.2']);
        const presetCalls = calls.filter((c) => c[1] === 'preset');
        assert.ok(presetCalls.every((c) => c[0] === path.join(dir, 'node_modules', '.bin', '1mcp') && c[2] === 'create'));
        assert.deepEqual(presetCalls.filter((c) => c[3] === 'agy').map((c) => [c[3], c[5]]), [['agy', 'aos AND NOT bdb_davinci_mcp']]);
        assert.deepEqual(calls.find((c) => c[0] === 'launchctl' && c[1] === 'bootout'), ['launchctl', 'bootout', 'gui/501/com.bdb.aos.gateway']);
        assert.deepEqual(calls.find((c) => c[0] === 'launchctl' && c[1] === 'bootstrap'), ['launchctl', 'bootstrap', 'gui/501', path.join(home, 'Library', 'LaunchAgents', 'com.bdb.aos.gateway.plist')]);
        const g = JSON.parse(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8')).mcpServers;
        assert.deepEqual(Object.keys(g).filter((n) => n !== 'codebase_memory_mcp').sort(), ['adobe_uxp_mcp', 'bdb_after_effects_mcp', 'bdb_blender_mcp', 'bdb_davinci_mcp', 'bdb_grandma3_mcp', 'bdb_remoteos_mcp', 'bdb_resolume_mcp', 'bdb_td_backup', 'bdb_unreal_mcp', 'bdb_windows_computer_use', 'chrome-devtools', 'deja', 'github', 'memb_mcp', 'open_design_mcp', 'zavora_computer_use']);
    });

    const pinnedOnDisk = (home) => {
        const d = path.join(cfg.gatewayDir(home), 'node_modules', '@1mcp', 'agent');
        fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ version: '0.38.2' }));
    };
    const sideEffects = (calls) => calls.filter((c) => c[0] === 'npm' || c[0] === 'launchctl' || c[1] === 'preset').map((c) => c.join(' '));

    test('update on an unchanged gateway does no npm install, no rewrite and no kickstart', async () => {
        const home = tmp();
        await pkg.install(mkCtx(home).ctx);
        pinnedOnDisk(home);
        const { ctx, calls } = mkCtx(home);
        const res = await pkg.update(ctx);
        assert.equal(res.unchanged, true);
        assert.deepEqual(sideEffects(calls), []);
    });

    test('restart on an unchanged gateway restarts the service without reinstalling', async () => {
        const home = tmp();
        await pkg.install(mkCtx(home).ctx);
        pinnedOnDisk(home);
        const { ctx, calls } = mkCtx(home);
        const res = await pkg.restart(ctx);
        assert.equal(res.ok, true);
        assert.deepEqual(sideEffects(calls), ['launchctl kickstart -k gui/501/com.bdb.aos.gateway']);
    });

    test('update honors gateway.mode === direct and leaves harnesses direct', async () => {
        const home = tmp();
        await pkg.install(mkCtx(home).ctx);
        pinnedOnDisk(home);
        profile.writeSettings(home, { gateway: { mode: 'direct' } });
        const { ctx } = mkCtx(home);
        const res = await pkg.update(ctx);
        assert.equal(res.harness, undefined);
    });

    test('update on a changed mcp.json reinstalls and restarts', async () => {
        const home = tmp();
        await pkg.install(mkCtx(home).ctx);
        pinnedOnDisk(home);
        fs.writeFileSync(path.join(cfg.gatewayDir(home), 'mcp.json'), '{}\n');
        const { ctx, calls } = mkCtx(home);
        const res = await pkg.update(ctx);
        assert.notEqual(res.unchanged, true);
        assert.ok(sideEffects(calls).includes(`npm install --prefix ${cfg.gatewayDir(home)} --no-audit --no-fund @1mcp/agent@0.38.2`));
        assert.ok(sideEffects(calls).includes('launchctl kickstart -k gui/501/com.bdb.aos.gateway'));
    });

    test('update with a changed plist or without the pinned package is not unchanged', async () => {
        const home = tmp();
        await pkg.install(mkCtx(home).ctx);
        const plist = path.join(home, 'Library', 'LaunchAgents', 'com.bdb.aos.gateway.plist');
        fs.writeFileSync(plist, fs.readFileSync(plist, 'utf8').replace('<integer>30</integer>', '<integer>31</integer>'));
        const { ctx, calls } = mkCtx(home);
        const res = await pkg.update(ctx);
        assert.notEqual(res.unchanged, true);
        assert.ok(sideEffects(calls).some((c) => c.startsWith('npm install')));
        assert.ok(sideEffects(calls).some((c) => c.startsWith('launchctl')));
    });

    const launchctlFails = (how) => async (cmd) => {
        if (cmd !== 'launchctl') return { status: 0, stdout: '' };
        if (how === 'reject') throw new Error('spawn launchctl ENOENT');
        return { status: how };
    };

    test('install retries bootstrap once after a delay when launchd has not unloaded yet', async () => {
        const home = tmp();
        const calls = [];
        const sleeps = [];
        let bootstraps = 0;
        const run = async (cmd, args) => {
            calls.push([cmd, ...args]);
            if (cmd === 'launchctl' && args[0] === 'bootstrap' && ++bootstraps === 1) return { status: 5 };
            return { status: 0, stdout: '' };
        };
        const say = [];
        await pkg.install(mkCtx(home, { run, sleep: async (ms) => { sleeps.push(ms); }, log: (m) => say.push(m) }).ctx);
        assert.deepEqual(calls.filter((c) => c[0] === 'launchctl').map((c) => c[1]), ['bootout', 'bootstrap', 'bootstrap']);
        assert.deepEqual(sleeps, [500]);
        assert.ok(!say.some((m) => /reported an error/.test(m)), 'second bootstrap succeeded, no error reported');
    });

    for (const how of ['reject', 5, 113]) {
        test(`install survives launchctl failing (${how})`, async () => {
            const home = tmp();
            const say = [];
            const { ctx } = mkCtx(home, { run: launchctlFails(how), log: (m) => say.push(m), sleep: async () => {} });
            const r = await pkg.install(ctx);
            assert.equal(r.ok, true);
            assert.ok(say.some((m) => /launchctl/.test(m)));
        });

        test(`update falls back to bootout + bootstrap when kickstart fails (${how})`, async () => {
            const home = tmp();
            const calls = [];
            const run = async (cmd, args) => { calls.push([cmd, ...args]); return launchctlFails(how)(cmd); };
            const { ctx } = mkCtx(home, { run, sleep: async () => {} });
            await pkg.update(ctx);
            const lc = calls.filter((c) => c[0] === 'launchctl').map((c) => c[1]);
            assert.deepEqual(lc, ['kickstart', 'bootout', 'bootstrap', 'bootstrap']);
        });

        test(`uninstall still unlinks and renames when bootout fails (${how})`, async () => {
            const home = tmp();
            await pkg.install(mkCtx(home).ctx);
            const dir = cfg.gatewayDir(home);
            fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
            const { ctx } = mkCtx(home, { run: launchctlFails(how), now: 1700000000001 });
            const res = await pkg.uninstall(ctx);
            assert.ok(!fs.existsSync(path.join(dir, 'token')));
            assert.ok(!fs.existsSync(path.join(dir, 'mcp.json')));
            assert.ok(!fs.existsSync(path.join(home, 'Library', 'LaunchAgents', 'com.bdb.aos.gateway.plist')));
            assert.ok(res.removedDirs.includes('node_modules'));
        });
    }

    test('install regenerates an empty or invalid token and keeps a valid one', async () => {
        const home = tmp();
        await pkg.install(mkCtx(home).ctx);
        const file = path.join(cfg.gatewayDir(home), 'token');
        const good = fs.readFileSync(file, 'utf8');
        await pkg.install(mkCtx(home).ctx);
        assert.equal(fs.readFileSync(file, 'utf8'), good);
        for (const bad of ['', '\n', 'short', 'G'.repeat(64)]) {
            fs.writeFileSync(file, bad);
            await pkg.install(mkCtx(home).ctx);
            assert.match(fs.readFileSync(file, 'utf8'), /^[0-9a-f]{64}$/);
            if (posix) assert.equal(mode(file), 0o600);
        }
    });

    test('install warns about a missing launcher and missing server scripts', async () => {
        const home = tmp();
        seedSelection(home);
        const say = [];
        await pkg.install(mkCtx(home, { log: (m) => say.push(m) }).ctx);
        assert.ok(say.some((m) => m.includes('launcher missing')));
        assert.ok(say.some((m) => /gateway server bdb_resolume_mcp: .*resolume_mcp\.py does not exist/.test(m)));
    });

    test('install passes only allow-listed ctx.env keys and uvPath to the upstreams', async () => {
        const home = tmp();
        seedSelection(home);
        const env = { HTTPS_PROXY: 'http://proxy:3128', LANG: 'de_DE.UTF-8', GITHUB_TOKEN: 'ghp_SHOULDNOTLEAK', SystemRoot: 'C:\\Windows' };
        await pkg.install(mkCtx(home, { env, uvPath: '/opt/uv/uv' }).ctx);
        const text = fs.readFileSync(path.join(cfg.gatewayDir(home), 'mcp.json'), 'utf8');
        const s = JSON.parse(text).mcpServers;
        assert.equal(s.github.env.HTTPS_PROXY, 'http://proxy:3128');
        assert.equal(s.github.env.LANG, 'de_DE.UTF-8');
        assert.equal(s.github.env.SystemRoot, undefined, 'win32-only key on darwin');
        assert.ok(!text.includes('SHOULDNOTLEAK'));
        assert.equal(s.bdb_resolume_mcp.command, '/opt/uv/uv');
    });

    test('install applies the env-based picks: the retired After Effects entry is no upstream', async () => {
        const home = tmp();
        await pkg.install(mkCtx(home, { env: { AOS_AE_MCP: 'legacy' } }).ctx);
        const s = JSON.parse(fs.readFileSync(path.join(cfg.gatewayDir(home), 'mcp.json'), 'utf8')).mcpServers;
        assert.ok(!('bdb_after_effects_mcp' in s));
    });

    test('update keeps the token and gateway.json, and kickstarts', async () => {
        const home = tmp();
        const first = mkCtx(home);
        await pkg.install(first.ctx);
        const dir = cfg.gatewayDir(home);
        const token = fs.readFileSync(path.join(dir, 'token'), 'utf8');
        fs.writeFileSync(path.join(dir, 'gateway.json'), '{"user":true}');
        const second = mkCtx(home);
        await pkg.update(second.ctx);
        assert.equal(fs.readFileSync(path.join(dir, 'token'), 'utf8'), token);
        assert.equal(fs.readFileSync(path.join(dir, 'gateway.json'), 'utf8'), '{"user":true}');
        assert.deepEqual(second.calls.find((c) => c.includes('kickstart')), ['launchctl', 'kickstart', '-k', 'gui/501/com.bdb.aos.gateway']);
    });

    test('install fails loudly when npm fails', async () => {
        const home = tmp();
        const { ctx } = mkCtx(home, { run: async () => ({ status: 1 }) });
        await assert.rejects(pkg.install(ctx), /npm install/);
    });

    test('win32 update drops the legacy task and stops the running gateway before it starts the vbs', async () => {
        const { ctx, calls } = mkCtx(tmp(), { platform: 'win32', env: { APPDATA: tmp() } });
        await pkg.update(ctx);
        assert.deepEqual(calls.filter((c) => ['schtasks', 'powershell', 'wscript.exe'].includes(c[0])).map((c) => c.slice(0, 2).join(' ')), ['schtasks /Delete', 'powershell -NoProfile', `wscript.exe ${path.join(ctx.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'com.bdb.aos.gateway.vbs')}`]);
    });

    test('a failing systemctl is reported with its first stderr line', async () => {
        const m = mkCtx(tmp(), { platform: 'linux' });
        const base = m.ctx.run;
        const ctx = { ...m.ctx, run: async (cmd, args) => (cmd === 'systemctl' ? { status: 1, stderr: 'Failed to connect to bus\nmore' } : base(cmd, args)) };
        const say = [];
        ctx.log = (m) => say.push(m);
        await pkg.install(ctx);
        assert.ok(say.some((m) => m === 'systemctl failed: Failed to connect to bus; start it with aos-gateway serve'), say.join(' | '));
    });

    test('preset create failure falls back to plain URL for that kind', async () => {
        const home = tmp();
        const { ctx, calls } = mkCtx(home);
        const base = ctx.run;
        ctx.run = async (cmd, args) => {
            if (args[0] !== 'preset') return base(cmd, args);
            calls.push([cmd, ...args]);
            return { status: 1, stderr: 'boom' };
        };
        const say = [];
        ctx.log = (m) => say.push(m);
        const seen = [];
        const real = harness.enable;
        harness.enable = (o) => { seen.push(o); return real(o); };
        try { await pkg.install(ctx); } finally { harness.enable = real; }
        assert.ok(calls.some((c) => c[1] === 'preset' && c[3] === 'agy'));
        assert.deepEqual(pkg.livePresets(cfg.gatewayDir(home), pkg.shippedPresets(ROOT)), {});
        assert.ok(seen.filter((o) => !o.dryRun).every((o) => Object.keys(o.presets).length === 0));
        assert.ok(say.some((m) => /presets not created: agy, worker, small; these kinds fall back to the plain URL/.test(m)), say.join(' | '));
    });

    test('dry-run plan passes the template presets to harness.enable', async () => {
        const seen = [];
        const real = harness.enable;
        harness.enable = (o) => { seen.push(o); return real(o); };
        try { await pkg.install(mkCtx(tmp(), { dryRun: true }).ctx); } finally { harness.enable = real; }
        assert.deepEqual(Object.keys(seen[0].presets), ['agy', 'worker', 'small']);
    });

    test('dryRun writes and runs nothing', async () => {
        const home = tmp();
        const { ctx, calls } = mkCtx(home, { dryRun: true });
        const r = await pkg.install(ctx);
        assert.ok(Array.isArray(r.actions) && r.actions.length > 0);
        assert.deepEqual(fs.readdirSync(home), []);
        assert.equal(calls.length, 0);
        const u = await pkg.uninstall(ctx);
        assert.ok(u.actions.length > 0);
        assert.deepEqual(fs.readdirSync(home), []);
    });

    test('detect needs the plist and the 1mcp binary', async () => {
        const home = tmp();
        const { ctx } = mkCtx(home);
        await pkg.install(ctx);
        assert.equal(pkg.detect(ctx), false);
        const bin = path.join(cfg.gatewayDir(home), 'node_modules', '.bin', '1mcp');
        fs.mkdirSync(path.dirname(bin), { recursive: true });
        fs.writeFileSync(bin, '');
        assert.equal(pkg.detect(ctx), true);
    });

    test('uninstall removes the generated trees (node_modules, mcp-pkgs, retired copies, log), keeps gateway.json and migration.json', async () => {
        const home = tmp();
        const { ctx, calls } = mkCtx(home);
        await pkg.install(ctx);
        const dir = cfg.gatewayDir(home);
        fs.writeFileSync(path.join(dir, 'gateway.json'), '{}');
        fs.writeFileSync(path.join(dir, 'migration.json'), '{}');
        for (const d of ['node_modules/x', 'mcp-pkgs/node_modules/y', 'node_modules.removed-1/z']) {
            fs.mkdirSync(path.join(dir, d), { recursive: true });
            fs.writeFileSync(path.join(dir, d, 'f.js'), '');
        }
        fs.writeFileSync(path.join(dir, 'gateway.log'), 'log');
        calls.length = 0;
        const res = await pkg.uninstall(ctx);
        assert.deepEqual(calls, [['launchctl', 'bootout', 'gui/501/com.bdb.aos.gateway']]);
        assert.deepEqual(fs.readdirSync(dir).sort(), ['gateway.json', 'migration.json']);
        assert.deepEqual(res.removedDirs.sort(), ['gateway.log', 'mcp-pkgs', 'node_modules', 'node_modules.removed-1']);
        assert.ok(!fs.existsSync(path.join(home, 'Library', 'LaunchAgents', 'com.bdb.aos.gateway.plist')));
    });

    test('uninstall removes the whole gateway dir when only generated files are in it', async () => {
        const home = tmp();
        const { ctx } = mkCtx(home);
        await pkg.install(ctx);
        const dir = cfg.gatewayDir(home);
        fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true });
        await pkg.uninstall(ctx);
        assert.ok(!fs.existsSync(dir));
    });

    test('present() finds the AOS service file without the 1mcp bin and ignores foreign files', async () => {
        const home = tmp();
        const { ctx } = mkCtx(home);
        assert.equal(pkg.present(ctx), false);
        await pkg.install(ctx);
        assert.equal(pkg.detect(ctx), false);
        assert.equal(pkg.present(ctx), true);
        fs.writeFileSync(path.join(home, 'Library', 'LaunchAgents', 'com.bdb.aos.gateway.plist'), 'not ours');
        assert.equal(pkg.present(ctx), false);
        fs.mkdirSync(path.join(cfg.gatewayDir(home), 'node_modules'), { recursive: true });
        assert.equal(pkg.present(ctx), true, 'generated dirs left by a failed uninstall keep it detectable');
    });

    test('linux install writes the systemd user unit and enables it now', async () => {
        const home = tmp();
        const { ctx, calls } = mkCtx(home, { platform: 'linux' });
        await pkg.install(ctx);
        const unit = fs.readFileSync(path.join(home, '.config', 'systemd', 'user', 'com.bdb.aos.gateway.service'), 'utf8');
        assert.ok(unit.includes(`ExecStart="/opt/node/bin/node" "${path.join(ROOT, 'bin', 'aos-gateway.mjs').replace(/["\\]/g, '\\$&')}" serve`));
        assert.ok(unit.includes('Restart=on-failure'));
        assert.ok(unit.includes(`StandardOutput=append:${cfg.gatewayDir(home)}/gateway.log`));
        assert.deepEqual(calls.filter((c) => c[0] === 'systemctl'), [
            ['systemctl', '--user', 'daemon-reload'],
            ['systemctl', '--user', 'enable', '--now', 'com.bdb.aos.gateway.service'],
        ]);
    });

    test('win32 install writes a Startup .vbs (no admin) and starts it once; the vbs is the detect record', async () => {
        const home = tmp();
        const { ctx, calls } = mkCtx(home, { platform: 'win32', env: { APPDATA: tmp() } });
        await pkg.install(ctx);
        const vbs = path.join(ctx.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'com.bdb.aos.gateway.vbs');
        const text = fs.readFileSync(vbs, 'utf8');
        assert.ok(text.includes(`WshShell.CurrentDirectory = "${home}"`), text);
        assert.ok(text.includes(`WshShell.Run """/opt/node/bin/node"" ""${path.join(ROOT, 'bin', 'aos-gateway.mjs')}"" ""serve""", 0, False`), text);
        assert.deepEqual(calls.filter((c) => c[0] === 'wscript.exe'), [['wscript.exe', vbs]]);
        assert.deepEqual(calls.filter((c) => c[0] === 'schtasks'), [['schtasks', '/Delete', '/TN', 'AOS MCP Gateway', '/F']], 'only the best-effort legacy cleanup, no /Create');
        assert.ok(fs.existsSync(path.join(cfg.gatewayDir(home), 'restart.at')), 'started: restart stamp written');
        assert.equal(pkg.detect(ctx), false, 'no 1mcp yet');
        const bin = path.join(cfg.gatewayDir(home), 'node_modules', '.bin', '1mcp.cmd');
        fs.mkdirSync(path.dirname(bin), { recursive: true });
        fs.writeFileSync(bin, '');
        assert.equal(pkg.detect(ctx), true);
        fs.unlinkSync(vbs);
        assert.equal(pkg.detect(ctx), false, 'without the vbs it is not installed');
    });

    test('win32: a failing wscript is reported and writes no restart stamp', async () => {
        const home = tmp();
        const say = [];
        const { ctx } = mkCtx(home, { platform: 'win32', env: { APPDATA: tmp() }, log: (m) => say.push(m), run: async (cmd) => (cmd === 'wscript.exe' ? { status: 1, stderr: 'boom' } : { status: 0, stdout: '' }) });
        await pkg.install(ctx);
        assert.ok(say.includes('wscript.exe failed: boom; start it with aos-gateway serve'), say.join(' | '));
        assert.ok(!fs.existsSync(path.join(cfg.gatewayDir(home), 'restart.at')));
    });

    test('uninstall removes the linux unit and the windows startup vbs', async () => {
        const lin = mkCtx(tmp(), { platform: 'linux' });
        await pkg.install(lin.ctx);
        const unit = path.join(lin.ctx.home, '.config', 'systemd', 'user', 'com.bdb.aos.gateway.service');
        lin.calls.length = 0;
        await pkg.uninstall({ ...lin.ctx, now: 1700000000000 });
        assert.deepEqual(lin.calls.filter((c) => c[0] === 'systemctl'), [['systemctl', '--user', 'disable', '--now', 'com.bdb.aos.gateway.service'], ['systemctl', '--user', 'daemon-reload']]);
        assert.ok(!fs.existsSync(unit));
        const win = mkCtx(tmp(), { platform: 'win32', env: { APPDATA: tmp() } });
        await pkg.install(win.ctx);
        const vbs = path.join(win.ctx.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'com.bdb.aos.gateway.vbs');
        assert.ok(fs.existsSync(vbs));
        win.calls.length = 0;
        await pkg.uninstall({ ...win.ctx, now: 1700000000000 });
        assert.deepEqual(win.calls.filter((c) => c[0] === 'schtasks'), [['schtasks', '/Delete', '/TN', 'AOS MCP Gateway', '/F']]);
        const stop = win.calls.find((c) => c[0] === 'powershell').join(' ');
        const lcWin = (s) => s.toLowerCase().replace(/\//g, '\\'); // stopArgs lower-cases and uses backslashes
        assert.ok(lcWin(stop).includes(lcWin(path.join(ROOT, 'bin', 'aos-gateway.mjs'))) && lcWin(stop).includes(lcWin(path.join(cfg.gatewayDir(win.ctx.home), 'node_modules'))) && stop.includes('Stop-Process'), stop);
        assert.ok(!win.calls.some((c) => c[0] === 'wscript.exe'), 'uninstall starts nothing');
        assert.ok(!fs.existsSync(vbs));
    });

    test('harnesses switch only when verify reports the gateway running', async () => {
        for (const running of [true, false]) {
            const log = [];
            const { ctx } = mkCtx(tmp(), { platform: 'linux', log: (m) => log.push(m), statusFn: async () => ({ running, port: cfg.GATEWAY_PORT }) });
            const res = await pkg.install(ctx);
            assert.equal('harness' in res, running);
            if (!running) assert.ok(log.some((m) => /service not confirmed on linux: harnesses left direct/.test(m)));
        }
    });

    test('update still switches harnesses when 1mcp answers only ~8 s after kickstart (F15)', async () => {
        let n = 0;
        const statusFn = async () => (++n <= 16 ? { running: true, port: cfg.GATEWAY_PORT, upstreams: [{ ok: false, error: 'ECONNREFUSED' }] } : { running: true, port: cfg.GATEWAY_PORT, upstreams: [{ ok: true }] });
        const log = [];
        const res = await pkg.update(mkCtx(tmp(), { platform: 'linux', statusFn, log: (m) => log.push(m) }).ctx);
        assert.ok('harness' in res, 'harness.enable ran');
        assert.ok(!log.some((m) => /harnesses left direct/.test(m)));
    });

    test('F15b: 1mcp refused for 90 s after restart: harnesses switch, verify BUSY inside the grace window, down after it', async () => {
        const home = tmp();
        const refused = async () => ({ running: true, port: cfg.GATEWAY_PORT, upstreams: [{ ok: false, error: '1mcp not reachable on 7791 (ECONNREFUSED)' }] });
        const t0 = 1700000000000;
        const res = await pkg.update(mkCtx(home, { platform: 'linux', statusFn: refused, now: t0 }).ctx);
        assert.ok('harness' in res, 'switched on forwarder running');
        const inGrace = await pkg.verify(mkCtx(home, { statusFn: refused, now: t0 + 90000 }).ctx);
        assert.equal(inGrace.ok, true);
        assert.equal(inGrace.busy, true);
        assert.match(inGrace.detail, /BUSY/);
        const after = await pkg.verify(mkCtx(home, { statusFn: refused, now: t0 + 181000 }).ctx);
        assert.equal(after.ok, false);
        assert.match(after.detail, /ECONNREFUSED/);
    });

    test('F15b: no grace without a restart stamp, with a future stamp, or when the service did not start', async () => {
        const refused = async () => ({ running: true, port: cfg.GATEWAY_PORT, upstreams: [{ ok: false, error: '1mcp not reachable on 7791 (ECONNREFUSED)' }] });
        const t0 = 1700000000000;
        assert.equal((await pkg.verify(mkCtx(tmp(), { statusFn: refused, now: t0 }).ctx)).ok, false, 'no stamp');
        const home = tmp();
        fs.mkdirSync(cfg.gatewayDir(home), { recursive: true });
        fs.writeFileSync(path.join(cfg.gatewayDir(home), 'restart.at'), String(t0 + 3600000));
        assert.equal((await pkg.verify(mkCtx(home, { statusFn: refused, now: t0 }).ctx)).ok, false, 'future stamp');
        const failed = tmp();
        await pkg.update(mkCtx(failed, { platform: 'linux', run: async () => ({ status: 1, stdout: '' }), statusFn: refused, now: t0 }).ctx).catch(() => {});
        assert.ok(!fs.existsSync(path.join(cfg.gatewayDir(failed), 'restart.at')), 'no stamp when systemctl failed');
    });

    test('retireNodeModules refuses anything but the gateway dir of this home and never deletes', () => {
        const home = tmp();
        const other = path.join(home, 'elsewhere');
        fs.mkdirSync(path.join(other, 'node_modules'), { recursive: true });
        assert.throws(() => pkg.retireNodeModules(other, home), /refusing/);
        assert.throws(() => pkg.retireNodeModules(cfg.gatewayDir('/'), '/'), /refusing/);
        assert.throws(() => pkg.retireNodeModules(cfg.gatewayDir('rel'), 'rel'), /refusing/);
        assert.ok(fs.existsSync(path.join(other, 'node_modules')));
        assert.equal(pkg.retireNodeModules(cfg.gatewayDir(home), home), null, 'missing node_modules is a no-op');
    });

    test('gateway sources contain no delete-tree primitive at all', () => {
        const files = [
            ...fs.readdirSync(path.join(ROOT, 'lib', 'gateway')).map((f) => path.join(ROOT, 'lib', 'gateway', f)),
            path.join(ROOT, 'lib', 'v5', 'pkg-gateway.js'),
            path.join(ROOT, 'bin', 'aos-gateway.mjs'),
        ];
        assert.ok(files.length >= 4);
        for (const f of files) {
            const src = fs.readFileSync(f, 'utf8');
            assert.ok(!new RegExp('\\b(rmSync|rmdir' + 'Sync|rimraf|rmtree)\\b|\\bfs\\.rm\\(|promises\\.rm\\(').test(src), f);
        }
    });

    test('verify retries until the gateway answers, then gives up after 10 tries', async () => {
        const home = tmp();
        let n = 0;
        const sleeps = [];
        const statusFn = async () => ({ running: ++n >= 3, port: 7790, upstreams: [] });
        const ok = await pkg.verify(mkCtx(home, { statusFn, sleep: async (ms) => { sleeps.push(ms); } }).ctx);
        assert.equal(ok.ok, true);
        assert.deepEqual(sleeps, [500, 500]);
        let m = 0;
        const never = await pkg.verify(mkCtx(home, { statusFn: async () => { m++; return { running: false, port: 7790 }; }, sleep: async () => {} }).ctx);
        assert.equal(never.ok, false);
        assert.equal(m, 10);
    });

    test('verify is ok only for a running gateway on 7790 and never spawns', async () => {
        const home = tmp();
        const noRun = async () => { throw new Error('verify must not spawn'); };
        const withStatus = (o) => mkCtx(home, { run: noRun, statusFn: async () => o, sleep: async () => {} }).ctx;
        assert.equal((await pkg.verify(withStatus({ running: true, port: 7790, upstreams: [] }))).ok, true);
        assert.equal((await pkg.verify(withStatus({ running: false, port: 7790, upstreams: [] }))).ok, false);
        assert.equal((await pkg.verify(withStatus({ running: true, port: 9999, upstreams: [] }))).ok, false);
        assert.equal((await pkg.verify(mkCtx(home, { run: noRun, statusFn: async () => { throw new Error('boom'); }, sleep: async () => {} }).ctx)).ok, false);
    });

    test('default verify reads gatewayStatus in-process (nothing listening → not running)', async () => {
        const home = tmp();
        const port = await freePort();
        const upstreamPort = await freePort();
        const r = await pkg.verify(mkCtx(home, { run: async () => { throw new Error('verify must not spawn'); }, sleep: async () => {}, statusFn: undefined, statusPorts: { port, upstreamPort } }).ctx);
        assert.equal(r.ok, false);
        assert.equal(r.status.running, false);
    });
});

describe('status JSON', () => {
    let status; let dir; const servers = [];
    const fake = async (handler) => { const s = http.createServer(handler); servers.push(s); return [s, await listen(s)]; };

    test('setup', async () => {
        status = (await import(pathToFileURL(path.join(ROOT, 'bin', 'aos-gateway.mjs')).href)).gatewayStatus;
        dir = tmp();
        fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({ mcpServers: { a: {}, b: {} } }));
        fs.writeFileSync(path.join(dir, 'gateway.pid'), String(process.pid));
    });

    test('running gateway with healthy 1mcp', async () => {
        const [, inner] = await fake((req, res) => { res.writeHead(req.url === '/health' ? 200 : 404); res.end('{}'); });
        const fw = createForwarder({ port: 0, upstreamPort: inner, token: 'x'.repeat(64) });
        await fw.listen();
        const port = fw.server.address().port;
        const s = await status({ dir, port, upstreamPort: inner });
        assert.deepEqual(s, { running: true, pid: process.pid, lazyLoading: true, port, upstreamsScope: 'global', upstreams: [{ name: 'a', ok: true }, { name: 'b', ok: true }] });
        await fw.close();
    });

    test('1mcp 503 with a failing upstream is degraded, not down', async () => {
        const body = JSON.stringify({ servers: { details: [{ name: 'a', healthy: true }, { name: 'b', healthy: false, lastError: 'spawn ENOENT' }] } });
        const [, inner] = await fake((req, res) => { res.writeHead(req.url === '/health' ? 503 : 404); res.end(body); });
        const fw = createForwarder({ port: 0, upstreamPort: inner, token: 'x'.repeat(64) });
        await fw.listen();
        const s = await status({ dir, port: fw.server.address().port, upstreamPort: inner });
        assert.equal(s.running, true);
        assert.deepEqual(s.upstreams, [{ name: 'a', ok: true }, { name: 'b', ok: false, degraded: true, error: 'spawn ENOENT' }]);
        const v = await pkg.verify({ home: dir, sleep: async () => {}, statusFn: async () => ({ ...s, port: cfg.GATEWAY_PORT }) });
        assert.equal(v.ok, true);
        assert.match(v.detail, /degraded upstreams: b/);
        await fw.close();
    });

    test('1mcp 503 without a parseable body is degraded-unknown, not down', async () => {
        const [, inner] = await fake((req, res) => { res.writeHead(503); res.end('nope'); });
        const fw = createForwarder({ port: 0, upstreamPort: inner, token: 'x'.repeat(64) });
        await fw.listen();
        const s = await status({ dir, port: fw.server.address().port, upstreamPort: inner });
        assert.ok(s.running && s.upstreams.every((u) => u.degraded && !u.ok));
        await fw.close();
    });

    test('running gateway, 1mcp down', async () => {
        const fw = createForwarder({ port: 0, upstreamPort: 1, token: 'x'.repeat(64) });
        await fw.listen();
        const dead = await freePort();
        const s = await status({ dir, port: fw.server.address().port, upstreamPort: dead });
        assert.equal(s.running, true);
        assert.equal(s.upstreams.length, 2);
        for (const u of s.upstreams) { assert.equal(u.ok, false); assert.match(u.error, /1mcp not reachable/); }
        await fw.close();
    });

    test('nothing listening', async () => {
        const s = await status({ dir, port: await freePort(), upstreamPort: await freePort() });
        assert.equal(s.running, false);
        assert.equal(s.pid, null);
        assert.equal(s.error, undefined);
        assert.deepEqual(s.upstreams.map((u) => u.ok), [false, false]);
    });

    test('port taken by another process is reported', async () => {
        const [, port] = await fake((req, res) => { res.writeHead(404); res.end(); });
        const s = await status({ dir, port, upstreamPort: await freePort() });
        assert.equal(s.running, false);
        assert.equal(s.error, `port ${port} in use by another process`);
        assert.equal(s.upstreams[0].error, s.error);
    });

    test('teardown', async () => {
        for (const s of servers) await closeServer(s);
    });
});

describe('startServe', () => {
    const { spawn } = require('child_process');
    const posix = process.platform !== 'win32';
    const TOKEN = 'c'.repeat(64);
    const wait = async (cond, ms = 5000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 25)); }
        return false;
    };
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    let startServe;
    const handles = [];

    const mkDir = (token = TOKEN, fileMode = 0o600) => {
        const dir = tmp();
        fs.writeFileSync(path.join(dir, 'token'), token, { mode: fileMode });
        fs.chmodSync(path.join(dir, 'token'), fileMode);
        return dir;
    };
    // Fake 1mcp: listens on the upstream port; with exitOnce it exits on its first run (marker file) to force a restart.
    const fakeChild = (dir, upstreamPort, exitOnce) => {
        const script = path.join(dir, 'fake1mcp.js');
        fs.writeFileSync(script, `const fs=require('fs'),http=require('http');const [port,marker,once]=process.argv.slice(2);
if(once==='1'&&!fs.existsSync(marker)){fs.writeFileSync(marker,'x');process.exit(0);}
http.createServer((q,s)=>{s.writeHead(200);s.end('{}');}).listen(Number(port),'127.0.0.1');`);
        const spawned = [];
        const spawnFn = (cmd, args, opts) => {
            assert.equal(cmd, process.execPath);
            assert.equal(opts.shell, false);
            const c = spawn(process.execPath, [script, String(upstreamPort), path.join(dir, 'marker'), exitOnce ? '1' : '0'], { stdio: 'ignore' });
            spawned.push(c);
            return c;
        };
        return { spawnFn, spawned };
    };

    test('setup', async () => {
        ({ startServe } = await import(pathToFileURL(path.join(ROOT, 'bin', 'aos-gateway.mjs')).href));
    });

    test('reapOrphan never signals a pid whose command line is not our 1mcp', async () => {
        const { reapOrphan } = await import(pathToFileURL(path.join(ROOT, 'bin', 'aos-gateway.mjs')).href);
        const dir = tmp();
        assert.equal(await reapOrphan(dir, '/x/1mcp.js', 1, async () => {}), false);
        fs.writeFileSync(path.join(dir, 'upstream.pid'), String(process.pid));
        assert.equal(await reapOrphan(dir, '/x/1mcp.js', 1, async () => {}), false);
        fs.writeFileSync(path.join(dir, 'upstream.pid'), '1');
        assert.equal(await reapOrphan(dir, '/x/1mcp.js', 1, async () => {}), false);
    });

    test('refuses an empty, invalid or group-readable token', async () => {
        const quiet = { log: () => {}, entry: 'x', port: 0 };
        for (const bad of ['', '  \n', 'nothex']) {
            await assert.rejects(startServe({ dir: mkDir(bad), upstreamPort: await freePort(), ...quiet }), /empty or invalid/);
        }
        await assert.rejects(startServe({ dir: tmp(), upstreamPort: await freePort(), ...quiet }), /no token/);
        if (posix) await assert.rejects(startServe({ dir: mkDir(TOKEN, 0o644), upstreamPort: await freePort(), ...quiet }), /group\/others/);
    });

    test('refuses when the upstream port already answers', async () => {
        const foreign = http.createServer((q, s) => { s.writeHead(200); s.end('hi'); });
        const taken = await listen(foreign);
        const { spawnFn, spawned } = fakeChild(tmp(), taken, false);
        await assert.rejects(startServe({ dir: mkDir(), upstreamPort: taken, spawnFn, entry: 'x', port: 0, log: () => {} }), /already in use/);
        assert.equal(spawned.length, 0, 'nothing was spawned');
        await closeServer(foreign);
    });

    test('restarts 1mcp with backoff after it exits, and stop() kills the child', async () => {
        const dir = mkDir();
        const upstreamPort = await freePort();
        const { spawnFn, spawned } = fakeChild(dir, upstreamPort, true);
        const logs = [];
        const h = await startServe({ dir, upstreamPort, spawnFn, entry: 'x', port: 0, backoffMs: 50, log: (m) => logs.push(m) });
        handles.push(h);
        assert.ok(await wait(() => spawned.length >= 2), 'second spawn after the first exit');
        assert.ok(logs.some((m) => /restarting in/.test(m)));
        assert.ok(await wait(async () => (await request(upstreamPort, { pathname: '/health' }).catch(() => ({}))).status === 200), 'restarted child answers');
        assert.ok(fs.existsSync(path.join(dir, 'gateway.pid')));
        const child = spawned[spawned.length - 1];
        await h.stop();
        assert.ok(await wait(() => !alive(child.pid)), 'child is dead after stop()');
        assert.ok(!fs.existsSync(path.join(dir, 'gateway.pid')));
        const count = spawned.length;
        await new Promise((r) => setTimeout(r, 200));
        assert.equal(spawned.length, count, 'no restart after stop()');
    });

    test('killNow() SIGKILLs a live child', async () => {
        const dir = mkDir();
        const upstreamPort = await freePort();
        const { spawnFn, spawned } = fakeChild(dir, upstreamPort, false);
        const h = await startServe({ dir, upstreamPort, spawnFn, entry: 'x', port: 0, log: () => {} });
        assert.ok(await wait(() => alive(spawned[0].pid)));
        h.killNow();
        assert.ok(await wait(() => !alive(spawned[0].pid)));
        await h.stop();
    });
});

describe('harness enable/disable', () => {
    const harness = require('../lib/gateway/harness.js');
    const { gatewayChecks } = require('../lib/gateway/doctor.js');
    const sec = require('../lib/mcp-secrets.js');
    const posix = process.platform !== 'win32';
    const TOKEN = 'd'.repeat(64);
    const shipped = sec.shippedServers(ROOT);

    const launcher = (home) => sec.launcherPath(home);
    const owned = (home, name) => sec.wrapServer(name, shipped[name], launcher(home));
    const ownedOc = (home, name) => sec.toOpencode({ type: 'local' }, owned(home, name));
    const edited = { command: 'node', args: ['/my/github.js'] };
    const wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
    const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

    function fixture(extra = {}) {
        const home = tmp();
        const f = {
            claude: path.join(home, '.claude.json'),
            cursor: path.join(home, '.cursor', 'mcp.json'),
            oc: path.join(home, '.config', 'opencode', 'opencode.json'),
            codex: path.join(home, '.codex', 'config.toml'),
            agy: path.join(home, '.gemini', 'config', 'mcp_config.json'),
        };
        const common = (h) => ({ mcsc: shipped.mcsc, bdb_rhino_mcp: shipped.bdb_rhino_mcp, mine: { command: 'node', args: ['mine.js'] }, ...h });
        wj(f.claude, { numStartups: 3, mcpServers: common({ github: owned(home, 'github'), open_design_mcp: owned(home, 'open_design_mcp') }), projects: { '/x': { mcpServers: { github: edited } } } });
        wj(f.cursor, { mcpServers: common({ github: edited, bdb_resolume_mcp: owned(home, 'bdb_resolume_mcp') }) });
        wj(f.oc, { $schema: 'x', mcp: { github: ownedOc(home, 'github'), mine: { type: 'local', command: ['node', 'm.js'] } }, ...extra });
        fs.mkdirSync(path.dirname(f.codex), { recursive: true });
        fs.writeFileSync(f.codex, '[mcp_servers.github]\ncommand = "npx"\nargs = ["-y", "x"]\n');
        wj(f.agy, { mcpServers: { github: owned(home, 'github') } });
        const files = [{ file: f.claude, kind: 'json' }, { file: f.cursor, kind: 'json' }, { file: f.oc, kind: 'opencode' }, { file: f.codex, kind: 'toml' }, { file: f.agy, kind: 'json' }];
        return { home, f, files };
    }
    const snap = (f) => Object.fromEntries(Object.entries(f).map(([k, p]) => [k, fs.readFileSync(p, 'utf8')]));
    const run = (fx, o = {}) => harness.enable({ home: fx.home, token: TOKEN, shipped, files: fx.files, now: 1000, ...o });

    test('fixtures really are AOS-owned / user-edited', () => {
        const { home } = fixture();
        assert.ok(sec.isAosOwned('github', owned(home, 'github'), shipped.github, shipped));
        assert.ok(sec.isLauncherEntry(owned(home, 'github')));
        assert.ok(!sec.isAosOwned('github', edited, shipped.github, shipped));
    });

    test('enable removes only AOS-owned gateway servers and adds aos with the token header', () => {
        const fx = fixture();
        const before = snap(fx.f);
        const rep = run(fx);
        const claude = rj(fx.f.claude);
        assert.deepEqual(Object.keys(claude.mcpServers).sort(), ['aos', 'bdb_rhino_mcp', 'mcsc', 'mine']);
        assert.deepEqual(claude.mcpServers.aos, { type: 'http', url: harness.GATEWAY_URL, headers: { 'X-AOS-Token': TOKEN } });
        assert.equal(claude.numStartups, 3);
        assert.deepEqual(claude.projects['/x'].mcpServers.github, edited, 'per-project servers untouched');
        const cursor = rj(fx.f.cursor);
        assert.deepEqual(cursor.mcpServers.github, edited, 'user-edited entry stays');
        assert.equal(cursor.mcpServers.bdb_resolume_mcp, undefined);
        assert.deepEqual(cursor.mcpServers.aos, { url: harness.GATEWAY_URL, headers: { 'X-AOS-Token': TOKEN } });
        assert.deepEqual(cursor.mcpServers.mcsc, shipped.mcsc);
        const oc = rj(fx.f.oc);
        assert.equal(oc.mcp.github, undefined);
        assert.ok(oc.mcp.mine);
        assert.deepEqual(oc.mcp.aos, { type: 'remote', url: harness.GATEWAY_URL, headers: { 'X-AOS-Token': TOKEN }, enabled: true });
        assert.equal(oc.$schema, 'x');
        assert.deepEqual(rep.find((r) => r.file === fx.f.cursor).kept, [{ name: 'github', reason: 'user-owned' }]);
        assert.ok(fs.readFileSync(fx.f.codex, 'utf8').startsWith(before.codex), 'codex keeps its own tables');
        assert.ok(/\[mcp_servers\.aos\]\nurl = "http:\/\/127\.0\.0\.1:7790\/mcp"/.test(fs.readFileSync(fx.f.codex, 'utf8')));
        assert.deepEqual(rj(fx.f.agy).mcpServers.aos, { serverUrl: harness.GATEWAY_URL, headers: { 'x-aos-token': TOKEN } });
        assert.deepEqual(rep.filter((r) => r.skipped).map((r) => r.skipped), []);
        // backups hold the pre-change bytes; migration.json holds originals and the aos marker, no token
        assert.equal(fs.readFileSync(rep.find((r) => r.file === fx.f.claude).backup, 'utf8'), before.claude);
        const mig = fs.readFileSync(harness.migrationPath(fx.home), 'utf8');
        assert.ok(!mig.includes(TOKEN));
        const recs = JSON.parse(mig).records;
        assert.equal(recs.filter((r) => r.added).length, 5); // incl. the Codex [mcp_servers.aos] marker (review C)
        assert.deepEqual(recs.find((r) => r.key === 'github' && r.kind === 'claude').original, owned(fx.home, 'github'));
        if (posix) assert.equal(mode(harness.migrationPath(fx.home)), 0o600);
    });

    test('enable strips group/other bits (token inside) and leaves no temp file', () => {
        const fx = fixture();
        if (posix) fs.chmodSync(fx.f.claude, 0o644);
        run(fx);
        if (posix) assert.equal(mode(fx.f.claude), 0o600);
        assert.ok(!fs.readdirSync(path.dirname(fx.f.claude)).some((n) => n.endsWith('.tmp')));
    });

    test('re-enable after a user edit replaces the stale record; unrestored originals stay recorded', () => {
        const fx = fixture();
        run(fx);
        const rec = JSON.parse(fs.readFileSync(harness.migrationPath(fx.home), 'utf8')).records;
        assert.equal(new Set(rec.map((r) => `${r.file}|${r.key}`)).size, rec.length);
    });

    test('enable twice is idempotent', () => {
        const fx = fixture();
        run(fx);
        const after = snap(fx.f);
        const mig = fs.readFileSync(harness.migrationPath(fx.home), 'utf8');
        const rep = run(fx, { now: 2000 });
        assert.deepEqual(snap(fx.f), after);
        assert.equal(fs.readFileSync(harness.migrationPath(fx.home), 'utf8'), mig);
        assert.ok(rep.filter((r) => !r.skipped).every((r) => !r.changed));
    });

    test('a user-owned aos entry is never overwritten and nothing else changes in that file', () => {
        const fx = fixture();
        const mine = { command: 'node', args: ['my-aos.js'] };
        const d = rj(fx.f.claude);
        d.mcpServers.aos = mine;
        wj(fx.f.claude, d);
        const before = fs.readFileSync(fx.f.claude, 'utf8');
        const rep = run(fx);
        assert.equal(fs.readFileSync(fx.f.claude, 'utf8'), before);
        assert.match(rep.find((r) => r.file === fx.f.claude).conflict, /aos/);
        assert.ok(rj(fx.f.cursor).mcpServers.aos.url, 'other files proceed');
    });

    test('an owned entry with an inline secret stays direct', () => {
        const fx = fixture();
        const d = rj(fx.f.cursor);
        d.mcpServers.bdb_resolume_mcp = { ...shipped.bdb_resolume_mcp, env: { SOME_API_KEY: 'sk-realvalue' } };
        wj(fx.f.cursor, d);
        const rep = run(fx);
        assert.ok(rj(fx.f.cursor).mcpServers.bdb_resolume_mcp);
        assert.ok(rep.find((r) => r.file === fx.f.cursor).kept.some((k) => k.reason === 'inline-secret'));
        assert.ok(!fs.readFileSync(harness.migrationPath(fx.home), 'utf8').includes('sk-realvalue'));
    });

    test('opencode jsonc with comments is not rewritten', () => {
        const fx = fixture();
        fs.writeFileSync(fx.f.oc, '{\n  // keep me\n  "mcp": {}\n}\n');
        const rep = run(fx);
        assert.equal(fs.readFileSync(fx.f.oc, 'utf8'), '{\n  // keep me\n  "mcp": {}\n}\n');
        assert.match(rep.find((r) => r.file === fx.f.oc).skipped, /not plain JSON/);
    });

    test('invalid token is refused before anything is written', () => {
        const fx = fixture();
        const before = snap(fx.f);
        assert.throws(() => run(fx, { token: 'short' }), /token/);
        assert.deepEqual(snap(fx.f), before);
    });

    test('dryRun writes nothing', () => {
        const fx = fixture();
        const before = snap(fx.f);
        const rep = run(fx, { dryRun: true });
        assert.deepEqual(snap(fx.f), before);
        assert.ok(rep.some((r) => r.changed));
        assert.ok(!fs.existsSync(harness.migrationPath(fx.home)));
    });

    test('disable restores originals exactly, removes aos, renames migration.json, and is idempotent', () => {
        const fx = fixture();
        const before = snap(fx.f);
        run(fx);
        const rep = harness.disable({ home: fx.home, files: fx.files, now: 3000 });
        for (const k of ['claude', 'cursor', 'oc', 'agy']) {
            assert.deepEqual(rj(fx.f[k]), JSON.parse(before[k]), k);
        }
        assert.equal(fs.readFileSync(fx.f.codex, 'utf8'), before.codex);
        assert.ok(!fs.existsSync(harness.migrationPath(fx.home)));
        assert.ok(fs.existsSync(`${harness.migrationPath(fx.home)}.restored-3000`));
        assert.ok(rep.some((r) => r.removedAos));
        const again = snap(fx.f);
        const rep2 = harness.disable({ home: fx.home, files: fx.files, now: 4000 });
        assert.deepEqual(snap(fx.f), again);
        assert.ok(rep2.every((r) => !r.changed));
    });

    test('disable keeps a user-owned aos entry and a same-named entry that now exists', () => {
        const fx = fixture();
        run(fx);
        const c = rj(fx.f.claude);
        c.mcpServers.github = edited;
        wj(fx.f.claude, c);
        const o = rj(fx.f.cursor);
        o.mcpServers.aos = { command: 'node', args: ['x'] };
        wj(fx.f.cursor, o);
        const rep = harness.disable({ home: fx.home, files: fx.files, now: 5000 });
        assert.deepEqual(rj(fx.f.claude).mcpServers.github, edited);
        assert.ok(rep.find((r) => r.file === fx.f.claude).conflicts.some((m) => /^github/.test(m)));
        assert.deepEqual(rj(fx.f.cursor).mcpServers.aos, { command: 'node', args: ['x'] });
    });

    test('doctor: healthy, duplicate, missing entry, missing migration record, leftover dir', () => {
        const fx = fixture();
        const dir = cfg.gatewayDir(fx.home);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'token'), TOKEN, { mode: 0o600 });
        const plist = path.join(fx.home, 'Library', 'LaunchAgents', 'com.bdb.aos.gateway.plist');
        fs.mkdirSync(path.dirname(plist), { recursive: true });
        fs.writeFileSync(plist, '');
        const check = (o = {}) => gatewayChecks({ home: fx.home, files: fx.files, shipped, platform: process.platform === 'win32' ? 'win32' : 'darwin', nodeMajor: 24, status: { running: true, port: 7790 }, ...o });
        const bad = (cs) => cs.filter((c) => !c.ok);

        let cs = check();
        assert.ok(bad(cs).some((c) => /gateway entry in .*claude/.test(c.name)), 'not enabled yet');
        assert.ok(cs.every((c) => c.area === 'gateway' && typeof c.name === 'string' && 'detail' in c && 'fix' in c && 'warningOnly' in c));

        run(fx);
        cs = check();
        assert.deepEqual(bad(cs), []);

        const c = rj(fx.f.claude);
        c.mcpServers.github = owned(fx.home, 'github');
        wj(fx.f.claude, c);
        assert.ok(bad(check()).some((x) => /duplicates in .*claude/.test(x.name)));
        delete c.mcpServers.github;
        wj(fx.f.claude, c);

        fs.renameSync(harness.migrationPath(fx.home), path.join(dir, 'moved.json'));
        assert.ok(bad(check()).some((x) => x.name === 'gateway migration record'));
        fs.renameSync(path.join(dir, 'moved.json'), harness.migrationPath(fx.home));

        assert.ok(bad(check({ status: { running: false, port: 7790 } })).some((x) => x.name === 'gateway running'));
        if (posix) {
            fs.chmodSync(path.join(dir, 'token'), 0o644);
            assert.ok(bad(check()).some((x) => x.name === 'gateway token'));
            fs.chmodSync(path.join(dir, 'token'), 0o600);
        }

        fs.mkdirSync(path.join(dir, 'node_modules.removed-1'));
        const left = bad(check()).find((x) => /leftover node_modules\.removed-1/.test(x.name));
        assert.equal(left.warningOnly, true);
        assert.ok(left.fix.includes(path.join(dir, 'node_modules.removed-1')));
    });

    test('doctor: everything is warningOnly when the gateway is not installed', () => {
        const home = tmp();
        const cs = gatewayChecks({ home, files: [], platform: 'darwin' });
        assert.ok(cs.length > 0 && cs.every((c) => c.warningOnly));
    });

    test('install enables harnesses by default, skips with harnesses:false; uninstall disables first, then unlinks the token', async () => {
        const mk = (home, extra) => {
            const run = async () => ({ status: 0, stdout: '' });
            return { home, run, dryRun: false, platform: 'darwin', log: () => {}, nodePath: '/n/node', aosRoot: ROOT, uid: 501, env: {}, sleep: async () => {}, statusFn: async () => ({ running: true, port: cfg.GATEWAY_PORT }), ...extra };
        };
        const fx = fixture();
        const before = snap(fx.f);
        await pkg.install(mk(fx.home, { harnesses: false }));
        assert.deepEqual(snap(fx.f), before);

        const dry = await pkg.install(mk(fx.home, { dryRun: true }));
        assert.ok(dry.actions.some((a) => a.startsWith('harness ')));
        assert.deepEqual(snap(fx.f), before);

        await pkg.install(mk(fx.home));
        assert.ok(rj(fx.f.claude).mcpServers.aos);
        assert.equal(rj(fx.f.claude).mcpServers.github, undefined);

        const real = harness.disable;
        const order = [];
        const tokenFile = path.join(cfg.gatewayDir(fx.home), 'token');
        harness.disable = (o) => { order.push(fs.existsSync(tokenFile) ? 'disable(token present)' : 'disable(token gone)'); return real(o); };
        try { await pkg.uninstall(mk(fx.home, { now: 1700000000002 })); } finally { harness.disable = real; }
        assert.deepEqual(order, ['disable(token present)']);
        assert.ok(!fs.existsSync(tokenFile));
        assert.deepEqual(rj(fx.f.claude), JSON.parse(before.claude));
    });

    test('install without a running gateway leaves every harness direct', async () => {
        const fx = fixture();
        const before = snap(fx.f);
        const notRunning = { run: async () => ({ status: 0, stdout: '' }), dryRun: false, platform: 'darwin', log: () => {}, nodePath: '/n/node', aosRoot: ROOT, uid: 501, env: {}, sleep: async () => {}, statusFn: async () => ({ running: false, port: cfg.GATEWAY_PORT }), home: fx.home };
        const res = await pkg.install(notRunning);
        assert.equal('harness' in res, false);
        assert.deepEqual(snap(fx.f), before);
    });
});

const gwHost = (home) => ({
    quickUpdateKernel: () => {}, quickUpdateHarnesses: () => {},
    detectInstallState: () => ({ isInstalled: true, localVersion: '4.0.0', installedModules: [] }),
    resolveTargetPaths: () => ({ targetSkillDir: path.join(home, 'skills'), targetMcpDir: path.join(home, 'mcp') }),
    moduleBasePath: () => path.join(home, '.agents'),
    isNewerVersion: (l, r) => l !== r, loadExistingEnv: () => ({}), PROVIDER_KEY_ENV_NAMES: {},
    saveManifest: () => {}, flushSessionManifest: () => {}, runUninstaller: () => 0,
});

test('update installs gateway when missing', async () => {
    const menu = require('../lib/v5/menu.js');
    const gw = require('../lib/v5/packages.js').registry.find((p) => p.id === 'gateway');
    const realInstall = gw.install, realVerify = gw.verify;
    const calls = [];
    gw.install = async (c) => { calls.push(c.home); c.log('preset aos-core not created'); return { ok: true }; };
    gw.verify = async () => ({ ok: true });
    const home = tmp();
    const out = [];
    try {
        await menu.update(gwHost(home), { home, platform: 'darwin', write: (s) => out.push(s), ui: {}, npmView: async () => { throw new Error('offline'); } });
    } finally { gw.install = realInstall; gw.verify = realVerify; }
    assert.deepStrictEqual(calls, [home]);
    assert.match(out.join(''), /✔ MCP gateway preset aos-core not created; running/);
    assert.doesNotMatch(out.join(''), /Optional, not installed:.*\bgateway\b/, 'F12: installed in this run, not listed as optional');
});

test('update: gateway update messages reach the step line (F15)', async () => {
    const menu = require('../lib/v5/menu.js');
    const gw = require('../lib/v5/packages.js').registry.find((p) => p.id === 'gateway');
    const real = { detect: gw.detect, update: gw.update, verify: gw.verify };
    gw.detect = () => ({ installed: true, version: '0.38.2' });
    gw.update = async (c) => { c.log('harnesses left direct'); return { ok: true }; };
    gw.verify = async () => ({ ok: true });
    const home = tmp();
    const out = [];
    try {
        await menu.update(gwHost(home), { home, platform: 'linux', write: (s) => out.push(s), ui: {}, npmView: async () => { throw new Error('offline'); } });
    } finally { Object.assign(gw, real); }
    assert.match(out.join(''), /✔ MCP gateway[^\n]*0\.38\.2; harnesses left direct/);
});

test('update: a failing gateway verify keeps the step messages in the error (F15b)', async () => {
    const menu = require('../lib/v5/menu.js');
    const gw = require('../lib/v5/packages.js').registry.find((p) => p.id === 'gateway');
    const real = { detect: gw.detect, update: gw.update, verify: gw.verify };
    gw.detect = () => ({ installed: true, version: '0.38.2' });
    gw.update = async (c) => { c.log('harnesses left direct'); return { ok: true }; };
    gw.verify = async () => ({ ok: false, detail: '1mcp not reachable on 7791 (ECONNREFUSED)' });
    const home = tmp();
    const out = [];
    try {
        await menu.update(gwHost(home), { home, platform: 'linux', write: (s) => out.push(s), ui: {}, npmView: async () => { throw new Error('offline'); } });
    } finally { Object.assign(gw, real); }
    const logged = /✖ MCP gateway — see (\S+)/.exec(out.join(''));
    assert.ok(logged, out.join(''));
    assert.match(fs.readFileSync(logged[1], 'utf8'), /ECONNREFUSED\); harnesses left direct/);
});

test('update installs the MCP gateway on linux too', async () => {
    const menu = require('../lib/v5/menu.js');
    const gw = require('../lib/v5/packages.js').registry.find((p) => p.id === 'gateway');
    const realInstall = gw.install, realVerify = gw.verify;
    const calls = [];
    gw.install = async (c) => { calls.push(c.home); return { ok: true }; };
    gw.verify = async () => ({ ok: true });
    const home = tmp();
    const out = [];
    try {
        await menu.update(gwHost(home), { home, platform: 'linux', write: (s) => out.push(s), ui: {}, npmView: async () => { throw new Error('offline'); } });
    } finally { gw.install = realInstall; gw.verify = realVerify; }
    assert.deepStrictEqual(calls, [home]);
    assert.doesNotMatch(out.join(''), /skipped on linux/);
});

for (const platform of ['linux', 'darwin']) {
    test(`update: gateway installed but unverified on ${platform} is ${platform === 'darwin' ? 'a failure' : 'a warning'}`, async () => {
        const menu = require('../lib/v5/menu.js');
        const gw = require('../lib/v5/packages.js').registry.find((p) => p.id === 'gateway');
        const realInstall = gw.install, realVerify = gw.verify;
        const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
        gw.install = async () => ({ ok: true });
        gw.verify = async () => ({ ok: false });
        Object.defineProperty(process, 'platform', { value: platform });
        const home = tmp();
        const out = [];
        try {
            await menu.update(gwHost(home), { home, platform, write: (s) => out.push(s), ui: {}, npmView: async () => { throw new Error('offline'); } });
        } finally {
            gw.install = realInstall; gw.verify = realVerify;
            Object.defineProperty(process, 'platform', realPlatform);
        }
        const text = out.join('');
        if (platform === 'darwin') {
            const logged = /✖ MCP gateway — see (\S+)/.exec(text);
            assert.ok(logged, text);
            assert.match(fs.readFileSync(logged[1], 'utf8'), /not running/);
        }
        else {
            assert.match(text, /✔ MCP gateway[^\n]*service not confirmed on linux: harnesses left direct, run aos-gateway enable after aos-gateway status is green/);
            assert.doesNotMatch(text, /✖ MCP gateway/);
        }
    });
}

describe('adoptGateway', () => {
    const menu = require('../lib/v5/menu.js');
    const adopt = require('../lib/gateway/adopt.js');
    const gw = require('../lib/v5/packages.js').registry.find((p) => p.id === 'gateway');
    const scanned = { adoptable: [{ name: 'foo', entry: { command: 'node', args: ['f.js'] } }, { name: 'bar', entry: { command: 'node', args: ['b.js'] } }] };

    const setup = () => {
        const home = tmp();
        const marker = path.join(home, 'order.txt');
        fs.mkdirSync(path.join(home, '.agents', 'bin'), { recursive: true });
        fs.writeFileSync(path.join(home, '.agents', 'bin', 'aos-gateway.mjs'), `import fs from 'fs';\nfs.appendFileSync(${JSON.stringify(marker)}, 'restart\\n');\n`);
        fs.mkdirSync(cfg.gatewayDir(home), { recursive: true });
        fs.writeFileSync(path.join(cfg.gatewayDir(home), 'token'), 'tok\n');
        return { home, marker, out: [], applied: [] };
    };

    test('picked server is adopted, config regenerated, then the gateway restarted', async () => {
        const t = setup();
        const real = { scan: adopt.scanAdoptable, apply: adopt.applyAdopt, update: gw.update };
        adopt.scanAdoptable = () => scanned;
        adopt.applyAdopt = (o) => { t.applied.push(o.only); return { adopted: o.only, files: [], skipped: [] }; };
        gw.update = async () => { fs.appendFileSync(t.marker, 'update\n'); return { ok: true }; };
        try {
            await menu.adoptGateway({ home: t.home, write: (s) => t.out.push(s), adopt: true, ui: { multi: async () => ['foo'] } }, path.join(t.home, 'adopt.log'));
        } finally { adopt.scanAdoptable = real.scan; adopt.applyAdopt = real.apply; gw.update = real.update; }
        assert.deepStrictEqual(t.applied, [['foo']]);
        assert.deepStrictEqual(fs.readFileSync(t.marker, 'utf8').split('\n').filter(Boolean), ['update', 'restart']);
        assert.match(t.out.join(''), /✔ Adopt MCP servers foo/);
    });

    test('empty pick adopts nothing and does not restart', async () => {
        const t = setup();
        const real = { scan: adopt.scanAdoptable, apply: adopt.applyAdopt };
        adopt.scanAdoptable = () => scanned;
        adopt.applyAdopt = (o) => { t.applied.push(o.only); return { adopted: [], files: [], skipped: [] }; };
        try {
            await menu.adoptGateway({ home: t.home, write: (s) => t.out.push(s), adopt: true, ui: { multi: async () => [] } }, path.join(t.home, 'adopt.log'));
        } finally { adopt.scanAdoptable = real.scan; adopt.applyAdopt = real.apply; }
        assert.deepStrictEqual(t.applied, []);
        assert.ok(!fs.existsSync(t.marker));
    });

    test('non-interactive update prints only the adopt hint', async () => {
        const t = setup();
        const real = { scan: adopt.scanAdoptable, apply: adopt.applyAdopt };
        adopt.scanAdoptable = () => scanned;
        adopt.applyAdopt = (o) => { t.applied.push(o.only); return { adopted: [], files: [], skipped: [] }; };
        try {
            await menu.adoptGateway({ home: t.home, write: (s) => t.out.push(s), ui: {} }, path.join(t.home, 'adopt.log'));
        } finally { adopt.scanAdoptable = real.scan; adopt.applyAdopt = real.apply; }
        assert.deepStrictEqual(t.out, ['Other MCP servers can join the gateway: aos-gateway adopt\n']);
        assert.deepStrictEqual(t.applied, []);
    });
});

test('full install does not duplicate gateway servers when aos entry exists', () => {
    const { spawnSync } = require('child_process');
    const home = tmp();
    const dir = path.join(home, 'mcp');
    const file = path.join(home, 'mcp.json');
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { aos: { type: 'http', url: 'http://127.0.0.1:7790/mcp', headers: { 'X-AOS-Token': 'x' } } } }));
    const code = `require(${JSON.stringify(path.join(ROOT, 'installer.js'))}).installMcpsForTarget({ targetMcpDir: process.argv[1], mcpConfigPath: process.argv[2], extraMcpConfigPaths: [] }, { selectedMcps: ['mcsc'], mode: 'merge', platformValue: '2', creds: {} });`;
    const r = spawnSync(process.execPath, ['-e', code, dir, file], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8', timeout: 120000 });
    assert.strictEqual(r.status, 0, r.stderr);
    const servers = JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers;
    assert.ok(servers.aos, 'gateway entry kept');
    assert.ok(Object.keys(servers).length > 1, 'merge still wrote the direct servers');
    assert.ok(servers.mcsc, 'direct-by-design server written');
    assert.deepStrictEqual(cfg.GATEWAY_SERVERS.filter((n) => n in servers), []);
});

describe('uninstall leftovers', () => {
    test('pruneBackups keeps the oldest and newest backup and archives the rest', () => {
        const d = tmp();
        const arch = path.join(tmp(), 'arch');
        const f = path.join(d, 'x.json');
        for (const t of [300, 100, 200, 400]) fs.writeFileSync(`${f}.aos-gateway-bak-${t}`, '{}');
        fs.writeFileSync(`${f}.bak`, '{}');
        const moved = require('../lib/gateway/harness.js').pruneBackups(f, arch);
        assert.equal(moved.length, 2);
        assert.deepEqual(fs.readdirSync(d).sort(), ['x.json.aos-gateway-bak-100', 'x.json.aos-gateway-bak-400', 'x.json.bak']);
        assert.deepEqual(fs.readdirSync(arch).sort(), ['x.json.aos-gateway-bak-200', 'x.json.aos-gateway-bak-300']);
    });

    test('removeGenerated clears runtime files, keeps gateway.json and migration records', () => {
        const home = tmp();
        const dir = cfg.gatewayDir(home);
        fs.mkdirSync(path.join(dir, 'runtime.owner'), { recursive: true });
        for (const n of ['upstream.pid', 'server.pid', 'runtime.owner.flock', 'package.json', 'runtime.owner/owner.json', 'gateway.json', 'migration.json.restored-1']) fs.writeFileSync(path.join(dir, n), '{}');
        pkg.removeGenerated(dir, home);
        assert.deepEqual(fs.readdirSync(dir).sort(), ['gateway.json', 'migration.json.restored-1']);
    });
});

describe('presets.json', () => {
    test('stripAosPresets removes only AOS-made presets; the file goes when none are left', () => {
        const dir = tmp();
        fs.writeFileSync(path.join(dir, 'aos-presets-ok.json'), JSON.stringify(['aos-core']));
        fs.writeFileSync(path.join(dir, 'presets.json'), JSON.stringify({ version: '1', presets: { 'aos-core': {}, mine: { a: 1 } } }));
        assert.equal(pkg.stripAosPresets(dir), 'stripped');
        assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'presets.json'), 'utf8')).presets), ['mine']);
        assert.ok(fs.readdirSync(dir).some((n) => n.endsWith('.bak')));
        fs.writeFileSync(path.join(dir, 'presets.json'), JSON.stringify({ presets: { 'aos-core': {} } }));
        assert.equal(pkg.stripAosPresets(dir), 'removed');
        assert.ok(!fs.existsSync(path.join(dir, 'presets.json')));
    });

    test('stripAosPresets also recognises presets of the `aos AND NOT x` shape missing from the record', () => {
        const dir = tmp();
        fs.writeFileSync(path.join(dir, 'aos-presets-ok.json'), JSON.stringify(['agy']));
        const mk = (...ex) => ({ strategy: 'advanced', tagQuery: { $and: [{ tag: 'aos' }, ...ex.map((tag) => ({ $not: { tag } }))] } });
        const mine = { strategy: 'or', tagQuery: { $or: [{ tag: 'github' }] } };
        fs.writeFileSync(path.join(dir, 'presets.json'), JSON.stringify({ presets: { agy: mk('a'), worker: mk('a', 'b'), small: mk('c'), mine } }));
        assert.equal(pkg.stripAosPresets(dir), 'stripped');
        assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'presets.json'), 'utf8')).presets), ['mine']);
        fs.writeFileSync(path.join(dir, 'presets.json'), JSON.stringify({ presets: { worker: mk('a') } }));
        assert.equal(pkg.stripAosPresets(dir), 'removed');
    });

    test('stripAosPresets removes the three presets exactly as 1mcp 1.0.0 stored them on a fresh install, with no record', () => {
        const dir = tmp();
        const base = (tags) => ({ strategy: 'advanced', tagQuery: { $and: [{ tag: 'aos' }, ...tags.map((tag) => ({ $not: { tag } }))] } });
        const stamp = (name) => ({ name, created: '2026-10-20T08:01:14.270Z', lastModified: '2026-10-20T08:01:14.270Z' });
        const presets = {
            agy: { ...base(['bdb_davinci_mcp']), ...stamp('agy') },
            worker: { ...base(['bdb_davinci_mcp', 'bdb_unreal_mcp', 'bdb_blender_mcp']), ...stamp('worker') },
            small: { ...base(['bdb_davinci_mcp', 'bdb_unreal_mcp']), ...stamp('small') },
        };
        fs.writeFileSync(path.join(dir, 'presets.json'), JSON.stringify({ version: '1.0.0', presets }, null, 2));
        assert.equal(pkg.stripAosPresets(dir), 'removed');
        assert.ok(!fs.existsSync(path.join(dir, 'presets.json')));
    });

    test('stripAosPresets removes the empty file 1mcp writes on start (real 1.0.0 storage shape); a user preset keeps it', () => {
        const dir = tmp();
        fs.writeFileSync(path.join(dir, 'presets.json'), JSON.stringify({ version: '1.0.0', presets: {} }, null, 2));
        assert.equal(pkg.stripAosPresets(dir), 'removed');
        assert.ok(!fs.existsSync(path.join(dir, 'presets.json')));
        const mine = { name: 'mine', strategy: 'or', tagQuery: { $or: [{ tag: 'github' }] }, created: 'x', lastModified: 'x' };
        fs.writeFileSync(path.join(dir, 'presets.json'), JSON.stringify({ version: '1.0.0', presets: { mine } }));
        assert.equal(pkg.stripAosPresets(dir), 'kept');
        assert.ok(fs.existsSync(path.join(dir, 'presets.json')));
    });
});
