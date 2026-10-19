// Map side panel: a plain-click decision writes a local receipt that the go-gate accepts once, and nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

process.env.AOS_TEST_SANDBOX = '1';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-side-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
const gdir = path.join(home, '.aos', 'gate');
const godir = path.join(home, '.aos', 'go');
fs.mkdirSync(gdir, { recursive: true, mode: 0o700 });
fs.mkdirSync(godir, { recursive: true, mode: 0o700 });

const gate = await import(pathToFileURL(path.join(root, '.claude', 'hooks', 'go-gate.mjs')).href);
const side = await import(pathToFileURL(path.join(root, 'skills/global_config/agenttrail/lib/sidepanel.mjs')).href);

const KEY = 'name-worker-x';
const CMD = 'gh pr merge 5';
const gateMod = { listStateKeys: () => [KEY], gateDir: () => gdir, TOKEN_TTL_MS: gate.TOKEN_TTL_MS, readState: () => ({}), gogateCommandsFor: () => [], effectiveGate: () => ({ mode: 'ask', grants: [], rejected: [] }), textHash: gate.textHash };
const writeReq = (id, scopes) => fs.writeFileSync(path.join(gdir, `${KEY}.req.json`), JSON.stringify([{ id, ts: new Date().toISOString(), session_name: 'worker: x', cmd_preview: CMD, cmd_hash: gate.textHash(CMD), scopes, hard: false }]));

test('approve once: receipt is accepted by the gate exactly once', async () => {
  writeReq('r1', ['merge']);
  const m = await side.sideModel({ home, gateMod });
  assert.equal(m.requests[0].session, 'worker: x');
  assert.equal(JSON.stringify(side.publicModel(m)).includes('cmdHash'), false);
  assert.equal(gate.localClickCovers(CMD, KEY, { consume: false }), false);
  await side.decide({ id: 'r1', decision: 'approve', scope: 'once' }, { home, gateMod });
  assert.equal(gate.localClickCovers('gh pr merge 6', KEY, { consume: false }), false);
  assert.equal(gate.localClickCovers(CMD, KEY), true);
  assert.equal(gate.localClickCovers(CMD, KEY), false);
  await assert.rejects(side.decide({ id: 'r1', decision: 'approve', scope: 'once' }, { home, gateMod }), { code: 'request-decided' });
});

test('grant scopes: 15m becomes a gate grant, broad scopes and bad ids are refused', async () => {
  writeReq('r2', ['merge']);
  await side.decide({ id: 'r2', decision: 'approve', scope: '15m' }, { home, gateMod });
  assert.ok(gate.effectiveGate(KEY, { source: '', cmds: [] }).grants.some((g) => g.scope === 'merge'));
  writeReq('r3', ['destructive']);
  await assert.rejects(side.decide({ id: 'r3', decision: 'approve', scope: 'session' }, { home, gateMod }), { code: 'broad-needs-terminal' });
  await assert.rejects(side.decide({ id: '../x', decision: 'approve' }, { home, gateMod }), { code: 'bad-request-id' });
  await assert.rejects(side.decide({ id: 'nope', decision: 'approve' }, { home, gateMod }), { code: 'unknown-request' });
});

test('deny writes nothing and hides the card', async () => {
  writeReq('r4', ['merge']);
  const dismissed = new Set();
  const before = fs.readdirSync(godir).length;
  await side.decide({ id: 'r4', decision: 'deny' }, { home, gateMod, dismissed });
  assert.equal(fs.readdirSync(godir).length, before);
  assert.equal((await side.sideModel({ home, gateMod, dismissed })).requests.length, 0);
});
