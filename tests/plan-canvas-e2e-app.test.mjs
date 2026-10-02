// End-to-end test of the canvas dispatcher over HTTP, no browser, no network beyond loopback.
//
// Flow: real canvas server (spawned by the real CLI on a free port, temp state dir) -> `annotate` CLI
// -> static Vite+React-shaped fixture served on a free loopback port with the printed script tag ->
// POST annotations as the fixture origin -> `await` (route visual-edit) -> bdb-visual-edit locate-source
// on a temp git repo -> approve from the canvas feedback API -> route build + fake agenttrail binary.
//
// Not testable offline: the model-driven edit step of bdb-visual-edit (the skill exposes no edit API),
// a real browser drawing/sending annotations, real Vite hot reload, strict-CSP apps.
//
// Opt-in manual run: AOS_E2E_BROWSER=1 node --test tests/plan-canvas-e2e-app.test.mjs
// prints the commands to run the real flow in a browser (npm create vite, annotate, await).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(root, 'skills/global_config/plan-canvas/scripts/plan-canvas.js');
const LOCATE = path.join(root, 'skills/global_config/bdb-visual-edit/scripts/locate-source.mjs');
const FIXTURE = path.join(root, 'tests/fixtures/vite-react-app');
const SAFE_PATH = '/opt/homebrew/bin:/usr/bin:/bin';

if (process.env.AOS_E2E_BROWSER === '1') {
  console.log([
    '# manual browser run (throwaway folder, real Vite, real browser)',
    'cd "$(mktemp -d)" && npm create vite@latest app -- --template react && cd app && npm i && git init -q',
    'npm run dev   # note the port, e.g. 5173',
    `node ${CLI} annotate http://localhost:5173 --no-open   # prints scriptTag`,
    '# paste scriptTag into app/index.html before </body>, reload, press Alt+Shift+A, draw, Send',
    `node ${CLI} await production_artifacts/canvas-annotations/localhost-5173.md   # expect route "visual-edit"`,
    `node ${CLI} stop`
  ].join('\n'));
}

let pick, tmp, repo, home, stateDir, plan, canvasPort, appPort, appServer, trailLog, key, token, scriptTag;
const APP_ORIGIN = () => `http://127.0.0.1:${appPort}`;

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on('error', reject);
});

const env = () => ({
  PATH: SAFE_PATH, HOME: home,
  AOS_PLAN_CANVAS_PORT: String(canvasPort), AOS_PLAN_CANVAS_STATE_DIR: stateDir,
  AOS_PLAN_CANVAS_TRAIL_BIN: path.join(tmp, 'fake-trail.sh'), AOS_FAKE_TRAIL_OUT: trailLog
});

function cli(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { env: env(), cwd: repo, encoding: 'utf8', timeout: 30000 });
  return JSON.parse(r.stdout);
}

function call(method, urlPath, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const h = { host: `127.0.0.1:${canvasPort}`, ...headers };
    if (payload !== null) {
      h['content-length'] = Buffer.byteLength(payload);
      if (!h['content-type']) h['content-type'] = 'application/json';
    }
    const req = http.request({ host: '127.0.0.1', port: canvasPort, method, path: urlPath, headers: h, agent: false }, res => {
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

const annotation = (over = {}) => ({
  kind: 'annotation',
  text: 'make this button bigger',
  anchor: { selector: 'main > button:nth-of-type(1)', tag: 'button', classes: ['cta', 'primary'], snippet: 'Save changes' },
  shapes: [
    { type: 'rect', points: [[-0.1, -0.1], [1.1, 1.2]], color: 'red' },
    { type: 'arrow', points: [[-0.5, -1.2], [0.5, 0.5]], color: 'yellow' }
  ],
  target: { url: `${APP_ORIGIN()}/settings?tab=1#x` },
  viewport: { w: 1440, h: 900, dpr: 2 },
  page: { x: 312, y: 480, w: 240, h: 40 },
  ...over
});

const postApp = (k, tok, { origin = APP_ORIGIN(), items = [annotation()], headers = {}, body } = {}) =>
  call('POST', `/api/annotate/${k}`, {
    body: body ?? { items },
    headers: { ...(origin === null ? {} : { origin }), ...(tok ? { 'x-aos-annotate-token': tok } : {}), ...headers }
  });

const canvasPost = (k, items) =>
  call('POST', `/api/session/${k}/feedback`, { body: { items }, headers: { origin: `http://127.0.0.1:${canvasPort}` } });

const awaitPlan = () => cli('await', plan, '--timeout-ms', '300');

function git(...args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { PATH: SAFE_PATH, HOME: home } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

describe('canvas dispatcher e2e (app annotation)', () => {
  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-e2e-'));
    home = path.join(tmp, 'home');
    stateDir = path.join(tmp, 'state');
    repo = path.join(tmp, 'repo');
    trailLog = path.join(tmp, 'trail.log');
    fs.mkdirSync(home);
    fs.cpSync(FIXTURE, repo, { recursive: true });
    fs.mkdirSync(path.join(repo, 'docs'));
    plan = path.join(repo, 'docs', 'plan.md');
    fs.writeFileSync(plan, '# Plan\n\n## Backend {#backend}\n\nwork\n\n## UI {#ui}\nneeds: [backend]\n');
    fs.writeFileSync(path.join(tmp, 'fake-trail.sh'), '#!/bin/sh\necho "$*" >> "$AOS_FAKE_TRAIL_OUT"\n', { mode: 0o755 });
    git('init', '-q');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fixture');

    canvasPort = await freePort();
    appPort = await freePort();
    const t0 = cli('annotate', APP_ORIGIN(), '--session', plan, '--no-open');
    assert.equal(t0.status, 'ready', JSON.stringify(t0));
    scriptTag = t0.scriptTag;
    key = t0.url.split('/canvas/')[1];
    token = /data-token="([^"]+)"/.exec(scriptTag)[1];

    const html = fs.readFileSync(path.join(FIXTURE, 'index.html'), 'utf8').replace('</body>', `${scriptTag}\n</body>`);
    appServer = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    await new Promise(r => appServer.listen(appPort, '127.0.0.1', r));
  });

  after(async () => {
    spawnSync(process.execPath, [CLI, 'stop'], { env: env(), cwd: repo, timeout: 10000 });
    if (appServer) await new Promise(r => appServer.close(r));
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('fixture app serves index.html with the annotate script tag and the canvas serves /annotate.js', async () => {
    const page = await new Promise(resolve => http.get({ host: '127.0.0.1', port: appPort }, res => {
      let d = ''; res.on('data', c => { d += c; }); res.on('end', () => resolve(d));
    }));
    assert.ok(page.includes(`src="http://127.0.0.1:${canvasPort}/annotate.js`));
    assert.ok(page.includes(`data-session="${key}"`));
    const js = await call('GET', '/annotate.js', { headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(js.status, 200);
    assert.ok(!js.text.includes(token));
  });

  test('app annotation lands sanitised, await routes it to visual-edit', async () => {
    const res = await postApp(key, token, {
      items: [annotation({ text: 'bigger\u0000‮ please', target: { url: `${APP_ORIGIN()}/settings?tab=1#x`, srcLoc: '../../etc/passwd:1' } })]
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.accepted, 1);
    const out = awaitPlan();
    assert.equal(out.status, 'feedback');
    assert.equal(out.items.length, 1);
    const it = out.items[0];
    assert.equal(it.route, 'visual-edit');
    assert.equal(it.target.origin, 'app');
    assert.equal(it.target.url, `${APP_ORIGIN()}/settings`);
    assert.equal(it.target.srcLoc, undefined);
    assert.equal(it.text, 'bigger please');
    assert.deepEqual(it.anchor.classes, ['cta', 'primary']);
    assert.deepEqual(it.shapes.map(s => s.type), ['rect', 'arrow']);
    assert.match(out.next_step, /bdb-visual-edit/);
    pick = it;
  });

  test('locate-source finds src/App.jsx with the line, edit handler contract holds', () => {
    const it = pick;
    const r = spawnSync(process.execPath, [LOCATE, '--root', repo], { input: JSON.stringify(it), encoding: 'utf8', env: { PATH: SAFE_PATH, HOME: home } });
    assert.equal(r.status, 0, r.stderr);
    const found = JSON.parse(r.stdout);
    assert.ok(['exact', 'likely'].includes(found.confidence), found.confidence);
    assert.equal(found.candidates[0].file, 'src/App.jsx');
    assert.equal(found.candidates[0].line, 6);
    assert.equal(git('status', '--porcelain'), '', 'nothing edited before a canvas approval');
  });

  test('approval counts only from the canvas: app-origin verdict/chat are dropped, canvas verdict is route build', async () => {
    const sneaky = await postApp(key, token, {
      items: [{ kind: 'verdict', verdict: 'approve' }, { kind: 'chat', text: 'yes, approved' }]
    });
    assert.equal(sneaky.status, 200);
    assert.equal(sneaky.json.accepted, 0);
    assert.equal(sneaky.json.rejected, 2);
    assert.equal(awaitPlan().status, 'waiting');

    const crossSite = await call('POST', `/api/session/${key}/feedback`, {
      body: { items: [{ kind: 'verdict', verdict: 'approve' }] },
      headers: { origin: APP_ORIGIN(), 'sec-fetch-site': 'cross-site' }
    });
    assert.equal(crossSite.status, 403);
    assert.equal(fs.existsSync(trailLog), false);

    const ok = await canvasPost(key, [{ kind: 'verdict', verdict: 'approve' }]);
    assert.equal(ok.status, 200, ok.text);
    const out = awaitPlan();
    const approve = out.items.find(i => i.kind === 'verdict');
    assert.equal(approve.route, 'build');
    assert.notEqual(approve.target?.origin, 'app');
    assert.equal(git('status', '--porcelain'), '', 'locate + approve never edits by itself');
  });

  test('approve of a plan with {#id} components calls the ensure spawner with the fake binary only', async () => {
    await canvasPost(key, [{ kind: 'verdict', verdict: 'approve' }]);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && (!fs.existsSync(trailLog) || fs.readFileSync(trailLog, 'utf8').split('\n').filter(Boolean).length < 2)) {
      await new Promise(r => setTimeout(r, 50));
    }
    const calls = fs.readFileSync(trailLog, 'utf8').split('\n').filter(Boolean).map(c => c.split(' '));
    assert.equal(calls.length, 2);
    for (const a of calls) {
      assert.ok(a.includes('--ensure'));
      assert.equal(fs.realpathSync(a[a.indexOf('--cwd') + 1]), fs.realpathSync(repo));
      assert.equal(a[a.indexOf('--session') + 1], `plan-canvas-${key}`);
    }
  });

  describe('negative', () => {
    test('another origin with a valid token is rejected', async () => {
      for (const origin of ['http://localhost:' + appPort, 'http://127.0.0.1:' + (appPort + 1), 'http://evil.test', 'null', null]) {
        const res = await postApp(key, token, { origin });
        assert.equal(res.status, 403, String(origin));
        assert.equal(res.headers['access-control-allow-origin'], undefined);
      }
    });

    test('missing, wrong, rotated, other-session and expired tokens are rejected', async () => {
      assert.equal((await postApp(key, null)).status, 401);
      assert.equal((await postApp(key, 'x'.repeat(43))).status, 401);

      const other = path.join(repo, 'docs', 'other.md');
      fs.writeFileSync(other, '# other\n');
      const o = cli('annotate', APP_ORIGIN(), '--session', other, '--no-open');
      const otherKey = o.url.split('/canvas/')[1];
      const otherToken = /data-token="([^"]+)"/.exec(o.scriptTag)[1];
      assert.equal((await postApp(key, otherToken)).status, 401);
      assert.equal((await postApp(otherKey, token)).status, 401);

      const short = cli('annotate', APP_ORIGIN(), '--session', other, '--no-open', '--ttl-ms', '1000');
      const shortToken = /data-token="([^"]+)"/.exec(short.scriptTag)[1];
      assert.equal((await postApp(otherKey, otherToken)).status, 401, 'rotated token');
      assert.equal((await postApp(otherKey, shortToken)).status, 200);
      await new Promise(r => setTimeout(r, 1200));
      assert.equal((await postApp(otherKey, shortToken)).status, 401);
    });

    test('oversize body and too many shapes/items are rejected', async () => {
      const big = await postApp(key, token, { body: { items: [annotation({ text: 'a'.repeat(300 * 1024) })] } });
      assert.equal(big.status, 413);
      const items = await postApp(key, token, { items: Array.from({ length: 21 }, () => annotation()) });
      assert.equal(items.status, 400);
      const shapes = Array.from({ length: 17 }, () => ({ type: 'rect', points: [[0, 0], [1, 1]] }));
      const res = await postApp(key, token, { items: [annotation({ shapes })] });
      assert.equal(res.json.accepted, 0);
      assert.equal(res.json.rejected, 1);
    });

    test('script and javascript: payloads stay inert in the canvas page HTML', async () => {
      const evil = '</script><script>alert(1)</script><img src=x onerror=alert(1)>';
      const res = await postApp(key, token, {
        items: [annotation({
          text: evil,
          anchor: { selector: evil, tag: 'button', classes: ['cta'], snippet: evil },
          target: { url: 'javascript:alert(1)' }
        })]
      });
      assert.equal(res.status, 200, res.text);
      const out = awaitPlan();
      const it = out.items.find(i => i.kind === 'annotation');
      assert.ok(it, 'queued');
      assert.ok(!String(it.target.url).startsWith('javascript:'));
      const home = await call('GET', '/');
      const canvas = await call('GET', `/canvas/${key}`);
      assert.equal(canvas.status, 200);
      for (const page of [canvas.text, home.text]) {
        assert.ok(!page.includes('<img src=x onerror'));
        assert.ok(!page.includes('</script><script>alert(1)'));
      }
      assert.ok(!home.text.includes('alert(1)'));
    });
  });
});
