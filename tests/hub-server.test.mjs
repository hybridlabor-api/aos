import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { createServer as createServer_fwd } from 'node:http';
import { mkdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHub } from '../lib/hub/server.mjs';
import { routes as planRoutes, probeTrailPorts } from '../lib/hub/routes-plans.mjs';
import { hubPaths, writeHubJson } from '../bin/aos-hub.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
// Unique temp dir, never deleted (rules forbid recursive deletes).
const tmp = join(tmpdir(), `aos-hub-test-${process.pid}-${Date.now()}`);
const home = join(tmp, 'home');
mkdirSync(home, { recursive: true });

const deferredFor = () => { let res; const promise = new Promise((ok) => { res = ok; }); return { promise, resolve: res }; };

let deferred;
const testRoutes = [
  ...planRoutes,
  {
    method: 'POST', path: '/api/test/mutate', mutates: true,
    handler: async () => ({ status: 200, json: { done: true } }),
  },
  {
    method: 'POST', path: '/api/test/confirm', mutates: true, confirm: 'hub',
    handler: async () => ({ status: 200, json: { done: true } }),
  },
  {
    method: 'POST', path: '/api/test/lock', mutates: true, lock: 'test',
    handler: async () => {
      await deferred.promise;
      return { status: 200, json: { done: true } };
    },
  },
  {
    method: 'POST', path: '/api/test/slow', mutates: true, lock: 'other',
    handler: async () => ({ status: 200, json: { done: true } }),
  },
];

let hub, base, token;
before(async () => {
  hub = createHub({ port: 0, home, routes: testRoutes, ctx: { root, hubJsonPath: join(home, '.aos', 'hub', 'hub.json') } });
  token = hub.token;
  await hub.listen();
  const a = hub.server.address();
  base = `http://127.0.0.1:${a.port}`;
});

after(async () => {
  hub.close();
});

const raw = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((ok, fail) => {
  const req = request(base + path, { method, headers }, (res) => {
    let data = '';
    res.on('data', (c) => { data += c; });
    res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: data }));
  });
  req.on('error', fail);
  if (body) req.write(body);
  req.end();
});
const post = (path, body_, headers = {}) => raw(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-aos-hub-token': token, ...headers },
  body: JSON.stringify(body_ ?? {}),
});

test('server listens on loopback only', () => {
  assert.equal(hub.server.address().address, '127.0.0.1');
});

test('guard: bad Host headers get 403', async () => {
  assert.equal((await raw('/api/health', { headers: { host: 'evil.com:7900' } })).status, 403);
  const port = hub.server.address().port;
  assert.equal((await raw('/api/health', { headers: { host: `127.0.0.1:${port === 7900 ? 7901 : 7900}` } })).status, 403);
});

test('guard: bad Origin on POST gets 403', async () => {
  assert.equal((await post('/api/test/mutate', {}, { origin: 'http://127.0.0.1:4519' })).status, 403);
});

test('navigation exemption: same-site navigate/document passes; iframe fails', async () => {
  const nav = { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
  assert.equal((await raw('/', { headers: nav })).status, 200);
  assert.equal((await raw('/', { headers: { ...nav, 'sec-fetch-dest': 'iframe' } })).status, 403);
  assert.equal((await raw('/api/test/x', { headers: nav })).status, 403);
});

test('token meta only on GET / (never on /ui/* files)', async () => {
  const homeHtml = (await raw('/')).body;
  assert.match(homeHtml, /<meta name="aos-hub-token" content="[0-9a-f]+">/);
  const css = (await raw('/ui/hub.css')).body;
  assert.doesNotMatch(css, /aos-hub-token/);
  const js = (await raw('/ui/app.js')).body;
  assert.doesNotMatch(js, /__AOS_HUB_TOKEN__/);
});

test('static: exact filenames only; path traversal gets 404', async () => {
  assert.equal((await raw('/ui/hub.css')).status, 200);
  assert.equal((await raw('/ui/plans.js')).status, 200);
  assert.equal((await raw('/ui/../server.mjs')).status, 404);
  assert.equal((await raw('/ui/%2e%2e/server.mjs')).status, 404);
  assert.equal((await raw('/ui/hub.css/../server.mjs')).status, 404);
  assert.equal((await raw('/ui/nonexistent.js')).status, 404);
  assert.equal((await raw('/ui/index.html')).status, 404);
});

test('mutations: POST only, JSON only, token only, confirm only', async () => {
  assert.equal((await raw('/api/test/mutate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await post('/api/test/mutate', {}, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post('/api/test/confirm', {})).status, 400);
  assert.equal((await post('/api/test/confirm', { confirm: 'hub' })).status, 200);
  assert.equal((await raw('/api/test/mutate', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 405);
  // 8 KB limit
  assert.equal((await post('/api/test/mutate', { blob: 'x'.repeat(9000) })).status, 413);
});

test('single-flight: two concurrent locked POSTs -> one 409 busy', async () => {
  deferred = deferredFor();
  const a = post('/api/test/lock');
  // a must be inside the handler (lock held) before b is even sent...
  await new Promise((ok) => setTimeout(ok, 80));
  const b = post('/api/test/lock');
  // ...and b must have reached the lock before a's deferred resolves, else a
  // releases first and both get 200. Resolving immediately after starting b
  // races the socket; give the loopback round-trip time to land.
  await new Promise((ok) => setTimeout(ok, 150));
  deferred.resolve();
  const [ra, rb] = await Promise.all([a, b]);
  const codes = [ra.status, rb.status].sort((x, y) => x - y);
  assert.deepEqual(codes, [200, 409]);
});

test('headers on every response', async () => {
  const res = await raw('/api/health');
  assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('/api/health shape', async () => {
  const { status, body } = await raw('/api/health');
  assert.equal(status, 200);
  const j = JSON.parse(body);
  assert.equal(j.ok, true);
  assert.equal(j.service, 'aos-hub');
  assert.match(j.version, /^\d/);
});

test('/api/trail lists HTTP-answering ports only', async () => {
  const fixtureServer = await new Promise((ok) => {
    const s = createServer_fwd((req, res) => { res.writeHead(200); res.end('ok'); });
    s.listen(0, '127.0.0.1', () => ok(s));
  });
  const fixturePort = fixtureServer.address().port;
  const live = await probeTrailPorts([fixturePort, 59991], 500);
  assert.deepEqual(live, [fixturePort]);
  fixtureServer.close();
});

test('/api/plans: fixture plan-canvas returns sessions; down gives idle note', async () => {
  // fixture on an ephemeral port, reached through a routes-plans handler with ctx.planCanvasPort
  const pc = createServer_fwd((req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
    if (pathname === '/api/sessions') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ sessions: [{ key: 'abc123def456', file: '/x/y.md', status: 'open', pending: 1, updatedAt: 'now' }] }));
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise((ok) => pc.listen(0, '127.0.0.1', ok));
  const port = pc.address().port;
  const hub3 = createHub({ port: 0, home, routes: [...planRoutes], ctx: { root, planCanvasPort: port } });
  await hub3.listen();
  const b3 = `http://127.0.0.1:${hub3.server.address().port}`;
  const get = (p) => new Promise((ok, fail) => request(b3 + p, {}, (r) => {
    let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => ok({ status: r.statusCode, body: d }));
  }).on('error', fail).end());
  const up = await get('/api/plans');
  assert.equal(up.status, 200);
  const upJson = JSON.parse(up.body);
  assert.equal(upJson.down, undefined);
  assert.equal(upJson.sessions[0].file, '/x/y.md');
  assert.equal(upJson.sessions[0].key, 'abc123def456');
  await hub3.close();
  pc.close();

  const { routes: planRoutes2 } = await import('../lib/hub/routes-plans.mjs');
  const hub4 = createHub({ port: 0, home, routes: planRoutes2, ctx: { root, planCanvasPort: 59999 } });
  await hub4.listen();
  const b4 = `http://127.0.0.1:${hub4.server.address().port}`;
  const downRes = await new Promise((ok, fail) => request(b4 + '/api/plans', {}, (r) => {
    let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => ok(d));
  }).on('error', fail).end());
  const downJson = JSON.parse(downRes);
  assert.equal(downJson.down, true);
  assert.match(downJson.note, /idle out after 30 minutes/);
  await hub4.close();
});

// ------- CLI: hub stop fails closed when ps is missing -------
test('hub stop with a failing ps: no kill, exit 1', async () => {
  const { file } = hubPaths(home);
  writeHubJson(home, { pid: String(process.pid) || 1, port: 59998, version: '0.0.0', token: 'x'.repeat(64) });
  assert.ok(existsSync(file));
  // no hub running on 59998 -> POST fails -> falls to ps (missing from PATH)
  const emptyPath = join(tmp, 'nopath');
  mkdirSync(emptyPath, { recursive: true });
  const res = await new Promise((ok) => {
    const p = spawn(process.execPath, [join(root, 'bin', 'aos-hub.mjs'), 'stop'], {
      cwd: home,
      env: { ...process.env, PATH: emptyPath, AOS_HUB_HOME: home, AOS_HUB_SERVE: '' },
    });
    let code = null;
    p.on('exit', (c) => { code = c; });
    p.on('close', (c) => ok(c ?? code));
  });
  assert.equal(res, 1);
  assert.ok(existsSync(file), 'hub.json untouched');
});

test('hub.json written 0600 in a 0700 dir (atomic tmp+rename)', () => {
  const { dir, file } = hubPaths(home);
  assert.ok(existsSync(file));
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(file).mode & 0o777, 0o600);
});
