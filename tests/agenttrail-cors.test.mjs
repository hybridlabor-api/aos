import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { hostOk, corsOriginAllowed, loadCorsOrigins, corsRead } from '../skills/global_config/agenttrail/lib/httpguard.mjs';

const ALLOWED = [
  'http://localhost', 'https://localhost', 'http://localhost:5330', 'http://127.0.0.1:5330',
  'https://127.0.0.1', 'http://[::1]:5330', 'https://[::1]', 'http://trail.aos.localhost:5330',
  'https://x.localhost', 'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost',
];
const REJECTED = [
  'http://evil.com', 'http://localhost.evil.com', 'http://127.0.0.1.nip.io', 'null', 'file://',
  'http://user@localhost', 'http://user:pw@localhost:5330', 'ftp://localhost', 'tauri://evil', '', 'http://localhost/path',
];

describe('corsOriginAllowed', () => {
  for (const o of ALLOWED) test(`allows ${o}`, () => assert.equal(corsOriginAllowed(o), true));
  for (const o of REJECTED) test(`rejects ${JSON.stringify(o)}`, () => assert.equal(corsOriginAllowed(o), false));
  test('extra exact origin', () => {
    assert.equal(corsOriginAllowed('http://dash.example:3000', ['http://dash.example:3000']), true);
    assert.equal(corsOriginAllowed('http://other.example', ['http://dash.example:3000']), false);
  });
  test('star allows any, but not an absent origin', () => {
    assert.equal(corsOriginAllowed('http://evil.com', ['*']), true);
    assert.equal(corsOriginAllowed(undefined, ['*']), false);
  });
});

describe('hostOk named localhost', () => {
  test('accepts <name>.localhost:port', () => assert.equal(hostOk('trail.aos.localhost:5330', 5330), true));
  test('rejects lookalikes and wrong ports', () => {
    assert.equal(hostOk('localhost.evil.com:5330', 5330), false);
    assert.equal(hostOk('trail.localhost:1', 5330), false);
    assert.equal(hostOk('.localhost:5330', 5330), false);
    assert.equal(hostOk('a b.localhost:5330', 5330), false);
  });
  test('click variant stays strict', () => {
    assert.equal(hostOk('trail.aos.localhost:5330', 5330, { click: true }), false);
    assert.equal(hostOk('127.0.0.1:5330', 5330, { click: true }), false);
    assert.equal(hostOk('localhost:5330', 5330, { click: true }), true);
  });
});

describe('loadCorsOrigins', () => {
  let dir;
  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-cors-')); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const write = (name, text) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; };

  test('file adds origins', () => {
    assert.deepEqual(loadCorsOrigins({}, write('ok.json', '{"corsOrigins":["http://a.example"]}')), ['http://a.example']);
  });
  test('star entry', () => {
    assert.deepEqual(loadCorsOrigins({}, write('star.json', '{"corsOrigins":["*"]}')), ['*']);
  });
  test('missing file is defaults', () => assert.deepEqual(loadCorsOrigins({}, path.join(dir, 'none.json')), []));
  test('malformed file logs once and falls back', () => {
    const logs = [];
    assert.deepEqual(loadCorsOrigins({}, write('bad.json', '{nope'), (m) => logs.push(m)), []);
    assert.deepEqual(loadCorsOrigins({}, write('bad2.json', '{"corsOrigins":"x"}'), (m) => logs.push(m)), []);
    assert.equal(logs.length, 2);
  });
  test('env overrides file', () => {
    assert.deepEqual(loadCorsOrigins({ AOS_TRAIL_CORS_ORIGINS: 'http://e.example, http://f.example' }, write('ok2.json', '{"corsOrigins":["http://a.example"]}')), ['http://e.example', 'http://f.example']);
  });
});

describe('corsRead on read-only routes only', () => {
  let server; let port; let extra = [];
  before(async () => {
    server = http.createServer((req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      if ((p === '/model' || p === '/events') && (req.method === 'OPTIONS' || req.method === 'GET') && corsRead(req, res, extra, port)) return;
      res.writeHead(200).end('ok');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });
  after(() => new Promise((r) => server.close(r)));
  const req = (method, p, origin, hostHeader) => new Promise((resolve, reject) => {
    const headers = origin ? { origin } : {};
    if (hostHeader) headers.host = hostHeader;
    const r = http.request({ host: '127.0.0.1', port, method, path: p, agent: false, headers }, (res) => {
      res.resume(); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    r.on('error', reject); r.end();
  });
  const acao = (h) => h['access-control-allow-origin'];

  test('allowed origin is echoed with Vary', async () => {
    for (const p of ['/model', '/events']) {
      const r = await req('GET', p, 'http://localhost:1234');
      assert.equal(acao(r.headers), 'http://localhost:1234');
      assert.match(r.headers.vary, /Origin/);
    }
  });
  test('rejected origin gets no header', async () => {
    const r = await req('GET', '/model', 'http://evil.com');
    assert.equal(acao(r.headers), undefined);
  });
  test('preflight allowed', async () => {
    const r = await req('OPTIONS', '/events', 'tauri://localhost');
    assert.equal(r.status, 204);
    assert.equal(acao(r.headers), 'tauri://localhost');
    assert.equal(r.headers['access-control-allow-methods'], 'GET');
    assert.equal(r.headers['access-control-allow-headers'], 'cache-control, last-event-id, accept');
    assert.equal(r.headers['access-control-max-age'], '600');
  });
  test('preflight rejected is 403 without Access-Control-*', async () => {
    const r = await req('OPTIONS', '/model', 'http://evil.com');
    assert.equal(r.status, 403);
    assert.deepEqual(Object.keys(r.headers).filter((k) => k.startsWith('access-control-')), []);
  });
  test('bad Host is 403 without Access-Control-* (DNS rebinding)', async () => {
    for (const m of ['GET', 'OPTIONS']) {
      const r = await req(m, '/events', 'http://localhost:1234', `rebind.evil.com:${port}`);
      assert.equal(r.status, 403);
      assert.deepEqual(Object.keys(r.headers).filter((k) => k.startsWith('access-control-')), []);
    }
    const ok = await req('GET', '/model', 'http://localhost:1234', `trail.aos.localhost:${port}`);
    assert.equal(ok.status, 200);
  });
  test('other routes never get Access-Control-*, even with star override', async () => {
    extra = ['*'];
    for (const [m, p] of [['GET', '/answer'], ['OPTIONS', '/answer'], ['GET', '/whoami'], ['OPTIONS', '/spawn']]) {
      const r = await req(m, p, 'http://evil.com');
      assert.deepEqual(Object.keys(r.headers).filter((k) => k.startsWith('access-control-')), [], `${m} ${p}`);
    }
    const ok = await req('GET', '/model', 'http://evil.com');
    assert.equal(acao(ok.headers), 'http://evil.com');
    extra = [];
  });
});
