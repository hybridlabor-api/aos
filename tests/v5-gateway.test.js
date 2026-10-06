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
        withcwd: { command: 'node', args: ['{{HOME}}/x.js'], cwd: '/work/dir', env: { FOO: 'bar' } },
        deja: { command: 'deja', args: ['mcp'] },
        memb_mcp: { command: '__PYTHON_BIN__', args: ['run.py'] },
        private_one: { command: 'node', args: ['p.js'], shared: false },
    };

    test('splitServers sends direct and shared:false servers to direct', () => {
        const { gateway, direct } = cfg.splitServers(shipped);
        assert.deepEqual(Object.keys(gateway).sort(), ['bdb_resolume_mcp', 'github', 'withcwd']);
        assert.deepEqual(Object.keys(direct).sort(), ['deja', 'memb_mcp', 'private_one']);
        for (const n of cfg.DIRECT_SERVERS) assert.ok(!(n in gateway));
    });

    const up = cfg.buildUpstreams({ shipped, home, launcher, pathEnv: '/usr/bin:/bin' });

    test('entries are explicit stdio with isolated env and no direct servers', () => {
        assert.deepEqual(Object.keys(up).sort(), ['bdb_resolume_mcp', 'github', 'withcwd']);
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
        assert.equal(up.withcwd.cwd, '/work/dir');
        assert.equal(up.withcwd.env.FOO, 'bar');
        assert.deepEqual(up.withcwd.args, [`${home}/x.js`]);
        assert.deepEqual(up.bdb_resolume_mcp.args, ['run', path.join(home, '.gemini', 'config', 'mcps', 'resolume_mcp.py')]);
        assert.equal(shipped.bdb_resolume_mcp.args[1], '__MCPS_DIR__/resolume_mcp.py');
    });

    test('the shipped template yields no direct server and no secret value', () => {
        const real = require('../lib/mcp-secrets.js').shippedServers(ROOT);
        const out = cfg.buildUpstreams({ shipped: real, home, launcher, pathEnv: 'p' });
        for (const n of cfg.DIRECT_SERVERS) assert.ok(!(n in out), n);
        assert.ok(out.github && out.open_design_mcp);
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

    test('teardown', async () => {
        await fw.close();
        await closeServer(upstream);
    });
});

describe('pkg-gateway', () => {
    const mkCtx = (home, extra = {}) => {
        const calls = [];
        const run = async (cmd, args) => { calls.push([cmd, ...args]); return { status: 0, stdout: '' }; };
        return { calls, ctx: { home, run, dryRun: false, platform: 'darwin', log: () => {}, nodePath: '/opt/node/bin/node', aosRoot: ROOT, uid: 501, ...extra } };
    };
    const posix = process.platform !== 'win32';

    test('contract shape', () => {
        assert.equal(pkg.id, 'gateway');
        for (const f of ['detect', 'install', 'update', 'verify', 'uninstall']) assert.equal(typeof pkg[f], 'function');
    });

    test('install creates dir 0700, token 0600, mcp.json and the plist', async () => {
        const home = tmp();
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
        assert.ok(servers.github && !servers.deja && !servers.memb_mcp);

        const plist = fs.readFileSync(path.join(home, 'Library', 'LaunchAgents', 'com.bdb.aos.gateway.plist'), 'utf8');
        assert.ok(plist.includes('<string>com.bdb.aos.gateway</string>'));
        assert.ok(plist.includes('<string>/opt/node/bin/node</string>'));
        assert.ok(plist.includes(`<string>${path.join(ROOT, 'bin', 'aos-gateway.mjs')}</string>`));
        assert.ok(plist.includes('<string>serve</string>'));
        assert.ok(plist.includes(`<string>${path.join(dir, 'gateway.log')}</string>`));
        assert.ok(/<key>RunAtLoad<\/key>\s*<true\/>/.test(plist) && /<key>KeepAlive<\/key>\s*<true\/>/.test(plist));
        assert.ok(plist.includes('<key>HOME</key>') && plist.includes('<key>PATH</key>'));

        assert.deepEqual(calls[0], ['npm', 'install', '--prefix', dir, '--no-audit', '--no-fund', '@1mcp/agent@0.38.2']);
        assert.deepEqual(calls[1], ['launchctl', 'bootstrap', 'gui/501', path.join(home, 'Library', 'LaunchAgents', 'com.bdb.aos.gateway.plist')]);
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
        assert.deepEqual(second.calls[1], ['launchctl', 'kickstart', '-k', 'gui/501/com.bdb.aos.gateway']);
    });

    test('install fails loudly when npm fails', async () => {
        const home = tmp();
        const { ctx } = mkCtx(home, { run: async () => ({ status: 1 }) });
        await assert.rejects(pkg.install(ctx), /npm install/);
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

    test('uninstall keeps gateway.json and migration.json and renames node_modules aside, deleting nothing recursively', async () => {
        const home = tmp();
        const { ctx, calls } = mkCtx(home);
        await pkg.install(ctx);
        const dir = cfg.gatewayDir(home);
        fs.writeFileSync(path.join(dir, 'gateway.json'), '{}');
        fs.writeFileSync(path.join(dir, 'migration.json'), '{}');
        fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'f.js'), '');
        calls.length = 0;
        const res = await pkg.uninstall({ ...ctx, now: 1700000000000 });
        assert.deepEqual(calls, [['launchctl', 'bootout', 'gui/501/com.bdb.aos.gateway']]);
        assert.deepEqual(fs.readdirSync(dir).sort(), ['gateway.json', 'migration.json', 'node_modules.removed-1700000000000']);
        assert.ok(fs.existsSync(path.join(dir, 'node_modules.removed-1700000000000', 'x', 'f.js')), 'content is moved, not deleted');
        assert.equal(res.retired, path.join(dir, 'node_modules.removed-1700000000000'));
        assert.ok(!fs.existsSync(path.join(home, 'Library', 'LaunchAgents', 'com.bdb.aos.gateway.plist')));
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

    test('pkg-gateway source contains no recursive delete', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'v5', 'pkg-gateway.js'), 'utf8');
        assert.ok(!/rmSync|rimraf|recursive:\s*true\s*,\s*force/.test(src.replace(/mkdirSync\([^)]*\)/g, '')));
    });

    test('verify is ok only for a running gateway on 7790', async () => {
        const home = tmp();
        const withOut = (o) => mkCtx(home, { run: async () => ({ status: 0, stdout: JSON.stringify(o) }) }).ctx;
        assert.equal((await pkg.verify(withOut({ running: true, port: 7790, upstreams: [] }))).ok, true);
        assert.equal((await pkg.verify(withOut({ running: false, port: 7790, upstreams: [] }))).ok, false);
        assert.equal((await pkg.verify(withOut({ running: true, port: 9999, upstreams: [] }))).ok, false);
        assert.equal((await pkg.verify(mkCtx(home, { run: async () => ({ stdout: 'not json' }) }).ctx)).ok, false);
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
        assert.deepEqual(s, { running: true, pid: process.pid, port, upstreams: [{ name: 'a', ok: true }, { name: 'b', ok: true }] });
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
