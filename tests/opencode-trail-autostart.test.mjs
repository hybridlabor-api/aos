import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trailEnsure, isSpawnTool } from '../.opencode/plugins/lib/trail-autostart.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-ac-'));
const fake = (name, body) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  return p;
};
const ok = fake('ok', `
require('fs').appendFileSync(process.env.ARGS_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
console.log(JSON.stringify({url:'http://127.0.0.1:5334/',started:true,opened:false,reason:null,plan:null,hint:'h'}));`);
const exit1 = fake('exit1', 'process.exit(1)');
const garbage = fake('garbage', "console.log('not json')");
const hang = fake('hang', 'setInterval(()=>{},1000)');
const run = (bin, extra = {}) => trailEnsure({ env: { ...process.env, AOS_TRAIL_BIN: bin, ARGS_LOG: path.join(tmp, 'args.log') }, cwd: '/w', sessionId: 's1', ...extra });

test('returns url and hint, passes only fixed args', () => {
  const r = run(ok);
  assert.deepStrictEqual(r, { url: 'http://127.0.0.1:5334/', hint: 'h' });
  const line = JSON.parse(fs.readFileSync(path.join(tmp, 'args.log'), 'utf8').trim().split('\n').pop());
  assert.deepStrictEqual(line, ['--ensure', '--cwd', '/w', '--session', 's1', '--json']);
});

test('only the task tool counts as a spawn', () => {
  assert.ok(isSpawnTool('task'));
  assert.ok(isSpawnTool('Task'));
  for (const t of ['bash', 'read', 'edit', '', undefined]) assert.ok(!isSpawnTool(t));
});

test('missing, failing, garbage and hanging binaries return null in time', () => {
  for (const bin of [path.join(tmp, 'nope'), exit1, garbage, hang]) {
    const t = Date.now();
    assert.strictEqual(run(bin), null);
    assert.ok(Date.now() - t < 2500, `slow: ${bin}`);
  }
});

test('injected spawnSync that throws is swallowed', () => {
  assert.strictEqual(trailEnsure({ spawnSync: () => { throw new Error('x'); }, env: {} }), null);
});

test('plugin: shape, task call runs ensure once per session and toasts; hostile prompt never reaches argv', async () => {
  const mod = await import(`file://${root}/.opencode/plugins/bdb-aos.js?t=${Date.now()}`);
  const toasts = [];
  const hooks = await mod.default({ directory: '/w', client: { tui: { showToast: async (a) => { toasts.push(a); } } } });
  assert.strictEqual(typeof hooks['tool.execute.before'], 'function');
  assert.strictEqual(typeof hooks['tool.execute.after'], 'function');
  const log = path.join(tmp, 'args.log');
  fs.writeFileSync(log, '');
  process.env.AOS_TRAIL_BIN = ok;
  process.env.ARGS_LOG = log;
  process.env.AGENTTRAIL_PORT = '1';
  try {
    const hostile = '$(touch /tmp/pwned); `id` ; --evil';
    await hooks['tool.execute.before']({ tool: 'task', sessionID: 'sA', callID: 'c1' }, { args: { prompt: hostile } });
    await hooks['tool.execute.before']({ tool: 'task', sessionID: 'sA', callID: 'c2' }, { args: { prompt: hostile } });
    await hooks['tool.execute.before']({ tool: 'read', sessionID: 'sB', callID: 'c3' }, { args: {} });
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.strictEqual(lines.length, 1);
    assert.ok(!lines[0].includes('pwned') && !lines[0].includes('evil'));
    assert.strictEqual(toasts.length, 1);
    assert.strictEqual(toasts[0].body.message, 'http://127.0.0.1:5334/');
  } finally {
    delete process.env.AOS_TRAIL_BIN; delete process.env.ARGS_LOG; delete process.env.AGENTTRAIL_PORT;
  }
});

test('plugin: task call with a broken binary does not throw', async () => {
  const mod = await import(`file://${root}/.opencode/plugins/bdb-aos.js?t=${Date.now()}b`);
  const hooks = await mod.default({ directory: '/w', client: {} });
  process.env.AOS_TRAIL_BIN = hang;
  process.env.AGENTTRAIL_PORT = '1';
  try {
    await hooks['tool.execute.before']({ tool: 'task', sessionID: 'sC', callID: 'c' }, { args: {} });
  } finally { delete process.env.AOS_TRAIL_BIN; delete process.env.AGENTTRAIL_PORT; }
});
