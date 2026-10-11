import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { createServer as createServer_fwd } from 'node:http';
import { connect as netConnect } from 'node:net';
import { mkdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHub } from '../lib/hub/server.mjs';
import { routes as planRoutes, probeTrailPorts } from '../lib/hub/routes-plans.mjs';
import { hubPaths, writeHubJson, readHubJson, killViaPs, parseArgv } from '../bin/aos-hub.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
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
  {
    method: 'GET', path: '/api/test/boom',
    handler: async () => { throw new Error('secret detail that must not leak'); },
  },
  {
    method: 'POST', path: '/api/test/ctx', mutates: true,
    handler: async ({ ctx }) => ({ status: 200, json: { hasCleanEnv: 'cleanEnv' in ctx, tokenLeaked: 'AOS_HUB_TOKEN' in (ctx.cleanEnv || {}) } }),
  },
  {
    method: 'GET', path: /^\/api\/re\/([^/?]+)$/,
    handler: ({ params }) => ({ status: 200, json: { isArray: Array.isArray(params), params } }),
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

// ---- finding 5: request targets ----
const rawSocket = (targetLine, method = 'GET') => new Promise((ok, fail) => {
  const port = hub.server.address().port;
  const s = netConnect(port, '127.0.0.1');
  let data = '';
  s.on('connect', () => {
    s.write(`${method} ${targetLine} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
  });
  s.on('data', (c) => { data += String(c); });
  s.on('end', () => ok({ status: Number(data.split(' ')[1]) }));
  s.on('error', fail);
});

test('request targets: //x and absolute-form rejected 400; backslash/dots/NUL -> 404', async () => {
  assert.equal((await rawSocket('//x')).status, 400);
  assert.equal((await rawSocket('http://evil.com/x')).status, 400);
  assert.equal((await raw('/a\\b')).status, 404);
  assert.equal((await raw('/a/%2e%2e/b')).status, 404);
  assert.equal((await raw('/a/%00/b')).status, 404);
  assert.equal((await raw('/api/health?x=1')).status, 200);
});

test('hub.json written 0600 in a 0700 dir (atomic tmp+rename)', () => {
  const { dir, file } = hubPaths(home);
  assert.ok(existsSync(file));
  if (process.platform !== 'win32') {
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  }
});

// ---- finding 8: anchored RegExp routes + capture validation ----
test('regex routes must be anchored at createHub time', () => {
  assert.throws(() => createHub({ port: 0, home, routes: [{ method: 'GET', path: /api\/unanchored/, handler: () => ({ status: 200, json: {} }) }], ctx: { root } }),
    /anchored/);
});

test('regex route params: array of decoded captures, charset-validated (404 otherwise)', async () => {
  const good = await raw('/api/re/abc-1_2');
  assert.equal(good.status, 200);
  const j = JSON.parse(good.body);
  assert.equal(j.isArray, true);
  assert.deepEqual(j.params, ['abc-1_2']);
  assert.equal((await raw('/api/re/ab%2Fc')).status, 404);
  assert.equal((await raw('/api/re/ab.c')).status, 404);
});

// ---- finding 7: generic 500 body, no error text leaked ----
test('500 responses: generic body with 8-hex id, handler message never leaked', async () => {
  const res = await raw('/api/test/boom');
  assert.equal(res.status, 500);
  const j = JSON.parse(res.body);
  assert.equal(j.error, 'internal error');
  assert.match(j.id, /^[0-9a-f]{8}$/);
  assert.doesNotMatch(res.body, /secret detail/);
});

// ---- finding 6: spawn helpers get a scrubbed env ----
test('ctx.cleanEnv (spawn-helper env) never contains AOS_HUB_TOKEN', async () => {
  process.env.AOS_HUB_TOKEN = 'leaky';
  const h2 = createHub({
    port: 0, home, routes: [{
      method: 'GET', path: '/api/test/env',
      handler: ({ ctx }) => ({ status: 200, json: { leaked: 'AOS_HUB_TOKEN' in ctx.cleanEnv } }),
    }], ctx: { root },
  });
  delete process.env.AOS_HUB_TOKEN;
  await h2.listen();
  const port2 = h2.server.address().port;
  const out = await new Promise((ok, fail) => request(`http://127.0.0.1:${port2}/api/test/env`, {
    headers: { host: `127.0.0.1:${port2}` },
  }, (r) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => ok({ status: r.statusCode, body: d })); }).on('error', fail).end());
  assert.equal(out.status, 200);
  assert.deepEqual(JSON.parse(out.body), { leaked: false });
  await h2.close();
});

// ---- finding 10: /api/trail 2 s cache on an injectable clock ----
test('/api/trail result cached for 2 s (injectable ctx.now)', async () => {
  const rp = await import('../lib/hub/routes-plans.mjs');
  let hits = 0;
  let fixture = null;
  let fixturePort = null;
  for (const p of rp.TRAIL_PORTS) {
    try {
      const s = createServer_fwd((req, res) => { hits += 1; res.writeHead(200); res.end('ok'); });
      await new Promise((ok, bad) => { s.once('error', bad); s.listen(p, '127.0.0.1', () => ok()); });
      fixture = s;
      fixturePort = p;
      break;
    } catch (e) {
      if (!String(e && e.code || e).includes('EADDRINUSE')) throw e;
    }
  }
  assert.ok(fixture, 'no free trail port for fixture');

  let fakeNow = 10_000_000;
  const hub5 = createHub({ port: 0, home, routes: [...rp.routes], ctx: { root, now: () => fakeNow } });
  await hub5.listen();
  const b5 = `http://127.0.0.1:${hub5.server.address().port}`;
  const getTrail = () => new Promise((ok, fail) => request(`${b5}/api/trail`, {}, (r) => {
    let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => ok(JSON.parse(d)));
  }).on('error', fail).end());

  const r1 = await getTrail();
  assert.equal(r1.live.includes(fixturePort), true);
  assert.equal(hits, 1);
  fakeNow += 1000; // within the 2 s window -> cached, no new probe
  const r2 = await getTrail();
  assert.equal(hits, 1);
  assert.deepEqual(r2.live, r1.live);
  fakeNow += 3000; // cache expired -> fresh probe
  const r3 = await getTrail();
  assert.equal(hits, 2);
  assert.equal(r3.live.includes(fixturePort), true);
  await hub5.close();
  fixture.close();
});

// ---- findings 1 + 2 + 3: the real serve-mode child end to end ----
test('serve-mode child: imports route graph, binds, writes hub.json after listen, POST shutdown -> clean exit + hub.json gone', async () => {
  const homeServe = join(tmp, 'serve-home');
  mkdirSync(homeServe, { recursive: true });
  const serveToken = 'f'.repeat(64);
  const portNum = 10000 + (Date.now() % 20000);
  const child = spawn(process.execPath, [join(root, 'bin', 'aos-hub.mjs'), '--serve', '--port', String(portNum)], {
    env: { ...process.env, AOS_HUB_SERVE: '1', AOS_HUB_TOKEN: serveToken, AOS_HUB_HOME: homeServe, AOS_HUB_CHILD_DONE: '' },
    stdio: 'ignore',
  });
  const { file } = hubPaths(homeServe);
  let rec = null;
  for (let i = 0; i < 40 && !rec; i++) {
    await new Promise((ok) => setTimeout(ok, 250));
    rec = readHubJson(homeServe);
  }
  assert.ok(rec, 'child never wrote hub.json (import graph or bind failed)');
  assert.equal(rec.port, portNum);
  assert.equal(rec.token, serveToken);
  assert.equal(Number.isInteger(rec.pid) && rec.pid > 0, true);
  const health = await fetch(`http://127.0.0.1:${rec.port}/api/health`);
  assert.equal(health.status, 200);
  const res = await fetch(`http://127.0.0.1:${rec.port}/api/shutdown`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-aos-hub-token': serveToken },
    body: JSON.stringify({ confirm: 'hub' }),
  });
  assert.equal(res.status, 200);
  const exit = await Promise.race([
    new Promise((ok) => child.once('exit', (c) => ok(c))),
    new Promise((ok) => setTimeout(() => ok('timeout'), 5000)),
  ]);
  assert.notEqual(exit, 'timeout', 'child did not exit after shutdown');
  assert.equal(exit, 0);
  await new Promise((ok) => setTimeout(ok, 50));
  assert.equal(existsSync(file), false, 'hub.json removed only after the reply was sent');
});

test('failed start (port busy) reports failure and never clobbers hub.json', async () => {
  const homeFail = join(tmp, 'fail-home');
  mkdirSync(homeFail, { recursive: true });
  writeHubJson(homeFail, { pid: 424242, port: 59996, version: 'sentinel', token: 'y'.repeat(64) });
  const { file } = hubPaths(homeFail);
  const before6 = readFileSync(file, 'utf8');
  const blocker = createServer_fwd(() => {});
  await new Promise((ok, bad) => { blocker.once('error', bad); blocker.listen(59996, '127.0.0.1', ok); });
  const prevHome = process.env.AOS_HUB_HOME;
  const prevServe = process.env.AOS_HUB_SERVE;
  process.env.AOS_HUB_HOME = homeFail;
  process.env.AOS_HUB_SERVE = '';
  try {
    const { cli } = await import('../bin/aos-hub.mjs');
    const code = await cli(['start', '--port', '59996', '--no-open']);
    assert.equal(code, 1, 'start reports failure');
  } finally {
    process.env.AOS_HUB_HOME = prevHome;
    process.env.AOS_HUB_SERVE = prevServe || '';
    blocker.close();
  }
  assert.equal(readFileSync(file, 'utf8'), before6, 'hub.json untouched');
});

// ---- finding 4: ps fallback verification ----
test('killViaPs: invalid pids rejected; marker + --port must all match', async () => {
  let psCalls = 0;
  const runPs = async () => { psCalls += 1; return { ok: true, text: 'node /x/aos-hub.mjs --serve --port 7900' }; };
  assert.equal(await killViaPs('abc', { runPs }), false);
  assert.equal(await killViaPs('-5', { runPs }), false);
  assert.equal(await killViaPs(0, { runPs }), false);
  assert.equal(await killViaPs(process.pid, { runPs }), false, 'never kills its own pid');
  assert.equal(psCalls, 0, 'no ps run for invalid pids');
  assert.equal(await killViaPs(42424284, { runPs: async () => ({ ok: true, text: 'node /x/aos-hub.mjs --port 7900' }), port: '7900' }), false);
  assert.equal(await killViaPs(42424284, { runPs: async () => ({ ok: true, text: 'node /x/aos-hub.mjs --serve --port 1111' }), port: '7900' }), false);
  const helper = spawn(process.execPath, ['-e', 'setInterval(()=>{},50)'], { stdio: 'ignore' });
  const ok2 = await killViaPs(helper.pid, { runPs: async () => ({ ok: true, text: 'node /x/aos-hub.mjs --serve --port 7900' }), port: '7900' });
  assert.equal(ok2, true);
  const exit = await Promise.race([
    new Promise((ok) => helper.once('exit', (c) => ok(c))),
    new Promise((ok) => setTimeout(() => ok('timeout'), 3000)),
  ]);
  assert.notEqual(exit, 'timeout', 'SIGTERM did not reach the verified process');
});

// ---- finding 9: --tab validated before it reaches a URL ----
test('parseArgv rejects --tab values outside [a-z]+', () => {
  for (const bad of ['TAB', 'a1', 'a-b', 'a.b', ''])
    assert.throws(() => parseArgv(['--tab', bad]), `should reject ${JSON.stringify(bad)}`);
  assert.equal(parseArgv(['--tab=plans']).tab, 'plans');
});

// ---- security round: the default ctx.run is the REAL runner (no silent stub) ----
test('defaultRun spawns for real, scrubs the env, resizes timeout, never throws', async () => {
  const { defaultRun } = await import('../lib/hub/server.mjs');
  process.env.AOS_HUB_TOKEN = 'leaky-stub-token';
  process.env.MY_SECRET_1 = 'leaky-secret-value';
  try {
    const out = await defaultRun(process.execPath, ['-e', 'console.log("RAN")']);
    assert.equal(out.ok, true, 'a real child ran');
    assert.match(out.stdout, /RAN/, 'the stub would have faked stdout');
    // env scrub: the child must not see AOS_HUB_TOKEN or secret-shaped vars
    const envProbe = await defaultRun(process.execPath, ['-e', 'console.log(JSON.stringify({ t: process.env.AOS_HUB_TOKEN ?? null, s: process.env.MY_SECRET_1 ?? null, p: !!process.env.PATH }))']);
    const seen = JSON.parse(envProbe.stdout.trim());
    assert.deepEqual(seen, { t: null, s: null, p: true });
    // timeout: the slow child is killed and the promise resolves ok:false
    const timedOut = await defaultRun(process.execPath, ['-e', 'setTimeout(()=>{}, 90000)'], { timeout: 400 });
    assert.equal(timedOut.ok, false);
    // failing child: resolves with ok:false, never throws
    const boom = await defaultRun(process.execPath, ['-e', 'process.exit(3)']);
    assert.equal(boom.ok, false);
    assert.equal(boom.code, 3);
  } finally {
    delete process.env.AOS_HUB_TOKEN;
    delete process.env.MY_SECRET_1;
  }
});

test('a hub without an injected run does not use the old silent stub', async () => {
  const h7 = createHub({
    port: 0, home,
    routes: [{ method: 'GET', path: '/api/test/run-type', handler: ({ ctx }) => ({ status: 200, json: { isReal: typeof ctx.run === 'function', isStub: ctx.run.length <= 3 && ctx.run !== undefined && ctx.run.toString().includes('Promise.resolve') } }) }],
    ctx: { root },
  });
  await h7.listen();
  const p7 = h7.server.address().port;
  const out = await new Promise((ok, fail) => request(`http://127.0.0.1:${p7}/api/test/run-type`, { headers: { host: `127.0.0.1:${p7}` } }, (r) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => ok(JSON.parse(d))); }).on('error', fail).end());
  assert.equal(out.isReal, true);
  assert.equal(out.isStub, false);
  await h7.close();
});

test('portConnectable: a foreign listener is connectable; a dead port is not', async () => {
  const { portConnectable } = await import('../bin/aos-hub.mjs');
  const blocker = createServer_fwd(() => {});
  await new Promise((ok, bad) => { blocker.once('error', bad); blocker.listen(59995, '127.0.0.1', ok); });
  assert.equal(await portConnectable(59995), true);
  assert.equal(await portConnectable(1), false, 'nothing listens on 127.0.0.1:1');
  blocker.close();
});
