import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import zlib from 'node:zlib';
import {
  COOKIE_NAME,
  newToken,
} from '../lib/annotation/guard.mjs';
import {
  DEFAULT_PORTS,
  OVERLAY_VERSION,
  createProxy,
  findInjectPoint,
  injectOverlay,
  overlayTag,
  parseUpstream,
  rewriteLocation,
  rewriteSetCookieLine,
  upgradePathOk,
} from '../lib/annotation/proxy.mjs';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

// Loopback upstream fixture: scripted responses per hit.
function makeUpstream() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ url: req.url, host: req.headers.host });
    if (req.url === '/html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body><h1>hi</h1></body></html>');
      return;
    }
    if (req.url === '/html-gzip') {
      const body = zlib.gzipSync(Buffer.from('<html><body>gz</body></html>'));
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      res.end(body);
      return;
    }
    if (req.url === '/plain') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('not html at all');
      return;
    }
    if (req.url === '/redirect-loopback') {
      res.writeHead(302, { location: `http://${req.headers.host}/html` });
      res.end();
      return;
    }
    if (req.url === '/redirect-off') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' });
      res.end();
      return;
    }
    if (req.url === '/slow') {
      // never responds within the test window; proxy timeout fires
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('nope');
  });
  return { server, hits };
}

let upstream;
let upstreamPort;
let proxy;
let proxyPort;
const upstreamPortAlt = 5173; // fixture inside the default allow range

const TOKEN = newToken();

function req({ path, headers = {}, method = 'GET', port = proxyPort, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: '127.0.0.1', port, method, path, headers: { cookie: `${COOKIE_NAME}=${TOKEN}`, ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString(),
        }));
      },
    );
    r.on('error', reject);
    r.end(body);
  });
}

before(async () => {
  upstream = makeUpstream();
  upstreamPort = await listen(upstream.server);
  const created = await createProxy({ token: TOKEN, upstream: { host: '127.0.0.1', port: upstreamPort } });
  proxy = created.server;
  proxyPort = created.port;
});

after(async () => {
  proxy.closeIdleConnections?.();
  upstream.server.closeIdleConnections?.();
  await Promise.all([
    new Promise((r) => proxy.close(r)),
    new Promise((r) => upstream.server.close(r)),
  ]);
});

test('uniform: overlay injected exactly once into upstream HTML before </body>', async () => {
  const res = await req({ path: '/html' });
  assert.equal(res.status, 200);
  assert.equal(res.headers['x-aos-annot'], 'rewritten');
  const matches = res.body.match(/<script src="\/__aos_annot\/overlay\.js\?v=0\.1\.0" nonce="[^"]+"><\/script>/g) ?? [];
  assert.equal(matches.length, 1, `injected once, got ${matches.length}`);
  const at = res.body.indexOf('<script');
  assert.ok(at < res.body.indexOf('</body>'), 'tag before closing body');
  assert.ok(res.body.includes('</body></html>'), 'tail preserved');
  assert.equal(res.headers['content-length'], String(Buffer.byteLength(res.body)));
  assert.equal(res.headers['content-security-policy'], undefined, 'upstream CSP stripped');
  assert.deepEqual(upstream.hits.at(-1), { url: '/html', host: `127.0.0.1:${upstreamPort}` },
    'Host rewritten to the fixed upstream; request path cannot select a different origin');
});

test('uniform: overlay route serves the version placeholder with strict CSP', async () => {
  const res = await req({ path: '/__aos_annot/overlay.js' });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /javascript/);
  assert.equal(res.body, 'window.__AOS_ANNOT = { version: "0.1.0" };\n');
  const csp = res.headers['content-security-policy'] ?? '';
  assert.ok(csp.includes("script-src 'self'"), 'self scripts allowed');
  assert.ok(!csp.includes('unsafe-inline'), 'no inline');
  assert.ok(!csp.includes('unsafe-eval'), 'no eval');
  assert.ok(csp.includes('connect-src'), 'connect-src pinned');
  assert.ok(csp.includes('frame-ancestors'), 'frame-ancestors pinned');
  assert.ok(res.headers['x-content-type-options'] === 'nosniff');
});

test('uniform: injection is a pure one-insertion point; garbage tolerated', () => {
  const once = injectOverlay('<html><BODY>x</BODY></html>', { nonce: 'n1' });
  assert.equal(once.match(/<script/g).length, 1);
  const noBody = injectOverlay('<div>x</div>', { nonce: 'n1' });
  assert.ok(noBody.endsWith(overlayTag({ nonce: 'n1' })));
  assert.equal(findInjectPoint('a</BODY>b'), 1);
  assert.ok(overlayTag({ nonce: 'n2' }).includes(`v=${OVERLAY_VERSION}`));
});

test('uniform: upstream gzip HTML is decoded, injected, content-length fixed', async () => {
  const res = await req({ path: '/html-gzip' });
  assert.equal(res.status, 200);
  assert.equal(res.headers['x-aos-annot'], 'rewritten');
  assert.equal(res.headers['content-encoding'], undefined);
  assert.equal((res.body.match(/<script/g) ?? []).length, 1);
  assert.ok(res.body.includes('gz'));
  assert.equal(res.headers['content-length'], String(Buffer.byteLength(res.body)));
});

test('uniform: non-HTML passes through untouched and streaming (no injection, no marker)', async () => {
  const res = await req({ path: '/plain' });
  assert.equal(res.body, 'not html at all');
  assert.equal(res.headers['x-aos-annot'], undefined);
  assert.equal((res.body.match(/<script/g) ?? []).length, 0);
});

test('uniform: request headers exceeded cap -> typed error, no internals', async () => {
  const res = await req({ path: '/html', headers: { 'x-fat': 'a'.repeat(20000) } });
  assert.equal(res.status, 403);
  assert.deepEqual(JSON.parse(res.body), { error: 'E_HEADERS' });
});

test('uniform: guard rejections surface through the proxy (bad token, spoofed Host, bad Origin)', async () => {
  const badToken = await req({ path: '/plain', headers: { cookie: `${COOKIE_NAME}=nope` } });
  assert.equal(badToken.status, 403);
  assert.equal(JSON.parse(badToken.body).error, 'E_TOKEN');
  const spoofed = await hostOverrideProbe(proxyPort, 'evil.example');
  assert.equal(spoofed.status, 403);
  assert.equal(JSON.parse(spoofed.body).error, 'E_HOST');
  const rebinding = await rawProbe(proxyPort, 'dns-rebind.example', TOKEN);
  assert.equal(rebinding.status, 403); // DNS-rebinding style Host also refused
  const badOrigin = await req({ path: '/plain', headers: { origin: 'http://evil.example' } });
  assert.equal(badOrigin.status, 403);
  assert.equal(JSON.parse(badOrigin.body).error, 'E_ORIGIN');
});

// http.request cannot override Host cleanly; raw socket with a hostile Host.
function rawProbe(port, hostHeader, token) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let raw = '';
    socket.on('connect', () => {
      socket.write(
        `GET /plain HTTP/1.1\r\nHost: ${hostHeader}\r\nCookie: ${COOKIE_NAME}=${token}\r\n\r\n`,
      );
    });
    socket.on('data', (chunk) => {
      raw += chunk.toString('latin1');
      const sep = raw.indexOf('\r\n\r\n');
      if (sep < 0) return;
      socket.destroy();
      resolve({ status: Number(raw.split(' ')[1]), body: raw.slice(sep + 4) });
    });
    socket.on('error', reject);
    setTimeout(() => reject(new Error('raw probe timeout')), 2000).unref();
  });
}

const hostOverrideProbe = (port, hostHeader) => rawProbe(port, hostHeader, TOKEN);

test('uniform: same-origin filled-in Origin keeps guard fully engaged', async () => {
  const ok = await req({ path: '/plain', headers: { origin: `http://127.0.0.1:${proxyPort}` } });
  assert.ok(ok.status === 200 || ok.status === 404);
  const mismatch = await req({ path: '/plain', headers: { origin: 'http://localhost:1' } });
  assert.equal(mismatch.status, 403);
});

test('secure: allowlist roots upstream; path cannot select a different origin', () => {
  assert.deepEqual(parseUpstream('localhost:5173'), { host: 'localhost', port: 5173 });
  assert.deepEqual(parseUpstream('http://127.0.0.1:5199'), { host: '127.0.0.1', port: 5199 });
  assert.equal(parseUpstreamSafe('evil.example:5173').code, 'E_UPSTREAM');
  assert.equal(parseUpstreamSafe('127.0.0.1:5200').code, 'E_UPSTREAM');
  assert.equal(parseUpstreamSafe('127.0.0.1:22').code, 'E_UPSTREAM');
  assert.equal(DEFAULT_PORTS.includes(upstreamPort) === false, true, 'fixture port is explicit, not from range');
  assert.equal(upstreamPortAlt >= 5173 && upstreamPortAlt <= 5199, true);
});

function parseUpstreamSafe(spec) {
  try {
    parseUpstream(spec);
    return { ok: true };
  } catch (err) {
    return { code: err.code };
  }
}

test('secure: redirect to another loopback port is rewritten, off-allowlist blocked', async () => {
  const good = await req({ path: '/redirect-loopback' });
  assert.equal(good.status, 302);
  assert.equal(good.headers.location, '/html');
  const bad = await req({ path: '/redirect-off' });
  assert.equal(bad.status, 502);
  assert.equal(JSON.parse(bad.body).error, 'E_REDIRECT_OFF_ALLOWLIST');
});

test('secure: rewriteLocation matrix (block non-loopback, scheme, relative pass)', () => {
  const up = 'http://127.0.0.1:5173';
  assert.deepEqual(rewriteLocation('/x?y=1', { upstreamOrigin: up }), { action: 'pass', value: '/x?y=1' });
  assert.deepEqual(rewriteLocation('http://127.0.0.1:5173/a', { upstreamOrigin: up }), { action: 'rewrite', value: '/a' });
  assert.equal(rewriteLocation('http://localhost:5173/a', { upstreamOrigin: up }).action, 'rewrite');
  assert.equal(rewriteLocation('https://127.0.0.1:5173/a', { upstreamOrigin: up }).action, 'block');
  assert.equal(rewriteLocation('http://metadata.internal:80/a', { upstreamOrigin: up }).action, 'block');
  assert.equal(rewriteLocation('//169.254.169.254/x', { upstreamOrigin: up }).action, 'block');
  assert.equal(rewriteLocation('//127.0.0.1:5173/x', { upstreamOrigin: up }).action, 'rewrite');
  assert.equal(rewriteLocation('http://127.0.0.1:5200/x', { upstreamOrigin: up }).action, 'block');
  assert.equal(rewriteLocation('', { upstreamOrigin: up }).action, 'block');
});

test('secure: Set-Cookie Domain attribute is dropped, other attributes kept', () => {
  assert.equal(
    rewriteSetCookieLine('sid=abc; Domain=127.0.0.1; Path=/; HttpOnly'),
    'sid=abc; Path=/; HttpOnly',
  );
  assert.equal(rewriteSetCookieLine('sid=abc'), 'sid=abc');
  assert.equal(rewriteSetCookieLine(''), '');
});

test('secure: upstream timeouts surface as typed error', async () => {
  const strict = await createProxy({
    token: TOKEN,
    upstream: { host: '127.0.0.1', port: upstreamPort },
    upstreamTimeoutMs: 120,
  });
  const res = await req({ port: strict.port, path: '/slow' });
  assert.equal(res.status, 502);
  assert.equal(JSON.parse(res.body).error, 'E_UPSTREAM');
  await new Promise((r) => strict.server.close(r));
});

test('uniform: tip cap passthrough marks skipped with no injection', async () => {
  const bigServer = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    for (let i = 0; i < 9; i++) res.write(Buffer.alloc(1024 * 1024, 0x61)); // 9 MB
    res.end('</body>');
  });
  const bigPort = await listen(bigServer);
  const strict = await createProxy({
    token: TOKEN,
    upstream: { host: '127.0.0.1', port: bigPort },
    maxHtmlBytes: 8 * 1024 * 1024,
  });
  const res = await req({ port: strict.port, path: '/big' });
  assert.equal(res.status, 200);
  assert.equal(res.headers['x-aos-annot'], 'skipped');
  assert.equal(toolarge(res.body, 8 * 1024 * 1024), true);
  assert.equal((res.body.match(/<script/g) ?? []).length, 0);
  await Promise.all([
    new Promise((r) => strict.server.close(r)),
    new Promise((r) => bigServer.close(r)),
  ]);
});

function toolarge(body, cap) {
  return Buffer.byteLength(body) > cap;
}

// Fixture: a real HTTP upgrade endpoint. Node parses the tunneled request,
// emits 'upgrade'; we send a genuine 101 and then echo raw frames.
function makeWsEchoServer() {
  const server = http.createServer(() => {});
  server.on('upgrade', (req, socket, head) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    if (head.length) socket.write(head);
    socket.on('data', (chunk) => socket.write(chunk));
    socket.on('error', () => socket.destroy());
  });
  return server;
}

test('uniform: upgrade tunnel echoes frames after guard checks (echo server)', async () => {
  const wsServer = makeWsEchoServer();
  const wsPort = await listen(wsServer);
  const strict = await createProxy({ token: TOKEN, upstream: { host: '127.0.0.1', port: wsPort } });
  const tracked = new Map();
  for (const srv of [strict.server, wsServer]) {
    const set = new Set();
    tracked.set(srv, set);
    srv.on('connection', (c) => set.add(c));
  }
  const socket = net.connect(strict.port, '127.0.0.1');
  const key = 'dGhlIHNhbXBsZSBub25jZQ==';
  const sentinel = '.echo-payload-42';
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('error', reject);
  });
  const head101 = await new Promise((resolve, reject) => {
    let raw = '';
    const timer = setTimeout(() => reject(new Error('no 101 within 4s; raw=' + JSON.stringify(raw))), 4000);
    socket.on('close', () => { clearTimeout(timer); reject(new Error('closed before 101; raw=' + JSON.stringify(raw))); });
    socket.on('data', function onData(chunk) {
      raw += chunk.toString('latin1');
      const sep = raw.indexOf('\r\n\r\n');
      if (sep < 0) return;
      socket.removeListener('data', onData);
      clearTimeout(timer);
      resolve({ status: Number(raw.split(' ')[1]), body: raw.slice(sep + 4) });
    });
    socket.on('error', reject);
    socket.write(
      `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${strict.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nCookie: aos_ann=${TOKEN}\r\n\r\n`,
    );
  });
  assert.equal(head101.status, 101);
  const echoed = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('echo timeout')), 2000);
    socket.once('data', (chunk) => { clearTimeout(timer); resolve(chunk.toString('latin1')); });
    socket.on('error', reject);
    socket.write(sentinel);
  });
  assert.ok(echoed.includes(sentinel));
  socket.destroy();
  for (const srv of [strict.server, wsServer]) {
    srv.closeAllConnections?.();
    for (const s of tracked.get(srv) ?? []) s.destroy();
  }
  await Promise.all([
    new Promise((r) => strict.server.close(r)),
    new Promise((r) => wsServer.close(r)),
  ]);
});

test('secure: upgrade refused on bad token and on disallowed path', async () => {
  const wsServer = net.createServer((socket) => {
    socket.on('data', (chunk) => socket.write(chunk));
  });
  const wsPort = await listen(wsServer);
  const strict = await createProxy({ token: TOKEN, upstream: { host: '127.0.0.1', port: wsPort } });

  const refused = await upgradeProbe(strict.port, '/ws', `${COOKIE_NAME}=wrong`, false);
  assert.equal(refused.status, 403);
  assert.equal(JSON.parse(refused.body).error, 'E_TOKEN');

  const refusedPath = await upgradeProbe(strict.port, '/other/path', `${COOKIE_NAME}=${TOKEN}`, false);
  assert.equal(refusedPath.status, 403);
  assert.equal(JSON.parse(refusedPath.body).error, 'E_UPGRADE_PATH');

  assert.equal(upgradePathOk('/_vite/hmr'), true);
  assert.equal(upgradePathOk('/ws'), true);
  assert.equal(upgradePathOk('/ws/dev'), true);
  assert.equal(upgradePathOk('/other'), false);
  assert.equal(upgradePathOk('/__aos_annot/x'), false);

  await Promise.all([
    new Promise((r) => strict.server.close(r)),
    new Promise((r) => wsServer.close(r)),
  ]);
});

// Raw-socket upgrade probe; heads are parsed by hand because http upgrade
// responses on refusal come back as plain HTTP with a JSON body.
function upgradeProbe(port, path, cookie, expectUpgrade) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let raw = '';
    socket.on('connect', () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nCookie: ${cookie}\r\n\r\n`,
      );
    });
    socket.on('data', (chunk) => {
      raw += chunk.toString('latin1');
      const sep = raw.indexOf('\r\n\r\n');
      if (sep < 0) return;
      const status = Number(raw.split(' ')[1]);
      socket.destroy();
      if (status === 101 || expectUpgrade) {
        resolve({ status, raw, body: '' });
        return;
      }
      resolve({ status, raw, body: raw.slice(sep + 4) });
    });
    socket.on('error', reject);
    setTimeout(() => reject(new Error('upgrade probe timeout')), 2000).unref();
  });
}
