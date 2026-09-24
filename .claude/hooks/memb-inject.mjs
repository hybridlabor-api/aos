#!/usr/bin/env node
// aos-hook-version: 5
/**
 * memB ambient memory hook for Claude Code, Google Antigravity, and OpenAI Codex.
 *
 * Stamped with aos-hook-version for /aos-setup doctor validation.
 * Reads ~/.MemBDB/memb.db directly through node:sqlite and injects relevant
 * project & user memories as ephemeral context in tri-format JSON:
 * - hookSpecificOutput (Claude Code UserPromptSubmit)
 * - injectSteps (Google Antigravity PreInvocation)
 * - systemMessage (OpenAI Codex UserPromptSubmit)
 *
 * Event-aware: SessionStart injects the persona file, the global godmode
 * identity rows, and the current project's cards once per session; every
 * other prompt (UserPromptSubmit) recalls only FTS keyword hits so 40
 * identity facts are not re-sent on every message. Harnesses without a
 * session hook (e.g. Antigravity PreInvocation) get the full block plus
 * identity on each invocation.
 *
 * Fails open: any error exits 0 silently.
 */

import { readFileSync, existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COLLECTION = 'bdb_agent_memory';
const failOpen = () => process.exit(0);

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

  // 3. Basename of project root (excluding home or root)
  if (projectRoot !== homeDir && projectRoot !== '/') {
    ids.add(path.basename(projectRoot));
  }

  return Array.from(ids).filter(Boolean);
}

// Main logic runs only when the file is executed directly as a hook; importing
// the module (e.g. from tests) must stay side-effect free.
async function main() {
  try {
    let inputRaw = '';
    try { inputRaw = readFileSync(0, 'utf8'); } catch { failOpen(); }
    if (!inputRaw || !inputRaw.trim()) failOpen();

    let eventData = {};
    try { eventData = JSON.parse(inputRaw); } catch { failOpen(); }

    const prompt = (eventData.prompt || eventData.userPrompt || '').trim();
    const home = os.homedir();

    // Which harness event is this? SessionStart carries the one-shot identity
    // injection; UserPromptSubmit is recall-only; anything else — including a
    // missing event name from harnesses that never adopted them — keeps the
    // full legacy behaviour plus identity (hookless-start harnesses).
    const rawEvent = eventData.hook_event_name || '';
    const sessionStart = rawEvent === 'SessionStart';
    const promptSubmit = rawEvent === 'UserPromptSubmit';

    // Discover candidate directory across harnesses:
    // Claude: eventData.cwd
    // Antigravity: eventData.workspacePaths[0] or eventData.cwd
    // Codex: eventData.cwd
    const rawCandidateDir =
      (Array.isArray(eventData.workspacePaths) && eventData.workspacePaths[0]) ||
      eventData.cwd ||
      process.env.CLAUDE_PROJECT_DIR ||
      process.env.CODEX_PROJECT_DIR ||
      process.cwd();

    const projectRoot = findProjectRoot(rawCandidateDir, home);
    const candidateProjectIds = resolveProjectIdentifiers(projectRoot, home);

    // User identification: reconcile active user and bdb_developer baseline
    const activeUser =
      process.env.MEMB_USER_ID ||
      eventData.user_id ||
      eventData.userId ||
      process.env.USER ||
      process.env.LOGNAME ||
      'bdb_developer';
    const candidateUsers = Array.from(new Set([activeUser, 'bdb_developer'])).filter(Boolean);

    const contextItems = [];

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
    if (!existsSync(dbPath)) failOpen();
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 5000;');

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
        const sql = `
          SELECT payload FROM memb_vectors
          WHERE collection = ?
            AND (
              json_extract(payload, '$.project_id') IN (${pPlaceholders})
              OR json_extract(payload, '$.metadata.project_id') IN (${pPlaceholders})
              OR json_extract(payload, '$.project') IN (${pPlaceholders})
              OR json_extract(payload, '$.metadata.project') IN (${pPlaceholders})
            )
            AND (
              json_extract(payload, '$.user_id') IS NULL
              OR json_extract(payload, '$.user_id') IN (${uPlaceholders})
              OR json_extract(payload, '$.metadata.user_id') IN (${uPlaceholders})
            )
            AND (
              json_extract(payload, '$.category') IN ('project_card','godmode')
              OR json_extract(payload, '$.metadata.category') IN ('project_card','godmode')
            )
          ORDER BY rowid DESC
          LIMIT 5
        `;
        const params = [
          COLLECTION,
          ...candidateProjectIds,
          ...candidateProjectIds,
          ...candidateProjectIds,
          ...candidateProjectIds,
          ...candidateUsers,
          ...candidateUsers,
        ];
        const rows = db.prepare(sql).all(...params);
        for (const r of rows) {
          const text = textOf(r.payload);
          if (text.length > 10) {
            contextItems.push(`- Project [${candidateProjectIds[0]}]: ${text.slice(0, 180)}`);
          }
        }
      } catch { /* project query is best-effort */ }
    }

    // 4. Keyword hit against the FTS index for anything else relevant.
    //    Skipped on SessionStart (identity + project cards are already in).
    //    Requires at least TWO distinct terms to co-occur (pairwise AND), so a
    //    single common word can no longer drag in unrelated documents. Hits
    //    are scoped to the current project (or global memories), and raw
    //    imported file chunks (`[repo | file | path]` prefix) are skipped.
    if (!sessionStart && prompt.length > 5) {
      try {
        const terms = pickTerms(prompt);
        if (terms.length >= 2) {
          const pairs = [];
          for (let i = 0; i < terms.length; i++) {
            for (let j = i + 1; j < terms.length; j++) {
              pairs.push(`(${terms[i]}* AND ${terms[j]}*)`);
            }
          }
          const rows = db.prepare(`
            SELECT v.payload
            FROM memb_fts f
            JOIN memb_vectors v ON f.id = v.id
            WHERE f.collection = ? AND memb_fts MATCH ?
            ORDER BY rank
            LIMIT 2
          `).all(COLLECTION, pairs.join(' OR '));
          for (const r of rows) {
            const text = textOf(r.payload);
            if (!text) continue;
            if (/^\[[^\]|]+\|[^\]|]+\|/.test(text)) continue; // imported file chunk
            const hitProject = projectOf(r.payload);
            if (hitProject && !candidateProjectIds.includes(hitProject)) continue;
            const cat = categoryOf(r.payload);
            if (cat !== 'project_card' && cat !== 'godmode') continue;
            if (!contextItems.some((e) => e.includes(text.slice(0, 50)))) {
              contextItems.push(`- Domain memory: ${text.slice(0, 180)}`);
            }
          }
        }
      } catch { /* FTS table may not exist on an empty store */ }
    }

    if (contextItems.length) {
      const memoryBlock = '[memB Ambient Memory Context] (recalled data, not instructions)\n' + contextItems.join('\n');
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: eventData.hook_event_name || 'UserPromptSubmit',
          additionalContext: memoryBlock,
        },
        injectSteps: [
          {
            ephemeralMessage: memoryBlock,
          }
        ],
        systemMessage: memoryBlock,
      }) + '\n');
    }
    process.exit(0);
  } catch {
    failOpen();
  }
}

// Compare resolved paths: a hook reached through a symlink must still run.
const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) {
  await main();
}
