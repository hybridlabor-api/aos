import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { hostOk, corsOriginAllowed, loadCorsOrigins } from '../skills/global_config/agenttrail/lib/httpguard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = path.join(root, 'skills', 'global_config', 'agenttrail', 'bin', 'agenttrail.mjs');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ALLOWED = [
  'http://localhost', 'https://localhost', 'http://localhost:5330', 'http://127.0.0.1:5330',
  'https://127.0.0.1', 'http://[::1]:5330', 'https://[::1]', 'http://trail.aos.localhost:5330',
  'https://x.localhost', 'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost',
];
const REJECTED = [
  'http://evil.com', 'http://localhost.evil.com', 'http://127.0.0.1.nip.io', 'null', 'file://',
  'http://user@localhost', 'http://user:pw@localhost:5330', 'ftp://localhost', 'tauri://evil', '', 'http://localhost/path',
  'http://evil.com#.localhost', 'http://a.localhost.evil.com', 'tauri://localhost.evil', 'http://localhost.',
  // browsers always send the normalised lowercase origin, so a raw uppercase string is not an Origin we accept
  'HTTP://LOCALHOST:1',
];

describe('corsOriginAllowed', () => {
  for (const o of ALLOWED) test(`allows ${o}`, () => assert.equal(corsOriginAllowed(o), true));
  for (const o of REJECTED) test(`rejects ${JSON.stringify(o)}`, () => assert.equal(corsOriginAllowed(o), false));
  test('extra exact origin', () => {
    assert.equal(corsOriginAllowed('http://dash.example:3000', ['http://dash.example:3000']), true);
    assert.equal(corsOriginAllowed('http://other.example', ['http://dash.example:3000']), false);
  });
  test('a star entry anywhere in the list allows any origin, but not an absent one', () => {
    assert.equal(corsOriginAllowed('http://evil.com', ['*']), true);
    assert.equal(corsOriginAllowed('http://evil.com', ['http://a.example', '*']), true);
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
  test('missing file is defaults and silent', () => {
    const logs = [];
    assert.deepEqual(loadCorsOrigins({}, path.join(dir, 'none.json'), (m) => logs.push(m)), []);
    assert.equal(logs.length, 0);
  });
  test('malformed file logs once and falls back', () => {
    const logs = [];
    assert.deepEqual(loadCorsOrigins({}, write('bad.json', '{nope'), (m) => logs.push(m)), []);
    assert.deepEqual(loadCorsOrigins({}, write('bad2.json', '{"corsOrigins":"x"}'), (m) => logs.push(m)), []);
    assert.equal(logs.length, 2);
  });
  test('oversized file logs one line and falls back', () => {
    const logs = [];
    const big = write('big.json', JSON.stringify({ corsOrigins: ['http://a.example'], pad: 'x'.repeat(70 * 1024) }));
    assert.deepEqual(loadCorsOrigins({}, big, (m) => logs.push(m)), []);
    assert.equal(logs.length, 1);
  });
  test('unreadable path (a directory) logs one line and falls back', () => {
    const logs = [];
    assert.deepEqual(loadCorsOrigins({}, dir, (m) => logs.push(m)), []);
    assert.equal(logs.length, 1);
  });
  test('env overrides file', () => {
    assert.deepEqual(loadCorsOrigins({ AOS_TRAIL_CORS_ORIGINS: 'http://e.example, http://f.example' }, write('ok2.json', '{"corsOrigins":["http://a.example"]}')), ['http://e.example', 'http://f.example']);
  });
});

async function freePort(start, floor) {
  for (let p = start; p >= floor; p -= 1) {
    const probe = net.createServer();
    const free = await new Promise((resolve) => {
      probe.once('error', () => resolve(false));
      probe.listen(p, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
    if (free) return p;
  }
  throw new Error('no free port');
}

// The real daemon, with a temp HOME, so the real router decides every response.
describe('agenttrail daemon: CORS only on GET /model and /events', () => {
  let daemon; let port; let repoDir; let homeDir; let out = '';
  before(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-cors-repo-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-cors-home-'));
    fs.writeFileSync(path.join(repoDir, 'PLAN.md'), '# Cors\n');
    port = await freePort(6299, 6250);
    const hubPort = await freePort(6199, 6150);
    daemon = spawn(process.execPath, [binary, repoDir, '--port', String(port), '--no-open'], {
      cwd: root,
      env: {
        ...process.env, HOME: homeDir, USERPROFILE: homeDir, AOS_NO_OPEN: '1', AOS_TRAIL_IDLE_MS: '0',
        AGENTTRAIL_PORT: String(hubPort), AOS_TRAIL_CORS_ORIGINS: '*',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    daemon.stdout.on('data', (c) => { out += c; });
    daemon.stderr.on('data', (c) => { out += c; });
    for (let i = 0; i < 80; i += 1) {
      if (daemon.exitCode !== null) throw new Error(`daemon exited: ${out}`);
      const r = await fetch(`http://127.0.0.1:${port}/whoami`, { signal: AbortSignal.timeout(1000) }).catch(() => null);
      if (r && r.status === 200) return;
      await sleep(100);
    }
    throw new Error(`daemon did not start: ${out}`);
  });
  after(() => {
    if (daemon && daemon.exitCode === null) { try { daemon.kill('SIGTERM'); } catch { /* gone */ } }
    for (const d of [repoDir, homeDir]) if (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  });

  const request = (method, p, { origin, host, body } = {}) => new Promise((resolve, reject) => {
    const headers = {};
    if (origin) headers.origin = origin;
    if (host) headers.host = host;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const r = http.request({ host: '127.0.0.1', port, method, path: p, agent: false, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    r.on('error', reject);
    r.end(body);
  });
  const acaoKeys = (h) => Object.keys(h).filter((k) => k.startsWith('access-control-'));

  test('GET /model echoes an allowed origin with Vary, even under the star override', async () => {
    const r = await request('GET', '/model', { origin: 'http://localhost:1234' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['access-control-allow-origin'], 'http://localhost:1234');
    assert.match(r.headers.vary, /Origin/);
  });
  test('GET /events streams with the echoed origin', async () => {
    await new Promise((resolve, reject) => {
      const r = http.get({ host: '127.0.0.1', port, path: '/events', agent: false, headers: { origin: 'tauri://localhost' } }, (res) => {
        try {
          assert.equal(res.statusCode, 200);
          assert.equal(res.headers['access-control-allow-origin'], 'tauri://localhost');
          assert.match(res.headers['content-type'], /text\/event-stream/);
          res.destroy();
          resolve();
        } catch (e) { reject(e); }
      });
      r.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
    });
  });
  test('preflight on /model and /events: 204 with the exact headers', async () => {
    for (const p of ['/model', '/events']) {
      const r = await request('OPTIONS', p, { origin: 'http://trail.aos.localhost:5330' });
      assert.equal(r.status, 204);
      assert.equal(r.headers['access-control-allow-origin'], 'http://trail.aos.localhost:5330');
      assert.equal(r.headers['access-control-allow-methods'], 'GET');
      assert.equal(r.headers['access-control-allow-headers'], 'cache-control, last-event-id, accept');
      assert.equal(r.headers['access-control-max-age'], '600');
      assert.match(r.headers.vary, /Origin/);
    }
  });
  test('OPTIONS without an Origin is 403 with Vary and no Access-Control-*', async () => {
    const r = await request('OPTIONS', '/model');
    assert.equal(r.status, 403);
    assert.match(r.headers.vary, /Origin/);
    assert.deepEqual(acaoKeys(r.headers), []);
  });
  test('POST /model and POST /events are 404 with no Access-Control-*', async () => {
    for (const p of ['/model', '/events']) {
      const r = await request('POST', p, { origin: 'http://localhost:1234', body: '{}' });
      assert.equal(r.status, 404);
      assert.deepEqual(acaoKeys(r.headers), []);
    }
  });
  test('no Access-Control-* on any other route, even with the star override', async () => {
    const cases = [
      ['POST', '/answer'], ['OPTIONS', '/answer'], ['POST', '/spawn'], ['OPTIONS', '/spawn'],
      ['GET', '/ask/nope'], ['OPTIONS', '/ask/nope'], ['POST', '/ask'], ['POST', '/side/decision'],
      ['OPTIONS', '/side/decision'], ['POST', '/shutdown'], ['OPTIONS', '/shutdown'], ['GET', '/whoami'],
    ];
    for (const [m, p] of cases) {
      const r = await request(m, p, { origin: 'http://evil.com', body: m === 'POST' ? '{}' : undefined });
      assert.deepEqual(acaoKeys(r.headers), [], `${m} ${p}`);
    }
  });
  test('a bad Host is 403 with no body and no Access-Control-* on every route (DNS rebinding)', async () => {
    const bad = `rebind.evil.com:${port}`;
    for (const p of ['/model', '/events', '/tree', '/summary', '/world', '/fleet', '/whoami']) {
      for (const m of ['GET', 'OPTIONS']) {
        const r = await request(m, p, { origin: 'http://localhost:1234', host: bad });
        assert.equal(r.status, 403, `${m} ${p}`);
        assert.deepEqual(acaoKeys(r.headers), [], `${m} ${p}`);
      }
    }
    const wrongPort = await request('GET', '/tree', { host: 'localhost:1' });
    assert.equal(wrongPort.status, 403);
  });
  test('non-browser Hosts keep working: 127.0.0.1, localhost, <name>.localhost', async () => {
    for (const h of [`127.0.0.1:${port}`, `localhost:${port}`, `trail.aos.localhost:${port}`]) {
      const r = await request('GET', '/whoami', { host: h });
      assert.equal(r.status, 200, h);
    }
  });
});
