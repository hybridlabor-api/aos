import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createSessionStore } = require('../skills/global_config/plan-canvas/scripts/lib/plan-canvas/sessions.js');
const { createPlanCanvasServer } = require('../skills/global_config/plan-canvas/scripts/lib/plan-canvas/server.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let workspace;
let outside;
let store;
let server;
let base;

async function openSession(file) {
  const response = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file }),
    signal: AbortSignal.timeout(3000),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

describe('Plan-Canvas artifact confinement', () => {
  before(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-root-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-outside-'));
    const insideFile = path.join(workspace, 'plan.md');
    const outsideFile = path.join(outside, 'secret.md');
    fs.writeFileSync(insideFile, '# inside');
    fs.writeFileSync(outsideFile, '# outside');
    fs.symlinkSync(outsideFile, path.join(workspace, 'linked.md'));
    store = createSessionStore({ stateDir: path.join(workspace, '.state') });
    server = createPlanCanvasServer({ store, workspaceRoot: workspace, idleTimeoutMs: 0 });
    const bound = await server.listen(0);
    base = `http://127.0.0.1:${bound.port}`;
  });

  after(async () => {
    if (server) await server.close().catch(() => {});
    if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
    if (outside) fs.rmSync(outside, { recursive: true, force: true });
  });

  test('opens a file inside the workspace', async () => {
    const result = await openSession(path.join(workspace, 'plan.md'));
    assert.equal(result.status, 200);
  });

  test('rejects files outside the workspace and symlink escapes', async () => {
    const outsideResult = await openSession(path.join(outside, 'secret.md'));
    assert.equal(outsideResult.status, 403);
    const linkResult = await openSession(path.join(workspace, 'linked.md'));
    assert.equal(linkResult.status, 403);
  });
});

const guard = require('../skills/global_config/plan-canvas/scripts/lib/loopback-guard.js');
const http = await import('node:http');

function rawRequest(port, { method = 'POST', pathName = '/api/end', headers = {}, body = '{"file":"nope.md"}' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathName, headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.setTimeout(3000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

describe('Plan-Canvas request provenance', () => {
  let ws;
  let srv;
  let port;

  before(async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-prov-'));
    srv = createPlanCanvasServer({ store: createSessionStore({ stateDir: path.join(ws, '.state') }), workspaceRoot: ws, idleTimeoutMs: 0 });
    port = (await srv.listen(0)).port;
  });

  after(async () => {
    if (srv) await srv.close().catch(() => {});
    if (ws) fs.rmSync(ws, { recursive: true, force: true });
  });

  test('unit: origin must match the port when one is given', () => {
    const hosts = guard.buildAllowedHostnames('127.0.0.1');
    assert.equal(guard.isAllowedOrigin('http://127.0.0.1:4519', hosts, 4519), true);
    assert.equal(guard.isAllowedOrigin('http://localhost:4519', hosts, 4519), true);
    assert.equal(guard.isAllowedOrigin('http://127.0.0.1:8081', hosts, 4519), false);
    assert.equal(guard.isAllowedOrigin('http://evil.example:4519', hosts, 4519), false);
    assert.equal(guard.isAllowedOrigin('null', hosts, 4519), false);
    assert.equal(guard.isAllowedOrigin(undefined, hosts, 4519), true);
    assert.equal(guard.isAllowedOrigin('http://127.0.0.1:8081', hosts), true, 'legacy call without a port is unchanged');
  });

  test('unit: fetch-site only accepts same-origin, none or absent', () => {
    assert.equal(guard.isAllowedFetchSite(undefined), true);
    assert.equal(guard.isAllowedFetchSite('same-origin'), true);
    assert.equal(guard.isAllowedFetchSite('none'), true);
    assert.equal(guard.isAllowedFetchSite('cross-site'), false);
    assert.equal(guard.isAllowedFetchSite('same-site'), false);
  });

  test('a CLI request without Origin is served', async () => {
    const r = await rawRequest(port);
    assert.notEqual(r.status, 403);
  });

  test('the canvas UI origin (same port) is served', async () => {
    const r = await rawRequest(port, { headers: { origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' } });
    assert.notEqual(r.status, 403);
  });

  test('another local web app on a different loopback port is refused', async () => {
    const r = await rawRequest(port, { headers: { origin: `http://127.0.0.1:${port + 1}` } });
    assert.equal(r.status, 403);
    assert.match(r.body, /forbidden origin/);
  });

  test('a cross-site browser request is refused even with a matching-looking origin', async () => {
    const r = await rawRequest(port, { headers: { origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'cross-site' } });
    assert.equal(r.status, 403);
    assert.match(r.body, /forbidden fetch site/);
  });

  test('the sandboxed artifact iframe can still load the sdk and sibling assets', async () => {
    // The canvas iframe has no allow-same-origin, so its subresource requests
    // are labelled Sec-Fetch-Site: cross-site. Read-only static paths must stay served.
    const sdk = await rawRequest(port, { method: 'GET', pathName: '/sdk.js', body: '', headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(sdk.status, 200);
    const asset = await rawRequest(port, { method: 'GET', pathName: '/artifact/aaaaaaaaaaaa/logo.png', body: '', headers: { 'sec-fetch-site': 'cross-site' } });
    assert.notEqual(asset.status, 403, 'a missing asset is 404, never a fetch-site refusal');
  });

  test('cross-site is still refused for API, canvas pages and state changes', async () => {
    const cross = { 'sec-fetch-site': 'cross-site' };
    assert.equal((await rawRequest(port, { method: 'GET', pathName: '/api/sessions', body: '', headers: cross })).status, 403);
    assert.equal((await rawRequest(port, { method: 'GET', pathName: '/canvas/aaaaaaaaaaaa', body: '', headers: cross })).status, 403);
    assert.equal((await rawRequest(port, { method: 'POST', pathName: '/api/end', headers: cross })).status, 403);
    assert.equal((await rawRequest(port, { method: 'POST', pathName: '/sdk.js', headers: cross })).status, 403);
  });

  test('shutdown and feedback endpoints are covered by the same gate', async () => {
    const other = { origin: `http://localhost:${port + 1}` };
    assert.equal((await rawRequest(port, { pathName: '/shutdown', headers: other })).status, 403);
    assert.equal((await rawRequest(port, { pathName: '/api/session/aaaaaaaaaaaa/feedback', headers: other })).status, 403);
  });
});
