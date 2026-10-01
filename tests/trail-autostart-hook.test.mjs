import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HOOK = path.join(ROOT, '.claude', 'hooks', 'trail-autostart.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-autostart-'));
const LOG = path.join(tmp, 'calls.log');
const SECRET = 'HOSTILE-$(touch pwned)-prompt-text';

function fake(name, body) {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, `#!/bin/sh\necho "$@" >> "${LOG}"\n${body}\n`, { mode: 0o755 });
  return f;
}
const json = (o) => `echo '${JSON.stringify(o)}'`;
const ok = fake('ok', json({ url: 'http://localhost:5334', started: true, opened: false, reason: null, plan: 'p', hint: null }));
const second = fake('second', json({ url: 'http://localhost:5334', started: false, opened: false, reason: null, plan: 'p', hint: null }));

function run(bin, input) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [HOOK], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...process.env, AOS_TRAIL_BIN: bin }, encoding: 'utf8', timeout: 10000,
  });
  return { ...r, ms: Date.now() - t };
}
const agent = { tool_name: 'Agent', session_id: 's1', cwd: '/some/dir', tool_input: { prompt: SECRET, description: SECRET } };

test('Agent call emits additionalContext with the url, passes --cwd/--session, never prompt text', () => {
  fs.rmSync(LOG, { force: true });
  const r = run(ok, agent);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out, { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'agenttrail live map: http://localhost:5334' } });
  const argv = fs.readFileSync(LOG, 'utf8');
  assert.match(argv, /--ensure/);
  assert.match(argv, /--cwd \/some\/dir/);
  assert.match(argv, /--session s1/);
  assert.match(argv, /--json/);
  assert.ok(!argv.includes('HOSTILE') && !r.stdout.includes('HOSTILE'));
});

test('Task tool also triggers; other tools print nothing and run nothing', () => {
  fs.rmSync(LOG, { force: true });
  assert.ok(run(ok, { ...agent, tool_name: 'Task' }).stdout.includes('5334'));
  fs.rmSync(LOG, { force: true });
  for (const tool_name of ['Bash', 'Read', 'agent', undefined]) {
    const r = run(ok, { ...agent, tool_name });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  }
  assert.ok(!fs.existsSync(LOG), 'ensure command must not run for non-Agent tools');
});

test('two consecutive Agent calls each call ensure; hook keeps no state', () => {
  fs.rmSync(LOG, { force: true });
  run(ok, agent);
  const r2 = run(second, agent);
  assert.equal(fs.readFileSync(LOG, 'utf8').trim().split('\n').length, 2);
  assert.ok(r2.stdout.includes('5334'));
});

test('hint without url is emitted as context', () => {
  const r = run(fake('hint', json({ url: null, started: false, opened: false, reason: 'no-plan', plan: null, hint: 'Create a plan file first.' })), agent);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, 'Create a plan file first.');
});

test('url null and no hint prints nothing', () => {
  const r = run(fake('nohint', json({ url: null, started: false, opened: false, reason: 'x', plan: null, hint: null })), agent);
  assert.equal(r.stdout, '');
});

test('failures are silent, exit 0, and fast', () => {
  const cases = {
    exit1: fake('bad1', 'exit 1'),
    hang: fake('hang', 'exec sleep 30'),
    garbage: fake('garbage', 'echo not-json'),
    missing: path.join(tmp, 'does-not-exist'),
  };
  for (const [name, bin] of Object.entries(cases)) {
    const r = run(bin, agent);
    assert.equal(r.status, 0, name);
    assert.equal(r.stdout, '', name);
    assert.ok(r.ms < 2500, `${name} took ${r.ms}ms`);
  }
  for (const bad of ['', 'not json', '[]', 'null']) {
    const r = run(ok, bad);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  }
});

test('registration: settings.json entry, installer merge is idempotent and keeps foreign hooks', () => {
  const repo = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
  const entry = repo.hooks.PreToolUse.find((e) => e.hooks.some((h) => h.command.includes('trail-autostart.mjs')));
  assert.equal(entry.matcher, 'Agent|Task');
  assert.equal(entry.hooks[0].timeout, 3);
  assert.ok(repo.hooks.PreToolUse.some((e) => e.hooks.some((h) => h.command.includes('go-gate.mjs'))));

  const installer = require(path.join(ROOT, 'installer.js'));
  for (const projectLocal of [false, true]) {
    const settings = path.join(tmp, `settings-${projectLocal}`, 'settings.json');
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.writeFileSync(settings, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node /mine.mjs' }] }] } }));
    for (let i = 0; i < 3; i++) installer.mergeBdbSettingsHooks(settings, { projectLocal });
    const cmds = JSON.parse(fs.readFileSync(settings, 'utf8')).hooks.PreToolUse.flatMap((e) => e.hooks.map((h) => h.command));
    assert.equal(cmds.filter((c) => c.includes('trail-autostart.mjs')).length, 1);
    assert.ok(cmds.includes('node /mine.mjs'));
    assert.ok(cmds.some((c) => c.includes('trail-autostart.mjs') && c.includes('$HOME/.claude/hooks/')));
  }
});
