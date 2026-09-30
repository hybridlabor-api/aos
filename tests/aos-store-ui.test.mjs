import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdirSync, mkdtempSync, realpathSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createStoreServer } from '../lib/store-ui/server.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'aos-store-ui-')));
const home = join(tmp, 'home');
const cwd = join(tmp, 'proj');
mkdirSync(home);
mkdirSync(cwd);
const realHome = process.env.HOME;
let server, base, token;

before(async () => {
  process.env.HOME = home;
  server = createStoreServer({ cwd });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
  token = (await (await fetch(base + '/')).text()).match(/const TOKEN='([0-9a-f]+)'/)[1];
});
after(() => {
  server.close();
  process.env.HOME = realHome;
  rmSync(tmp, { recursive: true, force: true });
});

const post = (path, body, headers = {}) => fetch(base + path, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const call = (path, body, headers) => post(path, body, { 'x-store-token': token, ...headers });

test('health', async () => {
  assert.deepEqual(await (await fetch(base + '/api/health')).json(), { ok: true, service: 'aos-store' });
});

test('catalog merges AOS Core and ECC with scope-aware state', async () => {
  const d = await (await fetch(base + '/api/catalog?scope=project')).json();
  assert.equal(d.scope, 'project');
  assert.ok(d.items.some((i) => i.source === 'AOS Core' && i.kind === 'skill'));
  assert.ok(d.items.some((i) => i.source === 'ECC' && i.kind === 'agent'));
  assert.ok(d.items.find((i) => i.name === 'frontend-slides').multiFile);
  assert.equal(d.items.find((i) => i.name === 'django-patterns').installed, false);
});

test('auth: 401 without token, 403 bad origin/host, 400 bad name', async () => {
  assert.equal((await post('/api/preview', { name: 'django-patterns', kind: 'skill' })).status, 401);
  assert.equal((await call('/api/preview', { name: 'django-patterns', kind: 'skill' }, { origin: 'http://evil.example' })).status, 403);
  const status = await new Promise((ok) => request(base + '/api/health', { headers: { host: 'evil.example' } }, (r) => { r.resume(); ok(r.statusCode); }).end());
  assert.equal(status, 403);
  assert.equal((await call('/api/preview', { name: '../x', kind: 'skill' })).status, 400);
  assert.equal((await call('/api/preview', { name: 'no-such-skill-xyz', kind: 'skill' })).status, 404);
  assert.equal((await fetch(base + '/api/preview')).status, 404);
});

test('preview lists global targets inside temp HOME and writes nothing', async () => {
  const d = await (await call('/api/preview', { name: 'django-patterns', kind: 'skill', scope: 'global' })).json();
  assert.equal(d.scope, 'global');
  assert.ok(d.targets.length >= 2);
  for (const t of d.targets) { assert.ok(t.startsWith(home), t); assert.ok(!existsSync(t)); }
});

test('preview in project scope targets the UI cwd', async () => {
  const d = await (await call('/api/preview', { name: 'django-patterns', kind: 'skill', scope: 'project' })).json();
  assert.deepEqual(d.targets, [join(cwd, 'skills', 'django-patterns', 'SKILL.md')]);
});

test('multi-file skills and Core items are refused', async () => {
  assert.equal((await call('/api/install', { name: 'frontend-slides', kind: 'skill' })).status, 409);
  const core = (await (await fetch(base + '/api/catalog')).json()).items.find((i) => i.core && i.kind === 'skill');
  assert.equal((await call('/api/preview', { name: core.name, kind: 'skill' })).status, 409);
});

test('multi-file list only names real index skills', () => {
  const idx = JSON.parse(readFileSync(join(root, 'lib', 'ecc-store-index.json'), 'utf8'));
  const list = JSON.parse(readFileSync(join(root, 'lib', 'store-ui', 'multi-file-skills.json'), 'utf8'));
  assert.equal(list.length, 35);
  for (const n of list) assert.ok(idx.skills[n], n);
});
