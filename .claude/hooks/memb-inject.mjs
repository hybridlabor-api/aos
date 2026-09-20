#!/usr/bin/env node
// aos-hook-version: 3
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
 * Fails open: any error exits 0 silently.
 */

import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const COLLECTION = 'bdb_agent_memory';
const failOpen = () => process.exit(0);

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

try {
  let inputRaw = '';
  try { inputRaw = readFileSync(0, 'utf8'); } catch { failOpen(); }
  if (!inputRaw || !inputRaw.trim()) failOpen();

  let eventData = {};
  try { eventData = JSON.parse(inputRaw); } catch { failOpen(); }

  const prompt = (eventData.prompt || eventData.userPrompt || '').trim();
  const home = os.homedir();

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

  // 1. Standing facts, if the user keeps any.
  const personaFile = path.join(home, '.MemBDB', 'ambient-persona.txt');
  if (existsSync(personaFile)) {
    try {
      for (const line of readFileSync(personaFile, 'utf8').split('\n')) {
        const t = line.trim();
        if (t && !t.startsWith('#')) contextItems.push(`- ${t}`);
      }
    } catch {}
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

  // 2. Query project-specific memories matching any candidate project ID
  if (candidateProjectIds.length > 0) {
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

  // 3. Keyword hit against the FTS index for anything else relevant.
  if (prompt.length > 5) {
    try {
      const terms = prompt
        .replace(/[^\p{L}\p{N}_-]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 4);
      if (terms.length) {
        const rows = db.prepare(`
          SELECT v.payload
          FROM memb_fts f
          JOIN memb_vectors v ON f.id = v.id
          WHERE f.collection = ? AND memb_fts MATCH ?
          ORDER BY rank
          LIMIT 2
        `).all(COLLECTION, terms.map((t) => `${t}*`).join(' OR '));
        for (const r of rows) {
          const text = textOf(r.payload);
          if (text && !contextItems.some((e) => e.includes(text.slice(0, 50)))) {
            contextItems.push(`- Domain memory: ${text.slice(0, 180)}`);
          }
        }
      }
    } catch { /* FTS table may not exist on an empty store */ }
  }

  if (contextItems.length) {
    const memoryBlock = '[memB Ambient Memory Context]\n' + contextItems.join('\n');
    const hookEvent = eventData.hook_event_name || 'UserPromptSubmit';
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: hookEvent,
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
