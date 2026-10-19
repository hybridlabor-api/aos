import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SessionTable } from '../skills/global_config/agenttrail/lib/sessions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = path.join(root, 'skills', 'global_config', 'agenttrail', 'bin', 'agenttrail.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

test('SessionTable drops ended sessions older than a day when a new session starts', () => {
  let now = Date.parse('2026-10-01T00:00:00Z');
  const table = new SessionTable({ now: () => now });
  const ev = (id, kind) => ({ agent: 'claude', session: { id }, cwd: `/${id}`, kind, ts: new Date(now).toISOString() });
  table.apply(ev('old', 'session.end'));
  table.apply(ev('live', 'session.start'));
  now += 25 * 3600e3;
  table.apply(ev('new', 'session.start'));
  assert.equal(table.byId('old'), undefined);
  assert.ok(table.byId('live'));
  assert.ok(table.byId('new'));
});

function makeRepo(tmp) {
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), '1\n');
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'init']]) {
    const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
    if (r.status !== 0) throw new Error(r.stderr);
  }
  return fs.realpathSync(repo);
}

async function freePort() {
  for (let i = 0; i < 50; i += 1) {
    const p = 20000 + Math.floor(Math.random() * 30000);
    const ok = await new Promise((resolve) => {
      const s = net.createServer();
      s.once('error', () => resolve(false));
      s.listen(p, '127.0.0.1', () => s.close(() => resolve(true)));
    });
    if (ok) return p;
  }
  throw new Error('no free port');
}

function startDaemon(repo, env) {
  return new Promise(async (resolve, reject) => {
    const port = await freePort();
    const child = spawn(process.execPath, [binary, repo, '--port', String(port), '--no-open'], {
      env: { PATH: process.env.PATH, HOME: path.join(path.dirname(repo), 'home'), AOS_TEST_SANDBOX: '1', AOS_NO_OPEN: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => reject(new Error('daemon did not start')), 10000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('http://localhost:')) { clearTimeout(timer); resolve({ child, port }); }
    });
    child.on('exit', () => { clearTimeout(timer); reject(new Error('daemon exited early')); });
  });
}

// first SSE frame of a fresh /events connection (a viewer's initial full model)
function firstFrame(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/events' }, (res) => {
      let buf = '';
      res.on('data', (d) => {
        buf += d;
        const i = buf.indexOf('\n\n');
        if (i >= 0) { req.destroy(); resolve(buf.slice(0, i)); }
      });
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
    setTimeout(() => reject(new Error('no frame within 5 s')), 5000).unref();
  });
}

test('with no viewer the next /events connect still gets the tree, including edits made meanwhile', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agt-slim-'));
  const repo = makeRepo(tmp);
  const d = await startDaemon(repo, { AOS_TRAIL_IDLE_MS: '0' });
  try {
    fs.writeFileSync(path.join(repo, 'src', 'b.js'), '2\n');
    await sleep(1500);
    assert.match(await firstFrame(d.port), /b\.js/);
  } finally {
    d.child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the daemon exits once its repo is gone, even while a viewer is attached', { timeout: 20000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agt-slim-'));
  const repo = makeRepo(tmp);
  const d = await startDaemon(repo, { AOS_TRAIL_IDLE_MS: '1000' });
  const viewer = http.get({ host: '127.0.0.1', port: d.port, path: '/events' }, () => {});
  viewer.on('error', () => {});
  try {
    await sleep(500);
    const exited = new Promise((resolve) => {
      d.child.on('exit', () => resolve(true));
      setTimeout(() => resolve(false), 8000).unref();
    });
    fs.rmSync(repo, { recursive: true, force: true });
    assert.equal(await exited, true, 'daemon still running after its repo was removed');
  } finally {
    viewer.destroy();
    d.child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
