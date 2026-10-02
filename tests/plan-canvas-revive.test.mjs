import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = '../skills/global_config/plan-canvas/scripts/lib/plan-canvas';
const { createSessionStore } = require(`${lib}/sessions.js`);
const { createPlanCanvasServer } = require(`${lib}/server.js`);
const CLI = path.resolve('skills/global_config/plan-canvas/scripts/plan-canvas.js');

let workspace;
let stateDir;
let plan;
let current;

async function start() {
  const store = createSessionStore({ stateDir });
  const server = createPlanCanvasServer({ store, workspaceRoot: workspace, idleTimeoutMs: 0 });
  const { port } = await server.listen(0);
  current = { server, base: `http://127.0.0.1:${port}` };
  return current;
}

const post = (p, body, headers = {}) => fetch(`${current.base}${p}`, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body || {}),
  signal: AbortSignal.timeout(3000)
});
const open = async (body) => (await post('/api/sessions', { file: plan, ...body })).json();

function attachSse(base, key) {
  return new Promise((resolve) => {
    const req = http.get(`${base}/events/${key}`, (res) => {
      res.once('data', () => resolve(req));
    });
  });
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

describe('Plan Canvas stable link', () => {
  before(() => {
    workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-revive-')));
    stateDir = path.join(workspace, '.state');
    plan = path.join(workspace, 'plan.md');
    fs.writeFileSync(plan, '# Plan\n');
  });

  after(async () => {
    if (current) await current.server.close().catch(() => {});
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  test('open, restart, open gives the same key and URL and keeps queued feedback', async () => {
    await start();
    const first = await open();
    assert.equal(first.resumed, false);
    assert.equal(first.viewers, 0);
    const queued = await post(`/api/session/${first.key}/feedback`, { items: [{ kind: 'chat', text: 'survive me' }] });
    assert.equal((await queued.json()).accepted, 1);
    await current.server.close();

    await start();
    const second = await open();
    assert.equal(second.key, first.key);
    assert.equal(second.url, first.url);
    assert.equal(second.resumed, true);
    const session = createSessionStore({ stateDir }).get(first.key);
    assert.equal(session.pendingFeedback.length, 1);
    assert.equal(session.pendingFeedback[0].text, 'survive me');
  });

  test('open reports viewers when an SSE client is attached', async () => {
    const { key } = await open();
    const sse = await attachSse(current.base, key);
    try {
      const again = await open();
      assert.equal(again.resumed, true);
      assert.equal(again.viewers, 1);
    } finally {
      sse.destroy();
    }
  });

  test('user-ended session: API open 409, home Resume form 303 reopens it', async () => {
    const { key } = await open();
    await post(`/api/session/${key}/end`);
    const refused = await post('/api/sessions', { file: plan });
    assert.equal(refused.status, 409);

    const home = await (await fetch(`${current.base}/`)).text();
    assert.ok(home.includes(`<form method="post" action="/api/session/${key}/resume">`));
    assert.ok(!home.includes('<script'));

    const resumed = await post(`/api/session/${key}/resume`, {});
    assert.equal(resumed.status, 303);
    assert.equal(resumed.headers.get('location'), `/canvas/${key}`);
    const list = await (await fetch(`${current.base}/api/sessions`)).json();
    assert.equal(list.sessions.find(s => s.key === key).status, 'open');
    const homeAfter = await (await fetch(`${current.base}/`)).text();
    assert.ok(!homeAfter.includes('/resume"'));
  });

  test('resume: cross-site POST 403, unknown key 404, deleted file 404', async () => {
    const { key } = await open();
    const cross = await post(`/api/session/${key}/resume`, {}, { origin: 'http://evil.test', 'sec-fetch-site': 'cross-site' });
    assert.equal(cross.status, 403);
    assert.equal((await post('/api/session/aaaaaaaaaaaa/resume', {})).status, 404);

    const gone = path.join(workspace, 'gone.md');
    fs.writeFileSync(gone, '# gone');
    const g = await (await post('/api/sessions', { file: gone })).json();
    await post(`/api/session/${g.key}/end`);
    fs.rmSync(gone);
    assert.equal((await post(`/api/session/${g.key}/resume`, {})).status, 404);
  });

  test('CLI: open reports resumed/viewers, skips browser when attached, 409 without --reopen', async () => {
    await current.server.close();
    const port = await freePort();
    const home = fs.mkdtempSync(path.join(workspace, 'home-'));
    const env = { ...process.env, HOME: home, AOS_PLAN_CANVAS_PORT: String(port), AOS_PLAN_CANVAS_STATE_DIR: path.join(workspace, '.cli-state') };
    const run = (...args) => {
      const r = spawnSync(process.execPath, [CLI, ...args], { env, cwd: workspace, encoding: 'utf8', timeout: 20000 });
      return JSON.parse(r.stdout);
    };
    try {
      const first = run('open', plan, '--no-open');
      assert.equal(first.resumed, false);
      assert.equal(first.viewers, 0);
      assert.equal(first.browser, 'not opened');
      const key = first.url.split('/canvas/')[1];

      const sse = await attachSse(`http://127.0.0.1:${port}`, key);
      try {
        const second = run('open', plan);
        assert.equal(second.resumed, true);
        assert.equal(second.viewers, 1);
        assert.equal(second.browser, 'already open');
        assert.equal(second.url, first.url);
      } finally {
        sse.destroy();
      }

      const ended = await fetch(`http://127.0.0.1:${port}/api/session/${key}/end`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
      });
      assert.equal(ended.status, 200);
      assert.equal(run('open', plan, '--no-open').status, 'user-ended');
      assert.equal(run('open', plan, '--no-open', '--reopen').status, 'open');
    } finally {
      spawnSync(process.execPath, [CLI, 'stop'], { env, cwd: workspace, timeout: 10000 });
    }
  });
});
