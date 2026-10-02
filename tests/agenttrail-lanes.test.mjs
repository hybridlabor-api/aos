import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = process.env.TRAIL_TEST_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = path.join(root, 'skills', 'global_config', 'agenttrail', 'bin', 'agenttrail.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PLAN = '# Plan\n\n## Thing {#thing}\nfiles: [src/**]\n\n- [ ] Do it {#do-it}\n';
const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
let tmp;
let LO;
let HI;
let realGit;
const servers = [];

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const canBind = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
});
async function freeRange(n) {
  for (let tries = 0; tries < 50; tries += 1) {
    const base = 20000 + Math.floor(Math.random() * 30000);
    let ok = true;
    for (let i = 0; i < n && ok; i += 1) ok = await canBind(base + i);
    if (ok) return base;
  }
  throw new Error('no free port range');
}
function gitRepo(name) {
  const dir = path.join(tmp, name);
  write(path.join(dir, 'production_artifacts', '00_execution_plan.md'), PLAN);
  write(path.join(dir, 'src', 'a.js'), '1\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return fs.realpathSync(dir);
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
  const e = { ...process.env, ...GIT_ENV, HOME: path.join(tmp, 'home'), TMPDIR: tmp, AOS_TRAIL_PORTS: `${LO}-${HI}`, DISPLAY: ':0', CI: '1' };
  for (const k of ['SSH_CONNECTION', 'SSH_TTY', 'AO_BROWSER_CAPABILITY', 'AOS_TRAIL_OPENER', 'CLAUDE_SESSION_ID', 'CODEX_SESSION_ID', 'AGENTTRAIL_PORT']) delete e[k];
  return { ...e, ...extra };
}
async function ensure(cwd, env = baseEnv()) {
  const r = await exec(['--ensure', '--json', '--cwd', cwd], env);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
const getJson = (url) => fetch(url).then((r) => r.json());
const hook = (url, ev) => fetch(`${url}/hook`, { method: 'POST', body: JSON.stringify(ev) });
const edit = (session, cwd, file) => ({ hook_event_name: 'PostToolUse', session_id: session, cwd, tool_name: 'Edit', tool_input: { file_path: file } });
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

async function whoAnswers(repo) {
  let n = 0;
  for (let p = LO; p <= HI; p += 1) {
    const w = await fetch(`http://127.0.0.1:${p}/whoami`, { signal: AbortSignal.timeout(300) }).then((r) => r.json()).catch(() => null);
    if (w && w.repoPath === repo) n += 1;
  }
  return n;
}

function fakeDaemon(port, repoPath, { shutdown = false } = {}) {
  const calls = [];
  const s = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (req.url === '/whoami') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ project: 'old', port, repoPath })); return; }
      calls.push(`${req.method} ${req.url} ${body}`);
      if (shutdown && req.url === '/shutdown' && req.method === 'POST') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}', () => { s.close(); s.closeAllConnections(); });
        return;
      }
      res.writeHead(404).end();
    });
  });
  servers.push(s);
  return new Promise((resolve) => s.listen(port, '127.0.0.1', () => resolve({ calls, server: s })));
}

before(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trail-lanes-')));
  fs.mkdirSync(path.join(tmp, 'home'));
  LO = await freeRange(8);
  HI = LO + 7;
  realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
});

after(async () => {
  for (const s of servers) await new Promise((r) => { s.close(r); s.closeAllConnections?.(); });
  for (let p = LO; p <= HI; p += 1) {
    const r = spawnSync('lsof', ['-ti', `tcp:${p}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    for (const pid of (r.stdout || '').split('\n').filter(Boolean)) { try { process.kill(Number(pid)); } catch {} }
  }
  await sleep(100);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('lane cap', () => {
  test('a worktree beyond the cap lands in the other lane and costs git once, not per event', async () => {
    const main = gitRepo('many');
    const wts = [];
    for (let i = 0; i < 13; i += 1) {
      const wt = path.join(tmp, `many-wt${i}`);
      git(main, 'worktree', 'add', '-q', '-b', `feat/${i}`, wt);
      wts.push(fs.realpathSync(wt));
    }
    const shim = path.join(tmp, 'shim');
    const log = path.join(tmp, 'git.log');
    write(path.join(shim, 'git'), `#!/bin/sh\necho "$@" >> "${log}"\nexec "${realGit}" "$@"\n`);
    fs.chmodSync(path.join(shim, 'git'), 0o755);
    const env = baseEnv({ PATH: `${shim}:${process.env.PATH}` });
    const a = await ensure(main, env);
    assert.equal(a.started, true, JSON.stringify(a));
    const who = await getJson(`${a.url}/whoami`);
    assert.equal(who.protocol, 2);
    assert.equal(who.worktrees.length, 12);
    const inLane = new Set(who.worktrees.map((w) => w.path));
    const out = wts.filter((w) => !inLane.has(w));
    assert.equal(out.length, 2);
    for (const w of wts.filter((x) => inLane.has(x))) await hook(a.url, edit(`s-${path.basename(w)}`, w, path.join(w, 'src', 'a.js')));
    fs.writeFileSync(log, '');
    for (let i = 0; i < 5; i += 1) {
      const dir = path.join(out[0], 'src', `d${i}`);
      fs.mkdirSync(dir, { recursive: true });
      await hook(a.url, edit('s-out', dir, path.join(dir, 'x.js')));
    }
    const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
    assert.ok(calls.filter((c) => c.startsWith('worktree list')).length <= 1, calls.join('\n'));
    assert.ok(calls.length <= 3, calls.join('\n'));
    const m = await getJson(`${a.url}/model`);
    const run = m.runs.find((r) => r.id === 's-out');
    assert.equal(run.lane, 'other');
    assert.equal(m.lanes.find((l) => l.key === 'other').label, 'other worktrees');
    assert.equal(m.lanes[0].main, true);
    assert.equal(m.runs.filter((r) => r.lane === '').length, 0);
  });
});

describe('setup writes into the requesting lane', () => {
  test('several lanes refuse an ambiguous setup; a named lane gets the files, never the main checkout', async () => {
    const main = gitRepo('setup');
    const wt = path.join(tmp, 'setup-wt');
    git(main, 'worktree', 'add', '-q', '-b', 'feat/s', wt);
    const real = fs.realpathSync(wt);
    const a = await ensure(main);
    assert.equal(a.started, true, JSON.stringify(a));
    const lane = (await getJson(`${a.url}/whoami`)).worktrees.find((w) => !w.main);
    const key = (await getJson(`${a.url}/model`)).lanes.find((l) => !l.main).key;
    assert.ok(lane);
    const refused = await post(`${a.url}/setup`, {});
    assert.equal(refused.ok, false);
    assert.match(refused.error, /lane/);
    assert.equal(fs.existsSync(path.join(main, 'CLAUDE.md')), false);
    const ok = await post(`${a.url}/setup`, { lane: key });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.match(fs.readFileSync(path.join(real, 'CLAUDE.md'), 'utf8'), /agenttrail plan convention/);
    assert.equal(fs.existsSync(path.join(main, 'CLAUDE.md')), false);
    assert.equal(fs.existsSync(path.join(main, '.gitignore')), false);
  });

  test('a single-lane map sets up its only checkout', async () => {
    const dir = path.join(tmp, 'setup-plain');
    write(path.join(dir, 'production_artifacts', '00_execution_plan.md'), PLAN);
    const real = fs.realpathSync(dir);
    const a = await ensure(real);
    assert.equal((await post(`${a.url}/setup`, {})).ok, true);
    assert.ok(fs.existsSync(path.join(real, 'CLAUDE.md')));
  });
});

describe('daemon upgrade', () => {
  test('an old daemon without a shutdown API is replaced by a new one and a hint is printed; both stay up', async () => {
    const main = gitRepo('old-keep');
    const old = await fakeDaemon(LO + 5, main);
    const a = await ensure(main);
    assert.equal(a.started, true, JSON.stringify(a));
    assert.notEqual(a.url, `http://127.0.0.1:${LO + 5}`);
    assert.equal((await getJson(`${a.url}/whoami`)).protocol, 2);
    assert.match(a.hint, new RegExp(`:${LO + 5}`));
    assert.ok(old.calls.every((c) => c.startsWith('POST /shutdown')), old.calls.join('|'));
    assert.equal(await fetch(`http://127.0.0.1:${LO + 5}/whoami`).then(() => true).catch(() => false), true);
    const b = await ensure(main);
    assert.deepEqual([b.started, b.url], [false, a.url]);
    old.server.close();
    old.server.closeAllConnections();
  });

  test('an old per-worktree daemon that supports shutdown is retired after the new one is up; unrelated daemons are never touched', async () => {
    const main = gitRepo('old-go');
    const wt = path.join(tmp, 'old-go-wt');
    git(main, 'worktree', 'add', '-q', '-b', 'feat/o', wt);
    const real = fs.realpathSync(wt);
    const other = gitRepo('old-other');
    const old = await fakeDaemon(LO + 6, real, { shutdown: true });
    const foreign = await fakeDaemon(LO + 7, other, { shutdown: true });
    const a = await ensure(main);
    assert.equal(a.started, true, JSON.stringify(a));
    assert.equal(a.hint, null);
    assert.equal(old.calls.length, 1);
    assert.equal(JSON.parse(old.calls[0].split(' ').slice(2).join(' ')).repoPath, real);
    assert.equal(await fetch(`http://127.0.0.1:${LO + 6}/whoami`).then(() => true).catch(() => false), false);
    assert.deepEqual(foreign.calls, []);
    foreign.server.close();
    foreign.server.closeAllConnections();
  });

  test('a daemon refuses shutdown for another repo and for a form post', async () => {
    const main = gitRepo('sd');
    const a = await ensure(main);
    const wrong = await fetch(`${a.url}/shutdown`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repoPath: tmp }) });
    assert.equal(wrong.status, 409);
    const form = await fetch(`${a.url}/shutdown`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ repoPath: main }) });
    assert.equal(form.status, 403);
    assert.equal((await getJson(`${a.url}/whoami`)).repoPath, main);
  });
});

describe('ensure race', () => {
  test('two simultaneous ensures start exactly one daemon', async () => {
    const main = gitRepo('race');
    const [a, b] = await Promise.all([ensure(main), ensure(main)]);
    assert.equal(a.url, b.url, JSON.stringify([a, b]));
    assert.equal([a, b].filter((x) => x.started).length, 1);
    await sleep(500);
    assert.equal(await whoAnswers(main), 1);
  });

  test('a stale lock from a dead pid does not block ensure', async () => {
    const main = gitRepo('stale');
    const lock = path.join(tmp, 'aos-trail-ensure', `${crypto.createHash('sha1').update(main).digest('hex').slice(0, 16)}.lock`);
    write(lock, JSON.stringify({ pid: 2147483646, at: Date.now() }));
    const a = await ensure(main);
    assert.equal(a.started, true, JSON.stringify(a));
    assert.equal(fs.existsSync(lock), false);
  });
});
