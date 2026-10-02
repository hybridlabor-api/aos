'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', '.claude', 'hooks', 'memb-inject.mjs');
let DatabaseSync;
try { DatabaseSync = require('node:sqlite').DatabaseSync; } catch { DatabaseSync = null; }
const opts = { skip: !DatabaseSync && 'node:sqlite unavailable' };

// Synthetic HOME with a project dir named "ambient-app"; never touches the real ~/.MemBDB.
function fixture(t, rows) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memb-ambient-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const proj = path.join(home, 'work', 'ambient-app');
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  const dbPath = path.join(home, '.MemBDB', 'memb.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE memb_vectors(id TEXT PRIMARY KEY, collection TEXT, vector BLOB, payload TEXT, created_at TEXT);
           CREATE VIRTUAL TABLE memb_fts USING fts5(id, collection, content);`);
  rows.forEach((r, i) => {
    db.prepare('INSERT INTO memb_vectors (id, collection, payload) VALUES (?, ?, ?)')
      .run(`r${i}`, 'bdb_agent_memory', JSON.stringify(r));
    db.prepare('INSERT INTO memb_fts (id, collection, content) VALUES (?, ?, ?)')
      .run(`r${i}`, 'bdb_agent_memory', r.memory);
  });
  db.close();
  return { home, proj };
}

function run(home, input, env = {}) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input), encoding: 'utf8',
    env: { HOME: home, PATH: '', MEMB_USER_ID: 'ann', ...env },
  });
}

const ctxOf = (res) => JSON.parse(res.stdout).hookSpecificOutput.additionalContext;

test('project-bound rows are injected whatever the category, other projects and plain globals are not', opts, (t) => {
  const { home, proj } = fixture(t, [
    { user_id: 'ann', project_id: 'ambient-app', category: 'deployment_runbook', memory: 'Deploy with rsync to the edge box' },
    { user_id: 'ann', project_id: 'other-app', category: 'deployment_runbook', memory: 'Other project runbook step' },
    { user_id: 'ann', category: 'architecture_decisions', memory: 'Global architecture note without project' },
    { user_id: 'ann', category: 'godmode', memory: 'Ann prefers terse answers' },
  ]);
  const ctx = ctxOf(run(home, { hook_event_name: 'SessionStart', cwd: proj }));
  assert.ok(ctx.includes('Deploy with rsync to the edge box'));
  assert.ok(!ctx.includes('Other project runbook step'));
  assert.ok(!ctx.includes('Global architecture note'));
  assert.ok(ctx.includes('Ann prefers terse answers'));
});

test('at most 5 project rows, each cut to 180 chars', opts, (t) => {
  const rows = Array.from({ length: 8 }, (_, i) => ({
    user_id: 'ann', project_id: 'ambient-app', category: 'bug_fixes', memory: `row${i} ` + 'x'.repeat(400),
  }));
  const { home, proj } = fixture(t, rows);
  const lines = ctxOf(run(home, { hook_event_name: 'SessionStart', cwd: proj }))
    .split('\n').filter((l) => l.startsWith('- Project ['));
  assert.strictEqual(lines.length, 5);
  for (const l of lines) assert.strictEqual(l.slice(l.indexOf(': ') + 2).length, 180);
});

test('reads user plus MEMB_GROUP_IDS; default group applies when unset', opts, (t) => {
  const { home, proj } = fixture(t, [
    { user_id: 'ann', project_id: 'ambient-app', category: 'bug_fixes', memory: 'personal row of ann' },
    { user_id: 'crew', project_id: 'ambient-app', category: 'bug_fixes', memory: 'group row of crew' },
    { user_id: 'bdb_developer', project_id: 'ambient-app', category: 'bug_fixes', memory: 'default group row' },
    { user_id: 'zed', project_id: 'ambient-app', category: 'bug_fixes', memory: 'foreign user row' },
  ]);
  const ev = { hook_event_name: 'SessionStart', cwd: proj };
  const custom = ctxOf(run(home, ev, { MEMB_GROUP_IDS: 'crew' }));
  assert.ok(custom.includes('personal row of ann') && custom.includes('group row of crew'));
  assert.ok(!custom.includes('default group row') && !custom.includes('foreign user row'));
  const dflt = ctxOf(run(home, ev));
  assert.ok(dflt.includes('default group row') && !dflt.includes('group row of crew'));
});

test('emits only the key each harness reads, never systemMessage', opts, (t) => {
  const { home, proj } = fixture(t, [
    { user_id: 'ann', project_id: 'ambient-app', category: 'bug_fixes', memory: 'bound row for shape check' },
  ]);
  const claude = JSON.parse(run(home, { hook_event_name: 'SessionStart', cwd: proj }).stdout);
  assert.deepStrictEqual(Object.keys(claude), ['hookSpecificOutput']);
  const agy = JSON.parse(run(home, { conversationId: 'c1', workspacePaths: [proj], prompt: 'hello there' }).stdout);
  assert.deepStrictEqual(Object.keys(agy), ['injectSteps']);
});

test('agy sends identity once per conversation, later invocations recall only', opts, (t) => {
  const { home, proj } = fixture(t, [
    { user_id: 'ann', category: 'godmode', memory: 'Ann identity fact' },
    { user_id: 'ann', project_id: 'ambient-app', category: 'bug_fixes', memory: 'Cache marker needle haystack entry' },
  ]);
  const call = (conv) => run(home, { conversationId: conv, workspacePaths: [proj], prompt: 'cache marker needle haystack' });
  const first = JSON.parse(call('conv-a').stdout).injectSteps[0].ephemeralMessage;
  assert.ok(first.includes('Ann identity fact'));
  const second = JSON.parse(call('conv-a').stdout).injectSteps[0].ephemeralMessage;
  assert.ok(!second.includes('Ann identity fact') && !second.includes('- Project ['));
  assert.ok(second.includes('Domain memory:'));
  assert.ok(JSON.parse(call('conv-b').stdout).injectSteps[0].ephemeralMessage.includes('Ann identity fact'));
});
