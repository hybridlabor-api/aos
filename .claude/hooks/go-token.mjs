#!/usr/bin/env node
// UserPromptSubmit hook: when the human types exactly `GO <session-name>` in a
// master session, record a single-use token that go-gate.mjs in <session-name>
// accepts. Writes nothing else and never blocks the prompt.

import { mkdirSync, realpathSync, readdirSync, unlinkSync, constants as FS } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { slug, TOKEN_TTL_MS, readSmallRegular, writeNoHang, fileLines, readStdinBounded } from "./go-gate.mjs";

// Regular-file text or a throw: a planted FIFO/device must not hang the hook.
function mustRead(f, max) {
  const t = readSmallRegular(f, max, true);
  if (typeof t !== "string") throw new Error("not a small regular file");
  return t;
}

function sessionName(transcriptPath) {
  let name = "";
  try {
    for (const line of fileLines(transcriptPath)) {
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
    try { age = now - Date.parse(JSON.parse(mustRead(join(dir, f), 64 * 1024))?.issued_at); } catch { /* unreadable: drop */ }
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
    writeNoHang(file, JSON.stringify(tok), FS.O_TRUNC);
    return file;
  } catch { return null; }
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };

// In-process entry for aos-hooks.mjs; output-free and never throws.
export function hook(input) {
  try { issueGoToken(input?.prompt, input); } catch { /* a failing hook must never block the prompt */ }
  return { code: 0, stdout: "", stderr: "" };
}

if (isMain()) {
  try {
    hook(JSON.parse((await readStdinBounded(2000)) ?? ""));
  } catch { /* a failing hook must never block the prompt */ }
  process.exit(0);
}
