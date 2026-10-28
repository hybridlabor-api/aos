// Cross-harness smoke (WP8): one whole run per harness with fake claude, codex, opencode, agy (and npx, ao, coop) binaries
// on PATH. The fakes only read the brief and write the report: no model, no login, no network, no real harness.
// Runs in the full suite and, on macOS, Linux and Windows 10+, in the `Fabric smoke` job of .github/workflows/ci.yml.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { CLI, ROOT, tmpProject } from './fixtures/fabric-helpers.mjs';

const GOAL = 'add a status page';
const FAKE = path.join(ROOT, 'tests', 'fixtures', 'fabric-fake-harness.mjs');
const WIN = process.platform === 'win32';
const SESSION_VARS = ['CLAUDE_SESSION_ID', 'CLAUDECODE', 'OPENCODE', 'CODEX_SANDBOX', 'CODEX_SESSION_ID', 'AGY_SESSION_ID', 'ANTIGRAVITY_SESSION_ID'];
const SESSION = { claude: { CLAUDECODE: '1' }, codex: { CODEX_SESSION_ID: '1' }, opencode: { OPENCODE: '1' }, agy: { AGY_SESSION_ID: '1' } };

// A shim per fake binary: sh script on POSIX, .cmd on Windows.
function shim(dir, name, body) {
  const file = path.join(dir, WIN ? `${name}.cmd` : name);
  if (WIN) fs.writeFileSync(file, `@"${process.execPath}" "${FAKE}" ${name} %*\r\n`);
  else fs.writeFileSync(file, `#!/bin/sh\n${body ?? `exec "${process.execPath}" "${FAKE}" ${name} "$@"`}\n`, { mode: 0o755 });
}

async function project(fn) {
  const p = tmpProject();
  const bin = path.join(p.base, 'bin');
  fs.mkdirSync(bin);
  for (const name of ['claude', 'codex', 'opencode', 'agy', 'npx', 'ao']) shim(bin, name);
  if (!WIN) shim(bin, 'coop', 'shift 3\nexec "$@"');
  try { await fn(p, bin); } finally { p.cleanup(); }
}

function run(args, p, bin, extra) {
  const env = { ...process.env };
  for (const k of SESSION_VARS) delete env[k];
  Object.assign(env, { PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: p.home, USERPROFILE: p.home, AOS_PLAN_APPROVAL: 'auto' }, extra);
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [CLI, ...args], { cwd: p.dir, env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    c.on('close', (code) => resolve({ code, stdout, stderr, lines: stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)) }));
  });
}

const log = (p) => fs.readFileSync(path.join(p.dir, 'production_artifacts', 'runs', 'r', 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const ends = (r) => r.lines.filter((l) => l.event === 'step_end');
const NODES = ['architect', 'techlead', 'human', 'ui_ux', 'engineering', 'reviewer', 'shipping'];

async function wholeRun(p, bin, harness, extraEnv = {}, driveArgs = []) {
  const started = await run(['start', '--run', 'r', '--goal', GOAL], p, bin, { ...SESSION[harness], ...extraEnv });
  assert.equal(started.code, 0, started.stderr);
  return run(['drive', '--run', 'r', ...driveArgs], p, bin, { ...SESSION[harness], ...extraEnv });
}

function assertWholeRun(p, r, harness, executorName) {
  assert.equal(r.code, 0, `${r.stderr}\n${r.stdout}`);
  assert.equal(r.lines.at(-1).phase, 'ready_to_ship');
  assert.equal(ends(r).length, 7, '7 steps');
  assert.deepEqual(ends(r).map((l) => l.step_id), NODES.map((n) => `0-${n}-1`));
  const accepted = log(p).filter((e) => e.kind === 'report_accepted');
  assert.deepEqual(accepted.map((e) => e.effective_status), Array(7).fill('ok'));
  for (const e of accepted) {
    if (e.step_id.includes('-human-')) continue;
    assert.equal(e.report.executor.harness, harness, e.step_id);
    assert.equal(e.report.executor.name, executorName, e.step_id);
  }
  assert.equal(log(p).at(-1).state.gate.tests, 'pass');
}

for (const harness of ['claude', 'codex', 'opencode']) {
  test(`smoke: a whole fabric run on ${harness}`, () => project(async (p, bin) => {
    const r = await wholeRun(p, bin, harness);
    assertWholeRun(p, r, harness, harness === 'codex' ? 'codex-exec' : 'aos-acp');
    const acpLog = path.join(p.home, '.aos', 'acp', 'fabric-r-0-architect-1.jsonl');
    assert.equal(fs.existsSync(acpLog), harness !== 'codex', harness === 'codex' ? 'codex runs through codex exec, not aos-acp' : 'aos-acp wrote its run log, so the GO-gated path ran');
    assert.match(r.stderr, /AOS_PLAN_APPROVAL=auto/, 'the skipped human verdict is announced');
  }));
}

test('smoke: a whole fabric run on agy, inside a sandbox', { skip: WIN && 'the coop sandbox needs macOS or Linux' }, () => project(async (p, bin) => {
  const r = await wholeRun(p, bin, 'agy', { AOS_FABRIC_SANDBOX: 'coop', AOS_SANDBOX_COOP_CMD: 'coop run {cwd} -- {cmd}' });
  assertWholeRun(p, r, 'agy', 'aos-acp');
  assert.ok(fs.existsSync(path.join(p.home, '.aos', 'acp', 'fabric-r-0-architect-1.jsonl')));
}));

test('smoke: agy cannot limit its write paths, so a writing step without a sandbox is refused and the run escalates', () => project(async (p, bin) => {
  const r = await wholeRun(p, bin, 'agy');
  assert.equal(r.code, 6);
  assert.equal(r.lines.at(-1).phase, 'escalated');
  assert.match(r.lines.at(-1).reason, /architect gave no usable result in 2 attempts: agy cannot limit its write paths/);
  assert.deepEqual(log(p).filter((e) => e.kind === 'report_accepted').map((e) => e.report.findings[0].id), ['agy-scope', 'agy-scope']);
}));

test('smoke: --executor ao without a reachable AO falls back to aos-acp and says so once in the log', () => project(async (p, bin) => {
  fs.mkdirSync(path.join(p.home, '.aos'), { recursive: true });
  fs.writeFileSync(path.join(p.home, '.aos', 'endpoints.json'), JSON.stringify({ schema: 1, services: { ao: { url: 'http://127.0.0.1:1', port: 1, status: 'down' } } }));
  const r = await wholeRun(p, bin, 'claude', {}, ['--executor', 'ao']);
  assertWholeRun(p, r, 'claude', 'aos-acp');
  const notes = log(p).filter((e) => e.kind === 'note');
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /AO was requested but the AO daemon is not reachable/);
}));

test('smoke: --executor ao with AO up hands the same brief and report path to an AO worker', () => project(async (p, bin) => {
  const server = http.createServer((req, res) => { res.statusCode = req.url === '/health' ? 200 : 404; res.end('ok'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    fs.mkdirSync(path.join(p.home, '.aos'), { recursive: true });
    const url = `http://127.0.0.1:${server.address().port}`;
    fs.writeFileSync(path.join(p.home, '.aos', 'endpoints.json'), JSON.stringify({ schema: 1, services: { ao: { url, port: server.address().port, status: 'up' } } }));
    const r = await wholeRun(p, bin, 'claude', {}, ['--executor', 'ao']);
    assertWholeRun(p, r, 'claude', 'ao');
    assert.equal(log(p).filter((e) => e.kind === 'note').length, 0, 'no fallback note when AO is used');
    const mine = r.lines.filter((l) => ['step_start', 'step_end'].includes(l.event) && l.step_id !== undefined && l.node !== 'human');
    assert.ok(mine.some((l) => l.event === 'step_start' && l.ao_session_id === 'x1'), 'step_start carries the AO session id');
    assert.ok(mine.some((l) => l.event === 'step_end' && l.ao_session_id === 'x1'), 'step_end carries the AO session id');
  } finally { server.close(); }
}));

test('smoke: --executor ao with an old ao (no --workdir) runs on aos-acp, never spawns ao, and says why', () => project(async (p, bin) => {
  const server = http.createServer((req, res) => { res.statusCode = req.url === '/health' ? 200 : 404; res.end('ok'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    fs.mkdirSync(path.join(p.home, '.aos'), { recursive: true });
    fs.writeFileSync(path.join(p.home, '.aos', 'endpoints.json'), JSON.stringify({ schema: 1, services: { ao: { url: `http://127.0.0.1:${server.address().port}`, port: server.address().port, status: 'up' } } }));
    const r = await wholeRun(p, bin, 'claude', { AOS_FAKE_AO_OLD: '1' }, ['--executor', 'ao']);
    assertWholeRun(p, r, 'claude', 'aos-acp');
    const notes = log(p).filter((e) => e.kind === 'note');
    assert.equal(notes.length, 1);
    assert.match(notes[0].text, /ao ao 0\.0\.0-fake lacks --workdir; use --executor aos-acp or update AO/);
  } finally { server.close(); }
}));
