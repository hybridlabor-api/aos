import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stopTrailHubs, portRange } from './_trail-hub-stop.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = path.join(root, 'skills', 'global_config', 'agenttrail', 'bin', 'agenttrail.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PLAN = '# Plan\n\n## Thing {#thing}\n\n- [ ] Do it {#do-it}\n';
let LO;
let HI;
let tmp;
let n = 0;
const servers = [];

const mk = (...parts) => {
  const d = path.join(tmp, ...parts);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

function canBind(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

async function freeRange(n) {
  for (let tries = 0; tries < 50; tries += 1) {
    const base = 20000 + Math.floor(Math.random() * 30000);
    let ok = true;
    for (let i = 0; i < n && ok; i += 1) ok = await canBind(base + i);
    if (ok) return base;
  }
  throw new Error('no free port range');
}

function repoWithPlan(plan = PLAN) {
  const dir = mk(`repo${n += 1}`);
  write(path.join(dir, 'production_artifacts', '00_execution_plan.md'), plan);
  return fs.realpathSync(dir);
}

// --ensure reuses or starts the repo's own map (protocol 2, /whoami repoPath) and never stops another map.
function fakeMap(port, repoPath) {
  const state = { shutdowns: 0 };
  const s = http.createServer((req, res) => {
    if (req.url === '/shutdown') { state.shutdowns += 1; req.resume(); res.writeHead(500).end('no'); return }
    res.end(JSON.stringify({ protocol: 2, project: 'x', port, repoPath }));
  });
  servers.push(s);
  s.state = state;
  return new Promise((resolve) => s.listen(port, '127.0.0.1', () => resolve(s)));
}

function recorder(name) {
  const log = path.join(tmp, `${name}.log`);
  const bin = mk(`bin-${name}`);
  const script = path.join(bin, 'rec');
  write(script, `#!/bin/sh\necho "$@" >> "${log}"\n`);
  fs.chmodSync(script, 0o755);
  return { bin, script, log, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []) };
}

// Windows has no lsof; listening sockets are the rows whose foreign address is 0.0.0.0:0 (the state word is localised).
function listenerPids(lo, hi) {
  if (process.platform === 'win32') {
    const r = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
    return (r.stdout || '').split(/\r?\n/).map((l) => /^\s*TCP\s+\S+:(\d+)\s+0\.0\.0\.0:0\s+\S+\s+(\d+)\s*$/.exec(l)).filter((m) => m && +m[1] >= lo && +m[1] <= hi).map((m) => m[2]);
  }
  const pids = [];
  for (let p = lo; p <= hi; p += 1) pids.push(...(spawnSync('lsof', ['-ti', `tcp:${p}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout || '').split('\n').filter(Boolean));
  return pids;
}

const noShStub = process.platform === 'win32' && 'the stub is a #! shell script, which Windows cannot spawn';

function exec(args, env) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [binary, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    c.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function baseEnv(extra = {}) {
  const e = { ...process.env, HOME: path.join(tmp, 'home'), USERPROFILE: path.join(tmp, 'home'), TMPDIR: tmp, TEMP: tmp, TMP: tmp, AOS_TRAIL_PORTS: `${LO}-${HI}`, DISPLAY: ':0' };
  for (const k of ['CI', 'SSH_CONNECTION', 'SSH_TTY', 'AO_BROWSER_CAPABILITY', 'AOS_TRAIL_OPENER', 'CLAUDE_SESSION_ID', 'CODEX_SESSION_ID']) delete e[k];
  return { ...e, ...extra };
}

async function run(args, env = {}) {
  const r = await exec(['--ensure', '--json', ...args], baseEnv(env));
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

before(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trail-ensure-')));
  fs.mkdirSync(path.join(tmp, 'home'));
  LO = await freeRange(5);
  HI = LO + 4;
});
after(async () => {
  for (const s of servers) await new Promise((r) => s.close(r));
  stopTrailHubs(portRange(LO, HI));
  await sleep(100);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('aos-trail --ensure', () => {
  afterEach(async () => {
    for (const s of servers.splice(0)) await new Promise((r) => { s.close(r); s.closeAllConnections?.(); });
    stopTrailHubs(portRange(LO, HI));
    await sleep(150);
  });

  test('no plan -> no start', async () => {
    const dir = mk('empty');
    const out = await run(['--cwd', dir]);
    assert.deepEqual([out.started, out.url, out.reason, out.plan], [false, null, 'no-plan', null]);
  });

  test('plan without {#id} -> no-markers, no start', async () => {
    const out = await run(['--cwd', repoWithPlan('# Plan\n\n## Thing\n')]);
    assert.equal(out.reason, 'no-markers');
    assert.equal(out.started, false);
    assert.equal(out.url, null);
  });

  test('several plans -> hint listing candidates, no start', async () => {
    const dir = mk('multi');
    write(path.join(dir, 'production_artifacts', 'a', '00_execution_plan.md'), PLAN);
    write(path.join(dir, 'production_artifacts', 'b', '00_execution_plan.md'), PLAN);
    const out = await run(['--cwd', dir]);
    assert.equal(out.reason, 'several-plans');
    assert.equal(out.started, false);
    assert.match(out.hint, /a\/00_execution_plan\.md.*b\/00_execution_plan\.md/);
  });

  test('reuses the repo map, opens once per session via the opener, leaves other maps alone', { skip: noShStub }, async () => {
    const repo = repoWithPlan();
    await fakeMap(LO + 1, repo);
    const other = await fakeMap(LO + 2, mk('elsewhere'));
    const rec = recorder('opener');
    const env = { AOS_TRAIL_OPENER: rec.script };
    const url = `http://127.0.0.1:${LO + 1}`;
    const a = await run(['--cwd', repo, '--session', 'sess/1'], env);
    assert.deepEqual([a.started, a.opened, a.url, a.reason], [false, true, url, null]);
    for (let i = 0; i < 40 && rec.calls().length < 1; i++) await sleep(100);
    assert.deepEqual(rec.calls(), [url]);
    const b = await run(['--cwd', repo, '--session', 'sess/1'], env);
    assert.equal(b.opened, false);
    assert.equal(b.url, url);
    await sleep(500);
    assert.equal(rec.calls().length, 1);
    assert.equal((await run(['--cwd', repo, '--session', 'sess/2'], env)).opened, true);
    assert.equal(other.state.shutdowns, 0, 'another repo map must never be stopped');
  });

  test('a map of another repo is not reused and not stopped; a new map starts', async () => {
    const repo = repoWithPlan();
    const foreign = await fakeMap(LO, mk('elsewhere2'));
    const out = await run(['--cwd', repo, '--session', 'other'], { CI: '1' });
    assert.equal(out.started, true, JSON.stringify(out));
    assert.notEqual(out.url, `http://127.0.0.1:${LO}`);
    await sleep(300);
    assert.equal(foreign.state.shutdowns, 0);
  });

  test('CI, SSH, headless Linux and the test sandbox never open', async () => {
    const repo = repoWithPlan();
    await fakeMap(LO + 1, repo);
    const rec = recorder('noopen');
    for (const [i, extra] of [{ CI: '1' }, { SSH_TTY: '/dev/pts/1' }, { AOS_TEST_SANDBOX: '1', AOS_TRAIL_OPENER: '' }].entries()) {
      const out = await run(['--cwd', repo, '--session', `no${i}`], { AOS_TRAIL_OPENER: rec.script, ...extra });
      assert.equal(out.opened, false);
      assert.equal(out.url, `http://127.0.0.1:${LO + 1}`);
    }
    await sleep(500);
    assert.deepEqual(rec.calls(), []);
  });

  test('AO_BROWSER_CAPABILITY runs `ao preview <url>`', { skip: noShStub }, async () => {
    const repo = repoWithPlan();
    await fakeMap(LO + 1, repo);
    const ao = recorder('ao');
    fs.renameSync(ao.script, path.join(ao.bin, 'ao'));
    const out = await run(['--cwd', repo, '--session', 'ao'], { AO_BROWSER_CAPABILITY: '1', PATH: `${ao.bin}${path.delimiter}${process.env.PATH}`, AOS_TRAIL_OPENER: '/nonexistent' });
    assert.equal(out.opened, true);
    for (let i = 0; i < 40 && ao.calls().length < 1; i++) await sleep(100);
    assert.deepEqual(ao.calls(), [`preview http://127.0.0.1:${LO + 1}`]);
  });

  test('starts one detached map, a second call reuses it; no hub port is touched; non-JSON output', async () => {
    const repo = repoWithPlan();
    const env = { CI: '1' };
    const a = await run(['--cwd', repo], env);
    assert.equal(a.started, true, JSON.stringify(a));
    assert.equal(a.opened, false);
    assert.match(a.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const b = await run(['--cwd', repo], env);
    assert.deepEqual([b.started, b.url], [false, a.url]);
    const line = await exec(['--ensure', '--cwd', repo], baseEnv(env));
    assert.equal(line.status, 0);
    assert.equal(line.stdout.trim(), `agenttrail: ${a.url}`);
  });

  test('exits 0 on errors', async () => {
    const r = await exec(['--ensure', '--json', '--cwd', path.join(tmp, 'does-not-exist'), '--plan', '/nonexistent/plan.md'], baseEnv());
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).url, null);
  });
});
