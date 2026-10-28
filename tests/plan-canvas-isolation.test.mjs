// Private plan-canvas instances: explicit port beats server.json, no endpoints.json announce for a private state dir.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/global_config/plan-canvas/scripts/plan-canvas.js');
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on('error', reject);
});
const mkTmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pc-iso-')));
const baseEnv = (home) => ({ PATH: process.env.PATH, HOME: home, USERPROFILE: home, AOS_TEST_SANDBOX: '1' });

const runCli = (env, args, cwd) => new Promise((resolve) => {
  const child = spawn(process.execPath, [CLI, ...args], { env, cwd });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
  child.on('close', () => { clearTimeout(timer); try { resolve(JSON.parse(out)); } catch { resolve({ raw: out }); } });
});

test('explicit AOS_PLAN_CANVAS_PORT wins over a live server.json', async () => {
  const tmp = mkTmp();
  const stateDir = path.join(tmp, 'state');
  fs.mkdirSync(stateDir);
  const fake = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url === '/health' ? { app: 'aos-plan-canvas', version: 'fake' } : { sessions: [] }));
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const recorded = fake.address().port;
  fs.writeFileSync(path.join(stateDir, 'server.json'), JSON.stringify({ pid: process.pid, port: recorded }));
  const env = { ...baseEnv(tmp), AOS_PLAN_CANVAS_STATE_DIR: stateDir };
  try {
    const implicit = await runCli(env, [], tmp);
    assert.equal(implicit.server, `http://127.0.0.1:${recorded}`, 'without env the recorded server is used');
    const other = await freePort();
    const explicit = await runCli({ ...env, AOS_PLAN_CANVAS_PORT: String(other) }, [], tmp);
    assert.equal(explicit.port, other);
    assert.equal(explicit.server, 'not running');
  } finally {
    fake.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

async function serverRun(env, port, cwd) {
  const child = spawn(process.execPath, [CLI, 'server', '--port', String(port)], { env, cwd, stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 100 && !up; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    up = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok, () => false);
  }
  assert.ok(up, 'server came up');
  await new Promise((r) => setTimeout(r, 200));
  const exited = new Promise((r) => child.on('close', r));
  child.kill('SIGTERM');
  await exited;
}

test('private state dir does not announce/retire in endpoints.json; default does', async () => {
  const tmp = mkTmp();
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home);
  const file = path.join(home, '.aos', 'endpoints.json');
  try {
    await serverRun({ ...baseEnv(home), AOS_PLAN_CANVAS_STATE_DIR: path.join(tmp, 'private') }, await freePort(), tmp);
    assert.equal(fs.existsSync(file), false, 'private instance leaves endpoints.json alone');

    const port = await freePort();
    await serverRun(baseEnv(home), port, tmp);
    const svc = JSON.parse(fs.readFileSync(file, 'utf8')).services['plan-canvas'];
    assert.equal(svc.port, port, 'default instance announces');
    assert.equal(svc.status, 'down', 'default instance retires on exit');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
