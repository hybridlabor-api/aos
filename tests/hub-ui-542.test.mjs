// 5.4.2 hub web UI fixes: catalog harness filter, store description/state, router table, version, AO path, /trail HTML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, request } from 'node:http';
import { createProxy } from '../lib/hub/proxy.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal DOM: just enough for lib/hub/ui/catalog.js mount().
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.dataset = {}; this._value = undefined; this.textContent = ''; this.tBodies = []; this.classList = { toggle() {} }; }
  appendChild(c) { this.children.push(c); if (c.tag === 'tbody') this.tBodies.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  set textContent(v) { this._t = v; if (v === '') { this.children = []; this._value = undefined; if (this.tag === 'tbody') this.tBodies = []; } }
  get textContent() { return this._t; }
  get value() { return this._value !== undefined ? this._value : this.tag === 'select' ? this.children[0]?.value : ''; }
  set value(v) { this._value = v; }
}

test('bug1: catalog default filters show every row, harness filter narrows', async () => {
  globalThis.document = { createElement: (t) => new El(t) };
  globalThis.history = { replaceState() {} };
  const { mount } = await import('../lib/hub/ui/catalog.js');
  const view = new El('div');
  const items = [{ name: 'a', installed: { claude: true, codex: false } }, { name: 'b', installed: { claude: false } }];
  await new Promise((ok) => { mount(view, async () => { setTimeout(ok, 0); return { status: 200, json: { agents: items, skills: [], commands: [], mcps: [], generatedAt: 1 } }; }); });
  await new Promise((r) => setTimeout(r, 5));
  const wrap = view.children[0];
  const controls = wrap.children[1];
  const note = wrap.children[2];
  assert.match(note.textContent, /^2 of 2 agents/);
  const harness = controls.children.filter((c) => c.tag === 'select').at(-1);
  harness.value = 'claude';
  harness.listeners.input[0]();
  assert.match(note.textContent, /^1 of 2 agents/);
});

test('bug2: folded YAML description is parsed by the store catalog', async () => {
  const { catalog } = await import('../lib/store-ui/server.mjs');
  const c = catalog('user', tmpdir());
  const items = (c.items || c).filter((i) => i.core);
  assert.ok(items.length > 0);
  assert.equal(items.filter((i) => /^[>|]-?$/.test(i.description)).length, 0);
});

test('bug2: store state line handles boolean installed', () => {
  const src = readFileSync(join(ROOT, 'lib/hub/ui/store.js'), 'utf8');
  const m = /const flagsText = \(item\) => \{[\s\S]*?\n  \};/.exec(src);
  assert.ok(m);
  const flagsText = new Function(`${m[0]}; return flagsText;`)();
  assert.equal(flagsText({ installed: true, core: true }), 'AOS core');
  assert.equal(flagsText({ installed: false }), 'not installed');
  assert.equal(flagsText({ installed: { claude: true, codex: false } }), 'claude');
});

test('bug3: missing shipped router table is a clear error; installer copies config/router.json', () => {
  const { loadLayeredRouterTable } = require('../lib/router/table.js');
  const home = mkdtempSync(join(tmpdir(), 'aos-rt-'));
  assert.throws(() => loadLayeredRouterTable({ home, projectRoot: home, shippedPath: join(home, 'nope.json') }), /Shipped router table not found/);
  const script = `const i=require(${JSON.stringify(join(ROOT, 'installer.js'))});i.installGlobalBinaries(${JSON.stringify(home)});`;
  const r = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(home, '.agents', 'config', 'router.json')));
  assert.ok(loadLayeredRouterTable({ home, projectRoot: home, shippedPath: join(home, '.agents', 'config', 'router.json') }).roles);
});

test('bug4: installed version falls back to the manifest when package.json is absent', () => {
  const { detectInstalledVersion } = require('../lib/update-check.js');
  const home = mkdtempSync(join(tmpdir(), 'aos-ver-'));
  mkdirSync(join(home, '.agents'), { recursive: true });
  writeFileSync(join(home, '.agents', '.bdb-manifest.json'), JSON.stringify({ version: '5.4.2' }));
  assert.equal(detectInstalledVersion(home), '5.4.2');
});

test('bug5: ao binary resolves the Windows path', async () => {
  // aoBinary is internal; assert through the source contract instead of a Windows host.
  const src = readFileSync(join(ROOT, 'lib/hub/services.mjs'), 'utf8');
  assert.match(src, /Programs', 'ao', 'ao\.exe'/);
  assert.doesNotMatch(src, /no ao binary at ~\/\.local/);
});

test('bug6: /trail without a live map gives HTML 502 for navigations, JSON otherwise', async () => {
  const proxy = createProxy({ routes: [{ prefix: '/trail', trail: true }], trailPorts: async () => [] });
  const srv = createServer((req, res) => proxy.handle({ req, res, pathname: req.url, hubToken: 't', hubPort: 0 }));
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const get = (headers) => new Promise((ok) => request({ port: srv.address().port, path: '/trail', headers }, (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => ok({ status: res.statusCode, type: res.headers['content-type'], t })); }).end());
  const nav = await get({ 'sec-fetch-mode': 'navigate' });
  const api = await get({ 'sec-fetch-mode': 'cors' });
  srv.close();
  assert.equal(nav.status, 502);
  assert.match(nav.type, /text\/html/);
  assert.match(nav.t, /aos-trail --ensure/);
  assert.equal(api.status, 502);
  assert.match(api.type, /json/);
});
