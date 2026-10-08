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

function reqRaw({ path, headers = {}, method = 'GET', port = proxyPort, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: '127.0.0.1', port, method, path, headers: { cookie: `${COOKIE_NAME}=${TOKEN}`, ...headers }, agent: false },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    r.on('error', reject);
    r.end(body);
  });
}

// Loopback upstream fixture: scripted responses per hit.
function makeUpstream() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ url: req.url, host: req.headers.host });
    if (req.url === '/html') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'self'; script-src 'self'",
        'x-frame-options': 'SAMEORIGIN',
      });
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
  const created = await createProxy({ token: TOKEN, upstream: { host: '127.0.0.1', port: upstreamPort }, allowedPorts: [upstreamPort] });
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
  assert.ok(res.headers['content-security-policy']?.includes("'nonce-"), 'upstream CSP kept with nonce appended');
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

test('secure: rewriteLocation blocks backslash/protocol-relative-trick/control-char Locations (F5)', () => {
  const up = 'http://127.0.0.1:5173';
  // browsers read '/\evil.com' as '//evil.com' (protocol-relative)
  assert.equal(rewriteLocation('/\\evil.com', { upstreamOrigin: up }).action, 'block');
  assert.equal(rewriteLocation('\\/evil.com', { upstreamOrigin: up }).action, 'block');
  assert.equal(rewriteLocation('/\tevil', { upstreamOrigin: up }).action, 'block');
  assert.equal(rewriteLocation('/x\u0000', { upstreamOrigin: up }).action, 'block');
  assert.equal(rewriteLocation('/x\nLocation: evil', { upstreamOrigin: up }).action, 'block');
  assert.equal(rewriteLocation('/x\r\nEvil: 1', { upstreamOrigin: up }).action, 'block');
  assert.equal(rewriteLocation('http:\\\\169.254.169.254\\x', { upstreamOrigin: up }).action, 'block');
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
    allowedPorts: [upstreamPort],
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
    allowedPorts: [bigPort],
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

// Fixture harness: upstream scripted by handler, proxy on port 0; every
// server/socket is torn down in finally.
async function proxyFixture(handler, proxyOptions, run) {
  const upServer = http.createServer(handler);
  upServer.on('upgrade', () => {});
  const upPort = await listen(upServer);
  const created = await createProxy({
    token: TOKEN,
    upstream: { host: '127.0.0.1', port: upPort },
    allowedPorts: [upPort],
    ...proxyOptions,
  });
  try {
    return await run({ port: created.port, nonce: created.nonce, upstreamPort: upPort });
  } finally {
    created.server.closeAllConnections?.();
    upServer.closeAllConnections?.();
    await Promise.all([
      new Promise((r) => created.server.close(r)),
      new Promise((r) => upServer.close(r)),
    ]);
  }
}

test('secure: upstream sees app cookies and identity accept-encoding, never aos_ann or authorization', { timeout: 8000 }, async () => {
  let seen = null;
  const result = await proxyFixture(
    (req, res) => {
      if (req.url === '/echo') {
        seen = {
          cookie: req.headers.cookie ?? null,
          acceptEncoding: req.headers['accept-encoding'] ?? null,
          authorization: req.headers.authorization ?? null,
        };
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('nope');
    },
    {},
    ({ port }) => req({ port, path: '/echo', headers: { cookie: `app_one=x; ${COOKIE_NAME}=${TOKEN}; app_two=y` } }),
  );
  assert.equal(result.status, 200);
  assert.equal(seen.cookie, 'app_one=x; app_two=y');
  assert.doesNotMatch(seen.cookie, /aos_ann/);
  assert.equal(seen.acceptEncoding, 'identity');
  assert.equal(seen.authorization, null);
});

test('secure: aos_ann cookie-only request forwards no Cookie header; authorization dropped', { timeout: 8000 }, async () => {
  let seen = null;
  await proxyFixture(
    (req, res) => {
      if (req.url === '/echo') {
        seen = { cookie: req.headers.cookie ?? null, authorization: req.headers.authorization ?? null };
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('nope');
    },
    {},
    ({ port }) => req({ port, path: '/echo', headers: { authorization: 'Bearer x' } }),
  );
  assert.equal(seen.cookie, null);
  assert.equal(seen.authorization, null);
});

test('secure: upstream Set-Cookie for aos_ann is stripped, app cookies kept', { timeout: 8000 }, async () => {
  const res = await proxyFixture(
    (req, res) => {
      if (req.url === '/set-cookie') {
        res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': [`aos_ann=evil-value`, `app_sid=ok; Domain=x.example`] });
        res.end('cookies set');
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('nope');
    },
    {},
    ({ port }) => req({ port, path: '/set-cookie' }),
  );
  assert.equal(res.status, 200);
  const set = res.headers['set-cookie'] ?? [];
  assert.equal(set.some((line) => line.toLowerCase().startsWith('aos_ann=')), false, 'aos_ann stripped');
  assert.ok(set.includes('app_sid=ok'), 'app cookie kept with Domain dropped');
});

test('secure: corrupt gzip HTML ends the response with raw bytes and skipped marker', { timeout: 8000 }, async () => {
  const res = await proxyFixture(
    (req, res) => {
      if (req.url === '/corrupt') {
        res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
        res.end(Buffer.from('this is not gzip data'));
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('nope');
    },
    {},
    ({ port }) => req({ port, path: '/corrupt' }),
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers['x-aos-annot'], 'skipped');
  assert.equal(res.headers['content-encoding'], 'gzip');
  assert.equal(res.body, 'this is not gzip data');
});

test('secure: gzip bomb (64 MB zeros) decodes against the cap, response ends on raw bytes', { timeout: 8000 }, async () => {
  const bombGz = zlib.gzipSync(Buffer.alloc(64 * 1024 * 1024, 0), { level: 1 });
  assert.ok(bombGz.length < 1024 * 1024, 'bomb is small on the wire');
  const res = await proxyFixture(
    (req, res) => {
      if (req.url === '/bomb') {
        res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
        res.end(bombGz);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('nope');
    },
    { maxHtmlBytes: 1 * 1024 * 1024 },
    ({ port }) => reqRaw({ port, path: '/bomb' }),
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers['x-aos-annot'], 'skipped');
  assert.equal(res.headers['content-encoding'], 'gzip');
  assert.equal(res.body.length, bombGz.length, 'raw passthrough, never expanded');
});

test('secure: concurrency slot is released after the response ends or the client closes', { timeout: 8000 }, async () => {
  assert.equal(
    await proxyFixture(
      (req, res) => {
        if (req.url === '/hold') return; // holds the response open
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('done');
      },
      { maxConcurrent: 1 },
      async ({ port }) => {
        const holder = danglingRequest(port, '/hold');
        try {
        await delay(200);
        const busy = await req({ port, path: '/plain', headers: { connection: 'close' } });
        assert.equal(busy.status, 429, 'held upstream response occupies the single slot');
        // client walks away -> slot must be released via res close
        holder.destroy();
        await delay(200);
        const after = await req({ port, path: '/plain', headers: { connection: 'close' } });
        assert.equal(after.status, 200, 'slot released after client close');
        const third = await req({ port, path: '/plain', headers: { connection: 'close' } });
        assert.equal(third.status, 200, 'slot released after normal response end');
        return third.status;
        } finally { holder.destroy(); }
      },
    ),
    200,
  );
});

function danglingRequest(port, path) {
  const r = http.request({ host: '127.0.0.1', port, path, headers: { cookie: `${COOKIE_NAME}=${TOKEN}`, connection: 'close' }, agent: false });
  r.on('error', () => {});
  r.end();
  return r;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  const strict = await createProxy({ token: TOKEN, upstream: { host: '127.0.0.1', port: wsPort }, allowedPorts: [wsPort] });
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
  const strict = await createProxy({ token: TOKEN, upstream: { host: '127.0.0.1', port: wsPort }, allowedPorts: [wsPort] });

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

test('secure: createProxy validates the upstream via parseUpstream and the listen port (F6)', { timeout: 8000 }, async () => {
  assert.equal(parseUpstreamSafe('127.0.0.1:5169').code, 'E_UPSTREAM', 'below range refused by default');
  assert.deepEqual(parseUpstream('127.0.0.1:5173'), { host: '127.0.0.1', port: 5173 });
  await assert.rejects(
    () => createProxy({ token: TOKEN, upstream: '127.0.0.1:22' }),
    (err) => err.code === 'E_UPSTREAM',
  );
  await assert.rejects(
    () => createProxy({ token: TOKEN, upstream: 'evil.example:5173' }),
    (err) => err.code === 'E_UPSTREAM',
  );
  // allowedPorts option widens the allowlist for explicit fixture ports only
  await assert.rejects(
    () => createProxy({ token: TOKEN, upstream: '127.0.0.1:5200' }),
    (err) => err.code === 'E_UPSTREAM',
  );
  await assert.rejects(
    () => createProxy({ token: TOKEN, upstream: { host: '127.0.0.1', port: 48162 }, allowedPorts: [48163] }),
    (err) => err.code === 'E_UPSTREAM',
  );
});

test('secure: self-port upstream refused when the proxy assigns its own port (F6)', { timeout: 8000 }, async () => {
  // first bind a proxy, then try to point a second proxy's upstream at the
  // first proxy's own listening port
  const first = await createProxy({ token: TOKEN, upstream: '127.0.0.1:5173' });
  try {
    await assert.rejects(
      () =>
        createProxy({
          token: TOKEN,
          upstream: { host: '127.0.0.1', port: first.port },
          allowedPorts: [first.port],
        }),
      (err) => err.code === 'E_UPSTREAM',
    );
  } finally {
    await new Promise((r) => first.server.close(r));
  }
});

test('secure: redirect with a backslash Location is blocked and the upstream socket released (F5)', { timeout: 8000 }, async () => {
  const res = await proxyFixture(
    (req, resOut) => {
      if (req.url === '/redirect-trick') {
        resOut.writeHead(302, { location: '/\\evil.example' });
        resOut.end('gone');
        return;
      }
      if (req.url === '/html') {
        resOut.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        resOut.end('<html><body>ok</body></html>');
        return;
      }
      resOut.writeHead(404, { 'content-type': 'text/plain' });
      resOut.end('nope');
    },
    {},
    async ({ port }) => {
      const blocked = await req({ port, path: '/redirect-trick' });
      assert.equal(blocked.status, 502);
      assert.equal(JSON.parse(blocked.body).error, 'E_REDIRECT_OFF_ALLOWLIST');
      // the upstream server must accept a follow-up request (socket released)
      return req({ port, path: '/html' });
    },
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers['x-aos-annot'], 'rewritten');
});

test('secure: nonce is crypto base64url, fresh per HTML response, and never in the JS body (F7)', { timeout: 8000 }, async () => {
  const html = await proxyFixture(
    (req, res) => {
      if (req.url === '/html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<html><body>hi</body></html>');
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('nope');
    },
    {},
    ({ port, nonce }) => req({ port, path: '/html' }).then((r) => ({ r, nonce })),
  );
  assert.match(html.nonce, /^[A-Za-z0-9_-]{22}$/, 'nonce is 16 random bytes base64url');
  const tagNonce = (html.r.body.match(/nonce="([A-Za-z0-9_-]+)"/) ?? [])[1] ?? '';
  assert.match(tagNonce, /^[A-Za-z0-9_-]{22}$/);
  const overlay = await req({ path: '/__aos_annot/overlay.js' });
  assert.equal(overlay.body.includes(tagNonce), false, 'nonce never in readable JS response body');
  assert.match(overlay.body, /^window\.__AOS_ANNOT/);
});

test('secure: app CSP kept with nonce appended per response; report-only handled; no CSP in -> none out (F8)', { timeout: 8000 }, async () => {
  const res = await proxyFixture(
    (req, res) => {
      const csp = req.url === '/csp'
        ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'none'"
        : req.url === '/csp-ro'
          ? "default-src 'self'; script-src 'self'"
          : undefined;
      const headers = { 'content-type': 'text/html; charset=utf-8' };
      if (csp !== undefined) {
        if (req.url === '/csp-ro') headers['content-security-policy-report-only'] = csp;
        else headers['content-security-policy'] = csp;
      }
      res.writeHead(200, headers);
      res.end(`<html><body>${req.url}</body></html>`);
      return;
    },
    {},
    async ({ port }) => {
      const withCsp = await req({ port, path: '/csp' });
      assert.equal(withCsp.status, 200);
      const cspValue = withCsp.headers['content-security-policy'];
      assert.ok(cspValue.includes("script-src 'self' 'unsafe-inline' 'nonce-"), 'app CSP kept, nonce appended');
      const nonce = withCsp.body.match(/nonce="([^"]+)"/)[1];
      assert.ok(cspValue.includes(`'nonce-${nonce}'`));
      assert.ok(cspValue.includes("default-src 'self'"), 'first directive untouched');
      const ro = await req({ port, path: '/csp-ro' });
      assert.ok(ro.headers['content-security-policy-report-only'].includes("'nonce-"), 'report-only extended');
      assert.equal(ro.headers['content-security-policy'], undefined, 'report-only does not add an enforcing CSP');
      const bare = await req({ port, path: '/bare' });
      assert.equal(bare.headers['content-security-policy'], undefined, 'no app CSP -> no CSP sent');
      return withCsp.status;
    },
  );
  assert.equal(res, 200);
});

test('secure: X-Frame-Options kept by default, dropped only with embedOrigin (F8)', { timeout: 8000 }, async () => {
  for (const embedOrigin of [null, 'http://127.0.0.1:7000']) {
    await proxyFixture(
      (req, res) => {
        if (req.url === '/xfo') {
          res.writeHead(200, { 'content-type': 'text/plain', 'x-frame-options': 'SAMEORIGIN' });
          res.end('framed?');
          return;
        }
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('nope');
      },
      embedOrigin === null ? {} : { embedOrigin },
      async ({ port }) => {
        const res = await req({ port, path: '/xfo' });
        if (embedOrigin === null) {
          assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN', 'kept when no embedOrigin');
        } else {
          assert.equal(res.headers['x-frame-options'], undefined, 'dropped when the canvas embeds the app');
        }
        return res.status;
      },
    );
  }
});

test('secure: upgrade against a plain HTTP upstream answers 502 JSON, both sockets closed (F11)', { timeout: 8000 }, async () => {
  // deliberate non-101 upstream: an 'upgrade' handler that answers 200 OK
  const up = http.createServer(() => {});
  up.on('upgrade', (_req, socket) => {
    socket.write('HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\nconnection: close\r\n\r\nno 101 here\n');
    socket.end();
  });
  const upPort = await listen(up);
  const strict = await createProxy({ token: TOKEN, upstream: { host: '127.0.0.1', port: upPort }, allowedPorts: [upPort] });
  try {
    const probe = await upgradeProbe(strict.port, '/ws', `${COOKIE_NAME}=${TOKEN}`, false);
    assert.equal(probe.status, 502);
    assert.equal(JSON.parse(probe.body).error, 'E_UPSTREAM');
  } finally {
    up.closeAllConnections?.();
    strict.server.closeAllConnections?.();
    await Promise.all([new Promise((r) => strict.server.close(r)), new Promise((r) => up.close(r))]);
  }
});

test('secure: upgrade request values with CR/LF are rejected before any upstream connect (F11)', { timeout: 8000 }, async () => {
  // Node refuses to parse malformed header lines as values containing CRLF via
  // raw sockets; use a raw socket probe with a header containing CR.
  let connected = null;
  const up = http.createServer(() => {});
  up.on('upgrade', () => { connected = true; });
  const upPort = await listen(up);
  const strict = await createProxy({ token: TOKEN, upstream: { host: '127.0.0.1', port: upPort }, allowedPorts: [upPort] });
  try {
    const socket = net.connect(strict.port, '127.0.0.1');
    try {
    const result = await new Promise((resolve, reject) => {
      let raw = '';
      socket.on('connect', () => {
        socket.write(
          `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${strict.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nCookie: aos_ann=${TOKEN}\r\nX-Smuggle: a\rb\r\n\r\n`,
        );
      });
      socket.on('data', (chunk) => {
        raw += chunk.toString('latin1');
        const sep = raw.indexOf('\r\n\r\n');
        if (sep < 0) return;
        resolve({ status: Number(raw.split(' ')[1]), raw });
      });
      socket.on('close', () => resolve({ status: Number((raw.split(' ')[1] ?? '')) || 400, raw }));
      socket.on('error', reject);
      setTimeout(() => reject(new Error('F11 probe timeout')), 4000).unref();
    });
    assert.equal(result.status, 400, 'malformed CRLF header rejected at parse, never tunneled');
    assert.equal(connected, null, 'upstream never saw the injected header');
    } finally { socket.destroy(); }
  } finally {
    up.closeAllConnections?.();
    strict.server.closeAllConnections?.();
    await Promise.all([new Promise((r) => strict.server.close(r)), new Promise((r) => up.close(r))]);
  }
});

test('uniform: mixed-case and trailing </BODY> handled from the original string (F12)', { timeout: 8000 }, async () => {
  const res = await proxyFixture(
    (req, res) => {
      if (req.url === '/upper') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<html><boDy>U</boDy></html>');
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('nope');
    },
    {},
    ({ port }) => req({ port, path: '/upper' }),
  );
  assert.equal(res.headers['x-aos-annot'], 'rewritten');
  assert.ok(res.body.includes('<boDy>U<script'), 'injects before mixed-case closing tag');
  assert.ok(res.body.includes('</boDy></html>'));
});

test('secure: non-utf8 charset skips the rewrite (F12)', { timeout: 8000 }, async () => {
  const latin = Buffer.from('<html><body>l\xe4</body></html>', 'latin1');
  const res = await proxyFixture(
    (req, res) => {
      if (req.url === '/latin') {
        res.writeHead(200, { 'content-type': 'text/html; charset=iso-8859-1' });
        res.end(latin);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('nope');
    },
    {},
    ({ port }) => req({ port, path: '/latin' }),
  );
  assert.equal(res.headers['x-aos-annot'], 'skipped');
  assert.equal(res.body.match(/<script/g)?.length ?? 0, 0, 'no injected tag');
  assert.ok(res.body.includes('l'), 'body passes through');
});

test('secure: dev methods PUT/PATCH/DELETE/HEAD/OPTIONS are forwarded to the app (F13)', { timeout: 8000 }, async () => {
  const seen = [];
  await proxyFixture(
    (req, res) => {
      seen.push(req.method);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    },
    {},
    async ({ port }) => {
      for (const method of ['HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        const res = await req({ port, path: '/api', method });
        assert.equal(res.status, 200, method);
      }
      const post = await req({ port, path: '/api', method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'plain write is the app lookahead' });
      assert.equal(post.status, 200, 'POST without JSON still forwarded (rule is for /__aos_annot only)');
      assert.deepEqual(seen.sort(), ['DELETE', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT']);
      return post.status;
    },
  );
});

test('secure: oversized forwarded body is capped with 413 E_BODY (F13)', { timeout: 8000 }, async () => {
  await proxyFixture(
    (req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('kept');
    },
    { maxBodyBytes: 64 },
    async ({ port }) => {
      const tooBig = await req({ port, path: '/api', method: 'PUT', body: 'x'.repeat(200) });
      assert.equal(tooBig.status, 413);
      assert.equal(JSON.parse(tooBig.body).error, 'E_BODY');
      return tooBig.status;
    },
  );
});
