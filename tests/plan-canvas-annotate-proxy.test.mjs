import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(root, 'skills/global_config/plan-canvas/scripts/plan-canvas.js');
const WIN = process.platform === 'win32';

let tmp, repo, home, stateDir, canvasPort, proxyPort, upstream, upstreamPort, child;

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on('error', reject);
});

const env = () => ({
  PATH: process.env.PATH,
  HOME: home,
  AOS_PLAN_CANVAS_PORT: String(canvasPort),
  AOS_PLAN_CANVAS_STATE_DIR: stateDir,
  ...(WIN ? { SystemRoot: process.env.SystemRoot, TEMP: os.tmpdir(), TMP: os.tmpdir(), USERPROFILE: home } : {}),
});

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: url.port, path: url.pathname + url.search, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

function waitForLoginUrl(proc) {
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`no login URL printed: ${out}`)), 60000);
    proc.stdout.on('data', (chunk) => {
      out += chunk.toString();
      const m = /(http:\/\/127\.0\.0\.1:\d+\/__aos\/annotate\/login\?t=[A-Za-z0-9_-]+)/.exec(out);
      if (m) { clearTimeout(timer); resolve(new URL(m[1])); }
    });
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`annotate exited early (${code}): ${out}`)); });
  });
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-proxy-'));
  home = path.join(tmp, 'home');
  stateDir = path.join(tmp, 'state');
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(repo, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'notes', 'app.md'), '# Annotations\n');
  spawnSync('git', ['init', '-q'], { cwd: repo });
  canvasPort = await freePort();
  proxyPort = await freePort();
  upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><body>fake-app</body></html>');
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  upstreamPort = upstream.address().port;
});

after(async () => {
  if (child && child.exitCode === null) child.kill('SIGINT');
  spawnSync(process.execPath, [CLI, 'stop'], { env: env(), cwd: repo, timeout: 10000 });
  await new Promise((r) => upstream.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('annotate --proxy prints a one-time login URL that sets the session cookie and serves the app', { timeout: 120000 }, async () => {
  child = spawn(process.execPath, [
    CLI, 'annotate', `http://127.0.0.1:${upstreamPort}`,
    '--proxy', '--proxy-port', String(proxyPort), '--session', 'notes/app.md', '--no-open',
  ], { cwd: repo, env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
  const loginUrl = await waitForLoginUrl(child);
  assert.equal(loginUrl.origin, `http://127.0.0.1:${proxyPort}`);
  assert.match(loginUrl.pathname, /^\/__aos\/annotate\/login$/);

  const login = await get(loginUrl);
  assert.equal(login.status, 302);
  assert.equal(login.headers.location, '/');
  const setCookie = [].concat(login.headers['set-cookie'] ?? [])[0] ?? '';
  assert.match(setCookie, /^aos_ann=[A-Za-z0-9_-]+; HttpOnly; SameSite=Strict; Path=\/;/);
  const cookie = setCookie.split(';')[0];

  const app = await get(new URL(`http://127.0.0.1:${proxyPort}/`), { cookie });
  assert.equal(app.status, 200);
  assert.match(app.body, /fake-app/);
  assert.match(app.body, /<script src="\/__aos_annot\/overlay\.js/);

  const replay = await get(loginUrl);
  assert.equal(replay.status, 403, 'login token is one-shot');

  const overlay = await get(new URL(`http://127.0.0.1:${proxyPort}/__aos_annot/overlay.js`), { cookie });
  assert.equal(overlay.status, 200);
  assert.match(overlay.body, /window\.__AOS_ANNOT_CFG = \{"session":"[a-f0-9]{12}","token":"[^"]+","endpoint":"\/__aos_annot\/api\/[a-f0-9]{12}"\}/);
});
