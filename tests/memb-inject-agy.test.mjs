import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { agyIdentitySent, stampAgyIdentity } from '../.claude/hooks/memb-inject.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_SRC = path.resolve(__dirname, '..', '.claude', 'hooks', 'memb-inject.mjs');

let DatabaseSync;
try {
  DatabaseSync = (await import('node:sqlite')).DatabaseSync;
} catch {
  DatabaseSync = null;
}

test('agyIdentitySent and stampAgyIdentity unit behavior', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cache-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  assert.equal(agyIdentitySent(''), false);
  assert.equal(stampAgyIdentity(''), false);

  assert.equal(agyIdentitySent('conv-1', tmp), false);
  assert.equal(stampAgyIdentity('conv-1', tmp), true);
  assert.equal(agyIdentitySent('conv-1', tmp), true);
});

test('A2: agy does not stamp when memory block is null (missing db)', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const proj = path.join(home, 'proj');
  fs.mkdirSync(proj, { recursive: true });

  const res = spawnSync(process.execPath, [HOOK_SRC], {
    input: JSON.stringify({ conversationId: 'conv-null', workspacePaths: [proj], prompt: 'hello' }),
    encoding: 'utf8',
    env: { HOME: home, PATH: process.env.PATH },
  });

  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), '');

  const cacheDir = path.join(home, '.aos', 'cache', 'memb-agy');
  const stamp = path.join(cacheDir, 'conv-null');
  assert.equal(fs.existsSync(stamp), false, 'stamp must not be written when memoryBlock is null');
});

test('A2: agy stamps only after memory block is delivered and then switches to recall only', { skip: !DatabaseSync && 'node:sqlite unavailable' }, (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-home-db-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const proj = path.join(home, 'proj');
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });

  const dbDir = path.join(home, '.MemBDB');
  fs.mkdirSync(dbDir, { recursive: true });
  const db = new DatabaseSync(path.join(dbDir, 'memb.db'));
  db.exec(`
    CREATE TABLE memb_vectors(id TEXT PRIMARY KEY, collection TEXT, vector BLOB, payload TEXT, created_at TEXT);
    CREATE VIRTUAL TABLE memb_fts USING fts5(id, collection, content);
  `);
  const row = { category: 'godmode', memory: 'Agy user identity fact' };
  db.prepare('INSERT INTO memb_vectors (id, collection, payload) VALUES (?, ?, ?)')
    .run('r1', 'bdb_agent_memory', JSON.stringify(row));
  db.prepare('INSERT INTO memb_fts (id, collection, content) VALUES (?, ?, ?)')
    .run('r1', 'bdb_agent_memory', row.memory);
  db.close();

  const stamp = path.join(home, '.aos', 'cache', 'memb-agy', 'conv-success');
  assert.equal(fs.existsSync(stamp), false);

  // Turn 1: Delivered and stamped
  const res1 = spawnSync(process.execPath, [HOOK_SRC], {
    input: JSON.stringify({ conversationId: 'conv-success', workspacePaths: [proj], prompt: 'hello world' }),
    encoding: 'utf8',
    env: { HOME: home, PATH: process.env.PATH, MEMB_USER_ID: 'user' },
  });
  assert.equal(res1.status, 0);
  assert.ok(res1.stdout.includes('Agy user identity fact'));
  assert.equal(fs.existsSync(stamp), true, 'stamp must exist after non-null delivery');

  // Turn 2: Recall only (identity dropped)
  const res2 = spawnSync(process.execPath, [HOOK_SRC], {
    input: JSON.stringify({ conversationId: 'conv-success', workspacePaths: [proj], prompt: 'different words' }),
    encoding: 'utf8',
    env: { HOME: home, PATH: process.env.PATH, MEMB_USER_ID: 'user' },
  });
  assert.equal(res2.status, 0);
  assert.equal(res2.stdout.trim(), '', 'no fts match on turn 2 should mean no output');
});
