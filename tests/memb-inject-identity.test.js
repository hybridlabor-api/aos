'use strict';

/**
 * tests/memb-inject-identity.test.js
 *
 * The owner's identity layer lives in memB as global `godmode` rows with no
 * project id. Hook v5 injects them exactly once per session (SessionStart),
 * never on every prompt; UserPromptSubmit recalls FTS hits only.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const HOOK_SRC = path.join(REPO_ROOT, '.claude', 'hooks', 'memb-inject.mjs');

// Keep the fixture in lockstep with the collection the hook actually queries.
const COLLECTION = (fs.readFileSync(HOOK_SRC, 'utf8').match(/^const COLLECTION = '([^']+)';/m) || [])[1]
  || 'bdb_agent_memory';

let DatabaseSync;
try { DatabaseSync = require('node:sqlite').DatabaseSync; } catch { DatabaseSync = null; }

// Throwaway HOME with a .MemBDB/memb.db in the schema the hook queries.
// The real ~/.MemBDB is never read or written.
function makeHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memb-identity-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const dbPath = path.join(home, '.MemBDB', 'memb.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE memb_vectors(id TEXT PRIMARY KEY, collection TEXT, vector BLOB, payload TEXT, created_at TEXT);
    CREATE VIRTUAL TABLE memb_fts USING fts5(id, collection, content);
  `);

  const rows = [
    { id: 'identity-global', payload: { category: 'godmode', memory: 'Tim runs Hybridlabor Global LLC' } },
    { id: 'identity-other', payload: { category: 'godmode', project_id: 'other', memory: 'Other project identity fact' } },
    { id: 'identity-chunk', payload: { category: 'godmode', memory: '[x | README.md | y] text' } },
  ];
  for (const r of rows) {
    db.prepare('INSERT INTO memb_vectors (id, collection, payload) VALUES (?, ?, ?)')
      .run(r.id, COLLECTION, JSON.stringify(r.payload));
    db.prepare('INSERT INTO memb_fts (id, collection, content) VALUES (?, ?, ?)')
      .run(r.id, COLLECTION, String(r.payload.memory || ''));
  }
  db.close();
  return home;
}

function runHook(home, eventData) {
  return spawnSync(process.execPath, [HOOK_SRC], {
    input: JSON.stringify(eventData),
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  });
}

test('SessionStart injects the global identity layer once, scoped and chunk-free', { skip: !DatabaseSync && 'node:sqlite unavailable' }, (t) => {
  const home = makeHome(t);
  const res = runHook(home, { hook_event_name: 'SessionStart', prompt: '', cwd: home });

  assert.strictEqual(res.status, 0, `hook must exit 0, stderr: ${res.stderr}`);
  const out = JSON.parse(res.stdout);
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'SessionStart');

  const context = out.hookSpecificOutput.additionalContext;
  assert.ok(context.includes('Tim runs Hybridlabor Global LLC'), 'global godmode row must be injected');
  assert.ok(!context.includes('Other project identity fact'), 'godmode row bound to another project must stay out');
  assert.ok(!context.includes('[x | README.md | y]'), 'raw import chunks must be skipped');
  assert.ok(!context.includes('Domain memory:'), 'SessionStart must skip the FTS recall step');
});

test('UserPromptSubmit recalls FTS hits only and prints nothing without any', { skip: !DatabaseSync && 'node:sqlite unavailable' }, (t) => {
  const home = makeHome(t);
  const res = runHook(home, { hook_event_name: 'UserPromptSubmit', prompt: 'zzqq yyxx', cwd: home });

  assert.strictEqual(res.status, 0, `hook must exit 0, stderr: ${res.stderr}`);
  assert.strictEqual(res.stdout.trim(), '', 'no FTS hits must mean no output');
});
