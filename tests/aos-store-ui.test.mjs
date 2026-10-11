import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, readFileSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createStoreServer } from '../lib/store-ui/server.mjs';
import { readLocalDoc } from '../lib/store-shared.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'aos-store-ui-')));
const home = join(tmp, 'home');
const cwd = join(tmp, 'proj');
mkdirSync(home);
mkdirSync(cwd);
const realHome = process.env.HOME;
const realProfile = process.env.USERPROFILE;
let server, base, token;

before(async () => {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  server = createStoreServer({ cwd });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
  token = (await (await fetch(base + '/')).text()).match(/const TOKEN='([0-9a-f]+)'/)[1];
});
after(() => {
  server.close();
  process.env.HOME = realHome;
  if (realProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = realProfile;
  // The temp dir is deliberately never deleted (rules forbid recursive deletes).
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
  assert.ok(d.items.every((i) => Array.isArray(i.requires)), 'the UI reads requires.length on every item');
  assert.ok(d.items.some((i) => i.source === 'AOS Core' && i.kind === 'skill'));
  assert.ok(d.items.some((i) => i.source === 'ECC' && i.kind === 'agent'));
  assert.ok(d.items.find((i) => i.name === 'frontend-slides').fileCount > 1);
  assert.equal(d.items.find((i) => i.name === 'django-patterns').fileCount, 1);
  assert.equal(d.items.find((i) => i.name === 'ck').hasHooks, true);
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

test('multi-file skills preview all files (no 409); Core items are refused', async () => {
  const idx = JSON.parse(readFileSync(join(root, 'lib', 'ecc-store-index.json'), 'utf8'));
  const res = await call('/api/preview', { name: 'frontend-slides', kind: 'skill', scope: 'project' });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.deepEqual(d.targets, idx.skills['frontend-slides'].files.map((f) => join(cwd, 'skills', 'frontend-slides', f.path)));
  for (const t of d.targets) assert.ok(!existsSync(t));
  const core = (await (await fetch(base + '/api/catalog')).json()).items.find((i) => i.core && i.kind === 'skill');
  assert.equal((await call('/api/preview', { name: core.name, kind: 'skill' })).status, 409);
});

test('no multi-file gating left in UI or server', () => {
  for (const f of ['lib/store-ui/index.html', 'lib/store-ui/server.mjs']) {
    assert.doesNotMatch(readFileSync(join(root, f), 'utf8'), /multiFile|multi-file-skills|install incomplete/);
  }
  assert.ok(!existsSync(join(root, 'lib', 'store-ui', 'multi-file-skills.json')));
});

test('catalog feeds a Playbooks area with every pb-* skill and the UI renders it', async () => {
  const d = await (await fetch(base + '/api/catalog')).json();
  const dirs = readdirSync(join(root, 'skills', 'playbooks')).filter((n) => n.startsWith('pb-')).sort();
  assert.deepEqual(d.playbooks.map((p) => p.name), dirs);
  for (const p of d.playbooks) {
    assert.ok(p.description && p.est_time && p.difficulty && Array.isArray(p.requires.skills), p.name);
  }
  const html = readFileSync(join(root, 'lib', 'store-ui', 'index.html'), 'utf8');
  assert.match(html, /renderPlaybooks/);
  assert.match(html, /chip\('tab','playbook'/);
  const inline = html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(inline));
});

test('WP4: catalog/previewMeta are exported for the hub', async () => {
  const mod = await import(new URL('../lib/store-ui/server.mjs', import.meta.url));
  assert.equal(typeof mod.catalog, 'function');
  assert.equal(typeof mod.previewMeta, 'function');
  const meta = mod.previewMeta('django-patterns', 'skill');
  assert.ok(meta.source && meta.pinned_commit, 'preview meta carries source + commit');
  assert.equal(typeof mod.catalog('global', cwd).items.length, 'number');
});

test('GET /api/skill: core skill doc, frontmatter + body, root-relative path', async () => {
  const res = await fetch(base + '/api/skill?name=startcycle');
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.name, 'startcycle');
  assert.equal(d.kind, 'skill');
  assert.match(d.frontmatter, /name:/);
  assert.ok(d.body.length > 0);
  assert.equal(d.truncated, false);
  assert.match(d.path, /^(skills|agents|\.claude)\//);
  assert.equal(d.path, 'skills/basic/startcycle/SKILL.md');
});

test('GET /api/skill: 400 for traversal, empty name and bad kind; 404 for unknown', async () => {
  for (const q of ['name=a%2Fb', 'name=..', 'name=%2e%2e%2fetc', 'name=', '']) {
    assert.equal((await fetch(`${base}/api/skill?${q}`)).status, 400, q);
  }
  assert.equal((await fetch(base + '/api/skill?name=startcycle&kind=foo')).status, 400);
  assert.equal((await fetch(base + '/api/skill?name=no-such-skill-xyz')).status, 404);
});

test('GET /api/skill: kind=agent returns a real agent; unknown agent 404s', async () => {
  const d = await (await fetch(base + '/api/skill?name=architect&kind=agent')).json();
  assert.equal(d.kind, 'agent');
  assert.match(d.path, /^(skills|agents|\.claude)\//);
  assert.ok(d.body.length > 0);
  assert.equal((await fetch(base + '/api/skill?name=no-such-agent-xyz&kind=agent')).status, 404);
});

test('readLocalDoc: CRLF frontmatter split; symlink, directory and outside-root cases 404', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'b2-doc-')));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'b2-out-')));
  mkdirSync(join(dir, 'skills', 'x'), { recursive: true });
  mkdirSync(join(dir, 'skills', 'link'), { recursive: true });
  mkdirSync(join(dir, 'agents', 'foo'), { recursive: true });
  writeFileSync(join(dir, 'skills', 'x', 'SKILL.md'), '---\r\nname: x\r\ndescription: y\r\n---\r\nBody line\r\n');
  writeFileSync(join(outside, 'SKILL.md'), '---\nname: out\n---\nsecret\n');
  symlinkSync(join(outside, 'SKILL.md'), join(dir, 'skills', 'link', 'SKILL.md'));
  const doc = readLocalDoc(dir, 'x', 'skill');
  assert.equal(doc.frontmatter, 'name: x\ndescription: y');
  assert.equal(doc.body, 'Body line\n');
  assert.equal(doc.path, 'skills/x/SKILL.md');
  assert.throws(() => readLocalDoc(dir, 'link', 'skill'), (e) => e.status === 404);
  assert.throws(() => readLocalDoc(dir, 'foo', 'agent'), (e) => e.status === 404);
  assert.throws(() => readLocalDoc(dir, '', 'skill'), (e) => e.status === 400);
});

test('B3: GET / serves the card UI with the inspector, /api/skill wiring and the token placeholder replaced', async () => {
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /id="inspector"/);
  assert.match(html, /\/api\/skill/);
  assert.match(html, /const TOKEN='[0-9a-f]{48}'/);
  assert.doesNotMatch(html, /__TOKEN__/);
  const section = html.slice(html.indexOf('const insp='), html.indexOf("document.addEventListener('keydown'"));
  assert.ok(section.includes("'/api/preview'"), 'inspector dry run posts to /api/preview');
  assert.ok(!section.includes('/api/install'), 'inspector section never references /api/install');
});
