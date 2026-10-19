import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scrub, summarize, disabled, firstTime, membMcpDir } from '../.claude/hooks/memb-session-save.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { resolveMembLlm } = require('../lib/memb-llm.js');
const { wrapServer } = require('../lib/mcp-secrets.js');
const nightly = require('../lib/memb-nightly.js');
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-auto-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

const line = (type, text) => JSON.stringify({ type, message: { content: [{ type: 'text', text }] } });
const transcript = (turns, last) => [...Array.from({ length: turns }, (_, i) => `${line('user', `question ${i}`)}\n${line('assistant', `answer ${i}`)}`), line('assistant', last)].join('\n');

test('scrub drops env-like lines and redacts token shapes', () => {
  const out = scrub('keep me\nGITHUB_TOKEN=abc123\nuse ghp_abcdefghijklmnop1234 and Bearer abcdefghijklmnopqrstu now');
  assert.match(out, /keep me/);
  assert.doesNotMatch(out, /GITHUB_TOKEN|ghp_|abcdefghijklmnopqrstu/);
});

test('summarize: skips short sessions and thin outcomes, keeps task and outcome otherwise', () => {
  const long = 'Decided to use X because Y. '.repeat(15);
  assert.equal(summarize(transcript(2, long)), null);
  assert.equal(summarize(transcript(5, 'done')), null);
  const s = summarize(transcript(5, long + '\nAPI_KEY=secretvalue'));
  assert.match(s, /^Session summary\. Task: question 0 Outcome: Decided to use X/);
  assert.doesNotMatch(s, /secretvalue/);
});

test('switches: env and v5-settings memorySave=off disable the save', (t) => {
  const home = tmp(t);
  assert.equal(disabled({}, home), false);
  assert.equal(disabled({ AOS_MEMB_AUTOSAVE: 'off' }, home), true);
  assert.equal(disabled({ AOS_SESSION_START_CONTEXT: 'off' }, home), true);
  assert.equal(disabled({ AOS_DELEGATE_DEPTH: '1' }, home), true);
  write(path.join(home, '.aos', 'v5-settings.json'), '{"memorySave":"off"}');
  assert.equal(disabled({}, home), true);
});

test('dedupe: a session id is saved once', (t) => {
  const base = tmp(t);
  assert.equal(firstTime('s1', base), true);
  assert.equal(firstTime('s1', base), false);
  assert.equal(firstTime('', base), false);
});

test('membMcpDir finds the venv python next to run.py', (t) => {
  const home = tmp(t);
  assert.equal(membMcpDir(home, {}), null);
  const d = path.join(home, '.gemini', 'config', 'mcps', 'memb-mcp');
  const py = path.join(d, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
  write(py, ''); write(path.join(d, 'run.py'), '');
  assert.equal(membMcpDir(home, {}).dir, d);
});

test('hook never fails the session: garbage stdin and missing transcript exit 0 and write nothing', (t) => {
  const home = tmp(t);
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const hook = path.join(root, '.claude', 'hooks', 'memb-session-save.mjs');
  assert.equal(spawnSync(process.execPath, [hook], { input: 'not json', env }).status, 0);
  const r = spawnSync(process.execPath, [hook], { input: JSON.stringify({ session_id: 'x', transcript_path: path.join(home, 'none') }), env });
  assert.equal(r.status, 0);
  assert.equal(fs.existsSync(path.join(home, '.aos', 'cache', 'memb-save')), false);
});

test('memb-llm follows the OpenWiki provider; MEMB_LLM_* in secrets.env pins it', (t) => {
  const home = tmp(t);
  assert.deepEqual(resolveMembLlm({ home, env: {} }), {});
  write(path.join(home, '.openwiki', '.env'), 'OPENWIKI_PROVIDER=openrouter\nOPENWIKI_MODEL_ID=google/gemini-2.5-flash\nOPENROUTER_API_KEY=or-key\nGEMINI_API_KEY=g-key\n');
  const r = resolveMembLlm({ home, env: {} });
  assert.deepEqual([r.MEMB_LLM_PROVIDER, r.MEMB_LLM_MODEL, r.MEMB_LLM_API_KEY, r.MEMB_LLM_BASE_URL, r.GEMINI_API_KEY], ['openai', 'google/gemini-2.5-flash', 'or-key', 'https://openrouter.ai/api/v1', 'g-key']);
  write(path.join(home, '.aos', 'secrets.env'), 'MEMB_LLM_PROVIDER=anthropic\nMEMB_LLM_MODEL=claude-haiku\nMEMB_LLM_API_KEY=a-key\n');
  fs.chmodSync(path.join(home, '.aos', 'secrets.env'), 0o600);
  const p = resolveMembLlm({ home, env: {} });
  assert.deepEqual([p.MEMB_LLM_PROVIDER, p.MEMB_LLM_MODEL, p.MEMB_LLM_API_KEY, p.MEMB_LLM_BASE_URL], ['anthropic', 'claude-haiku', 'a-key', undefined]);
});

test('memb-llm: a Gemini-only OpenWiki setup still yields GEMINI_API_KEY for the current memB', (t) => {
  const home = tmp(t);
  write(path.join(home, '.openwiki', '.env'), 'GEMINI_API_KEY=g-key\n');
  assert.equal(resolveMembLlm({ home, env: {} }).GEMINI_API_KEY, 'g-key');
});

test('memb_mcp launcher entry carries --memb-llm, other servers do not', () => {
  const l = '/h/.agents/bin/aos-mcp-env.mjs';
  assert.ok(wrapServer('memb_mcp', { command: 'python', args: ['run.py'], env: { GEMINI_API_KEY: '__GEMINI_API_KEY__' } }, l).args.includes('--memb-llm'));
  assert.ok(!wrapServer('github', { command: 'npx', args: ['x'], env: { GITHUB_TOKEN: 'ghp_x' } }, l).args.includes('--memb-llm'));
});

test('nightly job: plist has a calendar interval and the ingest script; Linux gets service plus timer', async (t) => {
  const home = tmp(t);
  const mac = await nightly.install({ home, platform: 'darwin', node: '/usr/bin/node' });
  const xml = fs.readFileSync(mac.file, 'utf8');
  assert.match(xml, /com\.bdb\.memb\.ingest/);
  assert.match(xml, /StartCalendarInterval/);
  assert.ok(xml.includes(path.join(home, '.agents', 'bin', 'aos-memb-ingest.mjs')));
  const lin = await nightly.install({ home, platform: 'linux', node: '/usr/bin/node' });
  assert.match(fs.readFileSync(lin.file, 'utf8'), /OnUnitActiveSec=24h/);
  assert.match(fs.readFileSync(lin.file.replace('.timer', '.service'), 'utf8'), /Type=oneshot/);
});

test('aos-memb-ingest: lists projects (no worktrees) with --dry-run, and is off when memb is excluded', (t) => {
  const home = tmp(t);
  const ws = path.join(home, 'dev', 'bdb-dev');
  for (const p of ['alpha', 'beta-wt-x', 'plain']) fs.mkdirSync(path.join(ws, p), { recursive: true });
  write(path.join(ws, 'alpha', 'AGENTS.md'), ''); write(path.join(ws, 'beta-wt-x', 'AGENTS.md'), '');
  const mcp = path.join(home, '.agents', 'memB');
  write(path.join(mcp, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python'), '');
  write(path.join(mcp, 'memb_ingest.py'), '');
  const run = () => spawnSync(process.execPath, [path.join(root, 'bin', 'aos-memb-ingest.mjs'), '--dry-run'], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  const on = run();
  assert.match(on.stdout, /would ingest .*alpha/);
  assert.doesNotMatch(on.stdout, /beta-wt-x|plain/);
  write(path.join(home, '.aos', 'v5-settings.json'), '{"disabled":["memb"]}');
  assert.match(run().stdout, /off/);
});
