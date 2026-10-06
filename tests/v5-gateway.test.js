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
        bdb_blender_mcp: { command: 'node', args: ['{{HOME}}/x.js'], cwd: '/work/dir', env: { FOO: 'bar' } },
        deja: { command: 'deja', args: ['mcp'] },
        memb_mcp: { command: '__PYTHON_BIN__', args: ['run.py'] },
        unknown_new_server: { command: 'node', args: ['n.js'] },
        open_design_mcp: { command: 'node', args: ['p.js'], shared: false },
    };

    test('splitServers: only allow-listed servers go to the gateway; shared:false forces direct', () => {
        const { gateway, direct } = cfg.splitServers(shipped);
        assert.deepEqual(Object.keys(gateway).sort(), ['bdb_blender_mcp', 'bdb_resolume_mcp', 'github']);
        assert.deepEqual(Object.keys(direct).sort(), ['deja', 'memb_mcp', 'open_design_mcp', 'unknown_new_server']);
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
        assert.deepEqual(Object.keys(out).sort(), ['bdb_blender_mcp', 'bdb_davinci_mcp', 'bdb_grandma3_mcp', 'bdb_resolume_mcp', 'github', 'open_design_mcp']);
        assert.ok(!('bdb_remoteos_mcp' in out));
        assert.ok(cfg.splitServers(real).direct.bdb_remoteos_mcp);
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
        assert.deepEqual(calls[1], ['launchctl', 'bootout', 'gui/501/com.bdb.aos.gateway']);
        assert.deepEqual(calls[2], ['launchctl', 'bootstrap', 'gui/501', path.join(home, 'Library', 'LaunchAgents', 'com.bdb.aos.gateway.plist')]);
        const g = JSON.parse(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8')).mcpServers;
        assert.deepEqual(Object.keys(g).sort(), ['bdb_blender_mcp', 'bdb_davinci_mcp', 'bdb_grandma3_mcp', 'bdb_resolume_mcp', 'github', 'open_design_mcp']);
    });

    const launchctlFails = (how) => async (cmd) => {
        if (cmd !== 'launchctl') return { status: 0, stdout: '' };
        if (how === 'reject') throw new Error('spawn launchctl ENOENT');
        return { status: how };
    };

    for (const how of ['reject', 5, 113]) {
        test(`install survives launchctl failing (${how})`, async () => {
            const home = tmp();
            const say = [];
            const { ctx } = mkCtx(home, { run: launchctlFails(how), log: (m) => say.push(m) });
            const r = await pkg.install(ctx);
            assert.equal(r.ok, true);
            assert.ok(say.some((m) => /launchctl/.test(m)));
        });

        test(`update falls back to bootout + bootstrap when kickstart fails (${how})`, async () => {
            const home = tmp();
            const calls = [];
            const run = async (cmd, args) => { calls.push([cmd, ...args]); return launchctlFails(how)(cmd); };
            const { ctx } = mkCtx(home, { run });
            await pkg.update(ctx);
            const lc = calls.filter((c) => c[0] === 'launchctl').map((c) => c[1]);
            assert.deepEqual(lc, ['kickstart', 'bootout', 'bootstrap']);
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
            assert.equal(res.retired, path.join(dir, 'node_modules.removed-1700000000001'));
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
        const say = [];
        await pkg.install(mkCtx(home, { log: (m) => say.push(m) }).ctx);
        assert.ok(say.some((m) => m.includes('launcher missing')));
        assert.ok(say.some((m) => /gateway server bdb_resolume_mcp: .*resolume_mcp\.py does not exist/.test(m)));
    });

    test('install passes only allow-listed ctx.env keys and uvPath to the upstreams', async () => {
        const home = tmp();
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

    test('gateway sources contain no delete-tree primitive at all', () => {
        const files = [
            ...fs.readdirSync(path.join(ROOT, 'lib', 'gateway')).map((f) => path.join(ROOT, 'lib', 'gateway', f)),
            path.join(ROOT, 'lib', 'v5', 'pkg-gateway.js'),
            path.join(ROOT, 'bin', 'aos-gateway.mjs'),
        ];
        assert.ok(files.length >= 4);
        for (const f of files) {
            const src = fs.readFileSync(f, 'utf8');
            assert.ok(!/\b(rmSync|rmdirSync|rimraf|rmtree)\b|\bfs\.rm\(|promises\.rm\(/.test(src), f);
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
        const r = await pkg.verify(mkCtx(home, { run: async () => { throw new Error('verify must not spawn'); }, sleep: async () => {} }).ctx);
        assert.equal(r.ok, false);
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
        assert.deepEqual(s, { running: true, pid: process.pid, port, upstreamsScope: 'global', upstreams: [{ name: 'a', ok: true }, { name: 'b', ok: true }] });
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
