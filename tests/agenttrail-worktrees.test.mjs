import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = path.join(root, 'skills', 'global_config', 'agenttrail', 'bin', 'agenttrail.mjs');
const { mainRoot, listWorktrees } = await import(path.join(root, 'skills', 'global_config', 'agenttrail', 'bin', 'repoid.mjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PLAN = '# Plan\n\n## Thing {#thing}\nfiles: [src/**]\n\n- [ ] Do it {#do-it}\n';
const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
let tmp;
let LO;
let HI;
const servers = [];

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};

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

function gitRepo(name) {
  const dir = path.join(tmp, name);
  write(path.join(dir, 'production_artifacts', '00_execution_plan.md'), PLAN);
  write(path.join(dir, 'src', 'a.js'), '1\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return fs.realpathSync(dir);
}

function exec(args, env, input) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [binary, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    c.on('close', (status) => resolve({ status, stdout, stderr }));
    c.stdin.end(input || '');
  });
}

function baseEnv(extra = {}) {
  const e = { ...process.env, ...GIT_ENV, HOME: path.join(tmp, 'home'), TMPDIR: tmp, AOS_TRAIL_PORTS: `${LO}-${HI}`, DISPLAY: ':0', CI: '1' };
  for (const k of ['SSH_CONNECTION', 'SSH_TTY', 'AO_BROWSER_CAPABILITY', 'AOS_TRAIL_OPENER', 'CLAUDE_SESSION_ID', 'CODEX_SESSION_ID', 'AGENTTRAIL_PORT']) delete e[k];
  return { ...e, ...extra };
}

async function ensure(cwd) {
  const r = await exec(['--ensure', '--json', '--cwd', cwd], baseEnv());
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const getJson = (url) => fetch(url).then((r) => r.json());
const hook = (url, ev) => fetch(`${url}/hook`, { method: 'POST', body: JSON.stringify(ev) });
const edit = (session, cwd, file) => ({ hook_event_name: 'PostToolUse', session_id: session, cwd, tool_name: 'Edit', tool_input: { file_path: file } });

before(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trail-wt-')));
  fs.mkdirSync(path.join(tmp, 'home'));
  LO = await freeRange(5);
  HI = LO + 4;
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

describe('repo identity', () => {
  test('worktree, subdir and main checkout resolve to the main checkout; non-git stays put', () => {
    const main = gitRepo('ident');
    const wt = path.join(tmp, 'ident-wt');
    git(main, 'worktree', 'add', '-q', '-b', 'feat/x', wt);
    assert.equal(mainRoot(wt), main);
    assert.equal(mainRoot(path.join(wt, 'src')), main);
    assert.equal(mainRoot(main), main);
    const plain = path.join(tmp, 'plain-ident');
    fs.mkdirSync(plain);
    assert.equal(mainRoot(plain), fs.realpathSync(plain));
    const list = listWorktrees(main);
    assert.deepEqual(list.map((w) => [w.path, w.branch]), [[main, 'main'], [fs.realpathSync(wt), 'feat/x']]);
  });
});

describe('one map per repo', () => {
  test('main checkout and worktree share one daemon; events land in their own lanes', async () => {
    const main = gitRepo('one');
    const wt1 = path.join(tmp, 'one-wt1');
    git(main, 'worktree', 'add', '-q', '-b', 'feat/one', wt1);
    write(path.join(wt1, 'production_artifacts', '00_execution_plan.md'), PLAN.replace('- [ ] Do it', '- [~] Do it'));
    const a = await ensure(wt1);
    assert.equal(a.started, true, JSON.stringify(a));
    const b = await ensure(main);
    assert.deepEqual([b.started, b.url], [false, a.url]);

    const who = await getJson(`${a.url}/whoami`);
    assert.equal(who.repoPath, main);
    assert.deepEqual(who.worktrees.map((w) => [w.path, w.main]), [[main, true], [fs.realpathSync(wt1), false]]);

    await hook(a.url, edit('s-main', main, path.join(main, 'src', 'a.js')));
    await hook(a.url, edit('s-wt1', wt1, path.join(wt1, 'src', 'a.js')));
    await hook(a.url, edit('s-other', os.tmpdir(), path.join(os.tmpdir(), 'x.js')));
    const m = await getJson(`${a.url}/model`);
    const laneKey = m.lanes.find((l) => !l.main).key;
    assert.deepEqual(m.lanes.map((l) => l.label), ['main · one', 'feat/one · one-wt1']);
    assert.deepEqual(m.plan.filter((n) => n.level === 'component').map((n) => [n.id, n.laneLabel]),
      [['thing', 'main · one'], [`${laneKey}--thing`, 'feat/one · one-wt1']]);
    assert.deepEqual(m.plan.filter((n) => n.level === 'task').map((n) => [n.id, n.status]),
      [['do-it', 'pending'], [`${laneKey}--do-it`, 'active']]);
    const runs = Object.fromEntries(m.runs.map((r) => [r.id, r]));
    assert.deepEqual(Object.keys(runs).sort(), ['s-main', 's-wt1']);
    assert.deepEqual([runs['s-main'].lane, runs['s-main'].componentId], ['', 'thing']);
    assert.deepEqual([runs['s-wt1'].lane, runs['s-wt1'].componentId], [laneKey, `${laneKey}--thing`]);
    assert.equal(m.activity.file, `${laneKey}:src/a.js`);

    const wt2 = path.join(tmp, 'one-wt2');
    git(main, 'worktree', 'add', '-q', '-b', 'feat/two', wt2);
    await hook(a.url, edit('s-wt2', wt2, path.join(wt2, 'src', 'a.js')));
    const m2 = await getJson(`${a.url}/model`);
    assert.equal(m2.lanes.length, 3);
    assert.equal(m2.runs.find((r) => r.id === 's-wt2').lane, m2.lanes[2].key);
  });

  test('non-git folder keeps a single main lane at its own path', async () => {
    const dir = path.join(tmp, 'plain');
    write(path.join(dir, 'production_artifacts', '00_execution_plan.md'), PLAN);
    const real = fs.realpathSync(dir);
    const a = await ensure(real);
    assert.equal(a.started, true, JSON.stringify(a));
    const who = await getJson(`${a.url}/whoami`);
    assert.equal(who.repoPath, real);
    assert.equal(who.worktrees.length, 1);
    const m = await getJson(`${a.url}/model`);
    assert.equal(m.lanes, undefined);
    assert.deepEqual(m.plan.filter((n) => n.level === 'component').map((n) => [n.id, n.lane]), [['thing', undefined]]);
  });

  test('AGENTTRAIL_PORT wins over the probed range for hook relay', async () => {
    const got = [];
    const mk = (port) => new Promise((resolve) => {
      const s = http.createServer((req, res) => { got.push(port); req.resume(); res.end(); });
      servers.push(s);
      s.listen(port, '127.0.0.1', resolve);
    });
    await mk(LO + 3);
    await mk(LO + 4);
    const ev = JSON.stringify({ hook_event_name: 'Stop', session_id: 'x', cwd: tmp });
    await exec(['hook'], baseEnv({ AGENTTRAIL_PORT: String(LO + 4) }), ev);
    assert.deepEqual(got, [LO + 4]);
    got.length = 0;
    await exec(['hook'], baseEnv(), ev);
    assert.deepEqual(got.sort(), [LO + 3, LO + 4]);
  });
});
