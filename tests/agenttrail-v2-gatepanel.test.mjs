import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { panel, scrub, parseLogLine, loadGate, filterStateKeys } from '../skills/global_config/agenttrail/lib/gatepanel.mjs';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

// A stand-in for the real go-gate module: same export names, its own store under a
// fixture directory. It only reads, so the "never writes" assertion is meaningful.
const STUB = `
import fs from 'node:fs';
import path from 'node:path';
const dir = process.env.FIXTURE_GATE_DIR;
const TOKEN_TTL_MS = 10 * 60 * 1000;
export const gateDir = () => dir;
export const sessionKey = (id) => String(id);
export const readState = (key) => { try { return JSON.parse(fs.readFileSync(path.join(dir, key + '.json'), 'utf8')); } catch { return null; } };
export const listStateKeys = () => { try { return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)); } catch { return []; } };
export const gogateCommandsFor = (source) => (JSON.parse(process.env.FIXTURE_CMDS || '{}')[source] || []);
export const statusText = () => '';
export const textHash = (t) => String(t);
export const parseGogate = (t) => ({ cmd: String(t) });
export function effectiveGate(key, opts, now = Date.now()) {
  const st = readState(key) || {};
  const grants = (st.grants || []).map((g) => ({ scope: g.scope, until: Date.parse(g.until), session: !!g.session }));
  return { mode: st.mode || 'soft', grants, rejected: st.rejected || [] };
}
export const tokenTtl = TOKEN_TTL_MS;
`;

let dir;
let gate;
let snapshot;

const write = (name, text) => fs.writeFileSync(path.join(dir, name), text);
const writeJson = (name, value) => write(name, JSON.stringify(value, null, 2));

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-gatepanel-'));
  const modPath = path.join(dir, 'stub-gate.mjs');
  fs.writeFileSync(modPath, STUB);
  process.env.FIXTURE_GATE_DIR = dir;
  gate = await import(pathToFileURL(modPath).href);

  writeJson('s1.json', {
    transcript: '/tmp/t.jsonl',
    mode: 'soft',
    grants: [
      { scope: 'push-feature', until: new Date(NOW + 45 * 60000).toISOString(), session_key: 's1' },
      { scope: 'merge', until: new Date(NOW - 5 * 60000).toISOString(), session_key: 's1' },
    ],
    rejected: ['grant push-main has no matching human gogate entry'],
  });
  write('s1.log', [
    `${ago(9 * 60000)} deny[ hard] main is protected "git push origin main" :: push-main`,
    `${ago(8 * 60000)} denied: destructive without GO "rm -rf /tmp/x" :: destructive`,
    `${ago(5 * 60000)} grant: allowed ${JSON.stringify('git push origin feat')}`,
    `${ago(3 * 60000)} rejected: grant merge revoked by a later hard`,
  ].join('\n') + '\n');
  writeJson('s1.block', { ts: ago(2 * 60000) });
  writeJson('s1.req.json', {
    id: 'r1',
    ts: ago(2 * 60000),
    session_key: 's1',
    session_name: 'opus',
    cwd: '/repo',
    cmd_hash: 'h-open',
    cmd_preview: 'git push origin feat',
    scopes: ['push-feature'],
    hard: false,
  });
  writeJson('trail-credential.json', { credentialId: 'fake', publicKey: {} });

  const before2 = fs.readdirSync(dir).sort();
  const mtimes = Object.fromEntries(before2.map((f) => [f, fs.statSync(path.join(dir, f)).mtimeMs]));
  snapshot = { before2, mtimes };
});

describe('scrub', () => {
  test('a bearer token is removed', () => {
    const out = scrub('curl -H "Authorization: Bearer sk-abc123DEF456" https://api.example.com');
    assert.ok(!out.includes('sk-abc123DEF456'), out);
    assert.match(out, /\*\*\*/);
  });

  test('--password and friends are removed', () => {
    for (const cmd of ['mysql --password hunter2 db', 'app --token=sekret run', 'app --api-key sk-x run', 'app --secret s run']) {
      const out = scrub(cmd);
      assert.ok(!/hunter2|sekret|sk-x|\bs\b run/.test(out), `${cmd} -> ${out}`);
    }
  });

  test('credentials in a url are removed', () => {
    const out = scrub('git clone https://user:p4ss@h/repo.git');
    assert.ok(!out.includes('p4ss'), out);
    assert.ok(out.includes('h/repo.git'), out);
  });

  test('--header arguments are removed', () => {
    const out = scrub("curl -H 'X-Api-Key: topsecret' https://x.invalid");
    assert.ok(!out.includes('topsecret'), out);
  });

  test('the preview is capped at 200 characters', () => {
    assert.ok(scrub('a'.repeat(500)).length <= 200);
  });

  test('control characters are stripped', () => {
    assert.equal(scrub('git push\norigin\rmain\x00'), 'git pushoriginmain');
  });

  test('an ordinary command is left alone', () => {
    assert.equal(scrub('git push origin feat'), 'git push origin feat');
  });
});

describe('parseLogLine', () => {
  test('a deny line yields kind, hard flag, command and reason', () => {
    const line = parseLogLine(`${ago(60000)} deny[ hard] main is protected "git push origin main" :: push-main`);
    assert.equal(line.kind, 'deny');
    assert.equal(line.hard, true);
    assert.equal(line.command, 'git push origin main');
    assert.equal(line.reason, 'push-main');
    assert.equal(line.ts, Date.parse(ago(60000)));
  });

  test('a soft deny line is not hard', () => {
    const line = parseLogLine(`${ago(60000)} denied: no GO "npm publish" :: publish`);
    assert.equal(line.kind, 'deny');
    assert.equal(line.hard, false);
    assert.equal(line.command, 'npm publish');
  });

  test('a grant line yields its command', () => {
    const line = parseLogLine(`${ago(60000)} grant: allowed ${JSON.stringify('git push origin feat')}`);
    assert.equal(line.kind, 'allow');
    assert.equal(line.command, 'git push origin feat');
  });

  test('a rejected line is recognised', () => {
    assert.equal(parseLogLine(`${ago(60000)} rejected: grant merge revoked by a later hard`).kind, 'reject');
  });

  test('a line with no timestamp is null', () => {
    assert.equal(parseLogLine('garbage'), null);
  });
});

describe('filterStateKeys', () => {
  test('request, revoke and credential files are not session keys', () => {
    const keys = filterStateKeys(['s1', 's1.req', 's1.revoke', 'trail-credential', 's2']);
    assert.deepEqual(keys, ['s1', 's2']);
  });
});

describe('panel', () => {
  test('grants come from the gate own effectiveGate with time left', async () => {
    const p = await panel({ now: NOW, gate, dir });
    assert.equal(p.available, true);
    const grant = p.grants.find((g) => g.scope === 'push-feature');
    assert.equal(grant.sessionKey, 's1');
    assert.equal(grant.minutesLeft, 45);
    assert.equal(grant.until, new Date(NOW + 45 * 60000).toISOString());
  });

  test('an expired grant is hidden', async () => {
    const p = await panel({ now: NOW, gate, dir });
    assert.equal(p.grants.some((g) => g.scope === 'merge'), false);
  });

  test('modes and rejected reasons are surfaced per session', async () => {
    const p = await panel({ now: NOW, gate, dir });
    assert.deepEqual(p.modes, [{ sessionKey: 's1', mode: 'soft' }]);
    assert.ok(p.rejected.some((r) => r.includes('no matching human gogate entry')), JSON.stringify(p.rejected));
  });

  test('deny log lines become blocks, hard ones are flagged not clickable', async () => {
    const p = await panel({ now: NOW, gate, dir });
    const hard = p.blocks.find((b) => b.command === 'git push origin main');
    assert.equal(hard.hard, true);
    assert.equal(hard.click, false);
    const soft = p.blocks.find((b) => b.command === 'rm -rf /tmp/x');
    assert.equal(soft.hard, false);
  });

  test('a request with no later allow line is open', async () => {
    const p = await panel({ now: NOW, gate, dir });
    assert.equal(p.requests.length, 1);
    const r = p.requests[0];
    assert.equal(r.id, 'r1');
    assert.equal(r.sessionKey, 's1');
    assert.equal(r.scopes[0], 'push-feature');
    assert.equal(r.click, true);
  });

  test('a later grant line for the same command closes the request', async () => {
    writeJson('s1.req.json', {
      id: 'r2',
      ts: ago(6 * 60000),
      session_key: 's1',
      cmd_hash: 'h-closed',
      cmd_preview: 'git push origin feat',
      scopes: ['push-feature'],
      hard: false,
    });
    const p = await panel({ now: NOW, gate, dir });
    assert.equal(p.requests.length, 0);
  });

  test('a request older than the token TTL is closed', async () => {
    writeJson('s1.req.json', {
      id: 'r3',
      ts: ago(11 * 60000),
      session_key: 's1',
      cmd_hash: 'h-old',
      cmd_preview: 'npm publish',
      scopes: ['publish'],
      hard: false,
    });
    const p = await panel({ now: NOW, gate, dir });
    assert.equal(p.requests.length, 0);
  });

  test('a hard request is never clickable', async () => {
    writeJson('s1.req.json', {
      id: 'r4',
      ts: ago(60000),
      session_key: 's1',
      cmd_hash: 'h-hard',
      cmd_preview: 'git push origin main',
      scopes: ['push-main'],
      hard: true,
    });
    const p = await panel({ now: NOW, gate, dir });
    assert.equal(p.requests.length, 1);
    assert.equal(p.requests[0].click, false);
  });

  test('sessionKey comes from the file name, not the record', async () => {
    writeJson('s1.req.json', { id: 'r5', ts: ago(60000), session_key: 'evil', cmd_hash: 'h5', cmd_preview: 'git push origin feat', scopes: ['push-feature'], hard: false });
    const p = await panel({ now: NOW, gate, dir });
    assert.equal(p.requests.length, 1);
    assert.equal(p.requests[0].sessionKey, 's1');
  });

  test('an oversized or symlinked req file is ignored', async () => {
    const f = path.join(dir, 's1.req.json');
    const rec = { id: 'r6', ts: ago(60000), session_key: 's1', cmd_hash: 'h6', cmd_preview: 'x', scopes: [], hard: false };
    write('s1.req.json', JSON.stringify([rec]) + ' '.repeat(70 * 1024));
    assert.equal((await panel({ now: NOW, gate, dir })).requests.length, 0);
    fs.rmSync(f);
    const target = path.join(dir, 'target.txt');
    fs.writeFileSync(target, JSON.stringify([rec]));
    fs.symlinkSync(target, f);
    assert.equal((await panel({ now: NOW, gate, dir })).requests.length, 0);
    fs.rmSync(f);
    fs.rmSync(target);
  });

  test('a missing gate module means available:false and nothing else', async () => {
    const p = await panel({ now: NOW, gate: null, dir });
    assert.equal(p.available, false);
    assert.deepEqual(p.blocks, []);
    assert.deepEqual(p.requests, []);
    assert.deepEqual(p.grants, []);
    assert.deepEqual(p.modes, []);
    assert.equal(p.reason, 'gate module not found');
  });

  test('reading the panel never writes to the gate store', async () => {
    // Snapshot taken here, not in before(): earlier cases rewrite the request record on purpose.
    const before2 = fs.readdirSync(dir).sort();
    const mtimes = Object.fromEntries(before2.map((f) => [f, fs.statSync(path.join(dir, f)).mtimeMs]));
    await panel({ now: NOW, gate, dir });
    const after = fs.readdirSync(dir).sort();
    assert.deepEqual(after, before2);
    for (const f of after) assert.equal(fs.statSync(path.join(dir, f)).mtimeMs, mtimes[f], `${f} was touched`);
  });
});

describe('loadGate', () => {
  test('a module that cannot be imported is null', async () => {
    assert.equal(await loadGate(path.join(dir, 'does-not-exist.mjs')), null);
  });

  test('an explicit module path is loaded', async () => {
    const loaded = await loadGate(path.join(dir, 'stub-gate.mjs'));
    assert.equal(typeof loaded.effectiveGate, 'function');
  });
});