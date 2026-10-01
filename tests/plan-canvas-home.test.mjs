import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const base_ = '../skills/global_config/plan-canvas/scripts/lib';
const { createSessionStore } = require(`${base_}/plan-canvas/sessions.js`);
const { createPlanCanvasServer } = require(`${base_}/plan-canvas/server.js`);
const { renderPlanFolder } = require(`${base_}/plan-builder/index.js`);

let workspace;
let server;
let base;
let key;
let prevDirs;

const get = async (p) => (await fetch(`${base}${p}`, { signal: AbortSignal.timeout(3000) })).text();

describe('Plan Canvas home and shell', () => {
  before(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-home-'));
    const skills = path.join(workspace, 'skills');
    fs.mkdirSync(path.join(skills, 'archify'), { recursive: true });
    fs.writeFileSync(path.join(skills, 'archify', 'SKILL.md'), `---\nname: archify\ndescription: ${'Diagram <b>things</b> '.repeat(15)}\n---\nbody`);
    prevDirs = process.env.AOS_PLAN_CANVAS_SKILL_DIRS;
    process.env.AOS_PLAN_CANVAS_SKILL_DIRS = skills;
    fs.writeFileSync(path.join(workspace, '<script>alert(1).md'), '# evil');
    fs.writeFileSync(path.join(workspace, 'plan.builder.html'), '<html></html>');
    const store = createSessionStore({ stateDir: path.join(workspace, '.state') });
    server = createPlanCanvasServer({ store, workspaceRoot: workspace, idleTimeoutMs: 0 });
    const bound = await server.listen(0);
    base = `http://127.0.0.1:${bound.port}`;
    for (const f of ['<script>alert(1).md', 'plan.builder.html']) {
      const r = await fetch(`${base}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: path.join(workspace, f) }),
      });
      const body = await r.json();
      key = key || body.session?.key || body.key;
    }
  });

  after(async () => {
    if (prevDirs === undefined) delete process.env.AOS_PLAN_CANVAS_SKILL_DIRS;
    else process.env.AOS_PLAN_CANVAS_SKILL_DIRS = prevDirs;
    if (server) await server.close().catch(() => {});
    if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
  });

  test('home lists templates, badges, skills and escapes titles', async () => {
    const html = await get('/');
    const tdir = path.join(process.cwd(), 'skills/global_config/plan-canvas/scripts/lib/plan-builder/templates');
    for (const id of fs.readdirSync(tdir)) {
      assert.ok(html.includes(`aos-plan-canvas new ${id} &lt;dir&gt;`), `template ${id}`);
    }
    assert.ok(html.includes('includes a design canvas with screens and arrows'));
    assert.ok(!html.includes('<script>alert(1)'));
    assert.ok(html.includes('&lt;script&gt;alert(1).md'));
    assert.ok(html.includes('Standard markdown'));
    assert.ok(html.includes('BDB Plan Builder'));
    assert.ok(!/<script/i.test(html), 'home page needs no scripts');
    assert.ok(!/https?:\/\/(?!127\.0\.0\.1)/.test(html), 'no external urls');
    assert.match(html, /archify<\/div>\s*<div class="row"><span class="chip ok">installed/);
    assert.match(html, /visual-plan<\/div>\s*<div class="row"><span class="chip missing">missing/);
    assert.ok(html.includes('Diagram &lt;b&gt;things&lt;/b&gt;'));
    assert.ok(html.includes('…'));
  });

  test('shell has chat toggle with guarded storage', async () => {
    assert.ok(key, 'session key');
    const html = await get(`/canvas/${key}`);
    assert.ok(html.includes('id="chatBtn"') && html.includes('Hide chat'));
    const js = await get('/client.js');
    assert.match(js, /try \{ chatHidden = localStorage\.getItem\(chatKey\) === '1'; \} catch/);
    assert.match(js, /try \{ localStorage\.setItem\(chatKey[^}]*\} catch/);
    assert.ok(js.includes("'Show chat'"));
  });

  test('builder html has nav toggle with guarded storage', () => {
    const dir = path.join(workspace, 'plan');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'plan.mdx'), '# T\n\n## One\n\ntext\n');
    const out = renderPlanFolder(dir);
    const html = out.html || fs.readFileSync(out.out, 'utf8');
    assert.ok(html.includes('class="nav-toggle"'));
    assert.match(html, /try \{ h = localStorage\.getItem\(K\) === '1'; \} catch/);
    assert.ok(html.includes('body.nav-collapsed .sidenav'));
  });
});
