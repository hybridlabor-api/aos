import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import {
  COOKIE_NAME,
  MAX_BODY,
  GuardError,
  checkRequest,
  cookieToken,
  fetchSiteReadOnlyOk,
  fetchSiteWriteOk,
  hostAllowed,
  issueCookie,
  newToken,
  originAllowed,
  originHostMatch,
  parseCookies,
  queryHasToken,
  readBody,
  shaToken,
  tokenOk,
} from '../lib/annotation/guard.mjs';

const PORT = 48161;
const TOKEN = newToken();
const SHA = shaToken(TOKEN);

let server;
before(async () => {
  server = http.createServer(async (req, res) => {
    try {
      checkRequest(req, { port: PORT, tokenSha: SHA });
    } catch (err) {
      const code = err instanceof GuardError ? err.code : 'E_INTERNAL';
      const status = err instanceof GuardError ? 403 : 500;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code }));
      return;
    }
    if (req.method === 'POST') {
      try {
        const body = await readBody(req);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, bytes: body.length }));
      } catch (err) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: err.code ?? 'E_BODY' }));
      }
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
});
after(() => new Promise((resolve) => server.close(resolve)));

function request({ method = 'GET', path = '/aos-api/annotations/collect', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, method, path, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.end(body);
    else req.end();
  });
}

const baseHeaders = () => ({
  cookie: `${COOKIE_NAME}=${TOKEN}`,
  origin: `http://127.0.0.1:${PORT}`,
});

test('unit: host/origin allowlist is exact, loopback spellings only', () => {
  assert.ok(hostAllowed(`127.0.0.1:${PORT}`, PORT));
  assert.ok(hostAllowed(`localhost:${PORT}`, PORT));
  assert.equal(hostAllowed('evil.example', PORT), false);
  assert.equal(hostAllowed('evil-x:whatever', PORT), false);
  assert.equal(hostAllowed(`127.0.0.1:${PORT + 1}`, PORT), false);
  assert.equal(hostAllowed('127.0.0.1', PORT), false);
  assert.equal(hostAllowed('0.0.0.0', PORT), false);
  assert.equal(hostAllowed('127.0.0.1:0', PORT), false);
  assert.equal(originAllowed(`http://127.0.0.1:${PORT}`, PORT), true);
  assert.equal(originAllowed(`http://localhost:${PORT}`, PORT), true);
  assert.equal(originAllowed('null', PORT), false);
  assert.equal(originAllowed(`http://127.0.0.1:${PORT}/x`, PORT), false);
  assert.equal(originAllowed('https://127.0.0.1:48161', PORT), false);
});

test('unit: origin and Host must agree (no 127-vs-localhost mismatch)', () => {
  assert.ok(originHostMatch(`http://localhost:${PORT}`, `localhost:${PORT}`, PORT));
  assert.equal(originHostMatch(`http://localhost:${PORT}`, `127.0.0.1:${PORT}`, PORT), false);
});

test('unit: token compare is constant-time over sha256 and exact', () => {
  assert.ok(tokenOk(TOKEN, SHA));
  assert.equal(tokenOk(TOKEN.slice(0, -1) + (TOKEN.endsWith('a') ? 'b' : 'a'), SHA), false);
  assert.equal(tokenOk(`token=${TOKEN}`, SHA), false);
});

test('unit: cookie parser and issued cookie shape', () => {
  assert.equal(cookieToken(`${COOKIE_NAME}=${TOKEN}; other=x`), TOKEN);
  assert.equal(cookieToken('x=1'), null);
  const set = issueCookie(TOKEN, 60);
  assert.match(set, new RegExp(`^${COOKIE_NAME}=${TOKEN}; HttpOnly; SameSite=Strict; Path=/aos-api; Max-Age=60$`));
  assert.doesNotMatch(set, /Domain=/);
  assert.doesNotMatch(set, /Secure/);
});

test('unit: token in the query string is refused for every known key', () => {
  assert.ok(queryHasToken('/x?token=abc'));
  assert.ok(queryHasToken('/x?a=1&access_token=abc'));
  assert.ok(queryHasToken('/x?t=abc'));
  assert.equal(queryHasToken('/x?a=1'), false);
  assert.equal(queryHasToken('/x'), false);
});

test('unit: Sec-Fetch-Site rules — same-origin reads and writes only', () => {
  assert.ok(fetchSiteReadOnlyOk('same-origin'));
  assert.ok(fetchSiteReadOnlyOk('none'));
  assert.ok(fetchSiteReadOnlyOk(undefined));
  assert.equal(fetchSiteReadOnlyOk('cross-site'), false);
  assert.equal(fetchSiteReadOnlyOk('same-site'), false);
  assert.ok(fetchSiteWriteOk('same-origin'));
  assert.ok(fetchSiteWriteOk(undefined));
  assert.equal(fetchSiteWriteOk('same-site'), false);
  assert.equal(fetchSiteWriteOk('cross-site'), false);
  assert.equal(fetchSiteWriteOk('none'), false);
});

test('unit: readBody caps declared and streamed size (Readable fake, no hang)', async () => {
  const fake = (buf, declared) => {
    const r = new Readable({ read() {} });
    r.headers = { 'content-length': declared };
    r.push(buf);
    r.push(null);
    return r;
  };
  const small = await readBody(fake(Buffer.from('hello'), 5), 10);
  assert.equal(small.toString(), 'hello');
  await assert.rejects(
    () => readBody(fake(Buffer.alloc(11, 65), 11), 10),
    (err) => err instanceof GuardError && err.code === 'E_BODY',
  );
  await assert.rejects(
    () => readBody(fake(Buffer.from(''), 11), 10),
    (err) => err instanceof GuardError && err.code === 'E_BODY',
  );
});

test('integration: gold path GET and POST with correct cookie, origin and type', async () => {
  const get = await request({ headers: baseHeaders() });
  assert.equal(get.status, 200);
  const post = await request({
    method: 'POST',
    path: '/aos-api/annotations/note',
    headers: { ...baseHeaders(), 'content-type': 'application/json' },
    body: '{"body":"please fix"}',
  });
  assert.equal(post.status, 200);
  assert.equal(JSON.parse(post.body).bytes, 21);
});

test('integration: wrong Host (exact binding, no suffix match)', async () => {
  const res = await request({ headers: { ...baseHeaders(), host: 'evil.example' } });
  assert.equal(res.status, 403);
  assert.equal(JSON.parse(res.body).code, 'E_HOST');
});

test('integration: DNS-rebinding-style Host refused', async () => {
  const res = await request({ headers: { ...baseHeaders(), host: '127.0.0.1.evil.example' } });
  assert.equal(res.status, 403);
  assert.equal(JSON.parse(res.body).code, 'E_HOST');
});

test('integration: missing Origin refused', async () => {
  const headers = baseHeaders();
  delete headers.origin;
  const res = await request({ headers });
  assert.equal(res.status, 403);
  assert.equal(JSON.parse(res.body).code, 'E_ORIGIN');
});

test('integration: wrong Origin (other port, other scheme, localhost-vs-127 mismatch)', async () => {
  for (const origin of [`http://127.0.0.1:${PORT + 1}`, `https://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]) {
    const res = await request({ headers: { ...baseHeaders(), origin } });
    assert.equal(res.status, 403, origin);
    assert.equal(JSON.parse(res.body).code, 'E_ORIGIN', origin);
  }
});

test('integration: bad and missing token cookie', async () => {
  const bad = await request({ headers: { ...baseHeaders(), cookie: `${COOKIE_NAME}=${'f'.repeat(64)}` } });
  assert.equal(bad.status, 403);
  assert.equal(JSON.parse(bad.body).code, 'E_TOKEN');
  const missing = await request({ headers: { ...baseHeaders(), cookie: 'other=1' } });
  assert.equal(missing.status, 403);
  assert.equal(JSON.parse(missing.body).code, 'E_TOKEN');
  const nocookieHeaders = baseHeaders();
  delete nocookieHeaders.cookie;
  const nocookie = await request({ headers: nocookieHeaders });
  assert.equal(nocookie.status, 403);
  assert.equal(JSON.parse(nocookie.body).code, 'E_TOKEN');
});

test('integration: token in the query string refused even with valid cookie', async () => {
  const res = await request({ headers: baseHeaders(), path: `/aos-api/collect?token=${TOKEN}` });
  assert.equal(res.status, 403);
  assert.equal(JSON.parse(res.body).code, 'E_QUERY_TOKEN');
});

test('integration: oversized body (declared) rejected with E_BODY', async () => {
  const res = await request({
    method: 'POST',
    path: '/aos-api/annotations/note',
    headers: { ...baseHeaders(), 'content-type': 'application/json', 'content-length': String(MAX_BODY + 1) },
    body: Buffer.alloc(MAX_BODY + 1, 65).toString('binary'),
  });
  assert.equal(res.status, 403);
  assert.equal(JSON.parse(res.body).code, 'E_BODY');
});

test('integration: write with wrong content type refused', async () => {
  const res = await request({
    method: 'POST',
    path: '/aos-api/annotations/note',
    headers: { ...baseHeaders(), 'content-type': 'text/plain' },
    body: 'hi',
  });
  assert.equal(res.status, 403);
  assert.equal(JSON.parse(res.body).code, 'E_METHOD');
});

test('integration: cross-site and same-site fetch metadata refused', async () => {
  for (const site of ['cross-site', 'same-site']) {
    const res = await request({ headers: { ...baseHeaders(), 'sec-fetch-site': site } });
    assert.equal(res.status, 403, site);
    assert.equal(JSON.parse(res.body).code, 'E_FETCH_SITE', site);
  }
});

test('integration: non-GET/POST methods refused', async () => {
  for (const method of ['PUT', 'DELETE']) {
    const res = await request({ method, headers: { ...baseHeaders(), 'content-type': 'application/json' } });
    assert.equal(res.status, 403, method);
    assert.equal(JSON.parse(res.body).code, 'E_METHOD', method);
  }
});
