import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSessionStore } = require('../skills/global_config/plan-canvas/scripts/lib/plan-canvas/sessions.js');
const { createPlanCanvasServer } = require('../skills/global_config/plan-canvas/scripts/lib/plan-canvas/server.js');

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-prefix-'));
fs.writeFileSync(path.join(ws, 'plan.md'), '# hi');
const server = createPlanCanvasServer({ store: createSessionStore({ stateDir: path.join(ws, '.s') }), workspaceRoot: ws, idleTimeoutMs: 0 });
const { port } = await server.listen(0);
const base = `http://127.0.0.1:${port}`;
after(() => server.close().catch(() => {}));

const open = await (await fetch(`${base}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: path.join(ws, 'plan.md') }) })).json();
const key = open.key || open.session?.key || String(open.url).split('/').pop();

test('without the header nothing changes', async () => {
  const html = await (await fetch(`${base}/canvas/${key}`)).text();
  assert.match(html, /href="\/canvas\.css"/);
});

test('with X-Forwarded-Prefix pages, client script and home links carry the prefix', async () => {
  const h = { 'x-forwarded-prefix': '/canvas' };
  const page = await (await fetch(`${base}/canvas/${key}`, { headers: h })).text();
  assert.match(page, /href="\/canvas\/canvas\.css"/);
  assert.match(page, /src="\/canvas\/client\.js"/);
  assert.doesNotMatch(page, /(src|href)="\/(?!canvas\/)/);
  const js = await (await fetch(`${base}/client.js`, { headers: h })).text();
  assert.match(js, /fetch\('\/canvas\/api\/session\//);
  assert.match(js, /EventSource\('\/canvas\/events\//);
  assert.doesNotMatch(js, /fetch\('\/api/);
  const home = await (await fetch(`${base}/`, { headers: h })).text();
  assert.match(home, new RegExp(`href="/canvas/canvas/${key}"`));
});

test('an invalid prefix is ignored', async () => {
  const page = await (await fetch(`${base}/canvas/${key}`, { headers: { 'x-forwarded-prefix': '//evil.test' } })).text();
  assert.match(page, /href="\/canvas\.css"/);
});
