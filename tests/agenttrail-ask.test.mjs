/**
 * tests/agenttrail-ask.test.mjs
 *
 * End-to-end test for the agenttrail ask/answer flow + CSRF hardening
 * (production_artifacts/00_execution_plan.md, component {#ask-tests}).
 *
 * Boots a REAL daemon (skills/global_config/agenttrail/bin/agenttrail.mjs) on a
 * mktemp scratch repo and its own port in 5390-5399 — never the user's daemons
 * on 5330/5331 — then asserts, per the plan:
 *   1. POST /answer with content-type: text/plain                → rejected
 *   2. POST /answer with valid JSON but Origin: http://evil.example → rejected
 *   3. POST /ask + POST /answer (valid JSON + the map's own origin)
 *      → GET /ask/<id> returns status 'go'
 *   4. a question created with a 1s timeout expires to status 'deny' + expired:true
 *   5. the decisions log carries timestamped entries for both the human
 *      answer and the timeout
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const AGENTTRAIL_BIN = path.join(REPO_ROOT, 'skills', 'global_config', 'agenttrail', 'bin', 'agenttrail.mjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Shared harness state
let tmpRepo = null;
let child = null;
let stdoutBuf = '';
let stderrBuf = '';
let daemonPort = 0;
let base = '';
let askAId = null; // the question the human (browser-simulating fetch) answers
let askBId = null; // the question that times out
const Q_GO = 'Start the build phase?';
const Q_TIMEOUT = 'Ship worker 2?';

function stderrTail() {
  return stderrBuf.split('\n').filter(Boolean).slice(-6).join('\n');
}

// Pick a free port inside 5390-5399 (5399 first, per the plan) so this test
// never collides with the user's live daemons on 5330-5344.
function probeFreePort(start = 5399, floor = 5390) {
  return new Promise((resolve) => {
    const tryPort = (p) => {
      if (p < floor) return resolve(5399); // all taken: the daemon's own port fallback + parsed startup line still make this test correct
      const srv = net.createServer();
      srv.once('error', () => { srv.close(() => tryPort(p - 1)); });
      srv.listen(p, '127.0.0.1', () => srv.close(() => resolve(p)));
    };
    tryPort(start);
  });
}

// Parse the real port from the startup line `agenttrail · <project> · http://localhost:<port>`
// printed by onListen, then wait until GET /whoami answers for THIS repo.
async function waitReady() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      assert.fail(`daemon exited early (code ${child.exitCode}):\n${stderrTail()}`);
    }
    const m = stdoutBuf.match(/http:\/\/localhost:(\d+)/);
    if (m) {
      daemonPort = Number(m[1]);
      base = `http://127.0.0.1:${daemonPort}`;
      try {
        const r = await fetch(`${base}/whoami`, { signal: AbortSignal.timeout(1000) });
        const j = await r.json();
        if (j && j.repoPath === tmpRepo) return;
      } catch { /* not up yet — retry */ }
    }
    await sleep(250);
  }
  assert.fail(`daemon not ready within 20s\nstdout:\n${stdoutBuf}\nstderr:\n${stderrTail()}`);
}

async function createAsk(question, timeoutMs) {
  const r = await fetch(`${base}/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, timeoutMs }),
    signal: AbortSignal.timeout(3000),
  });
  assert.ok(r.ok, `POST /ask failed: ${r.status}`);
  const j = await r.json();
  assert.ok(j && j.id, `POST /ask must return an id (got ${JSON.stringify(j)})`);
  return j.id;
}

// Simulates the map's button fetch (own-origin JSON) or an attack (wrong content-type / foreign origin).
function postAnswer(id, decision, { contentType = 'application/json', origin = null } = {}) {
  const headers = { 'content-type': contentType };
  if (origin) headers.origin = origin;
  return fetch(`${base}/answer`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id, decision }),
    signal: AbortSignal.timeout(3000),
  });
}

async function getAsk(id) {
  const r = await fetch(`${base}/ask/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(3000) });
  assert.ok(r.ok, `GET /ask/${id} failed: ${r.status}`);
  const j = await r.json(); // the daemon answers { ok, ask, decisions }
  return { ...j.ask, decisions: j.decisions };
}

describe('agenttrail ask/answer flow + CSRF ({#ask-tests})', () => {
  before(async () => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttrail-ask-'));
    fs.writeFileSync(path.join(tmpRepo, 'PLAN.md'), [
      '# Ask Test Repo',
      '',
      '## Ship the thing {#ship}',
      'tech: minimal map for the ask-flow test',
      '- [ ] Ask the human {#ask-the-human}',
      '',
      '## decisions',
      '',
    ].join('\n'));
    const port = await probeFreePort();
    child = spawn(process.execPath, [AGENTTRAIL_BIN, tmpRepo, '--port', String(port), '--no-open'], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (c) => { stdoutBuf += c; });
    child.stderr.on('data', (c) => { stderrBuf += c; });
    await waitReady();
  });

  after(async () => {
    // Stop ONLY our own daemon, then remove only our own artifacts.
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      const end = Date.now() + 3000;
      while (child.exitCode === null && Date.now() < end) await sleep(100);
      if (child.exitCode === null) { try { child.kill('SIGKILL'); } catch {} }
    }
    try {
      if (tmpRepo) {
        // Same key the daemon uses for its state file: ~/.agenttrail/<sha1(repo).slice(0,12)>.json
        const hash = crypto.createHash('sha1').update(tmpRepo).digest('hex').slice(0, 12);
        fs.rmSync(path.join(os.homedir(), '.agenttrail', `${hash}.json`), { force: true });
      }
    } catch {}
    try { if (tmpRepo) fs.rmSync(tmpRepo, { recursive: true, force: true }); } catch {}
  });

  // Belt and braces: never leak our daemon even on a hard crash.
  process.on('exit', () => { try { if (child && child.exitCode === null) child.kill('SIGKILL'); } catch {} });

  test('POST /answer rejects a non-JSON content-type (text/plain)', async () => {
    askAId = await createAsk(Q_GO, 30 * 60 * 1000);
    const r = await postAnswer(askAId, 'go', { contentType: 'text/plain' });
    assert.ok(!r.ok, `expected rejection for content-type text/plain, got ${r.status}`);
  });

  test('POST /answer rejects a foreign Origin header (http://evil.example)', async () => {
    const r = await postAnswer(askAId, 'go', { origin: 'http://evil.example' });
    assert.ok(!r.ok, `expected rejection for foreign origin, got ${r.status}`);
    const j = await getAsk(askAId);
    assert.strictEqual(j.status, 'pending', 'a rejected answer must not decide the question');
  });

  test('valid JSON + the map\'s own origin answers go ({#ask-answer})', async () => {
    const r = await postAnswer(askAId, 'go', { origin: `http://localhost:${daemonPort}` });
    assert.ok(r.ok, `POST /answer with the map's own origin failed: ${r.status}`);
    const j = await getAsk(askAId);
    assert.strictEqual(j.status, 'go', `expected status 'go', got ${JSON.stringify(j.status)}`);
  });

  test('a question with a 1s timeout expires to status deny + expired:true ({#ask-routes})', async () => {
    askBId = await createAsk(Q_TIMEOUT, 1000);
    const deadline = Date.now() + 10000;
    let j = null;
    while (Date.now() < deadline) {
      j = await getAsk(askBId);
      if (j.status !== 'pending') break;
      await sleep(500);
    }
    assert.ok(j, 'GET /ask/<id> kept responding');
    assert.strictEqual(j.status, 'deny', `expired question must deny, got ${JSON.stringify(j.status)}`);
    assert.strictEqual(j.expired, true, 'expired question must carry expired:true');
  });

  test('decisions log carries timestamped entries for the human answer and the timeout', async () => {
    const j = await getAsk(askAId);
    const log = j.decisions;
    assert.ok(Array.isArray(log), 'GET /ask/<id> returns the decisions log');
    const human = log.find((d) => d && d.by === 'you' && d.decision === 'go' && String(d.question || '').includes(Q_GO));
    assert.ok(human, 'the human go decision is logged');
    assert.ok(!Number.isNaN(new Date(human.at).getTime()), `human decision carries a timestamp, got ${JSON.stringify(human.at)}`);
    const timedOut = log.find((d) => d && d.by === 'timeout' && d.decision === 'deny' && String(d.question || '').includes(Q_TIMEOUT));
    assert.ok(timedOut, 'the timeout deny decision is logged');
    assert.ok(!Number.isNaN(new Date(timedOut.at).getTime()), `timeout decision carries a timestamp, got ${JSON.stringify(timedOut.at)}`);
  });
});
