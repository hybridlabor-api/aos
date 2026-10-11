'use strict';
// aos-acp agy target: drives the vendor `agy --print`. A fake `agy` on PATH stands in for the CLI; nothing here
// calls a real model. Temp dirs are left for the container to discard.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'aos-acp.mjs');
// A #! script is not spawnable on Windows, and spawn('agy') would then find a real agy.exe on PATH and run it.
const noFakeAgy = process.platform === 'win32' && 'the fake agy is a #! script';

const FAKE_AGY = `#!${process.execPath}
const fs = require('fs');
fs.writeFileSync(process.env.FAKE_AGY_ARGV, JSON.stringify(process.argv.slice(2)));
// Replies only after stdin reached EOF, like the real CLI that waits forever on an open pipe.
let buf = '';
process.stdin.on('data', (d) => { buf += d; });
process.stdin.on('end', () => {
  const mode = process.env.FAKE_AGY_MODE || 'ok';
  if (mode === 'timeout') {
    console.error('[agy] print timeout after 1m0s with turn in progress; returning partial output');
    console.log(JSON.stringify({ conversation_id: 'c1', status: 'SUCCESS', response: '', duration_seconds: 0, num_turns: 0 }));
  } else if (mode === 'nojson') {
    console.log('not json');
  } else if (mode === 'fail') {
    console.error('boom');
    process.exit(3);
  } else {
    console.log(JSON.stringify({ conversation_id: 'c1', status: 'SUCCESS', response: 'FAKE-ANSWER', duration_seconds: 1, num_turns: 2, usage: { total_tokens: 5 } }));
  }
});
`;

let home, binDir;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-acp-agy-'));
  binDir = path.join(home, 'bin');
  fs.mkdirSync(binDir);
  fs.writeFileSync(path.join(binDir, 'agy'), FAKE_AGY, { mode: 0o755 });
});

const run = (args, env = {}, { withAgy = true } = {}) => spawnSync(process.execPath, [BIN, 'agy', '--name', 'w1', '--cwd', home, '--prompt', 'do the thing', ...args], {
  env: { ...process.env, HOME: home, USERPROFILE: home, AGENTTRAIL_PORT: '1', FAKE_AGY_ARGV: path.join(home, 'argv.json'), PATH: withAgy ? `${binDir}:${process.env.PATH}` : path.dirname(process.execPath), ...env },
  encoding: 'utf8',
  timeout: 20000,
});
const argv = () => JSON.parse(fs.readFileSync(path.join(home, 'argv.json'), 'utf8'));
const readLog = () => fs.readFileSync(path.join(home, '.aos', 'acp', 'w1.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

describe('aos-acp agy', () => {
  test('default (deny) runs read-only plan mode, prints the answer, logs start/text/done, closes stdin', { skip: noFakeAgy }, () => {
    const r = run(['--model', 'gemini-3.8-flash-medium']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /FAKE-ANSWER/);
    const a = argv();
    assert.deepEqual(a.slice(0, 2), ['--model', 'gemini-3.8-flash-medium']);
    assert.ok(a.includes('--mode') && a[a.indexOf('--mode') + 1] === 'plan');
    assert.equal(a[a.indexOf('--print-timeout') + 1], '900s');
    assert.equal(a[a.indexOf('--output-format') + 1], 'json');
    assert.equal(a[a.length - 2], '--print');
    assert.equal(a[a.length - 1], 'do the thing');
    assert.ok(!a.includes('--dangerously-skip-permissions'));
    const events = readLog().map((e) => e.event);
    assert.deepEqual(events.filter((e) => ['start', 'text', 'done'].includes(e)), ['start', 'text', 'done']);
    assert.equal(readLog().find((e) => e.event === 'done').stopReason, 'end_turn');
  });

  test('--print-timeout sets the unit-suffixed agy flag', { skip: noFakeAgy }, () => {
    const r = run(['--print-timeout', '120']);
    assert.equal(r.status, 0, r.stderr);
    const a = argv();
    assert.equal(a[a.indexOf('--print-timeout') + 1], '120s');
  });

  test('scoped maps to accept-edits with the sandbox; allow maps to skip-permissions; neither is the default', { skip: noFakeAgy }, () => {
    assert.equal(run(['--allow-default', 'scoped']).status, 0);
    let a = argv();
    assert.equal(a[a.indexOf('--mode') + 1], 'accept-edits');
    assert.ok(a.includes('--sandbox'));
    assert.ok(!a.includes('--dangerously-skip-permissions'));
    assert.equal(run(['--allow-default', 'allow']).status, 0);
    a = argv();
    assert.ok(a.includes('--dangerously-skip-permissions'));
    assert.ok(!a.includes('--mode'));
  });

  test('an agy print timeout is a failure even though agy reports status SUCCESS with an empty response', { skip: noFakeAgy }, () => {
    const r = run([], { FAKE_AGY_MODE: 'timeout' });
    assert.equal(r.status, 1);
    assert.equal(readLog().find((e) => e.event === 'done').stopReason, 'timeout');
    assert.match(r.stderr, /cold start/);
    assert.match(r.stderr, /--project mcsc-delegate/);
    assert.match(r.stderr, /auth/);
  });

  test('non-JSON output and a non-zero exit are failures', { skip: noFakeAgy }, () => {
    assert.equal(run([], { FAKE_AGY_MODE: 'nojson' }).status, 1);
    assert.equal(run([], { FAKE_AGY_MODE: 'fail' }).status, 1);
    assert.equal(readLog().find((e) => e.event === 'done').stopReason, 'error');
  });

  test('a missing agy binary exits 2 with a clear message', () => {
    const r = run([], {}, { withAgy: false });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /agy is not installed/);
  });

  test('an unknown adapter is still an error and the usage names agy', () => {
    const r = spawnSync(process.execPath, [BIN, 'nope', '--name', 'a', '--prompt', 'x'], { env: { ...process.env, HOME: home, USERPROFILE: home, AGENTTRAIL_PORT: '1' }, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /claude\|codex\|opencode\|agy/);
  });
});
