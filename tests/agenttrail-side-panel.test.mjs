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

const MIN = 60e3, HOUR = 3600e3;
const ISO = (ms) => new Date(ms).toISOString();
const writeReqs = (recs) => fs.writeFileSync(path.join(gdir, `${KEY}.req.json`), JSON.stringify(recs));
const reqRec = (id, cmd, { scopes = ['merge'], ts = Date.now() } = {}) => ({ id, ts: ISO(ts), session_name: 'worker: x', cmd_preview: cmd, cmd_hash: gate.textHash(cmd), scopes, hard: false });
const writeReceipt = (name, payload) => fs.writeFileSync(path.join(godir, name), JSON.stringify({ payload, via: 'map-click' }), { mode: 0o600 });
const goPayload = (id, cmd, { issued = Date.now(), ttl = gate.TOKEN_TTL_MS, scopes = ['merge'] } = {}) => ({ v: 1, kind: 'go', request_id: id, session_key: KEY, cmd_hash: gate.textHash(cmd), scopes, ms: 0, issued_at: issued, expires_at: issued + ttl, nonce: 'n'.repeat(32) });
const grantPayload = (id, ms, { issued = Date.now(), scopes = ['merge'] } = {}) => ({ v: 1, kind: 'grant', request_id: id, session_key: KEY, cmd_hash: '', scopes, ms, issued_at: issued, expires_at: issued + ms, nonce: 'g'.repeat(32) });
const covers = (cmd, opts = {}) => gate.localClickCovers(cmd, KEY, { consume: false, ...opts });

test('prune: expired receipts and old used markers go, fresh receipts stay', () => {
  const now = Date.now();
  writeReceipt(`${KEY}.local-p-old.json`, goPayload('p-old', 'git status', { issued: now - HOUR }));
  fs.writeFileSync(path.join(godir, `${KEY}.local-p-old.json.used`), '');
  fs.utimesSync(path.join(godir, `${KEY}.local-p-old.json.used`), (now - HOUR) / 1000, (now - HOUR) / 1000);
  writeReceipt(`${KEY}.local-p-new.json`, goPayload('p-new', 'git status', { issued: now }));
  assert.ok(side.pruneStale(KEY, { now, home }) >= 2);
  assert.equal(fs.existsSync(path.join(godir, `${KEY}.local-p-old.json`)), false);
  assert.equal(fs.existsSync(path.join(godir, `${KEY}.local-p-old.json.used`)), false);
  assert.equal(fs.existsSync(path.join(godir, `${KEY}.local-p-new.json`)), true);
});

test('scope limits: a click never approves destructive, push-to-main or publish, once or as a grant', async () => {
  for (const [id, cmd] of [['s-reset', 'git reset --hard'], ['s-push', 'git push origin main'], ['s-pub', 'npm publish']]) {
    writeReqs([reqRec(id, cmd, { scopes: ['merge'] })]);
    writeReceipt(`${KEY}.local-${id}.json`, goPayload(id, cmd));
    assert.equal(covers(cmd), false, cmd);
  }
  writeReqs([reqRec('s-scope', 'gh pr merge 21', { scopes: ['push-main'] })]);
  writeReceipt(`${KEY}.local-s-scope.json`, goPayload('s-scope', 'gh pr merge 21', { scopes: ['push-main'] }));
  assert.equal(covers('gh pr merge 21'), false);
  for (const [id, scopes] of [['s-d', ['destructive']], ['s-p', ['publish']], ['s-m', ['push-main']]]) {
    writeReqs([reqRec(id, 'gh pr merge 22', { scopes })]);
    await assert.rejects(side.decide({ id, decision: 'approve', scope: 'once' }, { home, gateMod }), { code: 'broad-needs-terminal' });
    await assert.rejects(side.decide({ id, decision: 'approve', scope: '15m' }, { home, gateMod }), { code: 'broad-needs-terminal' });
  }
});

test('click grants share the 24 h gate cap (no separate 2 h cap)', () => {
  const now = Date.now();
  writeReqs([reqRec('cap-1', 'gh pr merge 31', { ts: now })]);
  writeReceipt(`${KEY}.local-g-cap-1.json`, grantPayload('cap-1', 3 * HOUR, { issued: now }));
  const grants = gate.effectiveGate(KEY, { source: '', cmds: [] }, now).grants;
  assert.ok(grants.some((g) => g.until > now + 2 * HOUR), 'a 3 h grant is honoured');
  assert.ok(grants.every((g) => g.until <= now + 24 * HOUR));
});

test('a receipt must match a recorded request by id and command hash', () => {
  const now = Date.now();
  writeReqs([reqRec('m-ok', 'gh pr merge 41', { ts: now })]);
  writeReceipt(`${KEY}.local-m-ok.json`, goPayload('m-ok', 'gh pr merge 41', { issued: now }));
  assert.equal(covers('gh pr merge 41', { now }), true);
  writeReceipt(`${KEY}.local-m-none.json`, goPayload('m-none', 'gh pr merge 42', { issued: now }));
  assert.equal(covers('gh pr merge 42', { now }), false, 'no request with that id');
  writeReqs([reqRec('m-hash', 'gh pr merge 43', { ts: now })]);
  writeReceipt(`${KEY}.local-m-hash.json`, goPayload('m-hash', 'gh pr merge 44', { issued: now }));
  assert.equal(covers('gh pr merge 44', { now }), false, 'request recorded for another command');
});

test('requests older than 10 min are stale for decisions and for receipts', async () => {
  const now = Date.now();
  writeReqs([reqRec('age-1', 'gh pr merge 51', { ts: now - 11 * MIN })]);
  // panel() already drops requests past the 10 min TTL, so the decision sees them as unknown; either refusal is correct.
  await assert.rejects(side.decide({ id: 'age-1', decision: 'approve', scope: 'once' }, { home, gateMod, now }), (e) => ['unknown-request', 'request-stale'].includes(e.code));
  writeReceipt(`${KEY}.local-age-1.json`, goPayload('age-1', 'gh pr merge 51', { issued: now }));
  assert.equal(covers('gh pr merge 51', { now }), false);
  writeReqs([reqRec('age-2', 'gh pr merge 52', { ts: now - 1 * MIN })]);
  writeReceipt(`${KEY}.local-age-2.json`, goPayload('age-2', 'gh pr merge 52', { issued: now }));
  assert.equal(covers('gh pr merge 52', { now }), true);
});

test('timestamps: no future request or receipt, no receipt older than its 10 min window', async () => {
  const now = Date.now();
  writeReqs([reqRec('t-fut', 'gh pr merge 61', { ts: now + MIN })]);
  await assert.rejects(side.decide({ id: 't-fut', decision: 'approve', scope: 'once' }, { home, gateMod, now }), { code: 'request-future' });
  writeReceipt(`${KEY}.local-t-fut.json`, goPayload('t-fut', 'gh pr merge 61', { issued: now + MIN }));
  assert.equal(covers('gh pr merge 61', { now }), false);
  writeReqs([reqRec('t-old', 'gh pr merge 62', { ts: now - 20 * MIN })]);
  writeReceipt(`${KEY}.local-t-old.json`, goPayload('t-old', 'gh pr merge 62', { issued: now - 20 * MIN, ttl: 25 * MIN }));
  assert.equal(covers('gh pr merge 62', { now }), false);
});

test('a request decided once cannot be decided again with a grant', async () => {
  writeReqs([reqRec('dup-1', 'gh pr merge 71')]);
  await side.decide({ id: 'dup-1', decision: 'approve', scope: 'once' }, { home, gateMod });
  await assert.rejects(side.decide({ id: 'dup-1', decision: 'approve', scope: '15m' }, { home, gateMod }), { code: 'request-decided' });
});

test('the card button says Hide, not Deny: hiding never grants', () => {
  const src = fs.readFileSync(path.join(root, 'skills/global_config/agenttrail/public/shared/side.js'), 'utf8');
  assert.match(src, /'Hide'/);
  assert.doesNotMatch(src, /Deny/);
});
