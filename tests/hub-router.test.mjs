'use strict';

import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHub } from '../lib/hub/server.mjs';
import { routes as routerRoutes } from '../lib/hub/routes-router.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
// Unique temp dirs, never deleted (rules forbid recursive deletes).
const tmp = mkdtempSync(join(tmpdir(), 'aos-hub-router-'));
const home = join(tmp, 'home');
const project = join(tmp, 'project');
mkdirSync(home, { recursive: true });
mkdirSync(project, { recursive: true });

const userRouter = join(home, '.aos', 'router.json');
const projectRouter = join(project, '.aos', 'router.json');

let hub, base, token;
before(async () => {
  hub = createHub({
    port: 0,
    home,
    routes: routerRoutes,
    ctx: { root, cwd: project, hubJsonPath: join(home, '.aos', 'hub', 'hub.json') },
  });
  token = hub.token;
  await hub.listen();
  base = `http://127.0.0.1:${hub.server.address().port}`;
});

after(() => hub.close());

const raw = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((ok, fail) => {
  const req = request(base + path, { method, headers }, (res) => {
    let data = '';
    res.on('data', (c) => { data += c; });
    res.on('end', () => ok({ status: res.statusCode, body: data }));
  });
  req.on('error', fail);
  if (body) req.write(body);
  req.end();
});
const get = (path) => raw(path);
const post = (path, body_, headers = {}) => raw(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-aos-hub-token': token, ...headers },
  body: JSON.stringify(body_ ?? {}),
});

test('GET /api/router returns the effective table with sources, paths and tests', async () => {
  const { status, body } = await get('/api/router');
  assert.equal(status, 200);
  const json = JSON.parse(body);
  assert.equal(json.ok, true);
  assert.equal(json.enforce, false);
  assert.ok(json.roles.includes('architect'));
  assert.ok(json.preferences.builder.length > 0);
  // Nothing overrides a fresh temp HOME/project: every source is shipped.
  for (const role of json.roles) assert.equal(json.sources[role], 'shipped');
  assert.equal(json.sources['target:claude'], 'shipped');
  assert.match(json.paths.user, /[.]aos[/\\]router[.]json$/);
  assert.match(json.paths.project, /[.]aos[/\\]router[.]json$/);
  // Per-role route preview (the tab's test button data).
  assert.equal(json.tests.builder.target, json.preferences.builder[0]);
  assert.ok(json.tests.builder.reason.length > 0);
  // lib/router exposes no live usage.
  assert.equal(json.usageAvailable, false);
  assert.match(json.note, /advisory/i);
});

test('POST /api/router saves to the user layer and GET reflects it', async () => {
  const { status, body } = await post('/api/router', { role: 'architect', targets: ['agy', 'claude'], layer: 'user' });
  assert.equal(status, 200);
  const saved = JSON.parse(body);
  assert.equal(saved.ok, true);
  assert.equal(saved.layer, 'user');
  assert.ok(existsSync(userRouter), 'user layer file must exist');
  const layer = JSON.parse(readFileSync(userRouter, 'utf8'));
  assert.deepEqual(layer.preferences.architect, ['agy', 'claude']);
  const { body: getBody } = await get('/api/router');
  const json = JSON.parse(getBody);
  assert.equal(json.sources.architect, 'user');
  assert.deepEqual(json.preferences.architect, ['agy', 'claude']);
});

test('layer toggle: saving to the project layer wins over the user layer', async () => {
  const { status } = await post('/api/router', { role: 'architect', targets: ['codex'], layer: 'project' });
  assert.equal(status, 200);
  assert.ok(existsSync(projectRouter), 'project layer file must exist');
  assert.deepEqual(JSON.parse(readFileSync(projectRouter, 'utf8')).preferences.architect, ['codex']);
  // The user layer write from the previous test must be untouched.
  assert.deepEqual(JSON.parse(readFileSync(userRouter, 'utf8')).preferences.architect, ['agy', 'claude']);
  const { body } = await get('/api/router');
  const json = JSON.parse(body);
  assert.equal(json.sources.architect, 'project');
  assert.deepEqual(json.preferences.architect, ['codex']);
});

test('POST /api/router preserves other keys and roles already in the layer file', async () => {
  mkdirSync(join(home, '.aos'), { recursive: true });
  writeFileSync(userRouter, JSON.stringify({ preferences: { scout: ['agy'] } }));
  await post('/api/router', { role: 'builder', targets: ['claude'], layer: 'user' });
  const layer = JSON.parse(readFileSync(userRouter, 'utf8'));
  assert.deepEqual(layer.preferences.scout, ['agy'], 'existing role preference must survive');
  assert.deepEqual(layer.preferences.builder, ['claude']);
});

test('POST /api/router rejects invalid input and writes nothing', async () => {
  const before = readFileSync(projectRouter, 'utf8');
  const bad = [
    { role: 'ninja', targets: ['claude'], layer: 'user' },
    { role: 'architect', targets: ['magic-engine'], layer: 'user' },
    { role: 'architect', targets: [], layer: 'user' },
    { role: 'architect', targets: 'claude', layer: 'user' },
    { role: 'architect', targets: ['claude'], layer: 'repo' },
    { targets: ['claude'], layer: 'user' },
  ];
  for (const payload of bad) {
    const { status } = await post('/api/router', payload);
    assert.equal(status, 400, `expected 400 for ${JSON.stringify(payload)}`);
  }
  assert.equal(readFileSync(projectRouter, 'utf8'), before, 'rejected writes must not touch the layer file');
  const layer = JSON.parse(readFileSync(userRouter, 'utf8'));
  assert.equal(layer.preferences.ninja, undefined);
});

test('POST /api/router runs the strict loader before writing: invalid merged config is rejected', async () => {
  // A poisoned user layer only becomes invalid through the merge: writing any
  // preference on top must be refused and the destination file must not exist.
  const badHome = join(tmp, 'bad-home');
  mkdirSync(join(badHome, '.aos'), { recursive: true });
  writeFileSync(join(badHome, '.aos', 'router.json'), JSON.stringify({ roles: ['architect', 'ninja'], targets: { claude: {} } }));
  const badProject = join(tmp, 'bad-project');
  mkdirSync(badProject, { recursive: true });
  const hub2 = createHub({
    port: 0,
    home: badHome,
    routes: routerRoutes,
    ctx: { root, cwd: badProject, hubJsonPath: join(badHome, '.aos', 'hub', 'hub.json') },
  });
  await hub2.listen();
  try {
    const b2 = `http://127.0.0.1:${hub2.server.address().port}`;
    const res = await new Promise((ok, fail) => {
      const req = request(`${b2}/api/router`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-aos-hub-token': hub2.token },
      }, (r) => {
        let d = '';
        r.on('data', (c) => { d += c; });
        r.on('end', () => ok({ status: r.statusCode, body: d }));
      });
      req.on('error', fail);
      req.end(JSON.stringify({ role: 'architect', targets: ['claude'], layer: 'project' }));
    });
    assert.equal(res.status, 400);
    assert.match(JSON.parse(res.body).error, /Unknown role "ninja"/);
    assert.ok(!existsSync(join(badProject, '.aos', 'router.json')), 'the rejected write must not land');
  } finally {
    hub2.close();
  }
});

test('mutating route guards apply: no token is 401, wrong content-type is 415', async () => {
  const noToken = await raw('/api/router', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noToken.status, 401);
  const noJson = await raw('/api/router', { method: 'POST', headers: { 'x-aos-hub-token': token }, body: '{}' });
  assert.equal(noJson.status, 415);
});
