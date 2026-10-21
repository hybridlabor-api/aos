// aos-hooks.mjs: one node process per Claude hook event. Blocking, fail-open/closed, output merge,
// the relay's no-map short circuit and the installer swapping the old per-module entries for the dispatcher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const HOOKS = path.join(ROOT, '.claude', 'hooks');
const DISPATCHER = path.join(HOOKS, 'aos-hooks.mjs');
const RELAY = path.join(HOOKS, 'trail-relay.mjs');
const require = createRequire(import.meta.url);
const { dispatch, mergeOutputs, REGISTRY } = await import(pathToFileURL(DISPATCHER).href);
const relay = await import(pathToFileURL(RELAY).href);

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `aos-disp-${p}-`));
const ok = (stdout = '', stderr = '') => ({ code: 0, stdout, stderr });
const ctxJson = (event, text) => `${JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } })}\n`;
const payload = (extra = {}) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, session_id: 's', cwd: os.tmpdir(), ...extra });

test('a gate block exits 2 with the gate message and no later module can undo or hide it', async () => {
  const calls = [];
  const registry = {
    ctx: { run: async () => { calls.push('ctx'); return ok(ctxJson('PreToolUse', 'late context')); } },
    gate: { gate: true, run: async () => { calls.push('gate'); return { code: 2, stdout: '', stderr: 'Blocked by fake gate: no GO\n' }; } },
    gate2: { gate: true, run: async () => { calls.push('gate2'); return ok(); } },
  };
  const r = await dispatch('PreToolUse', ['ctx', 'gate', 'gate2'], payload(), registry);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Blocked by fake gate: no GO/);
  assert.equal(r.stdout, '', 'no context is delivered with a block');
  assert.deepEqual(calls, ['gate'], 'gates run before the rest; the first PreToolUse block ends the run');
});

test('the real go-gate blocks a guarded command through the dispatcher (exit 2, its message on stderr)', () => {
  const home = tmp('home');
  const r = spawnSync(process.execPath, [DISPATCHER, 'PreToolUse', 'go-gate.mjs', 'conventional-commits.mjs', 'trail-relay.mjs'], {
    input: payload({ tool_input: { command: 'git push origin main' } }),
    env: { ...process.env, HOME: home, USERPROFILE: home, AGENTTRAIL_PORT: '1' }, encoding: 'utf8',
  });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /Blocked by go-gate hook/);
});

test('unreadable stdin on a gate event is denied by go-gate, not read as an empty payload', () => {
  const home = tmp('home');
  // stdin is a directory: readFileSync(0) throws EISDIR
  const r = spawnSync(process.execPath, [DISPATCHER, 'PreToolUse', 'go-gate.mjs', 'trail-relay.mjs'], {
    stdio: [fs.openSync(home, 'r'), 'pipe', 'pipe'],
    env: { ...process.env, HOME: home, USERPROFILE: home, AGENTTRAIL_PORT: '1' }, encoding: 'utf8',
  });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /Blocked by go-gate hook/);
});

test('the catch-all relay entry (--rest) skips the tools the other PreToolUse entries relayed', async () => {
  const seen = [];
  const registry = { relay: { run: async (c) => { seen.push(c.input.tool_name); return ok(); } } };
  for (const tool of ['Bash', 'Write', 'MultiEdit', 'Agent', 'Task', 'Read', 'mcp__x__y']) {
    await dispatch('PreToolUse', ['relay'], payload({ tool_name: tool }), registry, { rest: true });
  }
  assert.deepEqual(seen, ['Read', 'mcp__x__y']);
  seen.length = 0;
  await dispatch('PostToolUse', ['relay'], payload({ hook_event_name: 'PostToolUse', tool_name: 'Bash' }), registry, { rest: true });
  assert.deepEqual(seen, ['Bash'], 'only PreToolUse is split by tool');
});

test('an allowed command and unparseable input behave like the single hooks', () => {
  const home = tmp('home');
  const env = { ...process.env, HOME: home, USERPROFILE: home, AGENTTRAIL_PORT: '1' };
  const run = (input) => spawnSync(process.execPath, [DISPATCHER, 'PreToolUse', 'go-gate.mjs', 'conventional-commits.mjs', 'env-file-protection.mjs'], { input, env, encoding: 'utf8' });
  const allowed = run(payload());
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(allowed.stdout, '');
  const badCommit = run(payload({ tool_input: { command: 'git commit -m "no type"' } }));
  assert.equal(badCommit.status, 2);
  assert.match(badCommit.stderr, /conventional-commits hook/);
  const envWrite = run(payload({ tool_name: 'Write', tool_input: { file_path: '/srv/app/.env' } }));
  assert.equal(envWrite.status, 2);
  assert.match(envWrite.stderr, /env-file-protection hook/);
  assert.equal(run('not json').status, 2, 'go-gate stays fail-closed on input it cannot read');
});

test('a throwing or timing-out non-gate module never blocks and never hides a gate block', async () => {
  const boom = { run: async () => { throw new Error('memory exploded'); } };
  const slow = { budgetMs: 20, run: () => new Promise(() => {}) };
  const syncBoom = { run: () => { throw new Error('sync'); } };
  const alone = await dispatch('UserPromptSubmit', ['boom', 'slow', 'syncBoom', 'ok'], payload({ hook_event_name: 'UserPromptSubmit' }), {
    boom, slow, syncBoom, ok: { run: async () => ok(ctxJson('UserPromptSubmit', 'still delivered')) },
  });
  assert.equal(alone.code, 0);
  assert.match(alone.stdout, /still delivered/);

  const withGate = await dispatch('Stop', ['boom', 'gate'], payload({ hook_event_name: 'Stop' }), {
    boom, gate: { gate: true, run: async () => ({ code: 2, stdout: '', stderr: 'Blocked by graph-gate hook\n' }) },
  });
  assert.equal(withGate.code, 2);
  assert.match(withGate.stderr, /graph-gate/);
});

test('a gate that is fail-closed (go-gate) turns a throw into exit 2, a fail-open gate into a pass', async () => {
  const throwing = { gate: true, run: async () => { throw new Error('cannot load'); } };
  const closed = await dispatch('PreToolUse', ['g'], payload(), { g: { ...throwing, closed: true } });
  assert.equal(closed.code, 2);
  assert.match(closed.stderr, /cannot load/);
  const open = await dispatch('PreToolUse', ['g'], payload(), { g: throwing });
  assert.equal(open.code, 0);
  assert.ok(REGISTRY['go-gate.mjs'].closed && !REGISTRY['conventional-commits.mjs'].closed);
});

test('on Stop every gate runs: a graph-gate block and an A2A hand-over are both delivered', async () => {
  const r = await dispatch('Stop', ['graph', 'a2a'], payload({ hook_event_name: 'Stop' }), {
    graph: { gate: true, run: async () => ({ code: 2, stdout: '', stderr: 'graph blocked\n' }) },
    a2a: { gate: true, run: async () => ({ code: 2, stdout: '', stderr: 'a2a message\n' }) },
  });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /graph blocked[\s\S]*a2a message/);
});

test('two additionalContext emitters come out as ONE valid JSON object with both texts', async () => {
  const r = await dispatch('UserPromptSubmit', ['a', 'b', 'quiet'], payload({ hook_event_name: 'UserPromptSubmit' }), {
    a: { run: async () => ok(ctxJson('UserPromptSubmit', 'memory block')) },
    b: { run: async () => ok(ctxJson('UserPromptSubmit', 'rules block')) },
    quiet: { run: async () => ok() },
  });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.equal(out.hookSpecificOutput.additionalContext, 'memory block\n\nrules block');
  assert.equal(mergeOutputs([]), '');
  assert.equal(mergeOutputs(['not json']), '');
});

test('PreToolUse modules only see the tools they were matched to today', async () => {
  const seen = [];
  const mk = (name, tools) => ({ tools: new Set(tools), run: async () => { seen.push(name); return ok(); } });
  const registry = { bash: mk('bash', ['Bash']), files: mk('files', ['Write', 'Edit']), agent: mk('agent', ['Agent', 'Task']), all: { run: async () => { seen.push('all'); return ok(); } } };
  for (const tool of ['Bash', 'Write', 'Task', 'Read']) await dispatch('PreToolUse', ['bash', 'files', 'agent', 'all'], payload({ tool_name: tool }), registry);
  assert.deepEqual(seen, ['bash', 'all', 'files', 'all', 'agent', 'all', 'all']);
});

test('trail-relay with no running map sends nothing, imports nothing and spawns no process', async () => {
  const emptyHome = tmp('empty');
  const env = { HOME: emptyHome, AGENTTRAIL_PORT: '' };
  assert.deepEqual(relay.relayPorts(env), []);
  assert.deepEqual(relay.relayPorts({ ...env, AGENTTRAIL_PORT: '1' }), []);

  // in-process: no fetch
  const realFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; return { ok: true }; };
  try {
    const none = await relay.hook({ hook_event_name: 'PostToolUse', session_id: 's', cwd: os.tmpdir() }, { env });
    assert.deepEqual(none, { code: 0, stdout: '', stderr: '' });
    assert.equal(fetches, 0);
    // a dead pid in endpoints.json is not a running map
    fs.mkdirSync(path.join(emptyHome, '.aos'), { recursive: true });
    fs.writeFileSync(path.join(emptyHome, '.aos', 'endpoints.json'), JSON.stringify({ schema: 1, agenttrail: [{ port: 59998, pid: 2 ** 22 + 12345 }] }));
    await relay.hook({ hook_event_name: 'PostToolUse', session_id: 's', cwd: os.tmpdir() }, { env });
    assert.equal(fetches, 0);
    // a live map is posted to once, on its own port only
    fs.writeFileSync(path.join(emptyHome, '.aos', 'endpoints.json'), JSON.stringify({ schema: 1, agenttrail: [{ port: 59998, pid: process.pid }] }));
    await relay.hook({ hook_event_name: 'PostToolUse', session_id: 's', cwd: os.tmpdir() }, { env });
    assert.equal(fetches, 1);
  } finally {
    globalThis.fetch = realFetch;
  }

  // standalone script: a spy on child_process.spawn proves no detached worker is started without a map
  const dir = tmp('spy');
  const log = path.join(dir, 'spawn.log');
  const preload = path.join(dir, 'spy.mjs');
  fs.writeFileSync(preload, [
    "import cp from 'node:child_process';",
    "import fs from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    'const real = cp.spawn;',
    "cp.spawn = (...a) => { fs.appendFileSync(process.env.SPAWN_LOG, 'spawn\\n'); return real(...a); };",
    'syncBuiltinESMExports();',
  ].join('\n'));
  const runRelay = (home, extra = {}) => spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, RELAY, '--agent', 'claude'], {
    input: JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 's', cwd: os.tmpdir() }),
    env: { ...process.env, HOME: home, USERPROFILE: home, AGENTTRAIL_PORT: '', SPAWN_LOG: log, ...extra }, encoding: 'utf8',
  });
  const quiet = runRelay(tmp('quiet'));
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(fs.existsSync(log), false, 'no map: no worker');
  const live = runRelay(emptyHome);
  assert.equal(live.status, 0, live.stderr);
  assert.equal(fs.existsSync(log), true, 'a running map still gets its (one) detached worker');
});

test('install and update leave only dispatcher entries: no per-module entries of an earlier install remain', () => {
  const installer = require('../installer.js');
  const profile = require('../lib/v5/profile.js');
  const dir = tmp('settings');
  const settings = path.join(dir, 'settings.json');
  const old = (cmd, extra = {}) => ({ hooks: [{ type: 'command', command: cmd, timeout: 5 }], ...extra });
  const h = '$HOME/.claude/hooks/';
  fs.writeFileSync(settings, JSON.stringify({
    theme: 'dark',
    hooks: {
      PreToolUse: [
        old(`node "${h}go-gate.mjs" || exit 2`, { matcher: 'Bash' }), old(`node "${h}conventional-commits.mjs"`, { matcher: 'Bash' }),
        old(`node "${h}env-file-protection.mjs"`, { matcher: 'Write|Edit' }), old(`node "${h}trail-autostart.mjs"`, { matcher: 'Agent|Task' }),
        old(`node "${h}trail-relay.mjs" --agent claude`), old('node /mine/pre.mjs', { matcher: 'Bash' }),
      ],
      PostToolUse: [old(`node "${h}trail-relay.mjs" --agent claude`)],
      Stop: [old(`node "${h}graph-gate.mjs"`), old(`node "${h}a2a-inbox.mjs" stop`), old(`node "${h}trail-relay.mjs" --agent claude`)],
      SessionStart: [old(`node "${h}memb-inject.mjs"`), old(`node "${h}aos-session-hint.mjs"`), old(`node "${h}rules-inject.mjs"`), old(`node "${h}a2a-session.mjs"`)],
      UserPromptSubmit: [old(`node "${h}go-token.mjs"`), old(`node "${h}go-grant.mjs"`), old(`node "${h}memb-inject.mjs"`), old(`node "${h}rules-inject.mjs"`), old(`node "${h}a2a-inbox.mjs" drain`), old('node /mine/prompt.mjs')],
    },
  }));
  for (let i = 0; i < 3; i++) installer.mergeBdbSettingsHooks(settings);
  const s = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.equal(s.theme, 'dark');
  const all = Object.entries(s.hooks).flatMap(([event, entries]) => entries.flatMap((e) => e.hooks.map((x) => ({ event, command: x.command }))));
  const foreign = all.filter((x) => x.command.startsWith('node /mine/'));
  assert.equal(foreign.length, 2, 'foreign hooks survive');
  for (const { event, command } of all.filter((x) => !x.command.startsWith('node /mine/'))) {
    if (command.includes('aos-hooks.mjs')) {
      assert.match(command, new RegExp(`aos-hooks\\.mjs"? ${event} `), command);
    } else {
      assert.ok(command.includes('memb-session-save.mjs'), `old per-module entry left behind: ${event} ${command}`);
    }
  }
  for (const event of ['PreToolUse', 'PostToolUse', 'Stop', 'SessionStart', 'UserPromptSubmit', 'Notification', 'SubagentStop']) {
    assert.equal(all.filter((x) => x.event === event && x.command.includes('aos-hooks.mjs')).length, event === 'PreToolUse' ? 4 : 1, `${event}: dispatcher entries`);
  }
  assert.ok(all.some((x) => x.event === 'PreToolUse' && x.command.endsWith('|| exit 2')));

  // uninstall recognises the dispatcher command (and the old ones) by the script it runs
  const ur = require('../lib/uninstall-records.js');
  assert.ok(all.filter((x) => x.command.includes('aos-hooks.mjs')).every((x) => ur.commandRunsScript(x.command, profile.HOOK_SCRIPTS)));
  assert.ok(!ur.commandRunsScript('node /mine/prompt.mjs', profile.HOOK_SCRIPTS));
});

test('dropping a module (gate off, memory off, no context hooks) edits the dispatcher command, not the entry set', () => {
  const profile = require('../lib/v5/profile.js');
  const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'claude-hooks.json'), 'utf8')).hooks;
  const cmd = (event, drop) => profile.dropContextHooks(tpl[event], drop).flatMap((e) => e.hooks.map((x) => x.command));
  assert.deepEqual(cmd('PreToolUse', profile.isContextCommand).length, 2, 'context off: only the Bash gate entry and the env-file entry stay');
  assert.deepEqual(cmd('PostToolUse', profile.isContextCommand), [], 'a relay-only event disappears');
  const pre = cmd('PreToolUse', profile.isContextCommand);
  assert.equal(pre.length, 2);
  assert.ok(pre[0].includes('go-gate.mjs') && !pre[0].includes('trail-relay.mjs') && pre[0].endsWith('|| exit 2'));
  const gateOff = cmd('PreToolUse', (c) => profile.GATE_HOOKS.some((n) => c.includes(n)));
  assert.ok(!gateOff[0].includes('go-gate.mjs') && !gateOff[0].includes('|| exit 2') && gateOff[0].includes('conventional-commits.mjs'));
  assert.ok(gateOff.some((c) => c.endsWith('trail-relay.mjs --rest')));
  const noMemory = cmd('UserPromptSubmit', (c) => /memb-inject\.mjs/.test(c));
  assert.ok(!noMemory[0].includes('memb-inject.mjs') && noMemory[0].includes('rules-inject.mjs') && noMemory[0].includes('go-token.mjs'));
});

test('the template names only modules the dispatcher knows, and every module is a script that still runs alone', () => {
  const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'claude-hooks.json'), 'utf8')).hooks;
  const names = Object.values(tpl).flat().flatMap((e) => e.hooks.map((x) => x.command)).filter((c) => c.includes('aos-hooks.mjs'))
    .flatMap((c) => c.match(/[\w-]+\.mjs(?= |$)/g).filter((n) => n !== 'aos-hooks.mjs'));
  assert.ok(names.length >= 10);
  for (const n of new Set(names)) {
    assert.ok(REGISTRY[n], `${n} is unknown to the dispatcher`);
    assert.ok(fs.existsSync(path.join(HOOKS, n)), n);
  }
});
