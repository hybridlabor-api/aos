/**
 * BDB Agent OS (AOS) plugin for OpenCode.
 *
 * Implements:
 * 1. tool.execute.before: Releases gatekeeper (go-gate). Guards outward-facing
 *    or hard-to-reverse actions (git push, npm publish, npm version, rm -rf)
 *    unless the user explicitly authorized it with the literal word "GO".
 * 2. chat.message: Ambient memory injection (memB). Injects relevant project & user
 *    memories as ephemeral context from ~/.MemBDB/memb.db via node:sqlite.
 *
 * Zero external runtime dependencies. Fails open on memory lookup, fails closed
 * on unguarded destructive actions.
 */

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GUARDED_PATTERNS = [
  /^\s*git\s+push\b/i,
  /^\s*npm\s+publish\b/i,
  /^\s*npm\s+version\b/i,
  /^\s*rm\s+(-\w*[rR]\w*|--recursive)\b/i,
];

let lastHumanPrompt = '';

function isGuardedCommand(cmd) {
  if (typeof cmd !== 'string') return false;
  return GUARDED_PATTERNS.some((re) => re.test(cmd));
}

function verifyGoAuthorized(lastPrompt) {
  const trimmed = (lastPrompt || '').trim();
  return trimmed.toUpperCase() === 'GO';
}

// Extract ambient memory from local memB database
async function getMembContext(prompt, currentDir) {
  const home = os.homedir();
  const dbPath = path.join(home, '.MemBDB', 'memb.db');
  if (!existsSync(dbPath)) return null;

  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 3000;');

    const contextItems = [];

    // Standing persona facts
    const personaFile = path.join(home, '.MemBDB', 'ambient-persona.txt');
    if (existsSync(personaFile)) {
      try {
        for (const line of readFileSync(personaFile, 'utf8').split('\n')) {
          const t = line.trim();
          if (t && !t.startsWith('#')) contextItems.push(`- ${t}`);
        }
      } catch {}
    }

    // Resolve project ID candidate
    let projectName = path.basename(currentDir);
    const pkgPath = path.join(currentDir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg?.name) projectName = pkg.name;
      } catch {}
    }

    // Query project memories
    try {
      const sql = `
        SELECT payload FROM memb_vectors
        WHERE collection = 'bdb_agent_memory'
          AND (
            json_extract(payload, '$.project_id') = ?
            OR json_extract(payload, '$.metadata.project_id') = ?
            OR json_extract(payload, '$.project') = ?
            OR json_extract(payload, '$.metadata.project') = ?
          )
        ORDER BY rowid DESC
        LIMIT 3
      `;
      const rows = db.prepare(sql).all(projectName, projectName, projectName, projectName);
      for (const r of rows) {
        try {
          const p = JSON.parse(r.payload);
          const text = (p.memory || p.data || '').trim().replace(/\s+/g, ' ');
          if (text.length > 10) {
            contextItems.push(`- Project [${projectName}]: ${text.slice(0, 180)}`);
          }
        } catch {}
      }
    } catch {}

    db.close();

    if (contextItems.length === 0) return null;
    return `[AOS Ambient Memory - memB]\n${contextItems.join('\n')}`;
  } catch {
    return null;
  }
}

export default async function bdbAosPlugin(input) {
  const directory = input.directory || process.cwd();

  return {
    'chat.message': async (msgInput, msgOutput) => {
      // Capture the user prompt text for GO-gate verification
      const textParts = (msgOutput.parts || []).filter((p) => p && p.type === 'text' && typeof p.text === 'string');
      const fullText = textParts.map((p) => p.text).join('\n').trim();
      if (fullText) {
        lastHumanPrompt = fullText;
      }

      // Inject memB ambient memory
      try {
        const membContext = await getMembContext(fullText, directory);
        if (membContext) {
          msgOutput.parts.unshift({
            id: `memb-${Date.now()}`,
            sessionID: msgInput.sessionID,
            messageID: msgInput.messageID || '',
            type: 'text',
            text: membContext,
            synthetic: true,
          });
        }
      } catch {}
    },

    'tool.execute.before': async (toolInput, toolOutput) => {
      const toolName = (toolInput.tool || '').toLowerCase();
      // Intercept bash, terminal, or command execution tools
      if (toolName === 'bash' || toolName === 'terminal' || toolName === 'shell' || toolName === 'exec' || toolName === 'run_command') {
        const cmd = toolOutput?.args?.command || toolOutput?.args?.cmd || toolOutput?.args?.script || '';
        if (isGuardedCommand(cmd)) {
          let authorized = verifyGoAuthorized(lastHumanPrompt);

          // If last cached prompt wasn't GO, query recent session messages via OpenCode client as fallback
          if (!authorized && input.client && toolInput.sessionID) {
            try {
              const res = await input.client.session.messages({ path: { id: toolInput.sessionID } });
              const msgs = res?.data || [];
              for (let i = msgs.length - 1; i >= 0; i--) {
                const m = msgs[i];
                if (m.role === 'user') {
                  const parts = m.parts || [];
                  const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n').trim();
                  if (text) {
                    authorized = (text.toUpperCase() === 'GO');
                    break;
                  }
                }
              }
            } catch {}
          }

          if (!authorized) {
            throw new Error(
              `Blocked by BDB go-gate: Command "${cmd.slice(0, 80)}" is guarded and requires explicit authorization with the literal word "GO" before proceeding.`
            );
          }
        }
      }
    },
  };
}
