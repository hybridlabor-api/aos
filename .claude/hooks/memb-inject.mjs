#!/usr/bin/env node
// aos-hook-version: 9
/**
 * memB ambient memory hook for Claude Code, Google Antigravity, and OpenAI Codex.
 *
 * Stamped with aos-hook-version for /aos-setup doctor validation.
 * Reads ~/.MemBDB/memb.db directly through node:sqlite and injects relevant
 * project & user memories as ephemeral context, emitting only the key the
 * calling harness reads:
 * - hookSpecificOutput.additionalContext (Claude Code, OpenAI Codex)
 * - injectSteps (Google Antigravity PreInvocation)
 *
 * Reads rows of the configured user (MEMB_USER_ID, fallback $USER) plus the
 * group ids in MEMB_GROUP_IDS (comma list, default bdb_developer). Rows bound
 * to the current project are injected whatever their category (max 5, 180
 * chars each); global rows still need category `godmode`.
 *
 * Event-aware: SessionStart injects the persona file, the global godmode
 * identity rows, and the current project's cards once per session; every
 * other prompt (UserPromptSubmit) recalls only FTS keyword hits so 40
 * identity facts are not re-sent on every message. Harnesses without a
 * session hook (e.g. Antigravity PreInvocation) get the full block plus
 * identity on the first invocation of a conversation (cached per
 * conversationId); later invocations recall FTS hits only.
 *
 * Per-prompt semantic recall (memory.promptRecall = "semantic", opt-in; the
 * default is "fulltext"): each non-trivial prompt also asks memB's own vector +
 * BM25 search through memb-recall.py, under a 400 ms budget, keeps scoped hits
 * above a relevance threshold, and adds at most 5 lines / ~600 tokens. It needs
 * a warm memB process; a cold ONNX start exceeds the budget and is skipped.
 * "fulltext" keeps only the keyword recall; "off" disables per-prompt recall.
 *
 * Fails open: any error exits 0 silently.
 */

import { readFileSync, existsSync, realpathSync, mkdirSync, writeFileSync, fstatSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const COLLECTION = 'bdb_agent_memory';
const DEFAULT_GROUP_IDS = 'bdb_developer';
const PROJECT_ROW_CAP = 5;
const ROW_CHARS = 180;
const failOpen = () => process.exit(0);

// Per-prompt semantic recall limits. memB's search_memory (memB run.py:178, :184)
// returns dense cosine-style scores in ~0..1, and BM25 scores boosted x1.25 and capped
// at 1.0 when both legs match. 0.45 is a starting point; no measured calibration exists yet.
export const PROMPT_RECALL_MODES = ['semantic', 'fulltext', 'off'];
export const SEMANTIC_BUDGET_MS = 400;
export const SEMANTIC_MIN_SCORE = 0.45;
export const SEMANTIC_MAX_HITS = 5;
export const SEMANTIC_TOKEN_CHARS = 2400; // ~600 tokens at ~4 chars per token
const SEMANTIC_LINE_CHARS = 240;

// Standing rule, injected once at SessionStart next to the write hint (shared by every harness that reuses this block).
export const MEMB_RECALL_RULE = '- For questions about projects, people, the company, earlier decisions or preferences: query memB first (memb search / the memB MCP tool), then answer.';

// memory.promptRecall from ~/.aos/v5-settings.json; anything unknown means the default "fulltext".
export function promptRecallMode(home = os.homedir()) {
  try {
    const v = JSON.parse(readFileSync(path.join(home, '.aos', 'v5-settings.json'), 'utf8'))?.memory?.promptRecall;
    if (PROMPT_RECALL_MODES.includes(v)) return v;
  } catch {}
  return 'fulltext';
}

// Prompts too short or too structural to recall anything useful for (slash commands included).
export const isTrivialPrompt = (prompt) => {
  const t = String(prompt || '').trim();
  return t.length < 15 || t.startsWith('/');
};

// Where memb-recall.py and the memB engine live: the first candidate with a venv python and run.py.
// Null when memB is not installed; the caller then skips semantic recall silently.
export function membSearchTarget({ home = os.homedir(), env = process.env, exists = existsSync, hookDir = path.dirname(fileURLToPath(import.meta.url)) } = {}) {
  const win = process.platform === 'win32';
  const helper = path.join(hookDir, 'memb-recall.py');
  if (!exists(helper)) return null;
  const dirs = [env.MEMB_MCP_DIR, path.join(home, '.gemini', 'config', 'mcps', 'memb-mcp'), path.join(home, '.agents', 'mcps', 'memb-mcp'), path.join(home, '.agents', 'memB')];
  for (const d of dirs.filter(Boolean)) {
    const py = path.join(d, '.venv', win ? 'Scripts' : 'bin', win ? 'python.exe' : 'python');
    if (exists(py) && exists(path.join(d, 'run.py'))) return { python: py, helper, memb: d };
  }
  return null;
}

// Runs the helper as a child in its own process group (POSIX) and resolves
// after `budgetMs` even if a grandchild keeps stdout open: the whole group is
// killed on the timer (POSIX) or the tree via taskkill /T (Windows).
export function runBounded(cmd, args, { input = '', budgetMs = SEMANTIC_BUDGET_MS, env = process.env } = {}) {
  return new Promise((resolve) => {
    const win = process.platform === 'win32';
    let out = '';
    let settled = false;
    let timer = null;
    let child;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    try {
      child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, detached: !win, env });
    } catch {
      return finish({ status: null });
    }
    const killTree = () => {
      try {
        if (win) {
          spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
        } else {
          process.kill(-child.pid, 'SIGKILL');
        }
      } catch {
        try { child.kill('SIGKILL'); } catch {}
      }
    };
    timer = setTimeout(() => { killTree(); finish({ status: null, timedOut: true }); }, budgetMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stdin.on('error', () => {});
    child.on('error', () => finish({ status: null }));
    child.on('close', (code) => finish({ status: code, stdout: out }));
    child.stdin.end(input);
  });
}

// Keeps only semantic hits this user and project may see. A hit without a user is dropped
// (no scope metadata). A project hit must name one of this project's ids; a global hit must
// pass the same globalRowRelevant gate as the full-text path.
export function scopeSemanticHits(hits, { userIds = [], projectIds = [], terms = [] } = {}) {
  return hits.filter((h) => {
    if (!h.user_id || !userIds.includes(h.user_id)) return false;
    if (h.project_id) return projectIds.includes(h.project_id);
    return globalRowRelevant({ cat: h.category || '', text: h.memory, ids: projectIds, terms });
  });
}

// memB semantic hits for one prompt: [{ memory, score, user_id, project_id, category }] above minScore.
// A timeout, a missing engine, a non-zero exit or unparsable output all yield [] (no error, no injection).
export async function semanticRecall({ prompt, python, helper, memb, user = '', run = runBounded, budgetMs = SEMANTIC_BUDGET_MS, minScore = SEMANTIC_MIN_SCORE } = {}) {
  if (!python || !helper || !memb) return [];
  try {
    const args = [helper, String(SEMANTIC_MAX_HITS), memb, ...(user ? [user] : [])];
    const r = await run(python, args, { input: String(prompt).slice(0, 500), budgetMs });
    if (!r || r.status !== 0 || !r.stdout) return [];
    const list = JSON.parse(String(r.stdout));
    if (!Array.isArray(list)) return [];
    return list.filter((h) => h && typeof h.memory === 'string' && h.memory && Number(h.score) >= minScore);
  } catch {
    return [];
  }
}

// `deja wip --json` run in the project root, rendered as context lines.
// Best-effort: deja missing, slow, or silent yields []. Windows needs a shell
// to spawn npm's deja.cmd shim; the arguments are fixed, so nothing is injected.
export function dejaWip(cwd, run = execFileSync, timeout = 3000) {
  try {
    const out = run('deja', ['wip', '--json'], {
      cwd, encoding: 'utf8', timeout,
      stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32',
    });
    const wip = JSON.parse(out);
    const lines = (Array.isArray(wip?.lines) ? wip.lines : [])
      .map((l) => String(l).trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .slice(0, 4);
    if (!lines.length) return [];
    const src = [wip.harness, wip.session && `deja:${String(wip.session).slice(0, 8)}`].filter(Boolean).join(' ');
    return [`- Last session here${src ? ` (${src})` : ''}:`, ...lines.map((l) => `  - ${l.slice(0, 220)}`)];
  } catch {
    return [];
  }
}

// Opt-in (default off): setting memory.dejaContext = "on" in ~/.aos/v5-settings.json, or AOS_DEJA_CONTEXT=on.
// Every harness runs this hook (OpenCode through its plugin), so one switch covers all of them.
export function dejaContextOn(env = process.env, home = os.homedir()) {
  if (env.AOS_DEJA_CONTEXT) return env.AOS_DEJA_CONTEXT === 'on';
  try { return JSON.parse(readFileSync(path.join(home, '.aos', 'v5-settings.json'), 'utf8'))?.memory?.dejaContext === 'on'; } catch { return false; }
}

// `deja hook-context --plain --once`: deja's own session digest, capped. [] when deja is missing or silent.
export function dejaContext(cwd, run = execFileSync, timeout = 3000) {
  try {
    const out = String(run('deja', ['hook-context', '--plain', '--once'], {
      cwd, encoding: 'utf8', timeout,
      stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32',
    })).trim();
    return out ? [out.slice(0, 1200)] : [];
  } catch {
    return [];
  }
}

// `deja last 1 --json` for this project: { title, updated } of the newest session, or null.
// The project name reaches a win32 shell (npm's deja.cmd shim), so only shell-inert names are passed.
export function dejaLast(project, cwd, run = execFileSync, timeout = 2500) {
  if (project && !/^[\w.-]+$/.test(project)) return null;
  try {
    const out = run('deja', ['last', '1', '--json', ...(project ? ['--project', project] : [])], {
      cwd, encoding: 'utf8', timeout,
      stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32',
    });
    const s = JSON.parse(out)?.sessions?.[0];
    return s?.title ? { title: String(s.title), updated: s.updated || s.started || '' } : null;
  } catch {
    return null;
  }
}

const SECRET_LIKE = /(sk-|ghp_|gho_|xox[bap]-|AKIA|eyJ)[\w-]{8,}|[A-Za-z0-9+/_-]{32,}|(?:password|secret|token|apikey|api_key)\s*[:=]/i;
export const ago = (iso, now = Date.now()) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.round((now - t) / 60000));
  return m < 60 ? `${m}m ago` : m < 2880 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

// The one human-visible line at session start (stderr). No secrets, at most 160 chars.
export function visibleMemoryLine({ count = 0, project = '', last = null, now } = {}) {
  const tail = ' · aos memory show';
  const proj = String(project).slice(0, 30);
  const parts = [`memory: ${count} notes${proj ? ` (${proj})` : ''}`];
  const title = last && String(last.title).replace(/[\u0000-\u001f]+/g, ' ').trim();
  if (title && !SECRET_LIKE.test(title)) {
    const when = ago(last.updated, now);
    const room = 160 - tail.length - parts[0].length - ' · last session: '.length - (when ? when.length + 2 : 0);
    if (room > 8) parts.push(`last session: ${title.length > room ? title.slice(0, room - 1) + '…' : title}${when ? `, ${when}` : ''}`);
  }
  return parts.join(' · ').slice(0, 160 - tail.length) + tail;
}

// Rows are read for the user plus the configured group ids; nothing is
// hard-coded beyond the documented default group.
export function resolveReaderIds({ userId, env = process.env } = {}) {
  const user = env.MEMB_USER_ID || userId || env.USER || env.LOGNAME || '';
  const groups = String(env.MEMB_GROUP_IDS ?? DEFAULT_GROUP_IDS).split(',').map((g) => g.trim());
  return Array.from(new Set([user, ...groups].filter(Boolean)));
}

// Filler words (German + English) that must never become FTS query terms —
// they match virtually any document and would inject unrelated projects.
const STOPWORDS = new Set([
  'und', 'oder', 'aber', 'doch', 'noch', 'auch', 'nicht', 'eine', 'einen', 'einer',
  'dass', 'dann', 'wenn', 'was', 'wie', 'wir', 'ihr', 'sie', 'der', 'die', 'das',
  'den', 'dem', 'des', 'ist', 'sind', 'war', 'wird', 'werden', 'wurde', 'haben',
  'hat', 'kann', 'soll', 'sollte', 'muss', 'mit', 'von', 'für', 'auf', 'aus',
  'bei', 'nach', 'über', 'unter', 'schon', 'jetzt', 'hier', 'dort', 'stehen',
  'gemacht', 'machen', 'bitte', 'this', 'that', 'what', 'with', 'from', 'have',
  'will', 'would', 'should', 'could', 'there', 'their', 'about', 'into', 'your',
  'just',
]);

// Extract up to 4 distinctive keyword terms from a prompt: lowercase, split on
// non-alphanumeric characters, drop words of length <= 3 and stopwords,
// de-duplicate, and sort by length descending (longest = most specific first).
export function pickTerms(prompt) {
  const words = String(prompt || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
  return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 4);
}

// Category of a payload, read from the same dual JSON paths the step-2
// whitelist matches against. Empty string = uncategorized (legacy/raw rows),
// which never pass the injection whitelist.
export const categoryOf = (payload) => {
  const p = JSON.parse(payload);
  const v = p?.category ?? p?.metadata?.category;
  return v == null ? '' : String(v).trim();
};

// A global (project-less) FTS hit is injected only when it relates to this project or prompt:
// project cards must name the project, domain categories (branding, mail, ...) must match a
// project id or prompt term, identity (`godmode`) rows already matched the prompt terms.
export function globalRowRelevant({ cat, text, ids = [], terms = [] }) {
  if (cat === 'godmode') return true;
  const low = String(text || '').toLowerCase();
  const idsLow = ids.map((i) => String(i).toLowerCase()).filter((i) => i.length > 2);
  if (cat === 'project_card') return idsLow.some((i) => low.includes(i));
  if (!cat) return false;
  const words = cat.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
  const known = new Set([...terms, ...idsLow.flatMap((i) => i.split(/[^\p{L}\p{N}]+/u))]);
  return words.some((w) => known.has(w));
}

// Helper to find project root by walking upward from candidate start directory
function findProjectRoot(startDir, homeDir) {
  let current = path.resolve(startDir);
  let bestRoot = null;
  while (current && current !== path.dirname(current)) {
    if (current === homeDir) break;
    // .aos/project.json is the highest-priority project anchor
    if (existsSync(path.join(current, '.aos', 'project.json'))) return current;
    // .git, .agents, or package.json markers
    if (existsSync(path.join(current, '.git')) || existsSync(path.join(current, '.agents')) || existsSync(path.join(current, 'package.json'))) {
      bestRoot = current;
    }
    current = path.dirname(current);
  }
  return bestRoot || path.resolve(startDir);
}

const GENERIC_DIRS = new Set(['app', 'src', 'code', 'project', 'projects', 'repo', 'work', 'dev', 'test', 'tmp', 'web', 'api', 'main', 'desktop', 'documents', 'workspace']);

// Helper to extract candidate project identifiers
function resolveProjectIdentifiers(projectRoot, homeDir) {
  const ids = new Set();

  // 1. Check .aos/project.json
  const aosFile = path.join(projectRoot, '.aos', 'project.json');
  if (existsSync(aosFile)) {
    try {
      const cfg = JSON.parse(readFileSync(aosFile, 'utf8'));
      if (cfg?.memb?.projectId) ids.add(cfg.memb.projectId);
      if (cfg?.projectId) ids.add(cfg.projectId);
      if (cfg?.slug) ids.add(cfg.slug);
      if (cfg?.name) ids.add(cfg.name);
    } catch {}
  }

  // 2. Check package.json
  const pkgFile = path.join(projectRoot, 'package.json');
  if (existsSync(pkgFile)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
      if (typeof pkg?.name === 'string') {
        ids.add(pkg.name);
        ids.add(pkg.name.replace(/^@[^/]+\//, '')); // unscoped name (e.g. @acme/shop-service -> shop-service)
      }
    } catch {}
  }

  // 3. Basename only as a last resort: never next to a declared id, never a generic folder name.
  let basenameOnly = false;
  const base = path.basename(projectRoot);
  if (!ids.size && projectRoot !== homeDir && projectRoot !== '/' && !GENERIC_DIRS.has(base.toLowerCase())) {
    ids.add(base);
    basenameOnly = true;
  }

  return Object.assign(Array.from(ids).filter(Boolean), { basenameOnly });
}

// Nothing writes memB automatically; this line is the only prompt to do it.
export const MEMB_WRITE_HINT = '- To keep a durable decision or convention, call memb_mcp add_memory (project_id = this project, category e.g. architecture_decisions). Nothing is saved automatically.';

// Shared with the OpenCode plugin: everything between "which event" and the
// finished text block. Returns null when there is nothing to inject; never exits.
export async function buildMemoryBlock({ event = '', prompt = '', cwd, userId, isAgy = false, onStatus = null } = {}) {
  prompt = String(prompt).trim();
  const home = os.homedir();

  // Which harness event is this? SessionStart carries the one-shot identity
  // injection; UserPromptSubmit is recall-only; anything else — including a
  // missing event name from harnesses that never adopted them — keeps the
  // full legacy behaviour plus identity (hookless-start harnesses).
  const rawEvent = event;
  const sessionStart = rawEvent === 'SessionStart' || (isAgy && rawEvent === '');
  const promptSubmit = rawEvent === 'UserPromptSubmit';
  if (sessionStart && process.env.AOS_SESSION_START_CONTEXT === 'off') return null;

  const rawCandidateDir =
    cwd ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.env.CODEX_PROJECT_DIR ||
    process.cwd();

  const projectRoot = findProjectRoot(rawCandidateDir, home);
  const candidateProjectIds = resolveProjectIdentifiers(projectRoot, home);

  const candidateUsers = resolveReaderIds({ userId });

  const contextItems = [];
  let statusCount = 0;
  const recallMode = promptRecallMode();
  if (sessionStart) {
    contextItems.push(MEMB_WRITE_HINT);
    if (recallMode !== 'off') contextItems.push(MEMB_RECALL_RULE);
  }

  // 1. Standing facts, if the user keeps any. Skipped on UserPromptSubmit:
  //    they were already injected at SessionStart.
  if (!promptSubmit) {
    const personaFile = path.join(home, '.MemBDB', 'ambient-persona.txt');
    if (existsSync(personaFile)) {
      try {
        for (const line of readFileSync(personaFile, 'utf8').split('\n')) {
          const t = line.trim();
          if (t && !t.startsWith('#')) contextItems.push(`- ${t}`);
        }
      } catch {}
    }
  }

  const dbPath = path.join(home, '.MemBDB', 'memb.db');
  // node:sqlite needs Node >= 22.5; without it (or without a DB) only the non-DB parts run.
  let DatabaseSync = null;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch {}
  const db = DatabaseSync && existsSync(dbPath) ? new DatabaseSync(dbPath, { readOnly: true }) : null;
  try {
    try { db?.exec('PRAGMA busy_timeout = 5000;'); } catch {}
    const textOf = (payload) => {
      const p = JSON.parse(payload);
      return (p.memory || p.data || '').trim().replace(/\s+/g, ' ');
    };

    // Project id of a payload, read from the same JSON fields the project
    // query (step 2) matches against. Empty string means global memory.
    const projectOf = (payload) => {
      const p = JSON.parse(payload);
      const v = p?.project_id ?? p?.metadata?.project_id ?? p?.project ?? p?.metadata?.project;
      return v == null ? '' : String(v).trim();
    };

    // 2. Global identity facts (category `godmode`, bound to no project).
    //    Injected once per session on SessionStart — and on harnesses with no
    //    session hook — never on every prompt: 40 identity facts would waste
    //    ~1.5k tokens per message. Newest first, max 40; raw imported file
    //    chunks that carry the godmode category are skipped.
    if (!promptSubmit) {
      try {
        const uPlaceholders = candidateUsers.map(() => '?').join(',');
        const rows = db.prepare(`
          SELECT payload FROM memb_vectors
          WHERE collection = ?
            AND (json_extract(payload, '$.category') = 'godmode'
              OR json_extract(payload, '$.metadata.category') = 'godmode')
            AND (json_extract(payload, '$.project_id') IS NULL
              OR json_extract(payload, '$.project_id') = '')
            AND (json_extract(payload, '$.metadata.project_id') IS NULL
              OR json_extract(payload, '$.metadata.project_id') = '')
            AND (json_extract(payload, '$.project') IS NULL
              OR json_extract(payload, '$.project') = '')
            AND (json_extract(payload, '$.metadata.project') IS NULL
              OR json_extract(payload, '$.metadata.project') = '')
            AND (json_extract(payload, '$.user_id') IS NULL
              OR json_extract(payload, '$.user_id') IN (${uPlaceholders})
              OR json_extract(payload, '$.metadata.user_id') IN (${uPlaceholders}))
          ORDER BY rowid DESC
          LIMIT 40
        `).all(COLLECTION, ...candidateUsers, ...candidateUsers);
        for (const r of rows) {
          const text = textOf(r.payload);
          if (!text || text.startsWith('[')) continue; // raw import chunk
          if (contextItems.some((e) => e.includes(text.slice(0, 50)))) continue;
          contextItems.push(`- ${text.slice(0, 180)}`);
        }
      } catch { /* identity query is best-effort */ }
    }

    // 3. Query project-specific memories matching any candidate project ID
    if (!promptSubmit && candidateProjectIds.length > 0) {
      try {
        const pPlaceholders = candidateProjectIds.map(() => '?').join(',');
        const uPlaceholders = candidateUsers.map(() => '?').join(',');
        // A folder-name guess must equal the stored project_id exactly; looser `project` fields only for declared ids.
        const strict = candidateProjectIds.basenameOnly;
        const idCols = strict ? ['$.project_id', '$.metadata.project_id'] : ['$.project_id', '$.metadata.project_id', '$.project', '$.metadata.project'];
        const sql = `
          SELECT payload FROM memb_vectors
          WHERE collection = ?
            AND (
              ${idCols.map((c) => `json_extract(payload, '${c}') IN (${pPlaceholders})`).join('\n              OR ')}
            )
            AND (
              json_extract(payload, '$.user_id') IS NULL
              OR json_extract(payload, '$.user_id') IN (${uPlaceholders})
              OR json_extract(payload, '$.metadata.user_id') IN (${uPlaceholders})
            )
          ORDER BY (COALESCE(json_extract(payload, '$.category'),
                             json_extract(payload, '$.metadata.category')) = 'project_card') DESC,
                   rowid DESC
          LIMIT ${PROJECT_ROW_CAP * 4}
        `;
        const params = [
          COLLECTION,
          ...idCols.flatMap(() => candidateProjectIds),
          ...candidateUsers,
          ...candidateUsers,
        ];
        const rows = db.prepare(sql).all(...params);
        const usable = (text) => text.length > 10 && !/^\[[^\]|]+\|[^\]|]+\|/.test(text); // not too short / imported file chunk
        if (onStatus) {
          try { statusCount = db.prepare(sql.replace(/LIMIT \d+\s*$/, '')).all(...params).filter((r) => usable(textOf(r.payload))).length; } catch { statusCount = rows.filter((r) => usable(textOf(r.payload))).length; }
        }
        let taken = 0;
        for (const r of rows) {
          if (taken >= PROJECT_ROW_CAP) break;
          const text = textOf(r.payload);
          if (!usable(text)) continue;
          if (contextItems.some((e) => e.includes(text.slice(0, 50)))) continue;
          contextItems.push(`- Project [${candidateProjectIds[0]}]: ${text.slice(0, ROW_CHARS)}`);
          taken++;
        }
      } catch { /* project query is best-effort */ }
    }

    // 4. Keyword hit against the FTS index for anything else relevant.
    //    Skipped on SessionStart (identity + project cards are already in).
    //    Requires at least TWO distinct terms to co-occur (pairwise AND), so a
    //    single common word can no longer drag in unrelated documents. Hits
    //    are scoped to the current project (or global memories), and raw
    //    imported file chunks (`[repo | file | path]` prefix) are skipped.
    if (!sessionStart && recallMode !== 'off' && prompt.length > 5) {
      try {
        const terms = pickTerms(prompt);
        if (terms.length >= 2) {
          const pairs = [];
          for (let i = 0; i < terms.length; i++) {
            for (let j = i + 1; j < terms.length; j++) {
              pairs.push(`(${terms[i]}* AND ${terms[j]}*)`);
            }
          }
          const uPlaceholders = candidateUsers.map(() => '?').join(',');
          // Over-fetch: the project/relevance filter below runs in JS, the cap of 2 applies after it.
          const rows = db.prepare(`
            SELECT v.payload
            FROM memb_fts f
            JOIN memb_vectors v ON f.id = v.id
            WHERE f.collection = ? AND memb_fts MATCH ?
              AND (json_extract(v.payload, '$.user_id') IS NULL
                OR json_extract(v.payload, '$.user_id') IN (${uPlaceholders})
                OR json_extract(v.payload, '$.metadata.user_id') IN (${uPlaceholders}))
            ORDER BY rank
            LIMIT 40
          `).all(COLLECTION, pairs.join(' OR '), ...candidateUsers, ...candidateUsers);
          let hits = 0;
          for (const r of rows) {
            if (hits >= 2) break;
            const text = textOf(r.payload);
            if (!text) continue;
            if (/^\[[^\]|]+\|[^\]|]+\|/.test(text)) continue; // imported file chunk
            const hitProject = projectOf(r.payload);
            if (hitProject && !candidateProjectIds.includes(hitProject)) continue;
            const cat = categoryOf(r.payload);
            if (!hitProject && !globalRowRelevant({ cat, text, ids: candidateProjectIds, terms })) continue;
            if (!contextItems.some((e) => e.includes(text.slice(0, 50)))) {
              contextItems.push(`- Domain memory: ${text.slice(0, 180)}`);
              hits++;
            }
          }
        }
      } catch { /* FTS table may not exist on an empty store */ }
    }

    // 4b. Semantic recall: memB's vector + BM25 search for this prompt, under a
    //     hard time budget. Deduped against the FTS hits above; capped at
    //     SEMANTIC_MAX_HITS lines and SEMANTIC_TOKEN_CHARS characters.
    if (promptSubmit && recallMode === 'semantic' && !isTrivialPrompt(prompt)) {
      const target = membSearchTarget();
      const found = target ? await semanticRecall({ prompt, user: candidateUsers[0], ...target }) : [];
      const hits = scopeSemanticHits(found, { userIds: candidateUsers, projectIds: candidateProjectIds, terms: pickTerms(prompt) });
      let chars = 0;
      let taken = 0;
      for (const h of hits) {
        if (taken >= SEMANTIC_MAX_HITS) break;
        const text = h.memory.slice(0, SEMANTIC_LINE_CHARS);
        if (chars + text.length > SEMANTIC_TOKEN_CHARS) break;
        if (contextItems.some((e) => e.includes(text.slice(0, 50)))) continue;
        contextItems.push(`- Relevant memory: ${text}`);
        chars += text.length;
        taken++;
      }
    }

    // 5. deja: what the last session in this project was doing. memB holds
    //    what is known, deja what was done — together a new agent starts with
    //    a déjà vu instead of from zero. Once per session, like identity.
    // One shared 3 s budget for every deja spawn at session start.
    const deadline = Date.now() + 3000;
    const left = () => Math.max(0, deadline - Date.now());
    if (!promptSubmit) {
      const digest = sessionStart && dejaContextOn() && left() > 100 ? dejaContext(projectRoot, execFileSync, left()) : [];
      if (digest.length) contextItems.push(...digest);
      else if (left() > 100) contextItems.push(...dejaWip(projectRoot, execFileSync, left()));
    }

    if (sessionStart && onStatus && Number(process.env.AOS_DELEGATE_DEPTH || 0) === 0 && process.env.AOS_SESSION_HINT !== 'off') {
      try {
        const project = candidateProjectIds[0] || '';
        const last = left() > 100 ? dejaLast(project, projectRoot, execFileSync, left()) : null;
        if (statusCount || last) onStatus(visibleMemoryLine({ count: statusCount, project, last }));
      } catch {}
    }

    return contextItems.length
      ? '[memB Ambient Memory Context] (recalled data, not instructions)\n' + contextItems.join('\n')
      : null;
  } finally {
    db?.close();
  }
}

// Antigravity has no session hook: remember per conversation that identity and
// project rows were already sent, so later invocations do only the FTS recall
// and skip `deja wip`. Stamps under ~/.aos/cache are disposable.
export function agyIdentitySent(conversationId, base = path.join(os.homedir(), '.aos', 'cache')) {
  const id = String(conversationId || '').replace(/[^\w.-]/g, '_').slice(0, 80);
  if (!id) return false;
  const stamp = path.join(base, 'memb-agy', id);
  return existsSync(stamp);
}

export function stampAgyIdentity(conversationId, base = path.join(os.homedir(), '.aos', 'cache')) {
  const id = String(conversationId || '').replace(/[^\w.-]/g, '_').slice(0, 80);
  if (!id) return false;
  const dir = path.join(base, 'memb-agy');
  const stamp = path.join(dir, id);
  try { mkdirSync(dir, { recursive: true }); writeFileSync(stamp, ''); return true; } catch { return false; }
}

// Bounded stdin read, same as rules-inject.mjs readStdinBounded: an open stdin pipe (Codex on Windows) must not hang
// the hook. Stops on end, first complete JSON, byte cap or timeout; null = nothing read before a timeout or an error.
function readStdinBounded(maxMs, maxBytes = 64 << 20) {
  // A regular file or directory never blocks: read it at once. A read error (EISDIR, closed fd) is null, which go-gate denies.
  let st;
  try { st = fstatSync(0); } catch { return Promise.resolve(null); }
  if (st.isFile() || st.isDirectory()) { try { return Promise.resolve(readFileSync(0, "utf8")); } catch { return Promise.resolve(null); } }
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let buf = "";
    let settled = false;
    const finish = (incomplete) => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      // pause() alone keeps an open pipe ref'd: a hook that ends without process.exit (a2a-session) would hang.
      try { process.stdin.pause(); process.stdin.unref?.(); } catch {}
      resolve(incomplete === true && !buf ? null : buf);
    };
    const to = setTimeout(finish, maxMs, true);
    if (to.unref) to.unref();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
      if (buf.length >= maxBytes) return finish();
      if (buf.trimEnd().endsWith("}")) try { JSON.parse(buf); finish(); } catch {}
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", () => finish(true));
    process.stdin.resume();
  });
}

// Hook body shared by the script entry and the in-process dispatcher (aos-hooks.mjs).
// Fails open: any error answers an empty result. stderr carries the one human-visible status line.
export async function hook(eventData) {
  try {
    if (!eventData || typeof eventData !== 'object') return { code: 0, stdout: '', stderr: '' };
    // Discover candidate directory across harnesses:
    // Claude / Codex: eventData.cwd; Antigravity: eventData.workspacePaths[0] or eventData.cwd
    const isAgy = !eventData.hook_event_name && (Array.isArray(eventData.workspacePaths) || !!eventData.conversationId);
    const agyAlreadySent = isAgy && agyIdentitySent(eventData.conversationId);
    const event = agyAlreadySent
      ? 'UserPromptSubmit'
      : (eventData.hook_event_name || '');

    if (process.env.AOS_SESSION_START_CONTEXT === 'off' && (event === 'SessionStart' || eventData.hook_event_name === 'SessionStart' || (isAgy && event === ''))) {
      return { code: 0, stdout: '', stderr: '' };
    }

    let stderr = '';
    const memoryBlock = await buildMemoryBlock({
      event,
      prompt: eventData.prompt || eventData.userPrompt || '',
      cwd: (Array.isArray(eventData.workspacePaths) && eventData.workspacePaths[0]) || eventData.cwd,
      userId: eventData.user_id || eventData.userId,
      isAgy,
      onStatus: (line) => { stderr += `${line}\n`; },
    });

    if (!memoryBlock) return { code: 0, stdout: '', stderr };
    if (isAgy && !agyAlreadySent) {
      stampAgyIdentity(eventData.conversationId);
    }
    const { capText } = await import('./session-cap.mjs');
    const capped = capText(memoryBlock);
    const stdout = JSON.stringify(isAgy
      ? { injectSteps: [{ ephemeralMessage: capped }] }
      : {
        hookSpecificOutput: {
          hookEventName: eventData.hook_event_name || 'UserPromptSubmit',
          additionalContext: capped,
        },
      }) + '\n';
    return { code: 0, stdout, stderr };
  } catch {
    return { code: 0, stdout: '', stderr: '' };
  }
}

// Main logic runs only when the file is executed directly as a hook; importing
// the module (e.g. from tests) must stay side-effect free.
async function main() {
  let inputRaw = '';
  inputRaw = (await readStdinBounded(1500)) ?? '';
  if (!inputRaw || !inputRaw.trim()) failOpen();
  let eventData = {};
  try { eventData = JSON.parse(inputRaw); } catch { failOpen(); }
  const r = await hook(eventData);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.stdout) process.stdout.write(r.stdout);
  process.exit(0);
}

// Compare resolved paths: a hook reached through a symlink must still run.
const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) {
  await main();
}
