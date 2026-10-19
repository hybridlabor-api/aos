import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub } from '../lib/hub/server.mjs';
import { createProxy } from '../lib/hub/proxy.mjs';

const closers = [];
after(() => { for (const c of closers) c(); });

const listen = (handler) => new Promise((ok) => {
  const s = createServer(handler);
  s.listen(0, '127.0.0.1', () => { closers.push(() => { s.close(); s.closeAllConnections(); }); ok(s.address().port); });
});

const seen = [];
const upstream = () => listen((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    seen.push({ fwd: req.headers['x-forwarded-prefix'], method: req.method, url: req.url, host: req.headers.host, origin: req.headers.origin, token: req.headers['x-aos-hub-token'], body });
    if (req.url.startsWith('/events')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: one\n\n');
      setTimeout(() => { res.write('data: two\n\n'); res.end(); }, 50);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'x-up': '1' });
    res.end(JSON.stringify({ path: req.url }));
  });
});

const home = mkdtempSync(join(tmpdir(), 'aos-hub-proxy-'));
const memb = await upstream();
const canvas = await upstream();
const safe = await upstream();
const trailA = await upstream();
const trailB = await upstream();
const dead = await new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
let live = [trailA, trailB];

const proxy = createProxy({
  routes: [
    { prefix: '/memb', port: memb },
    { prefix: '/canvas', port: canvas },
    { prefix: '/relative', port: safe, safe: true },
    { prefix: '/dead', port: dead },
    { prefix: '/trail', trail: true },
    { prefix: '/store', redirect: '/?tab=store' },
  ],
  trailPorts: async () => live,
});
const hub = createHub({ port: 0, home, ctx: { proxy } });
await hub.listen();
closers.push(() => hub.close());
const port = hub.server.address().port;
const base = `http://127.0.0.1:${port}`;
const get = (path, headers = {}, method = 'GET', body) => new Promise((ok, bad) => {
  const r = request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
    let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text: t }));
  });
  r.on('error', bad);
  r.end(body);
});

test('API-style GET is proxied with the prefix stripped, query kept, Host pinned to the upstream', async () => {
  seen.length = 0;
  const r = await get('/memb/api/nodes?x=1', { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.text).path, '/api/nodes?x=1');
  assert.equal(r.headers['x-up'], '1');
  assert.equal(seen[0].host, `127.0.0.1:${memb}`);
});

test('prefix root maps to /', async () => {
  const bare = await get('/memb?a=1', { 'sec-fetch-mode': 'cors' });
  assert.equal(bare.status, 302);
  assert.equal(bare.headers.location, '/memb/?a=1');
  const r = await get('/memb/', { 'sec-fetch-mode': 'cors' });
  assert.equal(JSON.parse(r.text).path, '/');
});

test('browser navigation to a tool that emits absolute URLs redirects to its own port', async () => {
  const r = await get('/canvas/canvas/abc?k=1', { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, `http://127.0.0.1:${canvas}/canvas/abc?k=1`);
});

test('a prefix-safe tool is proxied even for navigations', async () => {
  const r = await get('/relative/page', { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate' });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.text).path, '/page');
});

test('SSE streams through chunk by chunk', async () => {
  const chunks = [];
  await new Promise((ok, bad) => {
    const r = request({ host: '127.0.0.1', port, path: '/memb/events', headers: { host: `127.0.0.1:${port}`, 'sec-fetch-mode': 'cors' } }, (res) => {
      assert.equal(res.headers['content-type'], 'text/event-stream');
      res.on('data', (c) => chunks.push(String(c)));
      res.on('end', ok);
    });
    r.on('error', bad); r.end();
  });
  assert.equal(chunks.join(''), 'data: one\n\ndata: two\n\n');
  assert.ok(chunks.length >= 2, 'arrived in separate chunks');
});

test('mutations need the hub token; the token is not forwarded', async () => {
  seen.length = 0;
  const h = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };
  assert.equal((await get('/memb/api/x', h, 'POST', '{}')).status, 401);
  assert.equal(seen.length, 0);
  const ok = await get('/memb/api/x', { ...h, 'x-aos-hub-token': hub.token, origin: base }, 'POST', '{"a":1}');
  assert.equal(ok.status, 200);
  assert.equal(seen[0].body, '{"a":1}');
  assert.equal(seen[0].token, undefined);
  assert.equal(seen[0].origin, `http://127.0.0.1:${memb}`);
});

test('hub guards still apply: bad host, bad origin, cross-site', async () => {
  assert.equal((await get('/memb/x', { host: 'evil.test' })).status, 403);
  assert.equal((await get('/memb/x', { origin: 'http://evil.test' })).status, 403);
  assert.equal((await get('/memb/x', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' })).status, 403);
  assert.equal((await get('/memb/x', { 'sec-fetch-site': 'same-site' })).status, 403);
});

test('dead upstream gives 502, prefix lookalikes and dot segments are not proxied', async () => {
  assert.equal((await get('/dead/x', { 'sec-fetch-mode': 'cors' })).status, 502);
  assert.equal((await get('/membership', { 'sec-fetch-mode': 'cors' })).status, 404);
  assert.equal((await get('/memb/../api/health', { 'sec-fetch-mode': 'cors' })).status, 404);
});

test('trail: first live map, explicit port only when live, 502 when none', async () => {
  const cors = { 'sec-fetch-mode': 'cors' };
  assert.equal(JSON.parse((await get('/trail/world', cors)).text).path, '/world');
  assert.equal(seen.at(-1).host, `127.0.0.1:${trailA}`);
  const b = await get(`/trail/${trailB}/world`, cors);
  assert.equal(JSON.parse(b.text).path, '/world');
  assert.equal(seen.at(-1).host, `127.0.0.1:${trailB}`);
  const nav = await get(`/trail/${trailB}/`, { 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none' });
  assert.equal(nav.headers.location, `http://127.0.0.1:${trailB}/`);
  assert.equal(JSON.parse((await get('/trail/9999/world', cors)).text).path, '/9999/world', 'not a live port: sent to the first map as a plain path');
  live = [];
  assert.equal((await get('/trail/world', cors)).status, 502);
  live = [trailA, trailB];
});

test('/store lands on the hub store tab', async () => {
  const r = await get('/store', { 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/?tab=store');
});

test('hub own routes are untouched', async () => {
  const r = await get('/ui/hub.css', { 'sec-fetch-site': 'same-origin' });
  assert.equal(r.status, 200);
});

test('every proxied route sends X-Forwarded-Prefix and overrides a client-supplied one', async () => {
  await get('/memb/api/x', { 'sec-fetch-mode': 'cors', 'x-forwarded-prefix': '/evil' });
  assert.equal(seen.at(-1).fwd, '/memb');
  await get(`/trail/${trailB}/world`, { 'sec-fetch-mode': 'cors' });
  assert.equal(seen.at(-1).fwd, `/trail/${trailB}`);
});
