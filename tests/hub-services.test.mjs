import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer as createServer_fwd } from 'node:http';
import { createHub } from '../lib/hub/server.mjs';
import { routes as servicesRoutes } from '../lib/hub/routes-services.mjs';
import {
  SERVICE_IDS, byId,
  controlService, statusService, serviceMeta,
  portOpen, cli, readServiceLog, openWikiProjects,
  setA2aListForTests, resetMetaCacheForTests, resetWikiCacheForTests,
} from '../lib/hub/services.mjs';
import { redact } from '../lib/hub/redact.mjs';
import { routes as planRoutes } from '../lib/hub/routes-plans.mjs';

const repo = resolve(new URL('..', import.meta.url).pathname);
const servicesSrc = readFileSync(join(repo, 'lib', 'hub', 'services.mjs'), 'utf8');

// Never the real home: point the a2a registry at a temp dir too.
process.env.AOS_SESSIONS_DIR = join(join(tmpdir(), `aos-hub-svc-${process.pid}-${Date.now()}`), 'sessions');
mkdirSync(process.env.AOS_SESSIONS_DIR, { recursive: true });

// Temp dirs are never deleted (rules forbid recursive deletes).
const tmp = mkdtempSync(join(tmpdir(), 'aos-hub-svc-'));
const home = join(tmp, 'home');
mkdirSync(home, { recursive: true });

// fake ctx.run: records every argv, answers ok with empty output.
const calls = [];
const fakeRun = (cmd, args, opts) => {
  calls.push({ cmd, args, opts });
  return Promise.resolve({ ok: true, code: 0, stdout: '', stderr: '' });
};
const recordingCtx = (extra = {}) => ({
  root: repo, home, cwd: home,
  run: fakeRun, now: () => Date.now(),
  log: () => {},
  platform: extra.platform || 'darwin', // injected: launchd branches must be testable on Linux/Docker
  uid: '501',
  ...extra,
});

before(() => { resetMetaCacheForTests(); resetWikiCacheForTests(); });
after(() => { setA2aListForTests(null); });

test('fixed service table has exactly the expected ids', () => {
  assert.deepEqual(SERVICE_IDS, ['memb', 'synapse', 'openwiki', 'ao', 'gateway', 'plan-canvas', 'a2a', 'agenttrail', 'hub']);
  for (const id of ['memb', 'synapse', 'openwiki', 'ao', 'gateway', 'plan-canvas', 'a2a', 'agenttrail', 'hub']) {
    assert.ok(byId.has(id));
  }
});

test('launchd start without a plist: clear error, fake ctx.run never called', async () => {
  calls.length = 0;
  await assert.rejects(() => controlService(recordingCtx(), 'memb', 'start'), /no LaunchAgent installed/);
  assert.equal(calls.length, 0);
});

test('launchd: "Bootstrap failed: 5" on start kicks the loaded agent; restart polls launchctl print', async () => {
  const home5 = join(tmp, 'home-b5');
  mkdirSync(join(home5, 'Library', 'LaunchAgents'), { recursive: true });
  const plist = join(home5, 'Library', 'LaunchAgents', 'com.bdb.memb.webui.plist');
  writeFileSync(plist, '<plist/>');
  const seq = [];
  const ctx = {
    ...recordingCtx({ home: home5 }),
    run: async (cmd, args) => {
      seq.push([cmd, ...args]);
      if (args[0] === 'bootstrap') return { ok: false, code: 5, stdout: '', stderr: 'Bootstrap failed: 5: Input/output error' };
      if (args[0] === 'print') return { ok: false, code: 37, stdout: '', stderr: 'not loaded' };
      return { ok: true, code: 0, stdout: '', stderr: '' };
    },
  };
  const res = await controlService(ctx, 'memb', 'start');
  assert.equal(res.ok, true, 'exit 5 counts as already-loaded, kicked afterwards');
  assert.deepEqual(seq, [
    ['launchctl', 'bootstrap', 'gui/501', plist],
    ['launchctl', 'kickstart', '-k', 'gui/501/com.bdb.memb.webui'],
  ]);
  // restart: bootout -> launchctl print must be asked before the bootstrap.
  seq.length = 0;
  let printAsked = false;
  const ctx2 = {
    ...recordingCtx({ home: home5 }),
    run: async (cmd, args) => {
      seq.push([cmd, ...args]);
      if (args[0] === 'print') { printAsked = true; return { ok: false, code: 37, stdout: '', stderr: 'not loaded' }; }
      return { ok: true, code: 0, stdout: '', stderr: '' };
    },
  };
  const res2 = await controlService(ctx2, 'memb', 'restart');
  assert.equal(res2.ok, true);
  assert.equal(seq[0][1], 'bootout');
  assert.equal(printAsked, true, 'restart polls launchctl print before bootstrapping');
  assert.equal(seq[seq.length - 1][1], 'bootstrap');
});

test('launchd control with a plist fixture: exact bootstrap argv', async () => {
  const home2 = join(tmp, 'home-plist');
  mkdirSync(join(home2, 'Library', 'LaunchAgents'), { recursive: true });
  const plist = join(home2, 'Library', 'LaunchAgents', 'com.bdb.memb.webui.plist');
  writeFileSync(plist, '<plist/>');
  mkdirSync(join(home2, '.memb'), { recursive: true });
  writeFileSync(join(home2, '.memb', 'webui.stdout.log'), 'launched\n');
  const local = recordingCtx({ home: home2 });
  calls.length = 0;
  const res = await controlService(local, 'memb', 'start');
  assert.deepEqual(calls.map((c) => [c.cmd, c.args]), [['launchctl', ['bootstrap', 'gui/501', plist]]]);
  assert.equal(res.ok, true);
});

test('windows: memb/synapse stop is disabled (Task Scheduler message); wscript start stays', async () => {
  const homeWin = join(tmp, 'home-win');
  const startup = join(homeWin, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  mkdirSync(startup, { recursive: true });
  writeFileSync(join(startup, 'com.bdb.memb.webui.vbs'), "' vbs stub");
  const savedAppData = process.env.APPDATA;
  delete process.env.APPDATA;
  try {
    calls.length = 0;
    await assert.rejects(
      () => controlService(recordingCtx({ platform: 'win32', home: homeWin }), 'memb', 'stop'),
      /Task Scheduler/,
      'no substring process-kill on Windows: the exact installed path is not derivable',
    );
    assert.equal(calls.length, 0, 'stop must not even attempt a kill');
    const res = await controlService(recordingCtx({ platform: 'win32', home: homeWin }), 'memb', 'start');
    assert.equal(res.ok, true);
    assert.deepEqual(calls.at(-1), { cmd: 'wscript.exe', args: [join(startup, 'com.bdb.memb.webui.vbs')], opts: { timeout: 10000 } });
  } finally {
    if (savedAppData !== undefined) process.env.APPDATA = savedAppData;
  }
});

test('readServiceLog reads at most the last 64 KB and still redacts', async () => {
  const homeLog = join(tmp, 'home-tail');
  mkdirSync(join(homeLog, '.memb'), { recursive: true });
  const big = 'x'.repeat(200 * 1024);
  writeFileSync(join(homeLog, '.memb', 'webui.stdout.log'), `${big}\nDATA1 filler beyond every tail\n${'y'.repeat(70 * 1024)}tail token=hunter2\n`);
  const text = await readServiceLog(recordingCtx({ home: homeLog }), 'memb', 'webui.stdout.log');
  assert.ok(text.length < 80 * 1024, 'the tail is bounded at 64 KB');
  assert.doesNotMatch(text, /DATA1/, 'content before the 64 KB tail never reaches the response');
  assert.match(text, /token=\[redacted\]/);
  assert.doesNotMatch(text, /hunter2/);
});

test('observe-only services refuse stop; id must be in the table', async () => {
  const ctx = recordingCtx();
  calls.length = 0;
  for (const [id, action] of [['agenttrail', 'stop'], ['a2a', 'restart']]) {
    const stopRoute = servicesRoutes.find((r) => r.path instanceof RegExp && r.path.test(`/api/services/${id}/${action}`) && r.confirm === 'id');
    const out = await stopRoute.handler({ url: new URL(`http://x/api/services/${id}/${action}`), params: [id, action], body: { id, confirm: id }, ctx });
    assert.notEqual(out.status, 200, `${id} must be refused`);
    assert.match(out.json.error, /observe|unknown/);
  }
  const bad = servicesRoutes.find((r) => r.path instanceof RegExp && r.path.test('/api/services/zzz/start'));
  const out2 = await bad.handler({ url: new URL('http://x/api/services/zzz/start'), params: ['zzz'], body: {}, ctx });
  assert.equal(out2.status, 400);
  assert.equal(calls.length, 0);
});

test('a2a status: list is called with {prune:false}; never readToken (static grep)', async () => {
  let seen = null;
  setA2aListForTests(async ({ prune }) => { seen = { prune }; return [{ name: 's1', harness: 'claude', pid: process.pid, url: 'http://127.0.0.1:1234', cwd: home }]; });
  const ctx = recordingCtx({ wikiRoot: join(tmp, 'no-dev') });
  const rows = await statusService(ctx);
  assert.deepEqual(seen, { prune: false });
  const a2a = rows.find((r) => r.id === 'a2a');
  assert.equal(a2a.up, true);
  assert.equal(a2a.sessions[0].name, 's1');
  assert.doesNotMatch(servicesSrc, /readToken/);
  setA2aListForTests(null);
});

test('stop gateway without the typed confirm -> 400 and no spawn', async () => {
  const stopRoute = servicesRoutes.find((r) => r.path instanceof RegExp && String(r.path).includes('stop'));
  calls.length = 0;
  const out = await stopRoute.handler({ url: new URL('http://x/api/services/gateway/stop'), params: ['gateway', 'stop'], body: { id: 'gateway' }, ctx: recordingCtx() });
  assert.equal(out.status, 400);
  assert.equal(calls.length, 0);
});

test('full hub: stop gateway without confirm -> 400; with confirm -> exact bootout argv', async () => {
  const home3 = join(tmp, 'home-hub');
  mkdirSync(join(home3, 'Library', 'LaunchAgents'), { recursive: true });
  writeFileSync(join(home3, 'Library', 'LaunchAgents', 'com.bdb.aos.gateway.plist'), '<plist/>');
  const hub = createHub({
    port: 0, home: home3,
    routes: [...planRoutes, ...servicesRoutes],
    ctx: {
      root: repo, platform: 'darwin', uid: '501', run: fakeRun, log: () => {},
      portOverrides: { memb: 0, synapse: 0, ao: 0, 'plan-canvas': 0 },
    },
  });
  await hub.listen();
  const base = `http://127.0.0.1:${hub.server.address().port}`;
  const noConfirm = await globalThis.fetch(base + '/api/services/gateway/stop', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-aos-hub-token': hub.token }, body: JSON.stringify({ id: 'gateway' }),
  });
  assert.equal(noConfirm.status, 400);
  calls.length = 0;
  const withConfirm = await globalThis.fetch(base + '/api/services/gateway/stop', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-aos-hub-token': hub.token }, body: JSON.stringify({ id: 'gateway', confirm: 'gateway' }),
  });
  assert.equal(withConfirm.status, 200);
  assert.deepEqual(calls.map((c) => [c.cmd, c.args]), [['launchctl', ['bootout', 'gui/501/com.bdb.aos.gateway']]]);
  await hub.close();
});

test('visualize with an unknown project -> 400', async () => {
  const viz = servicesRoutes.find((r) => r.path === '/api/services/openwiki/visualize');
  const out = await viz.handler({ url: new URL('http://x/api/services/openwiki/visualize'), params: [], body: { project: '/tmp/definitely-unknown-proj' }, ctx: recordingCtx({ wikiRoot: join(tmp, 'empty-dev') }) });
  assert.equal(out.status, 400);
  assert.match(out.json.error, /unknown project|dev root/);
});

test('visualize route sits on the services lock; projects.json paths outside the dev root are refused', async () => {
  const viz = servicesRoutes.find((r) => r.path === '/api/services/openwiki/visualize');
  assert.equal(viz.lock, 'services', 'viewer children take the services gate');
  resetWikiCacheForTests();
  const homeP = join(tmp, 'home-proj');
  const devRoot = join(tmp, 'dev-proj');
  const inside = join(devRoot, 'repo-a');
  mkdirSync(join(inside, '.openwiki'), { recursive: true });
  writeFileSync(join(inside, '.openwiki', 'index1.md'), 'a\n');
  const outside = join(tmp, 'outside-repo');
  mkdirSync(join(outside, '.openwiki'), { recursive: true });
  writeFileSync(join(outside, '.openwiki', 'index2.md'), 'b\n');
  mkdirSync(join(homeP, '.openwiki'), { recursive: true });
  writeFileSync(join(homeP, '.openwiki', 'projects.json'), JSON.stringify({ projects: [inside, outside] }));
  const ctx = recordingCtx({ home: homeP, wikiRoot: devRoot });
  const list = openWikiProjects(ctx).map((p) => p.path);
  assert.deepEqual(list, [inside], 'path outside the dev root is never offered');
  // the route refuses it too, with its own message, before the lookup:
  const r2 = await viz.handler({ url: new URL('http://x/api/services/openwiki/visualize'), params: [], body: { project: outside }, ctx });
  assert.equal(r2.status, 400);
  assert.match(r2.json.error, /dev root|unknown project/);
});

test('log route rejects ../x and unknown names', async () => {
  const logRoute = servicesRoutes.find((r) => r.path instanceof RegExp && r.path.test('/api/services/gateway/log') && r.method === 'GET');
  const rejecty = await logRoute.handler({ url: new URL('http://x/api/services/gateway/log?name=../x'), params: ['gateway'], ctx: recordingCtx() });
  assert.equal(rejecty.status, 400);
  const logHome = join(tmp, 'home-log');
  mkdirSync(join(logHome, '.memb'), { recursive: true });
  writeFileSync(join(logHome, '.memb', 'webui.stdout.log'), 'hello ghp_abcdefSecretValue\nX_API_KEY=abc done\n');
  const oky = await logRoute.handler({ url: new URL('http://x/api/services/memb/log?name=webui.stdout.log'), params: ['memb'], ctx: recordingCtx({ home: logHome }) });
  assert.equal(oky.status, 200);
  assert.match(oky.json.text, /\[redacted\]/);
  assert.doesNotMatch(oky.json.text, /abcSecretValue/);
  assert.doesNotMatch(oky.json.text, /abc done/);
});

test('fixture TCP server -> up:true via the port probe', async () => {
  const fixture = createServer_fwd((req, res) => { res.writeHead(200); res.end('ok'); });
  await new Promise((ok) => fixture.listen(0, '127.0.0.1', ok));
  const port = fixture.address().port;
  assert.equal(await portOpen(port), true);
  assert.equal(await portOpen(59990), false);
  // And wired into the status snapshot:
  const ctx = recordingCtx({ portOverrides: { memb: port }, wikiRoot: join(tmp, 'no-dev2') });
  const rows = await statusService(ctx);
  assert.equal(rows.find((r) => r.id === 'memb').up, true);
  fixture.close();
});

test('serviceMeta: npm uncheckable -> state uncheckable; force flag supported', async () => {
  resetMetaCacheForTests();
  const ctx = recordingCtx({ wikiRoot: join(tmp, 'no-dev3') });
  const m = await serviceMeta(ctx, { force: true });
  assert.ok(m.version);
  assert.equal(m.updates.memb.state, 'uncheckable');
  const m2 = await serviceMeta(ctx);
  assert.equal(m2.updates.memb.state, 'uncheckable');
  assert.equal(m2.cached, true);
});

test('static greps: services.mjs deletes nothing; windows strings present', () => {
  assert.doesNotMatch(servicesSrc, /rmSync|unlinkSync|rm -/);
  assert.match(servicesSrc, /Get-ScheduledTask -TaskName 'BDB_OpenWiki_Daemon'/);
  assert.match(servicesSrc, /process\.platform === 'win32' && id === 'openwiki'/);
  assert.match(servicesSrc, /com\.bdb\.memb\.webui\.vbs/);
  assert.match(servicesSrc, /com\.bdb\.synapse\.vbs/);
  assert.match(servicesSrc, /Get-CimInstance Win32_Process/);
  assert.match(servicesSrc, /wscript\.exe/);
  assert.doesNotMatch(servicesSrc, /readToken/);
});

// ------------------------------------------------------------ cli exit codes
test('cli exit codes', async () => {
  const silent = {
    ...recordingCtx({ home }),
    log: () => {},
    portOverrides: { memb: 0, synapse: 0, ao: 0, remoteos: 0, gateway: 0, 'plan-canvas': 0 },
  };
  assert.equal(await cli([], silent), 2);
  assert.equal(await cli(['bogus'], silent), 2);
  assert.equal(await cli(['status', '--json'], silent), 0);
  assert.equal(await cli(['status'], silent), 0);
  assert.equal(await cli(['start', 'nosuchid'], silent), 2);
  {
    const home4 = join(tmp, 'home-cli');
    mkdirSync(join(home4, 'Library', 'LaunchAgents'), { recursive: true });
    writeFileSync(join(home4, 'Library', 'LaunchAgents', 'com.bdb.aos.gateway.plist'), '<plist/>');
    const mac = {
      ...recordingCtx({ home: home4 }),
      log: () => {},
      portOverrides: { memb: 0, synapse: 0, ao: 0, gateway: 0, 'plan-canvas': 0 },
    };
    assert.equal(await cli(['stop', 'gateway', '--confirm', 'other'], mac), 2);
    assert.equal(await cli(['stop', 'gateway'], mac), 2);
    assert.equal(await cli(['start', 'memb'], mac), 1); // memb plist missing -> failed
    assert.equal(await cli(['stop', 'gateway', '--confirm', 'gateway'], mac), 0);
  }
});

// ---------------------------------------------------- regression: review fixes
test('launchd benign is per-command: a real bootout failure (EPERM) throws, "not loaded" stays benign', async () => {
  const homeE = join(tmp, 'home-bootout');
  mkdirSync(join(homeE, 'Library', 'LaunchAgents'), { recursive: true });
  writeFileSync(join(homeE, 'Library', 'LaunchAgents', 'com.bdb.memb.webui.plist'), '<plist/>');
  const eperm = {
    ...recordingCtx({ home: homeE }),
    run: async () => ({ ok: false, code: 1, stdout: '', stderr: 'Boot-out failed. Operation not permitted.' }),
  };
  await assert.rejects(
    () => controlService(eperm, 'memb', 'stop'),
    /Operation not permitted/,
    '"boot-out failed" must not read as benign on the stop path',
  );
  const notLoaded = {
    ...recordingCtx({ home: homeE }),
    run: async () => ({ ok: false, code: 1, stdout: '', stderr: 'not loaded' }),
  };
  assert.equal((await controlService(notLoaded, 'memb', 'stop')).ok, true, '"not loaded" stays benign for bootout');
  // Bootstrap only accepts its OWN benign output: bootout-benign stderr on a
  // failed bootstrap must be an error.
  const bootBenignBootstrap = {
    ...recordingCtx({ home: homeE }),
    run: async (cmd, args) => (args[0] === 'bootstrap'
      ? { ok: false, code: 1, stdout: '', stderr: 'not loaded' }
      : { ok: true, code: 0, stdout: '', stderr: '' }),
  };
  await assert.rejects(() => controlService(bootBenignBootstrap, 'memb', 'start'), /bootstrap failed/);
});

test('readServiceLog drops the mid-file cut fragment and keeps at most the last 400 lines', async () => {
  const homeLog2 = join(tmp, 'home-tail-lines');
  mkdirSync(join(homeLog2, '.memb'), { recursive: true });
  const f = join(homeLog2, '.memb', 'webui.stdout.log');
  const filler = 'x'.repeat(70 * 1024) + '\n'; // the 64 KB tail starts inside this line
  const body = Array.from({ length: 500 }, (_, i) => `line-${i}`).join('\n') + '\n';
  writeFileSync(f, filler + body);
  const text = await readServiceLog(recordingCtx({ home: homeLog2 }), 'memb', 'webui.stdout.log');
  const shown = text.split('\n');
  assert.ok(shown.length <= 400, `the 400-line cap is reapplied (got ${shown.length})`);
  assert.ok(!shown[0].startsWith('x'), 'the cut mid-file fragment line is not shown');
  assert.match(shown[0], /^line-\d+$/, 'the first shown line is complete');
});

test('redact: a 64 KB lowercase line without an URL scheme finishes under 500 ms', () => {
  const line = 'a'.repeat(64 * 1024);
  const t0 = Date.now();
  const out = redact(`${line}\ntokentoadmin 64KB-fill ${line.slice(0, 16)}\n`);
  assert.ok(Date.now() - t0 < 500, `redact took ${Date.now() - t0} ms`);
  assert.match(out, /tokentoadmin/, 'normal content stays untouched');
});

// ------------------------------------------------------------ linux systemd
describe('linux systemd control', () => {
  test('restart of a row with a unit issues exactly `systemctl --user restart <unit>`', async () => {
    calls.length = 0;
    const res = await controlService(recordingCtx({ platform: 'linux' }), 'gateway', 'restart');
    assert.equal(res.ok, true);
    assert.deepEqual(calls.map((c) => [c.cmd, c.args]), [['systemctl', ['--user', 'restart', 'com.bdb.aos.gateway.service']]]);
  });

  test('a row without a unit throws the not-available error and spawns nothing', async () => {
    calls.length = 0;
    await assert.rejects(
      () => controlService(recordingCtx({ platform: 'linux' }), 'ao', 'start'),
      /not available on this platform/,
    );
    assert.equal(calls.length, 0);
  });

  test('remoteos is an unknown id', async () => {
    await assert.rejects(
      () => controlService(recordingCtx({ platform: 'linux' }), 'remoteos', 'start'),
      /unknown service/,
    );
  });

  test('systemctl failure throws with stderr', async () => {
    const ctx = {
      ...recordingCtx({ platform: 'linux' }),
      run: async () => ({ ok: false, code: 1, stdout: '', stderr: 'Failed to restart unit: not found' }),
    };
    await assert.rejects(() => controlService(ctx, 'gateway', 'restart'), /Failed to restart unit/);
  });

  test('effectiveControlFor: unit -> systemd, no unit -> observe; agentLoaded probes is-enabled', async () => {
    const ctx = recordingCtx({ platform: 'linux' });
    calls.length = 0;
    const rows = await statusService(ctx);
    assert.equal(rows.find((r) => r.id === 'gateway').control, 'systemd');
    assert.equal(rows.find((r) => r.id === 'ao').control, 'observe');
    const loadCall = calls.find((c) => c.cmd === 'systemctl' && c.args[1] === 'is-enabled');
    assert.ok(loadCall, 'is-enabled was asked');
    assert.deepEqual(loadCall.args, ['--user', 'is-enabled', 'com.bdb.aos.gateway.service']);
  });
});
