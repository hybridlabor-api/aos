import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  createClick, createEnrolCode, verifyAssertion, enrolRefusal, canonicalPayload, challengeOf, ClickError,
  CHALLENGE_TTL_MS, ENROL_TTL_MS, stores,
} from '../skills/global_config/agenttrail/lib/click.mjs';
import { createSoftAuth, FLAG_UP, FLAG_UV } from './helpers/softauth.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hubBin = path.join(root, 'skills/global_config/agenttrail/bin/trail-hub.mjs');
const cliBin = path.join(root, 'skills/global_config/agenttrail/bin/agenttrail.mjs');

const code = (c) => (e) => { assert.equal(e.code, c, `expected ${c}, got ${e.code || e.message}`); return true; };
const mkHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'trail-click-'));
const mode = (f) => (process.platform === 'win32' ? 0o600 : fs.statSync(f).mode & 0o777); // NTFS reports 0666 whatever was asked; the profile ACL is the boundary
const files = (dir) => { try { return fs.readdirSync(dir).sort(); } catch { return []; } };

// ---------------------------------------------------------------------------------
// library: click.mjs with an injected clock and gate
// ---------------------------------------------------------------------------------

const PORT = 5350;
const ORIGIN = `http://localhost:${PORT}`;
const GATE = {
  requests: [
    { id: 'req1', sessionKey: 's1', cmdHash: 'hash-1', scopes: ['push-main'], hard: false, click: true },
    { id: 'req2', sessionKey: 's1', cmdHash: 'hash-2', scopes: [], hard: true, click: false },
  ],
  sessionKeys: ['s1'],
  scopes: ['push-feature', 'push-main', 'destructive'],
  maxGrantMs: 24 * 60 * 60 * 1000,
};

function setup() {
  const home = mkHome();
  const clock = { t: Date.parse('2026-10-08T10:00:00Z') };
  const click = createClick({ port: PORT, home, now: () => clock.t, gate: async () => GATE });
  const auth = createSoftAuth({ origin: ORIGIN });
  return { home, clock, click, auth, st: stores(home) };
}

function enrol(ctx) {
  const { code: c } = createEnrolCode({ home: ctx.home, now: ctx.clock.t });
  const opts = ctx.click.enrolBegin({ code: c });
  return ctx.click.enrolFinish(ctx.auth.register(opts.publicKey.challenge));
}

describe('enrolment (library)', () => {
  test('the harness check and the TTY check refuse', () => {
    assert.match(enrolRefusal({ stdinTTY: false, stdoutTTY: true, env: {} }), /TTY/);
    assert.match(enrolRefusal({ stdinTTY: true, stdoutTTY: false, env: {} }), /TTY/);
    assert.match(enrolRefusal({ stdinTTY: true, stdoutTTY: true, env: { AOS_ACP_CLIENT: '1' } }), /AOS_ACP_CLIENT/);
    assert.match(enrolRefusal({ stdinTTY: true, stdoutTTY: true, env: { CLAUDECODE: '1' } }), /CLAUDECODE/);
    assert.equal(enrolRefusal({ stdinTTY: true, stdoutTTY: true, env: {} }), null);
  });

  test('the CLI refuses without a TTY and writes nothing', () => {
    const home = mkHome();
    const r = spawnSync(process.execPath, [cliBin, 'enroll', '--no-open'], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /TTY/);
    assert.deepEqual(files(stores(home).gate), []);
  });

  test('a full enrolment stores the public key only, 0600', () => {
    const ctx = setup();
    assert.deepEqual(enrol(ctx), { ok: true });
    const file = path.join(ctx.st.gate, 'trail-credential.json');
    assert.equal(mode(file), 0o600);
    const cred = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(cred.id, ctx.auth.credentialId);
    assert.deepEqual(Object.keys(cred.publicKey).sort(), ['crv', 'kty', 'x', 'y']);
    assert.equal(ctx.click.enrolled(), true);
    assert.equal(fs.existsSync(path.join(ctx.st.gate, 'trail-enroll.json')), false, 'the pending record is gone');
  });

  test('the pending record is 0600 and holds a hash, not the code', () => {
    const ctx = setup();
    const { code: c } = createEnrolCode({ home: ctx.home, now: ctx.clock.t });
    const file = path.join(ctx.st.gate, 'trail-enroll.json');
    assert.equal(mode(file), 0o600);
    assert.equal(fs.readFileSync(file, 'utf8').includes(c), false);
    assert.equal(c.length, 8);
  });

  test('a code older than 5 minutes is refused', () => {
    const ctx = setup();
    const { code: c } = createEnrolCode({ home: ctx.home, now: ctx.clock.t });
    ctx.clock.t += ENROL_TTL_MS + 1;
    assert.throws(() => ctx.click.enrolBegin({ code: c }), code('code-expired'));
    assert.equal(ctx.click.enrolled(), false);
  });

  test('a wrong code counts a try; the third wrong try burns the code', () => {
    const ctx = setup();
    const { code: c } = createEnrolCode({ home: ctx.home, now: ctx.clock.t });
    for (let i = 0; i < 3; i += 1) assert.throws(() => ctx.click.enrolBegin({ code: 'AAAAAAAA' }), code('wrong-code'));
    assert.throws(() => ctx.click.enrolBegin({ code: c }), code('no-pending-enrolment'));
  });

  test('a code works once', () => {
    const ctx = setup();
    const { code: c } = createEnrolCode({ home: ctx.home, now: ctx.clock.t });
    ctx.click.enrolBegin({ code: c });
    assert.throws(() => ctx.click.enrolBegin({ code: c }), code('code-used'));
  });

  test('enrolling again is refused while a credential exists, unless --replace', () => {
    const ctx = setup();
    enrol(ctx);
    assert.throws(() => createEnrolCode({ home: ctx.home, now: ctx.clock.t }), code('already-enrolled'));
    // a pending record that claims no replace is refused by the hub side as well
    const { code: c } = createEnrolCode({ home: ctx.home, now: ctx.clock.t, replace: true });
    const pendingFile = path.join(ctx.st.gate, 'trail-enroll.json');
    const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
    fs.writeFileSync(pendingFile, JSON.stringify({ ...pending, replace: false }));
    assert.throws(() => ctx.click.enrolBegin({ code: c }), code('already-enrolled'));
    // the real --replace path swaps the credential
    const { code: c2 } = createEnrolCode({ home: ctx.home, now: ctx.clock.t, replace: true });
    const second = createSoftAuth({ origin: ORIGIN });
    const opts = ctx.click.enrolBegin({ code: c2 });
    ctx.click.enrolFinish(second.register(opts.publicKey.challenge));
    assert.equal(JSON.parse(fs.readFileSync(path.join(ctx.st.gate, 'trail-credential.json'), 'utf8')).id, second.credentialId);
  });

  test('finish fails for a stale challenge, a wrong origin, a wrong type and a wrong challenge', () => {
    const ctx = setup();
    const attempt = (over, advance = 0) => {
      const { code: c } = createEnrolCode({ home: ctx.home, now: ctx.clock.t });
      const opts = ctx.click.enrolBegin({ code: c });
      ctx.clock.t += advance;
      return () => ctx.click.enrolFinish(ctx.auth.register(over?.challenge || opts.publicKey.challenge, over?.cd || {}));
    };
    assert.throws(attempt(null, CHALLENGE_TTL_MS + 1), code('challenge-expired'));
    assert.throws(attempt({ cd: { origin: 'http://localhost:9999' } }), code('wrong-origin'));
    assert.throws(attempt({ cd: { type: 'webauthn.get' } }), code('wrong-type'));
    assert.throws(attempt({ challenge: 'AAAA' }), code('challenge-mismatch'));
    assert.equal(ctx.click.enrolled(), false, 'no failure wrote a credential');
    assert.throws(() => ctx.click.enrolFinish(ctx.auth.register('x')), code('no-enrolment-in-progress'));
  });
});

describe('challenge and confirm (library)', () => {
  let ctx;
  before(() => { ctx = setup(); enrol(ctx); });

  const ask = (over = {}) => ctx.click.challenge({ decision: 'go', requestId: 'req1', ...over });
  const receipts = () => files(ctx.st.go).filter((f) => f.includes('.click-'));

  test('no credential, no challenge', async () => {
    const bare = setup();
    await assert.rejects(bare.click.challenge({ decision: 'go', requestId: 'req1' }), code('no-credential'));
  });

  test('unknown and hard requests get no challenge', async () => {
    await assert.rejects(ask({ requestId: 'nope' }), code('unknown-request'));
    await assert.rejects(ask({ requestId: 'req2' }), code('request-hard'));
    await assert.rejects(ask({ requestId: '../../x' }), code('bad-request-id'));
    await assert.rejects(ctx.click.challenge({ decision: 'maybe' }), code('bad-decision'));
  });

  test('the challenge is the hash of the canonical payload and the response hides the nonce', async () => {
    const c = await ask();
    assert.equal(c.publicKey.rpId, 'localhost');
    assert.equal(c.publicKey.userVerification, 'required');
    assert.equal(c.publicKey.allowCredentials.length, 1);
    assert.equal(JSON.stringify(c).includes('nonce'), false);
    assert.equal(c.summary.kind, 'go');
    // the payload is the one the hub stored: confirming a signature over this challenge works below
    assert.match(c.publicKey.challenge, /^[A-Za-z0-9_-]{43}$/);
    await assert.rejects(ctx.click.confirm({ requestId: 'req1', assertion: ctx.auth.sign(c.publicKey.challenge, { flags: FLAG_UP }) }));
  });

  test('canonical payload has a fixed key order', () => {
    const p = { kind: 'go', request_id: 'r', session_key: 's', cmd_hash: 'h', scopes: [], ms: 0, issued_at: 1, expires_at: 2, nonce: 'n' };
    const shuffled = { nonce: 'n', expires_at: 2, issued_at: 1, ms: 0, scopes: [], cmd_hash: 'h', session_key: 's', request_id: 'r', kind: 'go' };
    assert.equal(canonicalPayload(p), canonicalPayload(shuffled));
    assert.equal(challengeOf(p), challengeOf(shuffled));
    assert.match(canonicalPayload(p), /^\{"v":1,"kind":"go","request_id":"r"/);
  });

  const failures = [
    ['user presence cleared', { flags: FLAG_UV }, 'user-presence-missing'],
    ['user verification cleared', { flags: FLAG_UP }, 'user-verification-missing'],
    ['wrong rpId', { rpId: 'evil.example' }, 'wrong-rp'],
    ['wrong origin', { origin: 'http://localhost:9999' }, 'wrong-origin'],
    ['wrong ceremony type', { type: 'webauthn.create' }, 'wrong-type'],
    ['assertion for another payload', { challenge: 'AAAA' }, 'challenge-mismatch'],
  ];
  for (const [name, over, expected] of failures) {
    test(`confirm fails and writes nothing: ${name}`, async () => {
      const c = await ask();
      await assert.rejects(ctx.click.confirm({ requestId: c.requestId, assertion: ctx.auth.sign(c.publicKey.challenge, over) }), code(expected));
      assert.deepEqual(receipts(), []);
    });
  }

  test('confirm fails for a signature by another key and for a tampered signature', async () => {
    let c = await ask();
    await assert.rejects(ctx.click.confirm({ requestId: c.requestId, assertion: ctx.auth.sign(c.publicKey.challenge, { key: ctx.auth.otherKey() }) }), code('bad-signature'));
    c = await ask();
    const a = ctx.auth.sign(c.publicKey.challenge);
    const raw = Buffer.from(a.signature, 'base64url');
    raw[raw.length - 1] ^= 1;
    await assert.rejects(ctx.click.confirm({ requestId: c.requestId, assertion: { ...a, signature: raw.toString('base64url') } }), code('bad-signature'));
    assert.deepEqual(receipts(), []);
  });

  test('a challenge is single use, also after a failure', async () => {
    const c = await ask();
    await assert.rejects(ctx.click.confirm({ requestId: c.requestId, assertion: ctx.auth.sign(c.publicKey.challenge, { flags: FLAG_UP }) }));
    await assert.rejects(ctx.click.confirm({ requestId: c.requestId, assertion: ctx.auth.sign(c.publicKey.challenge) }), code('no-challenge'));
    assert.deepEqual(receipts(), []);
  });

  test('a challenge older than 60 s is refused', async () => {
    const c = await ask();
    ctx.clock.t += CHALLENGE_TTL_MS + 1;
    await assert.rejects(ctx.click.confirm({ requestId: c.requestId, assertion: ctx.auth.sign(c.publicKey.challenge) }), code('challenge-expired'));
    assert.deepEqual(receipts(), []);
  });

  test('a valid click writes one 0600 receipt; the request cannot be decided twice', async () => {
    const c = await ask();
    const assertion = ctx.auth.sign(c.publicKey.challenge, { counter: 5 });
    const done = await ctx.click.confirm({ requestId: c.requestId, assertion });
    assert.equal(done.ok, true);
    const file = path.join(ctx.st.go, 's1.click-req1.json');
    assert.deepEqual(receipts(), ['s1.click-req1.json']);
    assert.equal(mode(file), 0o600);
    const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(receipt).sort(), ['assertion', 'payload']);
    assert.equal(receipt.payload.cmd_hash, 'hash-1');
    assert.equal(receipt.payload.session_key, 's1');
    assert.equal(receipt.payload.expires_at - receipt.payload.issued_at, 10 * 60 * 1000);
    assert.equal(receipt.assertion.signature, assertion.signature);
    assert.equal(JSON.parse(fs.readFileSync(path.join(ctx.st.gate, 'trail-credential.json'), 'utf8')).signCount, 5);
    await assert.rejects(ask(), code('request-decided'));
  });

  test('the hub verifier accepts its own receipt; so does the gate verifier when WP-9 is present', async (t) => {
    const receipt = JSON.parse(fs.readFileSync(path.join(ctx.st.go, 's1.click-req1.json'), 'utf8'));
    const credential = JSON.parse(fs.readFileSync(path.join(ctx.st.gate, 'trail-credential.json'), 'utf8'));
    const args = { credential, assertion: receipt.assertion, expectedChallenge: challengeOf(receipt.payload), origin: ORIGIN, rpId: 'localhost' };
    assert.deepEqual(verifyAssertion(args), { signCount: 5 });
    const gm = await import('../.claude/hooks/go-gate.mjs');
    if (typeof gm.verifyWebAuthnAssertion !== 'function') { t.skip('verifyWebAuthnAssertion is not in this tree (WP-9)'); return; }
    // interface assumed from the plan: same argument object, `{ ok: true }` on success
    const r = await gm.verifyWebAuthnAssertion(args);
    assert.equal(r && r.ok, true);
  });

  test('a signCount that goes backwards is refused', async () => {
    const c = await ctx.click.challenge({ decision: 'grant', sessionKey: 's1', scopes: ['push-feature'], ms: 15 * 60 * 1000 });
    await assert.rejects(ctx.click.confirm({ requestId: c.requestId, assertion: ctx.auth.sign(c.publicKey.challenge, { counter: 3 }) }), code('counter-regressed'));
  });

  test('grants: validated scopes and durations, broad ones need the confirmation', async () => {
    const g = (over) => ctx.click.challenge({ decision: 'grant', sessionKey: 's1', scopes: ['push-feature'], ms: 15 * 60 * 1000, ...over });
    await assert.rejects(g({ sessionKey: 'zz' }), code('unknown-session'));
    await assert.rejects(g({ scopes: [] }), code('bad-scopes'));
    await assert.rejects(g({ scopes: ['rm-rf'] }), code('bad-scopes'));
    await assert.rejects(g({ ms: 5 * 60 * 1000 }), code('bad-duration'));
    await assert.rejects(g({ scopes: ['destructive'] }), code('broad-needs-confirmation'));
    await assert.rejects(g({ scopes: ['push-main'] }), code('broad-needs-confirmation'));
    await assert.rejects(g({ ms: 24 * 60 * 60 * 1000 }), code('broad-needs-confirmation'));
    const ok = await g({ scopes: ['push-feature', 'push-feature'], ms: 2 * 60 * 60 * 1000 });
    assert.deepEqual(ok.summary.scopes, ['push-feature']);
    const done = await ctx.click.confirm({ requestId: ok.requestId, assertion: ctx.auth.sign(ok.publicKey.challenge, { counter: 9 }) });
    assert.equal(done.kind, 'grant');
    const rec = JSON.parse(fs.readFileSync(path.join(ctx.st.go, `s1.click-${ok.requestId}.json`), 'utf8'));
    assert.equal(rec.payload.cmd_hash, '');
    assert.equal(rec.payload.expires_at - rec.payload.issued_at, 2 * 60 * 60 * 1000);
  });

  test('revoke writes a tightening marker only for a known session', async () => {
    await assert.rejects(ctx.click.revoke({ sessionKey: '../x' }), code('unknown-session'));
    await assert.rejects(ctx.click.revoke({ sessionKey: 'nope' }), code('unknown-session'));
    assert.deepEqual(await ctx.click.revoke({ sessionKey: 's1' }), { ok: true });
    const f = path.join(ctx.st.gate, 's1.revoke.json');
    assert.equal(mode(f), 0o600);
    assert.ok(Number.isFinite(Date.parse(JSON.parse(fs.readFileSync(f, 'utf8')).ts)));
  });

  test('ClickError carries a status', () => {
    assert.equal(new ClickError('x', 409).status, 409);
  });
});

// ---------------------------------------------------------------------------------
// hub: the same flow over HTTP, plus every transport failure
// ---------------------------------------------------------------------------------

const STUB = `
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = path.join(os.homedir(), '.aos', 'gate');
export const TOKEN_TTL_MS = 10 * 60 * 1000;
export const MAX_GRANT_MS = 24 * 60 * 60 * 1000;
export const SCOPES = ['push-feature', 'push-main', 'destructive'];
export const gateDir = () => dir;
export const readState = (key) => { try { return JSON.parse(fs.readFileSync(path.join(dir, key + '.json'), 'utf8')); } catch { return null; } };
export const listStateKeys = () => fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
export const gogateCommandsFor = () => [];
export const textHash = (t) => String(t);
export const effectiveGate = () => ({ mode: 'soft', grants: [], rejected: [] });
`;

const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('hub click endpoints', () => {
  let home;
  let port;
  let child;
  let csrf;
  let auth;
  let st;
  let output = '';
  const seen = [];

  const request = (opts, body) => new Promise((resolve, reject) => {
    const headers = Object.fromEntries(Object.entries(opts.headers || {}).filter(([, v]) => v !== undefined));
    const r = http.request({ host: '127.0.0.1', port, agent: false, ...opts, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    if (body !== undefined) r.write(body);
    r.end();
  });

  const post = async (route, body, over = {}) => {
    const r = await request({
      method: 'POST',
      path: `/v1/gate/${route}`,
      headers: {
        host: `localhost:${port}`,
        origin: `http://localhost:${port}`,
        'content-type': 'application/json',
        'x-trail-csrf': csrf,
        ...over,
      },
    }, typeof body === 'string' ? body : JSON.stringify(body));
    seen.push(r.body);
    let json = null;
    try { json = JSON.parse(r.body); } catch { json = null; }
    return { status: r.status, json, body: r.body, headers: r.headers };
  };

  const listing = () => ['gate', 'go'].flatMap((d) => {
    const dir = path.join(home, '.aos', d);
    return files(dir).map((f) => `${d}/${f}:${fs.statSync(path.join(dir, f)).mtimeMs}`);
  });

  const unchanged = async (fn) => {
    const before = listing();
    await fn();
    assert.deepEqual(listing(), before, 'a refused request wrote into the gate store');
  };

  const enrolViaHttp = async (a) => {
    const { code: c } = createEnrolCode({ home });
    const b = await post('enroll-begin', { code: c });
    assert.equal(b.status, 200, b.body);
    const f = await post('enroll-finish', a.register(b.json.publicKey.challenge));
    assert.equal(f.status, 200, f.body);
  };

  before(async () => {
    home = mkHome();
    st = stores(home);
    fs.mkdirSync(st.gate, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(home, 'stub-gate.mjs'), STUB);
    const now = new Date().toISOString();
    fs.writeFileSync(path.join(st.gate, 's1.json'), JSON.stringify({ transcript: '/tmp/t.jsonl', mode: 'soft' }));
    fs.writeFileSync(path.join(st.gate, 's1.req.json'), JSON.stringify([
      { id: 'req1', ts: now, session_key: 's1', session_name: 'opus', cwd: '/tmp', cmd_hash: 'hash-1', cmd_preview: 'git push origin main', scopes: ['push-main'], hard: false },
      { id: 'req2', ts: now, session_key: 's1', session_name: 'opus', cwd: '/tmp', cmd_hash: 'hash-2', cmd_preview: 'rm -rf /', scopes: ['destructive'], hard: true },
    ]));
    port = await freePort();
    auth = createSoftAuth({ origin: `http://localhost:${port}` });
    child = spawn(process.execPath, [hubBin, '--port', String(port)], {
      env: { ...process.env, HOME: home, USERPROFILE: home, AOS_TRAIL_STATE_DIR: path.join(home, '.aos', 'trail'), AOS_GOGATE_PATH: path.join(home, 'stub-gate.mjs') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    for (let i = 0; i < 80; i += 1) {
      try {
        const r = await request({ method: 'GET', path: '/whoami', headers: { host: `localhost:${port}` } });
        if (r.status === 200) break;
      } catch { /* not up yet */ }
      await sleep(100);
    }
    const page = await request({ method: 'GET', path: '/', headers: { host: `localhost:${port}` } });
    csrf = /name="csrf-token" content="([^"]+)"/.exec(page.body)[1];
  });

  after(() => { if (child) child.kill('SIGTERM'); });

  test('transport: every failure is precise and writes nothing', async () => {
    const cases = [
      ['no Origin', { origin: undefined }, 403, 'origin'],
      ['foreign Origin', { origin: 'http://evil.example' }, 403, 'origin'],
      ['null Origin', { origin: 'null' }, 403, 'origin'],
      ['Origin on 127.0.0.1', { origin: `http://127.0.0.1:${port}` }, 403, 'origin'],
      ['wrong Host', { host: 'evil.example' }, 421, undefined],
      ['127.0.0.1 Host', { host: `127.0.0.1:${port}` }, 421, undefined],
      ['no CSRF header', { 'x-trail-csrf': undefined }, 403, 'csrf'],
      ['wrong CSRF header', { 'x-trail-csrf': 'nope' }, 403, 'csrf'],
      ['cross-site fetch', { 'sec-fetch-site': 'cross-site' }, 403, 'fetch-site'],
      ['wrong content type', { 'content-type': 'text/plain' }, 415, 'content-type'],
      ['content type with charset', { 'content-type': 'application/json; charset=utf-8' }, 415, 'content-type'],
    ];
    for (const [name, over, status, error] of cases) {
      await unchanged(async () => {
        const r = await post('challenge', { decision: 'go', requestId: 'req1' }, over);
        assert.equal(r.status, status, `${name}: ${r.body}`);
        // the shared pre-checks (foreign Origin, wrong Host) answer with an empty body
        if (error && r.json) assert.equal(r.json.error, error, name);
      });
    }
  });

  test('transport: only POST, no OPTIONS, 404 for unknown routes, bad bodies', async () => {
    const get = await request({ method: 'GET', path: '/v1/gate/challenge', headers: { host: `localhost:${port}` } });
    assert.equal(get.status, 405);
    const opt = await request({ method: 'OPTIONS', path: '/v1/gate/challenge', headers: { host: `localhost:${port}`, origin: `http://localhost:${port}` } });
    assert.equal(opt.status, 405);
    assert.equal(opt.headers['access-control-allow-origin'], undefined);
    assert.equal((await post('nope', {})).status, 404);
    assert.equal((await post('constructor', {})).status, 404);
    assert.equal((await post('challenge', '{not json')).status, 400);
    assert.equal((await post('challenge', '[1]')).status, 400);
  });

  test('no credential, no challenge; responses carry no-store and a CSP', async () => {
    const r = await post('challenge', { decision: 'go', requestId: 'req1' });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'no-credential');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
  });

  test('the enrolment page is served with the CSRF token and the CSP', async () => {
    const r = await request({ method: 'GET', path: '/enroll', headers: { host: `localhost:${port}` } });
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(r.headers['content-security-policy'], /script-src 'self'/);
    assert.equal(r.body.includes('__TRAIL_CSRF__'), false);
    assert.equal(r.body.includes(csrf), true);
    assert.equal(/<script\b(?![^>]*\bsrc=)/.test(r.body), false, 'no inline script');
    const js = await request({ method: 'GET', path: '/enroll.js', headers: { host: `localhost:${port}` } });
    assert.equal(js.status, 200);
  });

  test('enrolment: no pending record, wrong code, burnt code', async () => {
    await unchanged(async () => {
      const r = await post('enroll-begin', { code: 'ABCDEFGH' });
      assert.equal(r.json.error, 'no-pending-enrolment');
    });
    createEnrolCode({ home });
    assert.equal((await post('enroll-begin', { code: 'AAAAAAAA' })).json.error, 'wrong-code');
    assert.equal((await post('enroll-begin', {})).json.error, 'wrong-code');
    assert.equal((await post('enroll-begin', { code: 'AAAAAAAA' })).json.error, 'wrong-code');
    assert.equal((await post('enroll-begin', { code: 'AAAAAAAA' })).json.error, 'no-pending-enrolment');
    assert.equal(fs.existsSync(path.join(st.gate, 'trail-credential.json')), false);
  });

  test('enrolment: a code cannot be reused and a bad attestation writes nothing', async () => {
    const { code: c } = createEnrolCode({ home });
    const b = await post('enroll-begin', { code: c });
    assert.equal(b.status, 200);
    assert.equal(b.json.publicKey.authenticatorSelection.userVerification, 'required');
    assert.equal(b.json.publicKey.attestation, 'none');
    assert.deepEqual(b.json.publicKey.pubKeyCredParams, [{ type: 'public-key', alg: -7 }]);
    assert.equal((await post('enroll-begin', { code: c })).json.error, 'code-used');
    const bad = await post('enroll-finish', auth.register('AAAA'));
    assert.equal(bad.json.error, 'challenge-mismatch');
    assert.equal(fs.existsSync(path.join(st.gate, 'trail-credential.json')), false);
  });

  test('enrolment: full flow; the credential file is 0600 and public only', async () => {
    await enrolViaHttp(auth);
    const file = path.join(st.gate, 'trail-credential.json');
    assert.equal(mode(file), 0o600);
    const cred = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(cred.publicKey.d, undefined);
    assert.deepEqual(Object.keys(cred.publicKey).sort(), ['crv', 'kty', 'x', 'y']);
  });

  test('enrolment: refused while a credential exists', async () => {
    assert.throws(() => createEnrolCode({ home }), code('already-enrolled'));
    const pendingFile = path.join(st.gate, 'trail-enroll.json');
    createEnrolCode({ home, replace: true });
    const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
    fs.writeFileSync(pendingFile, JSON.stringify({ ...pending, replace: false }));
    const r = await post('enroll-begin', { code: 'ABCDEFGH' });
    assert.equal(r.json.error, 'already-enrolled');
    fs.unlinkSync(pendingFile);
  });

  test('the model reports enrolment and nothing else about the credential', async () => {
    const m = await request({ method: 'GET', path: '/v1/model?fresh=1', headers: { host: `localhost:${port}` } });
    assert.equal(JSON.parse(m.body).gate.enrolled, true);
    const cred = JSON.parse(fs.readFileSync(path.join(st.gate, 'trail-credential.json'), 'utf8'));
    assert.equal(m.body.includes(cred.id), false);
    assert.equal(m.body.includes(cred.publicKey.x), false);
    const direct = await request({ method: 'GET', path: '/trail-credential.json', headers: { host: `localhost:${port}` } });
    assert.equal(direct.status, 404);
  });

  test('click: unknown, hard and decided requests get no challenge', async () => {
    await unchanged(async () => {
      assert.equal((await post('challenge', { decision: 'go', requestId: 'nope' })).json.error, 'unknown-request');
      const hard = await post('challenge', { decision: 'go', requestId: 'req2' });
      assert.equal(hard.status, 403);
      assert.equal(hard.json.error, 'request-hard');
    });
  });

  test('click: reused, tampered and foreign assertions are refused; the real one yields a receipt', async () => {
    let c = await post('challenge', { decision: 'go', requestId: 'req1' });
    assert.equal(c.status, 200, c.body);
    assert.equal(c.body.includes('nonce'), false);
    const requestId = c.json.requestId;
    const challenge = c.json.publicKey.challenge;

    await unchanged(async () => {
      const foreign = await post('confirm', { requestId, assertion: auth.sign(challenge, { challenge: 'AAAA' }) });
      assert.equal(foreign.json.error, 'challenge-mismatch');
      const reuse = await post('confirm', { requestId, assertion: auth.sign(challenge) });
      assert.equal(reuse.json.error, 'no-challenge', 'a challenge answers once, even after a failure');
    });

    c = await post('challenge', { decision: 'go', requestId: 'req1' });
    const a = auth.sign(c.json.publicKey.challenge);
    const sig = Buffer.from(a.signature, 'base64url');
    sig[sig.length - 1] ^= 1;
    await unchanged(async () => {
      const tampered = await post('confirm', { requestId, assertion: { ...a, signature: sig.toString('base64url') } });
      assert.equal(tampered.json.error, 'bad-signature');
    });

    c = await post('challenge', { decision: 'go', requestId: 'req1' });
    const ok = await post('confirm', { requestId, assertion: auth.sign(c.json.publicKey.challenge) });
    assert.equal(ok.status, 200, ok.body);
    assert.deepEqual(files(st.go).filter((f) => f.includes('.click-')), ['s1.click-req1.json']);
    assert.equal(mode(path.join(st.go, 's1.click-req1.json')), 0o600);

    // the receipt re-verifies with the verifier used by the round trip
    const receipt = JSON.parse(fs.readFileSync(path.join(st.go, 's1.click-req1.json'), 'utf8'));
    const credential = JSON.parse(fs.readFileSync(path.join(st.gate, 'trail-credential.json'), 'utf8'));
    verifyAssertion({ credential, assertion: receipt.assertion, expectedChallenge: challengeOf(receipt.payload), origin: `http://localhost:${port}` });

    await unchanged(async () => {
      const again = await post('challenge', { decision: 'go', requestId: 'req1' });
      assert.equal(again.json.error, 'request-decided');
    });
  });

  test('click: a grant needs the broad confirmation, then ends in a receipt', async () => {
    const noBroad = await post('challenge', { decision: 'grant', sessionKey: 's1', scopes: ['destructive'], ms: 900000 });
    assert.equal(noBroad.json.error, 'broad-needs-confirmation');
    const c = await post('challenge', { decision: 'grant', sessionKey: 's1', scopes: ['push-feature'], ms: 900000 });
    assert.equal(c.status, 200, c.body);
    const ok = await post('confirm', { requestId: c.json.requestId, assertion: auth.sign(c.json.publicKey.challenge) });
    assert.equal(ok.status, 200, ok.body);
    assert.equal(ok.json.kind, 'grant');
    assert.ok(files(st.go).includes(`s1.click-${c.json.requestId}.json`));
  });

  test('revoke needs the transport checks but no assertion', async () => {
    await unchanged(async () => {
      assert.equal((await post('revoke', { sessionKey: 's1' }, { 'x-trail-csrf': undefined })).status, 403);
      assert.equal((await post('revoke', { sessionKey: 'zz' })).json.error, 'unknown-session');
    });
    assert.equal((await post('revoke', { sessionKey: 's1' })).status, 200);
    assert.ok(files(st.gate).includes('s1.revoke.json'));
  });

  test('no response carries the credential, and the hub never logs assertions or payloads', async () => {
    const cred = JSON.parse(fs.readFileSync(path.join(st.gate, 'trail-credential.json'), 'utf8'));
    const all = seen.join('\n');
    for (const secret of [cred.publicKey.x, cred.publicKey.y, 'trail-credential']) assert.equal(all.includes(secret), false, `a response leaked ${secret}`);
    const receipt = JSON.parse(fs.readFileSync(path.join(st.go, 's1.click-req1.json'), 'utf8'));
    for (const needle of [receipt.assertion.signature, receipt.assertion.authenticatorData, receipt.assertion.clientDataJSON, receipt.payload.nonce, csrf]) {
      assert.equal(output.includes(needle), false, 'the hub logged sensitive material');
    }
  });
});
