import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = path.join(root, 'skills', 'global_config', 'agenttrail', 'bin', 'agenttrail.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PLAN = '# Plan\n\n## Thing {#thing}\n\n- [ ] Do it {#do-it}\n';
const LO = 5360;
const HI = 5364;
let tmp;
let n = 0;
const servers = [];

const mk = (...parts) => {
  const d = path.join(tmp, ...parts);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

function repoWithPlan(plan = PLAN) {
  const dir = mk(`repo${n += 1}`);
  write(path.join(dir, 'production_artifacts', '00_execution_plan.md'), plan);
  return fs.realpathSync(dir);
}

function fakeMap(port, repoPath) {
  const s = http.createServer((req, res) => res.end(JSON.stringify({ project: 'x', port, repoPath })));
  servers.push(s);
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
  const e = { ...process.env, TMPDIR: tmp, AOS_TRAIL_PORTS: `${LO}-${HI}`, DISPLAY: ':0' };
  for (const k of ['CI', 'SSH_CONNECTION', 'SSH_TTY', 'AO_BROWSER_CAPABILITY', 'AOS_TRAIL_OPENER', 'CLAUDE_SESSION_ID', 'CODEX_SESSION_ID']) delete e[k];
  return { ...e, ...extra };
}

async function run(args, env = {}) {
  const r = await exec(['--ensure', '--json', ...args], baseEnv(env));
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

before(() => { tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trail-ensure-'))); });
after(async () => {
  for (const s of servers) await new Promise((r) => s.close(r));
  for (let p = LO; p <= HI; p += 1) {
    const r = spawnSync('lsof', ['-ti', `tcp:${p}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    for (const pid of (r.stdout || '').split('\n').filter(Boolean)) { try { process.kill(Number(pid)); } catch {} }
  }
  await sleep(100);
});

describe('aos-trail --ensure', () => {
  afterEach(async () => {
    for (const s of servers.splice(0)) await new Promise((r) => { s.close(r); s.closeAllConnections?.(); });
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

  test('reuses a running map for the repo, opens once per session via the opener', async () => {
    const repo = repoWithPlan();
    await fakeMap(LO + 1, repo);
    const rec = recorder('opener');
    const env = { AOS_TRAIL_OPENER: rec.script };
    const a = await run(['--cwd', repo, '--session', 'sess/1'], env);
    assert.deepEqual([a.started, a.opened, a.url, a.reason], [false, true, `http://127.0.0.1:${LO + 1}`, null]);
    for (let i = 0; i < 40 && rec.calls().length < 1; i++) await sleep(100);
    assert.deepEqual(rec.calls(), [`http://127.0.0.1:${LO + 1}`]);
    const b = await run(['--cwd', repo, '--session', 'sess/1'], env);
    assert.equal(b.opened, false);
    assert.equal(b.url, a.url);
    await sleep(500);
    assert.equal(rec.calls().length, 1);
    assert.equal((await run(['--cwd', repo, '--session', 'sess/2'], env)).opened, true);
  });

  test('a map of another repo is not reused', async () => {
    const repo = repoWithPlan();
    await fakeMap(LO + 3, mk('elsewhere'));
    const out = await run(['--cwd', repo, '--session', 'other'], { AOS_TRAIL_PORTS: `${LO + 3}-${LO + 4}`, CI: '1' });
    assert.equal(out.started, true);
    assert.notEqual(out.url, `http://127.0.0.1:${LO + 3}`);
  });

  test('CI, SSH and headless Linux never open', async () => {
    const repo = repoWithPlan();
    await fakeMap(LO + 1, repo);
    const rec = recorder('noopen');
    for (const [i, extra] of [{ CI: '1' }, { SSH_TTY: '/dev/pts/1' }].entries()) {
      const out = await run(['--cwd', repo, '--session', `no${i}`], { AOS_TRAIL_OPENER: rec.script, ...extra });
      assert.equal(out.opened, false);
      assert.equal(out.url, `http://127.0.0.1:${LO + 1}`);
    }
    await sleep(500);
    assert.deepEqual(rec.calls(), []);
  });

  test('AO_BROWSER_CAPABILITY runs `ao preview <url>`', async () => {
    const repo = repoWithPlan();
    await fakeMap(LO + 1, repo);
    const ao = recorder('ao');
    fs.renameSync(ao.script, path.join(ao.bin, 'ao'));
    const out = await run(['--cwd', repo, '--session', 'ao'], { AO_BROWSER_CAPABILITY: '1', PATH: `${ao.bin}${path.delimiter}${process.env.PATH}`, AOS_TRAIL_OPENER: '/nonexistent' });
    assert.equal(out.opened, true);
    for (let i = 0; i < 40 && ao.calls().length < 1; i++) await sleep(100);
    assert.deepEqual(ao.calls(), [`preview http://127.0.0.1:${LO + 1}`]);
  });

  test('starts one detached map, a second call reuses it; loopback URL; non-JSON output', async () => {
    const repo = repoWithPlan();
    const env = { CI: '1' };
    const a = await run(['--cwd', repo], env);
    assert.equal(a.started, true, JSON.stringify(a));
    assert.equal(a.opened, false);
    assert.match(a.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const b = await run(['--cwd', repo], env);
    assert.deepEqual([b.started, b.url], [false, a.url]);
    const line = await exec(['--ensure', '--cwd', repo], baseEnv({ CI: '1' }));
    assert.equal(line.status, 0);
    assert.equal(line.stdout.trim(), `agenttrail: ${a.url}`);
  });

  test('exits 0 on errors', async () => {
    const r = await exec(['--ensure', '--json', '--cwd', path.join(tmp, 'does-not-exist'), '--plan', '/nonexistent/plan.md'], baseEnv());
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).url, null);
  });
});
