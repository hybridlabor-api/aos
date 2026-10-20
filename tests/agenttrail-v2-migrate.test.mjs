import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stopTrailHubs, portRange } from './_trail-hub-stop.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ensureBin = path.join(root, 'skills/global_config/agenttrail/bin/agenttrail.mjs');
const relayBin = path.join(root, '.claude/hooks/trail-relay.mjs');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
});

const canBind = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)))
});

// A stand-in for the per-repo daemon this hub replaces.
function stubDaemon({ repo, port, obeyShutdown = true }) {
  const state = { shutdowns: 0, alive: true };
  const server = http.createServer((req, res) => {
    if (req.url === '/whoami' && state.alive) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: 'agenttrail', protocol: 2, port, repoPath: repo }));
      return
    }
    if (req.url === '/shutdown' && req.method === 'POST') {
      state.shutdowns += 1
      req.resume()
      if (obeyShutdown) {
        state.alive = false
        res.writeHead(200).end('bye')
        setTimeout(() => server.close(), 50)
      } else res.writeHead(500).end('no')
      return
    }
    res.writeHead(404).end()
  })
  server.listen(port, '127.0.0.1')
  return { server, state, port, stop: () => new Promise((r) => server.close(r)) }
}

let repo;
let home;
let hubPort;
let lo;
let hi;
const stubs = [];
const hubs = [];

const makeRepo = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-mig-'));
  git(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'production_artifacts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'production_artifacts/00_execution_plan.md'), '# P\n\n## Thing {#thing}\nfiles: [src/**]\n\n- [ ] do it {#do-it}\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'plan')
  return dir
}

// Async on purpose: spawnSync would block this process's event loop, and the stub
// daemons below live in *this* process. They could never answer a probe.
const run = (bin, args, { input, env = {}, timeout = 40000 } = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [bin, ...args], { env: { ...process.env, ...env }, timeout })
  let out = ''
  let err = ''
  child.stdout.on('data', (c) => { out += c })
  child.stderr.on('data', (c) => { err += c })
  if (input !== undefined) child.stdin.end(input)
  else child.stdin.end()
  const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
  child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout: out, stderr: err }) })
})

const ensureEnv = () => ({
  HOME: home,
  AOS_TRAIL_STATE_DIR: path.join(home, '.aos', 'trail'),
  AGENTTRAIL_PORT: String(hubPort),
  AOS_TRAIL_PORTS: `${lo}-${hi}`,
  AOS_GOGATE_PATH: path.join(home, 'none.mjs'),
  CI: '1', // do not open a browser during tests
})

const runEnsure = (extra = {}) => run(ensureBin, ['--ensure', '--cwd', repo, '--json'], { env: { ...ensureEnv(), ...extra } })

const waitGone = async (port) => {
  for (let i = 0; i < 40; i += 1) {
    const alive = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/whoami', timeout: 300 }, (r) => { r.resume(); r.on('end', () => resolve(true)) })
      req.on('error', () => resolve(false))
      req.on('timeout', () => { req.destroy(); resolve(false) })
    })
    if (!alive) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

before(async () => {
  repo = makeRepo()
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-mig-home-'))
  hubPort = await freePort()
  lo = 21000 + Math.floor(Math.random() * 500)
  while (!(await canBind(lo))) lo += 10
  hi = lo + 2
})

after(async () => {
  for (const s of stubs) await s.stop().catch(() => {})
  for (const h of hubs) h.kill('SIGKILL')
  stopTrailHubs([hubPort, ...portRange(lo, hi)])
})

describe('--ensure starts the repo map, not the hub', () => {
  test('it starts the map for the repo and never listens on the hub port', async () => {
    const r = await runEnsure()
    assert.equal(r.status, 0, r.stderr)
    const out = JSON.parse(r.stdout.trim())
    assert.ok(out.url, `no url: ${r.stdout}`)
    assert.equal(out.started, true)
    assert.doesNotMatch(out.url, new RegExp(`:${hubPort}$`))
    assert.equal(await canBind(hubPort), true, 'no hub may be started')
    const w = await fetch(`${out.url}/whoami`).then((x) => x.json())
    assert.equal(w.repoPath, fs.realpathSync(repo))
  })

  test('a second --ensure reuses the running map and starts nothing', async () => {
    const r = await runEnsure()
    const out = JSON.parse(r.stdout.trim())
    assert.equal(out.started, false)
  })

  test('two parallel --ensure runs do not start two maps', async () => {
    const [a, b] = await Promise.all([runEnsure(), runEnsure()])
    const starts = [a, b].map((r) => JSON.parse(r.stdout.trim()).started).filter(Boolean).length
    assert.ok(starts <= 1, `started ${starts} maps`)
  })

  test('without a plan the caller still exits 0 and says why', async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-mig-bare-'))
    git(bare, 'init', '-q', '-b', 'main')
    fs.writeFileSync(path.join(bare, 'README.md'), 'x')
    git(bare, 'add', '.')
    git(bare, 'commit', '-qm', 'x')
    const r = spawnSync(process.execPath, [ensureBin, '--ensure', '--cwd', bare, '--json'], {
      encoding: 'utf8', timeout: 40000,
      env: { ...process.env, HOME: home, AOS_TRAIL_STATE_DIR: path.join(home, '.aos', 'trail'), AOS_TRAIL_PORTS: `${lo}-${hi}`, CI: '1' },
    })
    assert.equal(r.status, 0, r.stderr)
    const out = JSON.parse(r.stdout.trim())
    assert.equal(out.url, null)
    assert.ok(out.reason, 'a missing plan must be reported')
  })
});

describe('other daemons are never retired', () => {
  // Earlier tests leave maps running inside the shared range, so the stubs get a range of their own that is free right now.
  let shared;
  before(async () => {
    shared = [lo, hi];
    for (let i = 0; ; i += 1) {
      lo = 21600 + Math.floor(Math.random() * 3000);
      if ((await canBind(lo)) && (await canBind(lo + 1)) && (await canBind(lo + 2))) break;
      assert.ok(i < 50, 'no free 3-port range found');
    }
    hi = lo + 2;
  });
  after(async () => {
    // The stubs listen inside this process: close them first, or the lsof sweep would find (and SIGTERM) the test runner itself.
    for (const s of stubs.splice(0)) await s.stop().catch(() => {});
    stopTrailHubs(portRange(lo, hi));
    [lo, hi] = shared;
  });

  test('daemons serving this or another repo are left running', async () => {
    const other = makeRepo()
    const mine = stubDaemon({ repo, port: lo, obeyShutdown: true })
    const theirs = stubDaemon({ repo: other, port: lo + 1, obeyShutdown: true })
    stubs.push(mine, theirs)
    await new Promise((r) => setTimeout(r, 100))
    await runEnsure()
    await new Promise((r) => setTimeout(r, 300))
    assert.equal(mine.state.shutdowns + theirs.state.shutdowns, 0, 'ensure must not shut anything down')
  })
});

describe('the relay posts to the maps', () => {
  const received = [];
  let server;
  let port;
  let legacyPort;
  let legacyStub;

  before(async () => {
    port = await freePort();
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => { received.push({ url: req.url }); res.writeHead(204).end() });
    });
    server.listen(port, '127.0.0.1');
    // a real port inside the legacy range, to prove whether it gets swept
    legacyPort = 5330;
    while (!(await canBind(legacyPort))) legacyPort += 1;
    legacyStub = http.createServer((req, res) => { received.push({ url: req.url, legacy: true }); res.writeHead(204).end() });
    legacyStub.listen(legacyPort, '127.0.0.1');
  });

  after(() => { legacyStub.close(); server.close() });

  const relay = (env = {}) => run(relayBin, ['--agent', 'claude'], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's-relay', cwd: repo, tool_name: 'Edit', tool_input: {} }),
    env: { AGENTTRAIL_PORT: String(port), ...env },
    timeout: 20000,
  });

  test('the hook payload reaches the explicit port and exits 0', async () => {
    received.length = 0;
    const r = await relay();
    assert.equal(r.status, 0, r.stderr);
    await new Promise((x) => setTimeout(x, 300));
    const hits = received.filter((x) => !x.legacy);
    assert.equal(hits.length, 1, JSON.stringify(received));
    assert.equal(hits[0].url, '/hook');
  });

  test('with an explicit port the map range is not swept', async () => {
    received.length = 0;
    const r = await relay();
    assert.equal(r.status, 0, r.stderr);
    await new Promise((x) => setTimeout(x, 400));
    assert.equal(received.some((x) => x.legacy), false, `legacy port was contacted: ${JSON.stringify(received)}`);
  });

  test('without AGENTTRAIL_PORT the per-repo map range receives the event', async () => {
    received.length = 0;
    const r = await relay({ AGENTTRAIL_PORT: '' });
    assert.equal(r.status, 0, r.stderr);
    await new Promise((x) => setTimeout(x, 500));
    assert.equal(received.some((x) => x.legacy), true, JSON.stringify(received));
  });

  test('AGENTTRAIL_LEGACY=1 brings the legacy range back for one release', async () => {
    received.length = 0;
    const r = await relay({ AGENTTRAIL_LEGACY: '1' });
    assert.equal(r.status, 0, r.stderr);
    await new Promise((x) => setTimeout(x, 500));
    assert.equal(received.some((x) => x.legacy), true, `legacy port was not contacted: ${JSON.stringify(received)}`);
  });
});