import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = path.join(root, 'skills/global_config/plan-canvas/scripts/lib/plan-canvas');
const { createSessionStore } = require(path.join(lib, 'sessions.js'));
const { createPlanCanvasServer } = require(path.join(lib, 'server.js'));

const APP = 'http://localhost:5173';
const VERSION = '9.9.9-test';
const clock = { t: 1_800_000_000_000 };
let workspace;
let stateDir;
let store;
let server;
let port;
let files = 0;

function call(method, urlPath, { headers = {}, body = null, host = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    const h = { host: host || `127.0.0.1:${port}`, ...headers };
    if (payload !== null) {
      h['content-length'] = Buffer.byteLength(payload);
      if (!Object.keys(h).some(k => k.toLowerCase() === 'content-type')) h['content-type'] = 'application/json';
    }
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: h, agent: false }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function newSession() {
  files += 1;
  const file = path.join(workspace, `plan-${files}.md`);
  fs.writeFileSync(file, `# plan ${files}\n`);
  const res = await call('POST', '/api/sessions', { body: { file } });
  assert.equal(res.status, 200);
  return { key: res.json.key, file };
}

async function mint(key, origin = APP, extra = {}) {
  const res = await call('POST', `/api/annotate/${key}/token`, { body: { origin, ...extra } });
  assert.equal(res.status, 200, res.text);
  return res.json;
}

const item = (over = {}) => ({
  kind: 'annotation',
  text: 'make this bigger',
  anchor: { selector: 'main > button:nth-of-type(1)', tag: 'button', snippet: 'Sign up' },
  shapes: [{ type: 'arrow', points: [[-0.5, -1.2], [0.5, 0.5]], color: 'red' }],
  target: { url: `${APP}/signup?x=1`, srcLoc: 'src/Signup.jsx:42' },
  ...over
});

const post = (key, token, { origin = APP, body = { items: [item()] }, headers = {} } = {}) =>
  call('POST', `/api/annotate/${key}`, {
    body,
    headers: { ...(origin === null ? {} : { origin }), ...(token ? { 'x-aos-annotate-token': token } : {}), ...headers }
  });

async function awaitItems(key) {
  const res = await call('GET', `/api/await?key=${key}&timeoutMs=50`);
  return res.json;
}

describe('annotate server', () => {
  before(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-annotate-'));
    stateDir = path.join(workspace, '.state');
    process.env.AOS_PLAN_CANVAS_STATE_DIR = stateDir;
    store = createSessionStore({ stateDir });
    server = createPlanCanvasServer({ store, workspaceRoot: workspace, idleTimeoutMs: 0, version: VERSION, now: () => clock.t });
    port = (await server.listen(0)).port;
  });

  after(async () => {
    if (server) await server.close().catch(() => {});
    if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
  });

  describe('/annotate.js', () => {
    test('is served cross-site without Origin, with the contract headers and no secrets', async () => {
      const { key } = await newSession();
      const t = await mint(key);
      const res = await call('GET', `/annotate.js?v=${VERSION}`, { headers: { 'sec-fetch-site': 'cross-site' } });
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], 'text/javascript; charset=utf-8');
      assert.equal(res.headers['cache-control'], 'no-cache');
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.equal(res.headers['cross-origin-resource-policy'], 'cross-origin');
      assert.equal(res.headers['x-aos-annotate-version'], VERSION);
      assert.ok(!res.text.includes(t.token));
      assert.ok(!res.text.includes(key));
    });

    test('Host allowlist still applies and only GET is allowed', async () => {
      assert.equal((await call('GET', '/annotate.js', { host: 'evil.test' })).status, 403);
      assert.equal((await call('GET', '/annotate.js', { host: `evil.test:${port}` })).status, 403);
      assert.equal((await call('POST', '/annotate.js', { body: {} })).status, 405);
    });
  });

  describe('token issuing', () => {
    test('returns token, bound origin, expiry, script tag and bookmarklet; stores only the hash', async () => {
      const { key } = await newSession();
      const t = await mint(key, APP);
      assert.match(t.token, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(t.origin, APP);
      assert.ok(Date.parse(t.expiresAt) > clock.t);
      assert.ok(t.scriptTag.includes(`src="http://127.0.0.1:${port}/annotate.js?v=${VERSION}"`));
      assert.ok(t.scriptTag.includes(`data-session="${key}"`));
      assert.ok(t.scriptTag.includes(`data-token="${t.token}"`));
      assert.ok(t.bookmarklet.startsWith('javascript:'));
      const persisted = fs.readFileSync(path.join(stateDir, 'sessions.json'), 'utf8');
      assert.ok(!persisted.includes(t.token), 'raw token must never be persisted');
      assert.match(persisted, /tokenSha256/);
    });

    test('refused for any Origin or Sec-Fetch-Site header (browsers)', async () => {
      const { key } = await newSession();
      for (const headers of [{ origin: `http://127.0.0.1:${port}` }, { origin: 'http://evil.test' }, { origin: 'null' }, { 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-site': 'none' }]) {
        const res = await call('POST', `/api/annotate/${key}/token`, { body: { origin: APP }, headers });
        assert.equal(res.status, 403, JSON.stringify(headers));
        assert.ok(!res.text.includes('"token"'));
      }
    });

    test('bad origins, bad ttl, unknown and ended sessions', async () => {
      const { key, file } = await newSession();
      for (const origin of ['http://evil.test:5173', 'https://localhost:5173', 'http://localhost:80', 'http://localhost:1023', 'http://localhost:5173/app', 'http://localhost:5173@evil.test', '*', 'null', '', 5173, null, undefined]) {
        const res = await call('POST', `/api/annotate/${key}/token`, { body: origin === undefined ? {} : { origin } });
        assert.equal(res.status, 400, String(origin));
        assert.equal(res.json.code, 'bad_origin');
      }
      for (const ttlMs of [0, -5, 'soon', 5, null]) {
        const res = await call('POST', `/api/annotate/${key}/token`, { body: { origin: APP, ttlMs } });
        assert.equal(res.status, 400, String(ttlMs));
      }
      assert.equal((await call('POST', '/api/annotate/aaaaaaaaaaaa/token', { body: { origin: APP } })).status, 404);
      assert.equal((await call('POST', '/api/annotate/not-a-key/token', { body: { origin: APP } })).status, 404);
      assert.equal((await call('GET', `/api/annotate/${key}/token`)).status, 405);
      assert.equal((await call('POST', '/api/end', { body: { file } })).status, 200);
      assert.equal((await call('POST', `/api/annotate/${key}/token`, { body: { origin: APP } })).status, 409);
    });

    test('ttl is capped at 24 hours', async () => {
      const { key } = await newSession();
      const t = await mint(key, APP, { ttlMs: 1e12 });
      assert.equal(Date.parse(t.expiresAt), clock.t + 24 * 3600 * 1000);
    });
  });

  describe('accepted annotation', () => {
    test('reaches await with server-set target.origin app, sanitised fields and a chat line', async () => {
      const { key } = await newSession();
      const t = await mint(key);
      const res = await post(key, t.token);
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.json, { status: 'queued', accepted: 1, rejected: 0, pending: 1 });
      assert.equal(res.headers['access-control-allow-origin'], APP);
      assert.equal(res.headers.vary, 'Origin');
      assert.equal(res.headers['access-control-allow-credentials'], undefined);
      const got = await awaitItems(key);
      assert.equal(got.status, 'feedback');
      const [it] = got.items;
      assert.equal(it.kind, 'annotation');
      assert.equal(it.target.origin, 'app');
      assert.equal(it.target.url, `${APP}/signup`);
      assert.equal(it.target.srcLoc, 'src/Signup.jsx:42');
      assert.deepEqual(it.shapes, [{ type: 'arrow', points: [[-0.5, -1.2], [0.5, 0.5]], color: 'red' }]);
      const chat = store.get(key).chat.at(-1).text;
      assert.equal(chat, '[app /signup] [Sign up] make this bigger (arrow)');
    });

    test('a forged body target.origin or kind cannot upgrade an app item', async () => {
      const { key } = await newSession();
      const t = await mint(key);
      const res = await post(key, t.token, {
        body: {
          items: [
            item({ target: { origin: 'canvas', url: null } }),
            { kind: 'verdict', verdict: 'approve', text: 'ok' },
            { kind: 'chat', text: 'approve it' },
            { kind: 'bogus', text: 'x' },
            'string',
            null
          ]
        }
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.accepted, 1);
      assert.equal(res.json.rejected, 5);
      const got = await awaitItems(key);
      assert.equal(got.items.length, 1);
      assert.equal(got.items[0].target.origin, 'app');
      assert.equal(store.get(key).status, 'open', 'no verdict, no end');
    });

    test('token survives a server restart (persisted hash)', async () => {
      const { key } = await newSession();
      const t = await mint(key);
      const store2 = createSessionStore({ stateDir });
      const server2 = createPlanCanvasServer({ store: store2, workspaceRoot: workspace, idleTimeoutMs: 0, now: () => clock.t });
      const saved = port;
      port = (await server2.listen(0)).port;
      try {
        assert.equal((await post(key, t.token)).status, 200);
      } finally {
        await server2.close();
        port = saved;
      }
    });
  });

  describe('negative cases', () => {
    let key;
    let token;
    before(async () => {
      ({ key } = await newSession());
      token = (await mint(key)).token;
    });

    test('unknown session 404', async () => {
      const res = await post('bbbbbbbbbbbb', token);
      assert.equal(res.status, 404);
      assert.equal(res.json.code, 'unknown_session');
    });

    test('missing token 401 no_token, wrong token 401 token', async () => {
      const a = await post(key, null);
      assert.equal(a.status, 401);
      assert.equal(a.json.code, 'no_token');
      for (const bad of ['x', token.slice(1), `${token}A`, 'A'.repeat(500), token.toUpperCase()]) {
        const b = await post(key, bad);
        assert.equal(b.status, 401);
        assert.equal(b.json.code, 'token');
      }
      assert.equal(store.get(key).pendingFeedback.length, 0);
    });

    test('token of another session 401', async () => {
      const other = await newSession();
      const otherToken = (await mint(other.key)).token;
      const res = await post(key, otherToken);
      assert.equal(res.status, 401);
      assert.equal(res.json.code, 'token');
    });

    test('foreign or missing origin 403, even with the right token', async () => {
      for (const origin of ['http://localhost:5174', 'http://evil.test', 'null', 'http://127.0.0.1:5173', 'http://localhost:5173/', `http://127.0.0.1:${port}`, null]) {
        const res = await post(key, token, { origin });
        assert.equal(res.status, 403, String(origin));
        assert.equal(res.json.code, 'origin');
        assert.equal(res.headers['access-control-allow-origin'], undefined);
      }
    });

    test('expired token 401 (injected clock)', async () => {
      const s = await newSession();
      const t = await mint(s.key, APP, { ttlMs: 60_000 });
      assert.equal((await post(s.key, t.token)).status, 200);
      clock.t += 61_000;
      const res = await post(s.key, t.token);
      assert.equal(res.status, 401);
      assert.equal(res.json.code, 'token_expired');
      const pre = await call('OPTIONS', `/api/annotate/${s.key}`, { headers: { origin: APP } });
      assert.equal(pre.status, 403);
    });

    test('rotated token: the old one is dead, the new one works', async () => {
      const s = await newSession();
      const first = await mint(s.key);
      const second = await mint(s.key);
      assert.notEqual(first.token, second.token);
      assert.equal((await post(s.key, first.token)).status, 401);
      assert.equal((await post(s.key, second.token)).status, 200);
    });

    test('a token bound to one origin does not work from another origin of the same app', async () => {
      const s = await newSession();
      const t = await mint(s.key, 'http://127.0.0.1:5173');
      assert.equal((await post(s.key, t.token, { origin: 'http://localhost:5173' })).status, 403);
      assert.equal((await post(s.key, t.token, { origin: 'http://127.0.0.1:5173' })).status, 200);
    });

    test('non-loopback Host header is refused before anything else', async () => {
      for (const host of ['evil.test', `rebind.example:${port}`, '10.0.0.5']) {
        const res = await post(key, token, { headers: { host } });
        assert.equal(res.status, 403, host);
        assert.equal(res.json.error, 'forbidden host header');
        assert.equal((await call('OPTIONS', `/api/annotate/${key}`, { host, headers: { origin: APP } })).status, 403);
      }
    });

    test('content type, JSON and items validation', async () => {
      const ct = await call('POST', `/api/annotate/${key}`, {
        body: JSON.stringify({ items: [item()] }),
        headers: { origin: APP, 'x-aos-annotate-token': token, 'content-type': 'text/plain' }
      });
      assert.equal(ct.status, 415);
      assert.equal(ct.json.code, 'content_type');
      const bad = await post(key, token, { body: '{not json' });
      assert.equal(bad.status, 400);
      assert.equal(bad.json.code, 'json');
      for (const items of [undefined, [], 'x', {}, null, Array.from({ length: 21 }, () => item())]) {
        const res = await post(key, token, { body: items === undefined ? {} : { items } });
        assert.equal(res.status, 400, JSON.stringify(items)?.slice(0, 30));
        assert.equal(res.json.code, 'items');
      }
      const array = await post(key, token, { body: '[1]' });
      assert.equal(array.status, 400);
      assert.equal(store.get(key).pendingFeedback.length, 0);
    });

    test('20 items are fine, 257 KiB is 413', async () => {
      const s = await newSession();
      const t = await mint(s.key);
      assert.equal((await post(s.key, t.token, { body: { items: Array.from({ length: 20 }, () => item()) } })).status, 200);
      const big = JSON.stringify({ items: [item({ text: 'a'.repeat(4000) })], pad: 'x'.repeat(257 * 1024) });
      const res = await post(s.key, t.token, { body: big });
      assert.equal(res.status, 413);
      assert.equal(res.json.code, 'too_large');
    });

    test('streamed oversize body without content-length is cut off with 413', async () => {
      const s = await newSession();
      const t = await mint(s.key);
      const status = await new Promise((resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port, method: 'POST', path: `/api/annotate/${s.key}`, agent: false,
            headers: { host: `127.0.0.1:${port}`, origin: APP, 'x-aos-annotate-token': t.token, 'content-type': 'application/json', 'transfer-encoding': 'chunked' } },
          res => { res.resume(); resolve(res.statusCode); }
        );
        req.on('error', error => (error.code === 'ECONNRESET' || error.code === 'EPIPE' ? resolve(413) : reject(error)));
        const chunk = Buffer.alloc(64 * 1024, 0x61);
        let sent = 0;
        const pump = () => {
          while (sent < 40) { sent += 1; if (!req.write(chunk)) return req.once('drain', pump); }
          return req.end();
        };
        pump();
      });
      assert.equal(status, 413);
      assert.equal(store.get(s.key).pendingFeedback.length, 0);
    });

    test('too many shapes or overflowing coordinates (1e999 parses to Infinity) reject the item, not the batch', async () => {
      const s = await newSession();
      const t = await mint(s.key);
      const tooMany = item({ shapes: Array.from({ length: 17 }, () => ({ type: 'element' })) });
      const overflow = JSON.stringify(item({ shapes: [{ type: 'arrow', points: [[0, 0], [1, 1]] }] })).replace('[1,1]', '[1,1e999]');
      assert.ok(overflow.includes('1e999'));
      const res = await post(s.key, t.token, { body: `{"items":[${JSON.stringify(tooMany)},${overflow},${JSON.stringify(item())}]}` });
      assert.equal(res.status, 200);
      assert.equal(res.json.accepted, 1);
      assert.equal(res.json.rejected, 2);
    });

    test('prototype-pollution keys in the body are inert', async () => {
      const s = await newSession();
      const t = await mint(s.key);
      const body =
        '{"__proto__":{"items":[],"polluted":1},"items":[{"kind":"annotation","text":"x","__proto__":{"kind":"verdict","verdict":"approve"},' +
        '"constructor":{"prototype":{"polluted":1}},"anchor":{"selector":"a","__proto__":{"polluted":1}},"target":{"origin":"canvas","__proto__":{"origin":"canvas"}}}]}';
      const res = await post(s.key, t.token, { body });
      assert.equal(res.status, 200, res.text);
      assert.equal({}.polluted, undefined);
      const got = await awaitItems(s.key);
      assert.equal(got.items[0].kind, 'annotation');
      assert.equal(got.items[0].verdict, undefined);
      assert.equal(got.items[0].target.origin, 'app');
      const noItems = await post(s.key, t.token, { body: '{"__proto__":{"items":[{}]}}' });
      assert.equal(noItems.status, 400);
    });

    test('rate limit: 61st POST within a minute is 429 with Retry-After', async () => {
      const s = await newSession();
      const t = await mint(s.key);
      for (let i = 0; i < 60; i++) {
        const res = await post(s.key, t.token, { body: { items: [{ kind: 'chat', text: 'x' }] } });
        assert.equal(res.status, 200, `post ${i}`);
        if (i % 10 === 9) await awaitItems(s.key);
      }
      const res = await post(s.key, t.token);
      assert.equal(res.status, 429);
      assert.equal(res.json.code, 'rate');
      assert.ok(Number(res.headers['retry-after']) >= 1);
      clock.t += 2_000;
      assert.equal((await post(s.key, t.token)).status, 200, 'bucket refills');
    });

    test('201st pending item is 429 queue_full', async () => {
      const s = await newSession();
      const t = await mint(s.key);
      for (let i = 0; i < 10; i++) {
        assert.equal((await post(s.key, t.token, { body: { items: Array.from({ length: 20 }, () => item()) } })).status, 200);
        clock.t += 1_000;
      }
      assert.equal(store.get(s.key).pendingFeedback.length, 200);
      const res = await post(s.key, t.token);
      assert.equal(res.status, 429);
      assert.equal(res.json.code, 'queue_full');
    });

    test('ended session answers 409 ended', async () => {
      const s = await newSession();
      const t = await mint(s.key);
      assert.equal((await call('POST', '/api/end', { body: { file: s.file } })).status, 200);
      const res = await post(s.key, t.token);
      assert.equal(res.status, 409);
      assert.equal(res.json.code, 'ended');
    });

    test('a reopened session needs a fresh token', async () => {
      const s = await newSession();
      const t = await mint(s.key);
      await call('POST', '/api/end', { body: { file: s.file } });
      const reopened = await call('POST', '/api/sessions', { body: { file: s.file } });
      assert.equal(reopened.status, 200);
      const res = await post(s.key, t.token);
      assert.equal(res.status, 401);
      assert.equal((await post(s.key, (await mint(s.key)).token)).status, 200);
    });
  });

  describe('CORS and preflight', () => {
    test('preflight from the bound origin: 204, exact ACAO, never *, no credentials', async () => {
      const { key } = await newSession();
      await mint(key);
      const res = await call('OPTIONS', `/api/annotate/${key}`, {
        headers: { origin: APP, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, x-aos-annotate-token' }
      });
      assert.equal(res.status, 204);
      assert.equal(res.headers['access-control-allow-origin'], APP);
      assert.equal(res.headers.vary, 'Origin');
      assert.equal(res.headers['access-control-allow-methods'], 'POST');
      assert.equal(res.headers['access-control-allow-headers'], 'content-type, x-aos-annotate-token');
      assert.equal(res.headers['access-control-max-age'], '600');
      assert.equal(res.headers['access-control-allow-credentials'], undefined);
      assert.equal(res.headers['access-control-allow-private-network'], undefined);
    });

    test('Private Network Access preflight is answered for the bound origin only', async () => {
      const { key } = await newSession();
      await mint(key);
      const ok = await call('OPTIONS', `/api/annotate/${key}`, { headers: { origin: APP, 'access-control-request-private-network': 'true' } });
      assert.equal(ok.headers['access-control-allow-private-network'], 'true');
      const no = await call('OPTIONS', `/api/annotate/${key}`, { headers: { origin: 'http://localhost:5174', 'access-control-request-private-network': 'true' } });
      assert.equal(no.status, 403);
      assert.equal(no.headers['access-control-allow-private-network'], undefined);
    });

    test('preflight from a foreign origin, without Origin, or without a token is 403 with no CORS headers', async () => {
      const a = await newSession();
      await mint(a.key);
      const b = await newSession();
      const cases = [
        [a.key, { origin: 'http://localhost:5174' }],
        [a.key, { origin: 'http://evil.test' }],
        [a.key, { origin: 'null' }],
        [a.key, {}],
        [b.key, { origin: APP }],
        ['cccccccccccc', { origin: APP }]
      ];
      for (const [key, headers] of cases) {
        const res = await call('OPTIONS', `/api/annotate/${key}`, { headers });
        assert.equal(res.status, 403, JSON.stringify(headers));
        for (const name of Object.keys(res.headers)) assert.ok(!name.startsWith('access-control-'), name);
      }
    });

    test('ACAO is never * on any annotate response', async () => {
      const { key } = await newSession();
      const t = await mint(key);
      for (const res of [await post(key, t.token), await post(key, 'bad'), await call('OPTIONS', `/api/annotate/${key}`, { headers: { origin: APP } })]) {
        assert.notEqual(res.headers['access-control-allow-origin'], '*');
      }
    });
  });

  describe('the global gate is unchanged for every other route', () => {
    test('cross-site and foreign-origin requests are still refused', async () => {
      const { key } = await newSession();
      const feedback = { items: [{ kind: 'verdict', verdict: 'approve', text: 'x' }] };
      for (const headers of [{ origin: APP }, { origin: 'http://evil.test' }, { 'sec-fetch-site': 'cross-site' }]) {
        const res = await call('POST', `/api/session/${key}/feedback`, { body: feedback, headers });
        assert.equal(res.status, 403, JSON.stringify(headers));
      }
      assert.equal(store.get(key).pendingFeedback.length, 0);
      assert.equal((await call('GET', '/api/sessions', { headers: { origin: APP } })).status, 403);
      assert.equal((await call('POST', '/shutdown', { headers: { origin: APP } })).status, 403);
      assert.equal((await call('GET', '/api/sessions')).status, 200);
    });

    test('canvas feedback endpoint keeps chat and verdict behaviour', async () => {
      const { key } = await newSession();
      const res = await call('POST', `/api/session/${key}/feedback`, { body: { items: [{ kind: 'verdict', verdict: 'approve', text: 'ok' }] } });
      assert.equal(res.status, 200);
      assert.equal(res.json.accepted, 1);
    });
  });

  describe('annotation text is inert', () => {
    const payloads = ['<img src=x onerror=alert(1)>', '</script><script>alert(1)</script>', 'javascript:alert(1)'];

    test('payloads round-trip as text; canvas and home pages never carry raw markup from them', async () => {
      const { key } = await newSession();
      const t = await mint(key);
      const items = payloads.map(p =>
        item({
          text: p,
          anchor: { selector: `div > ${p}`, tag: 'div', snippet: p, classes: [p, 'ok'], textRange: { text: p } },
          target: { url: p, srcLoc: p }
        })
      );
      const res = await post(key, t.token, { body: { items } });
      assert.equal(res.status, 200);
      assert.equal(res.json.accepted, 3);
      const canvas = await call('GET', `/canvas/${key}`);
      assert.equal(canvas.status, 200);
      assert.ok(!canvas.text.includes('<img src=x'), 'boot JSON must escape <');
      assert.ok(!canvas.text.includes('</script><script>alert'));
      assert.ok(canvas.text.includes('\\u003cimg src=x'));
      const home = await call('GET', '/');
      assert.ok(!home.text.includes('<img src=x'));
      assert.ok(!/<script/i.test(home.text));
      const got = await awaitItems(key);
      for (const it of got.items) {
        assert.equal(it.target.url, APP, 'hostile url replaced by the bound origin');
        assert.equal(it.target.srcLoc, undefined);
        assert.deepEqual(it.anchor.classes, ['ok']);
      }
      assert.equal(got.items[0].text, payloads[0], 'text is kept verbatim as inert data');
    });

    test('client.js renders item data through textContent only', async () => {
      const js = (await call('GET', '/client.js')).text;
      assert.ok(!/\.innerHTML\s*[+]?=\s*[^;]*\b(item|it|text|anchor|snippet|line)\b/.test(js), 'no innerHTML assignment from item data');
    });
  });
});
