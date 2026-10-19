import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hook = (f) => path.join(root, '.claude', 'hooks', f);
const { HARNESS_HOOKS } = createRequire(import.meta.url)('../lib/v5/profile.js');

const run = (script, home, input) => spawnSync(process.execPath, [hook(script)], {
  input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, AOS_TEST_SANDBOX: '1' },
});
const tmpHome = (t) => { const h = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-boot-')); t.after(() => fs.rmSync(h, { recursive: true, force: true })); return h; };

test('memb-inject creates an empty memb.db with the memB schema and injects the write hint', async (t) => {
  const { DatabaseSync } = await import('node:sqlite');
  const home = tmpHome(t);
  const proj = path.join(home, 'proj'); fs.mkdirSync(proj);
  const r = run('memb-inject.mjs', home, { hook_event_name: 'SessionStart', cwd: proj });
  assert.equal(r.status, 0, r.stderr);
  const db = new DatabaseSync(path.join(home, '.MemBDB', 'memb.db'), { readOnly: true });
  const names = db.prepare("SELECT name FROM sqlite_master WHERE name IN ('memb_vectors','memb_fts','idx_memb_col')").all().map((x) => x.name).sort();
  db.close();
  assert.deepEqual(names, ['idx_memb_col', 'memb_fts', 'memb_vectors']);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /memb_mcp add_memory/);
});

test('memb-inject leaves an existing memb.db untouched and stays silent on UserPromptSubmit', (t) => {
  const home = tmpHome(t);
  const r = run('memb-inject.mjs', home, { hook_event_name: 'UserPromptSubmit', cwd: home, prompt: 'hello there' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.includes('add_memory'), false);
});

test('aos-session-hint: Claude SessionStart shape', (t) => {
  const r = run('aos-session-hint.mjs', tmpHome(t), { hook_event_name: 'SessionStart' });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.hookEventName, 'SessionStart');
});

test('aos-session-hint: agy gets the hint on the first invocation of a conversation only', (t) => {
  const home = tmpHome(t);
  const input = { conversationId: 'c1', workspacePaths: [home] };
  const first = JSON.parse(run('aos-session-hint.mjs', home, input).stdout);
  assert.match(first.injectSteps[0].ephemeralMessage, /plan-canvas/);
  assert.equal(run('aos-session-hint.mjs', home, input).stdout, '');
});

test('agy and OpenCode are wired for the session hint', () => {
  assert.ok(HARNESS_HOOKS.agy.includes('aos-session-hint.mjs'));
  const plugin = fs.readFileSync(path.join(root, '.opencode', 'plugins', 'bdb-aos.js'), 'utf8');
  assert.match(plugin, /aos-session-hint\.mjs/);
  assert.match(plugin, /await buildHint\(\)/);
  assert.match(fs.readFileSync(path.join(root, 'installer.js'), 'utf8'), /obs\(globalHooksDir, 'aos-session-hint\.mjs'\)/);
});
