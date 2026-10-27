// Hooks can never be blocked by their environment: each hook has a hard wall-clock budget well below the harness
// timeout of its event. A non-gate hook whose dependency stalls (a child that never exits, a server that never
// answers, a locked store, a harness that never writes stdin) still exits 0 within budget + 1 s and leaves no child
// of its own running; go-gate still denies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = join(ROOT, '.claude', 'hooks');
const WIN = process.platform === 'win32';
const SLACK_MS = 1000;
const POSIX_ONLY = WIN && 'the stall is a POSIX tool or a direct (shell-less) spawn';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = () => mkdtempSync(join(tmpdir(), 'aos-budget-'));

// A fake tool on PATH as `name` (POSIX script or Windows .cmd shim) that runs `body` under node.
function fakeBin(dir, name, body) {
  const js = join(dir, `${name}-fake.cjs`);
  writeFileSync(js, `${body}\n`);
  if (WIN) writeFileSync(join(dir, `${name}.cmd`), `@echo off\r\n"${process.execPath}" "${js}" %*\r\n`);
  else {
    writeFileSync(join(dir, name), `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`);
    chmodSync(join(dir, name), 0o755);
  }
}
// A dependency that never finishes: records its pid, then idles for a minute.
function stallBin(dir, name) {
  const pidFile = join(dir, `${name}.pid`);
  fakeBin(dir, name, `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 60000);`);
  return pidFile;
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const readPid = (f) => (existsSync(f) ? Number(readFileSync(f, 'utf8')) : 0);
async function waitFor(fn, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (fn()) return true; await sleep(50); }
  return fn();
}

// Clean env: no AOS switch of the outer session leaks in, HOME is a fresh dir, and PATH is `bin` plus the system
// dirs only, so no installed deja, agy or aos-* of this machine ever runs (hooks start node by its absolute path).
function hookEnv(home, bin, extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(AOS_|MCSC_|AGENTTRAIL_|MEMB_|CLAUDE_|XDG_)/i.test(k)) delete env[k];
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
  const sys = WIN ? [join(process.env.SystemRoot || 'C:\\Windows', 'System32')] : ['/usr/bin', '/bin'];
  env[pathKey] = [bin, ...sys].filter(Boolean).join(delimiter);
  return { ...env, HOME: home, USERPROFILE: home, AOS_SESSIONS_DIR: join(home, 'sessions'), ...extra };
}

// Runs a hook; `payload` undefined keeps stdin open and silent (a harness that never writes).
function runHook(rel, args, { env, cwd, payload, limitMs }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let ms = 0;
    const child = spawn(process.execPath, [join(ROOT, rel), ...args], { cwd, env, stdio: 'pipe', windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const kill = setTimeout(() => child.kill('SIGKILL'), limitMs + 10000);
    child.on('exit', () => { ms = Date.now() - started; });
    child.on('close', (code) => {
      clearTimeout(kill);
      child.stdin.destroy();
      resolve({ code, ms, stdout, stderr });
    });
    if (payload !== undefined) child.stdin.write(`${JSON.stringify(payload)}\n`);
  });
}

async function expectFailOpen(rel, args, budgetMs, opts) {
  const r = await runHook(rel, args, { ...opts, limitMs: budgetMs });
  assert.equal(r.code, 0, `${rel} exit ${r.code}\n${r.stderr}`);
  assert.ok(r.ms <= budgetMs + SLACK_MS, `${rel} took ${r.ms} ms, budget ${budgetMs} ms`);
  return r;
}

test('memb-inject: a deja that never exits is killed with its tree, the hook still answers', async () => {
  const home = tmp(); const bin = tmp(); const proj = tmp();
  try {
    const pidFile = stallBin(bin, 'deja');
    const r = await expectFailOpen('.claude/hooks/memb-inject.mjs', [], 5500, {
      env: hookEnv(home, bin), cwd: proj, payload: { hook_event_name: 'SessionStart', session_id: 'budget-1', cwd: proj },
    });
    assert.match(r.stdout, /memB Ambient Memory Context/, 'the context gathered before deja stalled is still printed');
    const pid = readPid(pidFile);
    assert.ok(pid > 0, 'the stalled deja was started');
    assert.ok(await waitFor(() => !alive(pid), 3000), `deja (pid ${pid}) still runs after the hook exited`);
  } finally { for (const d of [home, bin, proj]) rmSync(d, { recursive: true, force: true }); }
});

test('memb-inject: a locked memb.db costs at most a short busy wait per query', async (t) => {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { return t.skip('node:sqlite unavailable'); }
  const home = tmp(); const bin = tmp(); const proj = tmp();
  fakeBin(bin, 'deja', 'process.exit(1);');
  const store = join(home, '.MemBDB');
  mkdirSync(store, { recursive: true });
  const db = new DatabaseSync(join(store, 'memb.db'));
  try {
    db.exec('CREATE TABLE memb_vectors (id TEXT, collection TEXT, payload TEXT); BEGIN EXCLUSIVE;');
    const r = await expectFailOpen('.claude/hooks/memb-inject.mjs', [], 5500, {
      env: hookEnv(home, bin), cwd: proj, payload: { hook_event_name: 'SessionStart', session_id: 'budget-2', cwd: proj },
    });
    assert.ok(r.ms < 4000, `lock waits took ${r.ms} ms`);
  } finally {
    try { db.exec('ROLLBACK'); } catch {}
    db.close();
    for (const d of [home, bin, proj]) rmSync(d, { recursive: true, force: true });
  }
});

test('trail-autostart: an aos-trail that never exits is killed, the hook exits 0 silently', async () => {
  const home = tmp(); const bin = tmp();
  try {
    const js = join(bin, 'trail-stall.cjs');
    const pidFile = join(bin, 'trail.pid');
    writeFileSync(js, `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 60000);\n`);
    const r = await expectFailOpen('.claude/hooks/trail-autostart.mjs', [], 2000, {
      env: hookEnv(home, bin, { AOS_TRAIL_BIN: js }), cwd: home, payload: { tool_name: 'Agent', session_id: 'budget-3', cwd: home },
    });
    assert.equal(r.stdout, '');
    const pid = readPid(pidFile);
    assert.ok(pid > 0, 'the stalled aos-trail was started');
    assert.ok(await waitFor(() => !alive(pid), 3000), `aos-trail (pid ${pid}) still runs after the hook exited`);
  } finally { for (const d of [home, bin]) rmSync(d, { recursive: true, force: true }); }
});

test('a2a-session: a ps that never answers cannot hold the SessionStart hook', { skip: POSIX_ONLY }, async () => {
  const home = tmp(); const bin = tmp();
  try {
    stallBin(bin, 'ps');
    await expectFailOpen('.claude/hooks/a2a-session.mjs', [], 3500, {
      env: hookEnv(home, bin, { AOS_A2A_SIDECAR: 'off' }), cwd: home, payload: { hook_event_name: 'SessionStart', session_id: 'budget-4' },
    });
  } finally { for (const d of [home, bin]) rmSync(d, { recursive: true, force: true }); }
});

test('agy a2a-inbox: a ps that never answers cannot hold PreInvocation', { skip: POSIX_ONLY }, async () => {
  const home = tmp(); const bin = tmp();
  try {
    stallBin(bin, 'ps');
    const r = await expectFailOpen('agy-hooks/a2a-inbox.mjs', [], 3500, {
      env: hookEnv(home, bin, { AOS_A2A_SIDECAR: 'off' }), cwd: home, payload: { conversationId: 'budget-5', invocationNum: 0 },
    });
    assert.equal(r.stdout.trim(), JSON.stringify({ injectSteps: [] }));
  } finally { for (const d of [home, bin]) rmSync(d, { recursive: true, force: true }); }
});

test('trail-relay: an agenttrail port that accepts and never answers costs the hook nothing', async () => {
  const home = tmp();
  const sockets = [];
  const server = net.createServer((s) => { sockets.push({ s, closed: false }); s.on('close', () => { sockets.find((x) => x.s === s).closed = true; }); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await expectFailOpen('.claude/hooks/trail-relay.mjs', ['--agent', 'claude'], 1500, {
      env: hookEnv(home, '', { AGENTTRAIL_PORT: String(server.address().port) }), cwd: home,
      payload: { hook_event_name: 'PreToolUse', tool_name: 'Read', session_id: 'budget-6', cwd: home },
    });
    // The worker is detached and slow to start on a loaded machine; what matters is that it gives up on its own.
    assert.ok(await waitFor(() => sockets.length > 0, 8000), 'the detached relay worker reached the port');
    assert.ok(await waitFor(() => sockets.every((x) => x.closed), 8000), 'the relay worker gave up on the silent port');
  } finally {
    for (const { s } of sockets) s.destroy();
    server.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('memb-session-save: the memb-mcp child is detached and never awaited', { skip: POSIX_ONLY }, async () => {
  const home = tmp(); const mcp = tmp();
  try {
    mkdirSync(join(mcp, '.venv', 'bin'), { recursive: true });
    writeFileSync(join(mcp, 'run.py'), '');
    const pidFile = stallBin(join(mcp, '.venv', 'bin'), 'python');
    const transcript = join(home, 't.jsonl');
    const turn = (type, text) => JSON.stringify({ type, message: { content: text } });
    writeFileSync(transcript, [1, 2, 3, 4].map((i) => turn('user', `task step ${i}`)).concat(turn('assistant', 'done '.repeat(60))).join('\n'));
    await expectFailOpen('.claude/hooks/memb-session-save.mjs', [], 3500, {
      env: hookEnv(home, '', { MEMB_MCP_DIR: mcp }), cwd: home,
      payload: { hook_event_name: 'SessionEnd', session_id: 'budget-7', transcript_path: transcript, cwd: home },
    });
    assert.ok(await waitFor(() => readPid(pidFile) > 0, 3000), 'the save child was started');
    const pid = readPid(pidFile);
    assert.ok(alive(pid), 'the hook exited without waiting for its detached save child');
    process.kill(pid, 'SIGKILL');
  } finally { for (const d of [home, mcp]) rmSync(d, { recursive: true, force: true }); }
});

test('fabric-dispatch hook mode: an agy worker that never exits cannot hold the prompt past the budget', { skip: POSIX_ONLY }, async () => {
  const home = tmp(); const bin = tmp(); const proj = tmp();
  try {
    stallBin(bin, 'agy');
    mkdirSync(join(proj, '.agents'), { recursive: true });
    for (const f of ['nodes.json', 'graph.md']) if (existsSync(join(ROOT, '.agents', f))) writeFileSync(join(proj, '.agents', f), readFileSync(join(ROOT, '.agents', f)));
    await expectFailOpen('.claude/workflows/fabric-dispatch.mjs', [], 20000, {
      env: hookEnv(home, bin), cwd: proj, payload: { hook_event_name: 'UserPromptSubmit', prompt: '/fabric-graph budget test goal', session_id: 'budget-8', cwd: proj },
    });
  } finally { for (const d of [home, bin, proj]) rmSync(d, { recursive: true, force: true }); }
});

// A harness that keeps stdin open and never writes: the stall every hook shares.
for (const [rel, args, budget] of [
  ['.claude/hooks/memb-inject.mjs', [], 5500],
  ['.claude/hooks/rules-inject.mjs', [], 1000],
  ['.claude/hooks/aos-session-hint.mjs', [], 2000],
  ['.claude/hooks/a2a-session.mjs', ['--harness', 'codex'], 3500],
  ['.claude/hooks/a2a-inbox.mjs', ['drain'], 3500],
  ['.claude/hooks/trail-relay.mjs', ['--agent', 'codex'], 1500],
  ['.claude/hooks/trail-autostart.mjs', [], 2000],
  ['.claude/hooks/memb-session-save.mjs', [], 3500],
  ['agy-hooks/a2a-inbox.mjs', [], 3500],
]) {
  test(`${rel} fails open within its budget when stdin stays open and silent`, async () => {
    const home = tmp();
    try {
      await expectFailOpen(rel, args, budget, { env: hookEnv(home, '', { AOS_A2A_SIDECAR: 'off', AGENTTRAIL_PORT: '1' }), cwd: home });
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
}

test('go-gate: a harness that never sends the payload is still denied within the budget', async () => {
  const home = tmp();
  try {
    const r = await runHook('.claude/hooks/go-gate.mjs', [], { env: hookEnv(home, ''), cwd: home, limitMs: 7000 });
    assert.equal(r.code, 2, r.stderr);
    assert.ok(r.ms <= 7000 + SLACK_MS, `go-gate took ${r.ms} ms`);
    assert.match(r.stdout, /"decision":"deny"/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('go-gate: a transcript that would block forever (FIFO) still denies a guarded command within the budget', { skip: POSIX_ONLY }, async () => {
  const home = tmp();
  try {
    const fifo = join(home, 'transcript.jsonl');
    const mk = spawn('mkfifo', [fifo]);
    await new Promise((r) => mk.on('close', r));
    const r = await runHook('.claude/hooks/go-gate.mjs', [], {
      env: hookEnv(home, ''), cwd: home, limitMs: 7000,
      payload: { tool_name: 'Bash', tool_input: { command: 'npm publish' }, transcript_path: fifo, session_id: 'budget-9', cwd: home },
    });
    assert.equal(r.code, 2, r.stderr);
    assert.ok(r.ms <= 7000 + SLACK_MS, `go-gate took ${r.ms} ms`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
