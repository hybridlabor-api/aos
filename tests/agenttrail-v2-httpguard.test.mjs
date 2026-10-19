import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';

import {
  hostOk, originOk, contentTypeOk, csrfOk, sameOriginFetchSite, csrfToken,
  securityHeaders, readJson, MAX_BODY_BYTES,
} from '../skills/global_config/agenttrail/lib/httpguard.mjs';

const PORT = 5399;

function guardApp(token) {
  return async (req, res) => {
    const click = req.url.startsWith('/v1/gate/');
    securityHeaders(res);
    if (req.method === 'OPTIONS') { res.writeHead(405).end(); return }
    if (!hostOk(req.headers.host, PORT, { click })) { res.writeHead(421).end('bad host'); return }
    if (req.headers['sec-fetch-site'] !== undefined && !sameOriginFetchSite(req.headers)) { res.writeHead(403).end('fetch site'); return }
    if (req.method !== 'GET') {
      if (!csrfOk(req.headers, token)) { res.writeHead(403).end('csrf'); return }
      if (click && !originOk(req.headers.origin, PORT)) { res.writeHead(403).end('origin'); return }
      const body = await readJson(req, res)
      if (!body.ok) { return }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body.value))
      return
    }
    res.writeHead(200).end('ok')
  };
}

let server;
let token;
let base;

const request = (opts, body) => new Promise((resolve, reject) => {
  // undefined means "omit this header"; a fresh socket per request keeps the
  // oversize test's socket teardown from poisoning the next assertion.
  const headers = Object.fromEntries(Object.entries(opts.headers || {}).filter(([, v]) => v !== undefined));
  const req = http.request({ host: '127.0.0.1', port: PORT, agent: false, ...opts, headers }, (res) => {
    let data = '';
    res.on('data', (c) => { data += c });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
  });
  req.on('error', reject);
  if (body !== undefined) req.write(body);
  req.end();
});

const clickPost = (extra = {}, body = JSON.stringify({ decision: 'allow' })) => request({
  method: 'POST',
  path: '/v1/gate/challenge',
  headers: {
    host: `localhost:${PORT}`,
    origin: `http://localhost:${PORT}`,
    'content-type': 'application/json',
    'x-trail-csrf': token,
    ...extra,
  },
}, body);

before(async () => {
  token = csrfToken();
  server = http.createServer(guardApp(token));
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  base = `http://127.0.0.1:${PORT}`;
});
after(() => new Promise((r) => server.close(r)));

describe('hostOk', () => {
  test('exact loopback hosts are accepted', () => {
    assert.equal(hostOk(`localhost:${PORT}`, PORT), true);
    assert.equal(hostOk(`127.0.0.1:${PORT}`, PORT), true);
  });

  test('read routes refuse anything but the two exact hosts', () => {
    assert.equal(hostOk(`localhost.evil.com:${PORT}`, PORT), false);
    assert.equal(hostOk(`localhost:${PORT}.evil.com`, PORT), false);
    assert.equal(hostOk(`evil-localhost:${PORT}`, PORT), false);
    assert.equal(hostOk(`LOCALHOST:${PORT}`, PORT), false);
    assert.equal(hostOk(`localhost`, PORT), false);
    assert.equal(hostOk(`[::1]:${PORT}`, PORT), false);
  });

  test('a missing host is refused', () => {
    assert.equal(hostOk(undefined, PORT), false);
    assert.equal(hostOk('', PORT), false);
    assert.equal(hostOk(null, PORT), false);
  });

  test('click routes accept only the localhost host', () => {
    assert.equal(hostOk(`localhost:${PORT}`, PORT, { click: true }), true);
    assert.equal(hostOk(`127.0.0.1:${PORT}`, PORT, { click: true }), false);
  });

  test('the wrong port is refused', () => {
    assert.equal(hostOk('localhost:1234', PORT), false);
  });
});

describe('originOk', () => {
  test('only the exact click origin is accepted', () => {
    assert.equal(originOk(`http://localhost:${PORT}`, PORT), true);
  });

  test('missing, null, foreign and https origins are refused', () => {
    assert.equal(originOk(undefined, PORT), false);
    assert.equal(originOk('null', PORT), false);
    assert.equal(originOk(`http://localhost.evil.com:${PORT}`, PORT), false);
    assert.equal(originOk(`https://localhost:${PORT}`, PORT), false);
    assert.equal(originOk(`http://127.0.0.1:${PORT}`, PORT), false);
    assert.equal(originOk(`http://localhost:${PORT}/evil`, PORT), false);
  });
});

describe('content type and csrf', () => {
  test('the content type must be exactly application/json', () => {
    assert.equal(contentTypeOk({ headers: { 'content-type': 'application/json' } }), true);
    assert.equal(contentTypeOk({ headers: { 'content-type': 'application/json; charset=utf-8' } }), false);
    assert.equal(contentTypeOk({ headers: { 'content-type': 'text/plain' } }), false);
    assert.equal(contentTypeOk({ headers: {} }), false);
  });

  test('the csrf header must equal the per-process token', () => {
    assert.equal(csrfOk({ 'x-trail-csrf': token }, token), true);
    assert.equal(csrfOk({ 'x-trail-csrf': 'guess' }, token), false);
    assert.equal(csrfOk({}, token), false);
  });

  test('csrfToken is long, random and different per call', () => {
    const a = csrfToken();
    const b = csrfToken();
    assert.ok(a.length >= 32);
    assert.notEqual(a, b);
  });

  test('Sec-Fetch-Site is only checked when present', () => {
    assert.equal(sameOriginFetchSite({}), true);
    assert.equal(sameOriginFetchSite({ 'sec-fetch-site': 'same-origin' }), true);
    assert.equal(sameOriginFetchSite({ 'sec-fetch-site': 'cross-site' }), false);
    assert.equal(sameOriginFetchSite({ 'sec-fetch-site': 'none' }), false);
  });
});

describe('guarded server', () => {
  test('a good click request is accepted', async () => {
    const r = await clickPost();
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { decision: 'allow' });
  });

  test('a foreign Host is 421', async () => {
    const r = await clickPost({ host: `localhost.evil.com:${PORT}` });
    assert.equal(r.status, 421);
  });

  test('127.0.0.1 as Host on a click route is 421', async () => {
    const r = await clickPost({ host: `127.0.0.1:${PORT}` });
    assert.equal(r.status, 421);
  });

  test('a missing Origin on a click route is 403', async () => {
    const r = await clickPost({ origin: undefined });
    assert.equal(r.status, 403);
  });

  test('a null Origin is 403', async () => {
    const r = await clickPost({ origin: 'null' });
    assert.equal(r.status, 403);
  });

  test('a missing csrf header is 403', async () => {
    const r = await clickPost({ 'x-trail-csrf': undefined });
    assert.equal(r.status, 403);
  });

  test('a wrong csrf value is 403', async () => {
    const r = await clickPost({ 'x-trail-csrf': 'nope' });
    assert.equal(r.status, 403);
  });

  test('a cross-site Sec-Fetch-Site is 403', async () => {
    const r = await clickPost({ 'sec-fetch-site': 'cross-site' });
    assert.equal(r.status, 403);
  });

  test('text/plain is rejected on a state-changing route', async () => {
    const r = await clickPost({ 'content-type': 'text/plain' });
    assert.equal(r.status, 415);
  });

  test('application/json with a charset is rejected', async () => {
    const r = await clickPost({ 'content-type': 'application/json; charset=utf-8' });
    assert.equal(r.status, 415);
  });

  test('a body over the cap is 413', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(MAX_BODY_BYTES + 64) });
    const r = await clickPost({}, big);
    assert.equal(r.status, 413);
  });

  test('malformed JSON is 400', async () => {
    const r = await clickPost({}, '{ not json');
    assert.equal(r.status, 400);
  });

  test('OPTIONS is 405 with no CORS headers', async () => {
    const r = await request({ method: 'OPTIONS', path: '/v1/gate/challenge', headers: { host: `localhost:${PORT}` } });
    assert.equal(r.status, 405);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
    assert.equal(r.headers['access-control-allow-credentials'], undefined);
  });

  test('no response ever carries an Access-Control-* header', async () => {
    for (const r of [await clickPost(), await clickPost({ origin: 'null' }), await clickPost({ host: 'evil' }), await request({ method: 'GET', path: '/x', headers: { host: `localhost:${PORT}` } })]) {
      for (const h of Object.keys(r.headers)) assert.ok(!h.toLowerCase().startsWith('access-control-'), `${h} leaked`);
    }
  });

  test('every response carries the security headers', async () => {
    const r = await clickPost();
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);

    // Opt-in via env: frame-ancestors lists the origin and X-Frame-Options is dropped
    const oldEnv = process.env.AOS_EMBED_ANCESTORS;
    try {
      process.env.AOS_EMBED_ANCESTORS = 'tauri://localhost';
      const r2 = await clickPost();
      assert.equal(r2.headers['x-frame-options'], undefined);
      assert.match(r2.headers['content-security-policy'], /frame-ancestors 'self' tauri:\/\/localhost;/);
    } finally {
      if (oldEnv === undefined) delete process.env.AOS_EMBED_ANCESTORS;
      else process.env.AOS_EMBED_ANCESTORS = oldEnv;
    }
  });

  test('an HTTP/1.0 request without a Host header is refused', async () => {
    const raw = await new Promise((resolve, reject) => {
      const sock = net.connect(PORT, '127.0.0.1', () => sock.write('GET /x HTTP/1.0\r\n\r\n'));
      let data = '';
      sock.on('data', (c) => { data += c; sock.end() });
      sock.on('close', () => resolve(data));
      sock.on('error', reject);
    });
    assert.match(raw, /HTTP\/1\.[01] 421/);
  });

  test('GET on the guarded server still needs the exact host', async () => {
    assert.equal((await request({ method: 'GET', path: '/x', headers: { host: `localhost:${PORT}` } })).status, 200);
    assert.equal((await request({ method: 'GET', path: '/x', headers: { host: `localhost.evil.com:${PORT}` } })).status, 421);
  });
});

describe('base url', () => {
  test('sanity: the test server is reachable on loopback only', () => {
    assert.equal(base, `http://127.0.0.1:${PORT}`);
  });
});