// Firefox sends `Origin: null` on every load made by the sandboxed artifact iframe (opaque origin),
// including the no-cors <script src="/sdk.js">. A 403 there means no annotation toolbar in Firefox.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSessionStore } = require('../skills/global_config/plan-canvas/scripts/lib/plan-canvas/sessions.js');
const { createPlanCanvasServer } = require('../skills/global_config/plan-canvas/scripts/lib/plan-canvas/server.js');

let workspace;
let server;
let port;
let key;

// node:http, not fetch: fetch refuses to set the Origin and Sec-Fetch-* headers.
function call(method, urlPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const extra = body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {};
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: { ...headers, ...extra } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', c => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

// What Firefox 160 sent for <script src> inside a sandbox="allow-scripts" iframe (captured headers).
const FIREFOX_SANDBOX = { origin: 'null', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' };

describe('Plan Canvas: loads from the sandboxed artifact iframe', () => {
  before(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-origin-'));
    fs.writeFileSync(path.join(workspace, 'plan.md'), '# plan');
    fs.writeFileSync(path.join(workspace, 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const store = createSessionStore({ stateDir: path.join(workspace, '.state') });
    server = createPlanCanvasServer({ store, workspaceRoot: workspace, idleTimeoutMs: 0 });
    port = (await server.listen(0)).port;
    const opened = await call('POST', '/api/sessions', {}, JSON.stringify({ file: path.join(workspace, 'plan.md') }));
    assert.equal(opened.status, 200, opened.text);
    const m = /"key":"([a-f0-9]{12})"/.exec(opened.text);
    assert.ok(m, opened.text);
    key = m[1];
  });

  after(async () => {
    if (server) await server.close().catch(() => {});
  });

  test('sdk.js is served with Origin: null (Firefox) and with no Origin header (Chromium)', async () => {
    const firefox = await call('GET', '/sdk.js', FIREFOX_SANDBOX);
    assert.equal(firefox.status, 200, firefox.text.slice(0, 200));
    assert.match(firefox.text, /role=\\"toolbar\\"/);
    const chromium = await call('GET', '/sdk.js', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' });
    assert.equal(chromium.status, 200);
  });

  test('the artifact page and its sibling assets load with Origin: null', async () => {
    assert.equal((await call('GET', `/artifact/${key}/`, { origin: 'null', 'sec-fetch-site': 'cross-site' })).status, 200);
    assert.equal((await call('GET', `/artifact/${key}/pic.svg`, { ...FIREFOX_SANDBOX, 'sec-fetch-dest': 'image' })).status, 200);
  });

  test('no CORS header is added, so a cross-origin page still cannot read the response', async () => {
    const res = await call('GET', '/sdk.js', FIREFOX_SANDBOX);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  test('Origin: null stays refused everywhere else', async () => {
    assert.equal((await call('GET', '/api/sessions', { origin: 'null' })).status, 403);
    assert.equal((await call('GET', `/canvas/${key}`, { origin: 'null' })).status, 403);
    assert.equal((await call('POST', '/api/sessions', { origin: 'null' }, JSON.stringify({ file: path.join(workspace, 'plan.md') }))).status, 403);
    assert.equal((await call('POST', '/sdk.js', { origin: 'null' }, '{}')).status, 403);
  });

  test('a foreign origin is refused on the static paths too, and the Host check still applies', async () => {
    assert.equal((await call('GET', '/sdk.js', { origin: 'http://evil.test' })).status, 403);
    assert.equal((await call('GET', '/sdk.js', { origin: 'null', host: 'evil.test' })).status, 403);
  });
});
