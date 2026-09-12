#!/usr/bin/env node
/**
 * memB ambient memory hook for Claude Code (UserPromptSubmit).
 *
 * Reads ~/.MemBDB/memb.db directly through node:sqlite and injects the most
 * relevant memories as ephemeral additionalContext — nothing is written to
 * disk and nothing lands in git. Fails open: any error exits 0 silently, so a
 * broken memory store can never block a prompt.
 *
 * Install: copy to ~/.claude/hooks/memb-inject.mjs and wire it as a
 * UserPromptSubmit hook (see the aos-setup skill, section 4).
 *
 * Optional: put standing facts (persona, brand, house rules) one per line in
 * ~/.MemBDB/ambient-persona.txt — they are prepended to every prompt.
 */

import { readFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';

const COLLECTION = 'bdb_agent_memory';
const failOpen = () => process.exit(0);

try {
  let inputRaw = '';
  try { inputRaw = readFileSync(0, 'utf8'); } catch { failOpen(); }
  if (!inputRaw || !inputRaw.trim()) failOpen();

  let eventData;
  try { eventData = JSON.parse(inputRaw); } catch { failOpen(); }

  const prompt = (eventData.prompt || '').trim();
  const cwd = eventData.cwd || process.cwd();
  const projectName = path.basename(cwd);
  const home = os.homedir();

  const contextItems = [];

  // 1. Standing facts, if the user keeps any.
  const personaFile = path.join(home, '.MemBDB', 'ambient-persona.txt');
  if (existsSync(personaFile)) {
    for (const line of readFileSync(personaFile, 'utf8').split('\n')) {
      const t = line.trim();
      if (t && !t.startsWith('#')) contextItems.push(`- ${t}`);
    }
  }

  const dbPath = path.join(home, '.MemBDB', 'memb.db');
  if (!existsSync(dbPath)) failOpen();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000;');

  const textOf = (payload) => {
    const p = JSON.parse(payload);
    return (p.memory || p.data || '').trim().replace(/\s+/g, ' ');
  };

  // 2. Memories bound to this project (memB's project_id is the folder name).
  if (projectName && projectName !== path.basename(home)) {
    try {
      const rows = db.prepare(`
        SELECT payload FROM memb_vectors
        WHERE collection = ?
          AND (json_extract(payload, '$.project_id') = ?
            OR json_extract(payload, '$.metadata.project_id') = ?)
        ORDER BY rowid DESC
        LIMIT 3
      `).all(COLLECTION, projectName, projectName);
      for (const r of rows) {
        const text = textOf(r.payload);
        if (text.length > 10) contextItems.push(`- Project [${projectName}]: ${text.slice(0, 180)}`);
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
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: '[memB Ambient Memory Context]\n' + contextItems.join('\n'),
      },
    }) + '\n');
  }
  process.exit(0);
} catch {
  failOpen();
}
