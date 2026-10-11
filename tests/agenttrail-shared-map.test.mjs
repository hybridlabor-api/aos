import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveShared, SHARED_DIR } from '../skills/global_config/agenttrail/lib/shared-static.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'skills/global_config/agenttrail/public');
const hubBin = path.join(root, 'skills/global_config/agenttrail/bin/trail-hub.mjs');
const read = (...p) => fs.readFileSync(path.join(pub, ...p), 'utf8');

describe('one shared map renderer', () => {
  const LAYOUT_FNS = ['function laneLayout', 'function boardLayout', 'function renderGraph', 'function graphNodeMetrics', 'function fitWorld', 'function flyToRegion'];

  test('both pages load the shared renderer and stylesheet', () => {
    for (const html of [read('index.html'), read('hub', 'index.html')]) {
      assert.match(html, /<script src="\/shared\/map\.js"><\/script>/);
      assert.match(html, /<link rel="stylesheet" href="\/shared\/map\.css">/);
    }
  });

  test('the layout functions live only in public/shared/', () => {
    const shared = read('shared', 'map.js');
    for (const fn of LAYOUT_FNS) {
      assert.ok(shared.includes(fn), `${fn} missing from shared/map.js`);
      for (const f of [['index.html'], ['hub', 'index.html'], ['hub', 'app.js']]) {
        assert.equal(read(...f).includes(fn), false, `${fn} is copied into ${f.join('/')}`);
      }
    }
  });

  test('the shared markup carries no inline handler (the hub CSP forbids them)', () => {
    assert.equal(/\son(click|keydown|pointer\w+)=/.test(read('shared', 'map.js')), false);
  });
});

describe('/shared path guard', () => {
  test('serves the two shared files', () => {
    assert.equal(resolveShared('/shared/map.js'), path.join(SHARED_DIR, 'map.js'));
    assert.equal(resolveShared('/shared/map.css'), path.join(SHARED_DIR, 'map.css'));
  });

  test('refuses traversal, encoded traversal, other prefixes and unknown types', () => {
    for (const bad of ['/shared/../app.js', '/shared/..%2fapp.js', '/shared/%2e%2e/%2e%2e/package.json', '/shared/', '/shared', '/sharedx/map.js', '/app.js', '/shared/map.js%00.css', '/shared/%E0%A4%A', '/shared/x.html']) {
      assert.equal(resolveShared(bad), null, bad);
    }
    assert.equal(resolveShared('/shared/../shared-evil/map.js', path.join(os.tmpdir(), 'nope')), null);
  });
});

describe('the hub serves /shared', () => {
  let child; let port;
  const rawGet = (p) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: { host: `127.0.0.1:${port}` } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });

  before(async () => {
    port = await new Promise((resolve) => {
      const s = net.createServer();
      s.listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => resolve(p)); });
    });
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-shared-home-'));
    child = spawn(process.execPath, [hubBin, '--port', String(port)], {
      env: { ...process.env, HOME: home, AOS_TRAIL_STATE_DIR: path.join(home, '.aos', 'trail'), AOS_GOGATE_PATH: path.join(home, 'none.mjs') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (let i = 0; i < 80; i += 1) {
      try { if ((await rawGet('/whoami')).status === 200) return; } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('hub did not start');
  });

  after(() => { if (child) child.kill('SIGKILL'); });

  test('map.js and map.css are served with their own types and no csrf injection', async () => {
    const js = await rawGet('/shared/map.js');
    assert.equal(js.status, 200);
    assert.match(js.headers['content-type'], /javascript/);
    assert.equal(js.body, read('shared', 'map.js'));
    const css = await rawGet('/shared/map.css');
    assert.equal(css.status, 200);
    assert.match(css.headers['content-type'], /text\/css/);
  });

  test('traversal out of /shared/ answers 404', async () => {
    for (const p of ['/shared/../app.js', '/shared/..%2f..%2fpackage.json', '/shared/%2e%2e/hub/app.js', '/shared/nope.js']) {
      assert.equal((await rawGet(p)).status, 404, p);
    }
  });
});
