#!/usr/bin/env node
// UserPromptSubmit hook: when the human types exactly `GO <session-name>` in a
// master session, record a single-use token that go-gate.mjs in <session-name>
// accepts. Writes nothing else and never blocks the prompt.

import { readFileSync, writeFileSync, mkdirSync, realpathSync, readdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { slug, TOKEN_TTL_MS } from "./go-gate.mjs";

function sessionName(transcriptPath) {
  let name = "";
  try {
    for (const line of readFileSync(transcriptPath, "utf8").split("\n")) {
      if (!line.includes('"agent-name"') && !line.includes('"custom-title"')) continue;
      try {
        const e = JSON.parse(line);
        if (e.type === "agent-name" && e.agentName) name = e.agentName;
        else if (e.type === "custom-title" && e.customTitle && !name) name = e.customTitle;
      } catch { /* partial line */ }
    }
  } catch { /* unreadable transcript */ }
  return name || process.env.AOS_SESSION_NAME || "";
}

// Expired or unreadable tokens are never read again by anyone, so a write is the moment to drop them.
export function pruneExpiredTokens(dir, now = Date.now()) {
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".token")); } catch { return 0; }
  let removed = 0;
  for (const f of files) {
    let age = NaN;
    try { age = now - Date.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))?.issued_at); } catch { /* unreadable: drop */ }
    if (age >= 0 && age < TOKEN_TTL_MS) continue;
    try { unlinkSync(join(dir, f)); removed++; } catch { /* already gone */ }
  }
  return removed;
}

// Returns the token path, or null. Never throws. An aos-acp worker is a worker
// by definition and must not mint a token for itself.
export function issueGoToken(prompt, { transcript_path, session_id, message_id } = {}) {
  try {
    const m = /^GO\s+(\S(?:.*\S)?)$/i.exec(String(prompt ?? "").trim());
    if (!m || process.env.AOS_ACP_CLIENT) return null;
    const target = slug(m[1]);
    const base = { target: m[1].trim(), issued_at: new Date().toISOString() };
    let tok;
    if (transcript_path) tok = { ...base, master_transcript: transcript_path, master_session: sessionName(transcript_path) };
    else if (session_id && message_id) tok = { ...base, issuer: "opencode", master_session_id: session_id, master_message_id: message_id };
    if (!target || !tok) return null;
    const dir = join(homedir(), ".aos", "go");
    mkdirSync(dir, { recursive: true });
    pruneExpiredTokens(dir);
    const file = join(dir, `${target}.token`);
    writeFileSync(file, JSON.stringify(tok));
    return file;
  } catch { return null; }
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };

if (isMain()) {
  try {
    const input = JSON.parse(readFileSync(0, "utf8"));
    issueGoToken(input.prompt, input);
  } catch { /* a failing hook must never block the prompt */ }
  process.exit(0);
}
