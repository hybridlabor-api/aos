'use strict';

/**
 * tests/memb-prompt-recall.test.js
 *
 * Per-prompt semantic recall (memory.promptRecall): time budget and timeout
 * skip, relevance threshold, dedupe against full-text hits, the off and
 * fulltext switches, and the standing memB rule injected once at SessionStart.
 * A fake memB venv (a shell script) stands in for the real engine; every run
 * uses a throwaway HOME, never the real one.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const HOOK_SRC = path.join(REPO_ROOT, '.claude', 'hooks', 'memb-inject.mjs');
const RULE_TEXT = 'query memB first (memb search / the memB MCP tool), then answer.';
const POSIX = process.platform !== 'win32';

let DatabaseSync;
try { DatabaseSync = require('node:sqlite').DatabaseSync; } catch { DatabaseSync = null; }

const load = () => import('../.claude/hooks/memb-inject.mjs');

// Throwaway HOME with an empty-but-valid memB store, a memB engine dir and a fake venv python.
function makeHome(t, { fakePython = null, settings = null, rows = [] } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memb-recall-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const dbPath = path.join(home, '.MemBDB', 'memb.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE memb_vectors(id TEXT PRIMARY KEY, collection TEXT, vector BLOB, payload TEXT, created_at TEXT);
    CREATE VIRTUAL TABLE memb_fts USING fts5(id, collection, content);
  `);
  for (const r of rows) {
    db.prepare('INSERT INTO memb_vectors (id, collection, payload) VALUES (?, ?, ?)')
      .run(r.id, 'bdb_agent_memory', JSON.stringify(r.payload));
    db.prepare('INSERT INTO memb_fts (id, collection, content) VALUES (?, ?, ?)')
      .run(r.id, 'bdb_agent_memory', String(r.payload.memory || ''));
  }
  db.close();

  if (fakePython) {
    const engine = path.join(home, '.agents', 'memB');
    fs.mkdirSync(path.join(engine, '.venv', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(engine, 'run.py'), '# fake engine marker\n');
    const py = path.join(engine, '.venv', 'bin', 'python');
    fs.writeFileSync(py, fakePython, { mode: 0o755 });
  }
  if (settings) {
    fs.mkdirSync(path.join(home, '.aos'), { recursive: true });
    fs.writeFileSync(path.join(home, '.aos', 'v5-settings.json'), JSON.stringify(settings));
  }
  return home;
}

function runHook(home, eventData) {
  const started = Date.now();
  const res = spawnSync(process.execPath, [HOOK_SRC], {
    input: JSON.stringify(eventData),
    env: { ...process.env, HOME: home, USER: 'tester', MEMB_USER_ID: 'tester', MEMB_MCP_DIR: '' },
    encoding: 'utf8',
    timeout: 15000,
  });
  return { ...res, elapsed: Date.now() - started, context: parseContext(res.stdout) };
}

function parseContext(stdout) {
  try { return JSON.parse(stdout).hookSpecificOutput.additionalContext; } catch { return ''; }
}

const PROMPT = 'what colors do we use for projects Hybridlabor Global';
const FACT = 'Hybridlabor Global LLC runs the projects portfolio';
const FAKE_HITS = (rows) => `#!/bin/sh\ncat >/dev/null\ncat <<'EOF'\n${JSON.stringify(rows)}\nEOF\n`;
const SEEDED_ROWS = [{ id: 'fact-1', payload: { category: 'godmode', memory: FACT } }];

test('promptRecallMode defaults to semantic, honours settings, ignores unknown values', async () => {
  const { promptRecallMode } = await load();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memb-mode-'));
  try {
    assert.strictEqual(promptRecallMode(home), 'semantic');
    fs.mkdirSync(path.join(home, '.aos'));
    const f = path.join(home, '.aos', 'v5-settings.json');
    fs.writeFileSync(f, JSON.stringify({ memory: { promptRecall: 'fulltext' } }));
    assert.strictEqual(promptRecallMode(home), 'fulltext');
    fs.writeFileSync(f, JSON.stringify({ memory: { promptRecall: 'off' } }));
    assert.strictEqual(promptRecallMode(home), 'off');
    fs.writeFileSync(f, JSON.stringify({ memory: { promptRecall: 'everything' } }));
    assert.strictEqual(promptRecallMode(home), 'semantic');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('isTrivialPrompt skips short prompts and slash commands only', async () => {
  const { isTrivialPrompt } = await load();
  assert.ok(isTrivialPrompt('/clear'));
  assert.ok(isTrivialPrompt('ok thanks'));
  assert.ok(!isTrivialPrompt('what do you know about company X'));
});

test('semanticRecall keeps only hits at or above the threshold and passes the budget as timeout', async () => {
  const { semanticRecall, SEMANTIC_BUDGET_MS } = await load();
  let seen;
  const run = (cmd, args, opts) => {
    seen = { cmd, args, opts };
    return { status: 0, stdout: JSON.stringify([{ memory: 'strong', score: 0.9 }, { memory: 'weak', score: 0.2 }, { memory: '', score: 0.99 }]) };
  };
  const hits = semanticRecall({ prompt: 'colors please', python: '/py', helper: '/h.py', memb: '/m', run });
  assert.deepStrictEqual(hits.map((h) => h.memory), ['strong']);
  assert.strictEqual(seen.opts.timeout, SEMANTIC_BUDGET_MS, 'the hard budget is the spawn timeout');
  assert.strictEqual(SEMANTIC_BUDGET_MS, 400);
  assert.strictEqual(seen.opts.input, 'colors please');
});

test('semanticRecall skips silently on timeout, non-zero exit, bad output or a missing engine', async () => {
  const { semanticRecall } = await load();
  const base = { prompt: 'colors please', python: '/py', helper: '/h.py', memb: '/m' };
  assert.deepStrictEqual(semanticRecall({ ...base, run: () => ({ status: null, error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) }) }), []);
  assert.deepStrictEqual(semanticRecall({ ...base, run: () => ({ status: 1, stdout: '' }) }), []);
  assert.deepStrictEqual(semanticRecall({ ...base, run: () => ({ status: 0, stdout: 'not json' }) }), []);
  assert.deepStrictEqual(semanticRecall({ ...base, python: null, run: () => assert.fail('no engine, no spawn') }), []);
});

test('membSearchTarget finds the venv python and run.py, null when memB is absent', async () => {
  const { membSearchTarget } = await load();
  const have = new Set(['/h/memb-recall.py', '/home/u/.agents/memB/.venv/bin/python', '/home/u/.agents/memB/run.py']);
  const exists = (p) => have.has(p);
  const t = membSearchTarget({ home: '/home/u', env: {}, exists, hookDir: '/h' });
  if (POSIX) assert.deepStrictEqual(t, { python: '/home/u/.agents/memB/.venv/bin/python', helper: '/h/memb-recall.py', memb: '/home/u/.agents/memB' });
  assert.strictEqual(membSearchTarget({ home: '/home/u', env: {}, exists: () => false, hookDir: '/h' }), null);
});

test('SessionStart injects the memB rule exactly once; the off switch removes it', { skip: !DatabaseSync && 'node:sqlite unavailable' }, (t) => {
  const home = makeHome(t, { rows: SEEDED_ROWS });
  const start = runHook(home, { hook_event_name: 'SessionStart', prompt: '', cwd: home });
  assert.strictEqual(start.status, 0, start.stderr);
  assert.strictEqual(start.context.split(RULE_TEXT).length - 1, 1, 'rule present exactly once');

  const prompt = runHook(home, { hook_event_name: 'UserPromptSubmit', prompt: PROMPT, cwd: home });
  assert.ok(!prompt.context.includes(RULE_TEXT), 'the rule is not repeated per prompt');

  const offHome = makeHome(t, { rows: SEEDED_ROWS, settings: { memory: { promptRecall: 'off' } } });
  const offStart = runHook(offHome, { hook_event_name: 'SessionStart', prompt: '', cwd: offHome });
  assert.ok(!offStart.context.includes(RULE_TEXT), 'off: no rule');
});

test('semantic hits are added, below-threshold hits dropped, duplicates of full-text hits not repeated', { skip: (!DatabaseSync || !POSIX) && 'needs node:sqlite and a POSIX shell' }, (t) => {
  const fake = FAKE_HITS([
    { memory: FACT, score: 0.95 },
    { memory: 'Brand colors are teal and sand', score: 0.8 },
    { memory: 'weakly related note', score: 0.1 },
  ]);
  const home = makeHome(t, { fakePython: fake, rows: SEEDED_ROWS });
  const res = runHook(home, { hook_event_name: 'UserPromptSubmit', prompt: PROMPT, cwd: home });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.context.includes('- Relevant memory: Brand colors are teal and sand'), res.context);
  assert.ok(!res.context.includes('weakly related note'), 'below threshold stays out');
  assert.strictEqual(res.context.split(FACT).length - 1, 1, 'dedupe: the full-text hit is not repeated by semantic recall');
});

test('a slow memB is cut at the budget and the prompt still gets its full-text hits', { skip: (!DatabaseSync || !POSIX) && 'needs node:sqlite and a POSIX shell' }, (t) => {
  const home = makeHome(t, { fakePython: '#!/bin/sh\ncat >/dev/null\nexec sleep 5\n', rows: SEEDED_ROWS });
  const res = runHook(home, { hook_event_name: 'UserPromptSubmit', prompt: PROMPT, cwd: home });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.elapsed < 4000, `hook must not wait for the slow engine (took ${res.elapsed} ms)`);
  assert.ok(!res.context.includes('Relevant memory:'), 'timeout: nothing semantic injected');
  assert.ok(res.context.includes(`Domain memory: ${FACT}`), 'full-text recall still runs');
});

test('fulltext keeps keyword recall but never calls the engine; off disables both', { skip: (!DatabaseSync || !POSIX) && 'needs node:sqlite and a POSIX shell' }, (t) => {
  const fake = FAKE_HITS([{ memory: 'Brand colors are teal and sand', score: 0.8 }]);
  const ft = makeHome(t, { fakePython: fake, settings: { memory: { promptRecall: 'fulltext' } }, rows: SEEDED_ROWS });
  const r1 = runHook(ft, { hook_event_name: 'UserPromptSubmit', prompt: PROMPT, cwd: ft });
  assert.ok(!r1.context.includes('Relevant memory:'), 'fulltext: no semantic lines');
  assert.ok(r1.context.includes(`Domain memory: ${FACT}`), 'fulltext: keyword recall still on');

  const off = makeHome(t, { fakePython: fake, settings: { memory: { promptRecall: 'off' } }, rows: SEEDED_ROWS });
  const r2 = runHook(off, { hook_event_name: 'UserPromptSubmit', prompt: PROMPT, cwd: off });
  assert.strictEqual(r2.context, '', 'off: no per-prompt recall at all');
});

test('trivial prompts never reach the engine', { skip: (!DatabaseSync || !POSIX) && 'needs node:sqlite and a POSIX shell' }, (t) => {
  const home = makeHome(t, { fakePython: FAKE_HITS([{ memory: 'Brand colors are teal and sand', score: 0.8 }]), rows: SEEDED_ROWS });
  const res = runHook(home, { hook_event_name: 'UserPromptSubmit', prompt: '/clear', cwd: home });
  assert.ok(!res.context.includes('Relevant memory:'));
});
