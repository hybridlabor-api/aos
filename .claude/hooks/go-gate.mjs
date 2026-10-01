#!/usr/bin/env node
// PreToolUse gate for outward-facing / hard-to-reverse commands across harnesses:
// - Antigravity / Gemini CLI (hooks.json PreToolUse)
// - Claude Code (.claude/hooks/go-gate.mjs)
//
// Scope:
// 1. git push
// 2. npm publish
// 3. npm version
// 4. gh pr merge
// 5. gh release create
// 6. git reset --hard
// 7. git clean -f (force clean untracked files)
// 8. rm -r / rm -rf (recursive deletions)
//
// Gate validity: open ONLY if the LAST human-typed user message in the transcript
// is the literal word "GO" (case-insensitive, trimmed). Any other message closes it.
//
// Token path (master-session): a `GO <session>` typed by the human in a master
// session is turned into ~/.aos/go/<session>.token by go-token.mjs. This gate
// honours that token once, if it is <10 min old, names this session, and the
// master transcript it points at still ends with that very `GO <session>`.
// Own session name: latest agent-name/custom-title entry in this transcript
// (what --name / ListAgents show), else env AOS_SESSION_NAME. If neither is
// available the token path stays closed.
//
// A token is single-use per master message: the master's GO entry uuid (Claude)
// or message id (OpenCode) goes into ~/.aos/go/.consumed, so a re-minted token
// on an unchanged master cannot be replayed.
//
// Threat model: this stops accidental or replayed GOs, not an agent that can
// write arbitrary files; it can forge a master transcript. Nothing in-process fixes that.
//
// OpenCode-issued tokens (issuer "opencode") are verified offline against
// opencode.db, read-only. Limits: the schema is internal and undocumented, only
// the default XDG / ~/.local/share data dir is read, and bun:sqlite is an
// unverified fallback. Any miss fails closed; the human types a literal GO.

import { readFileSync, writeFileSync, existsSync, unlinkSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const GUARDED_PATTERNS = [
  /(?:^|[;&|]\s*)git\s+push\b/i,
  /(?:^|[;&|]\s*)npm\s+publish\b/i,
  /(?:^|[;&|]\s*)npm\s+version\b/i,
  /(?:^|[;&|]\s*)gh\s+pr\s+merge\b/i,
  /(?:^|[;&|]\s*)gh\s+release\s+create\b/i,
  /(?:^|[;&|]\s*)git\s+reset\s+--hard\b/i,
  /(?:^|[;&|]\s*)git\s+clean\s+-[a-zA-Z]*f\b/i,
  /(?:^|[;&|]\s*)rm\s+(?:-\w*[rR]\w*|--recursive)\b/i,
];

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function respond(isAgy, allowed, reason = "", command = "") {
  if (isAgy) {
    if (allowed) {
      console.log(JSON.stringify({ decision: "allow" }));
    } else {
      console.log(JSON.stringify({
        decision: "deny",
        reason: `[MECHANICAL GO-GATE BLOCKED] Der Befehl "${command.slice(0, 100)}" wurde blockiert. Er erfordert ein frisches, isoliertes "GO" als letzte Benutzereingabe. ${reason}`
      }));
    }
    process.exit(0);
  } else {
    // Claude Code harness
    if (allowed) {
      process.exit(0);
    } else {
      process.stderr.write(
        `Blocked by go-gate hook: command "${command.slice(0, 80)}" requires a fresh, literal "GO" as your last message. ${reason}\n`
      );
      process.exit(2);
    }
  }
}

function extractClaudeText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

function extractAgyText(rawContent) {
  if (!rawContent || typeof rawContent !== "string") return "";
  // Strip metadata tags if present
  let text = rawContent.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, "");
  const match = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
  if (match) {
    text = match[1];
  }
  return text.trim();
}

export const slug = (s) => s.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
const TOKEN_TTL_MS = 10 * 60 * 1000;

function ownSessionName(transcriptPath) {
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
  } catch { /* unreadable */ }
  return name || process.env.AOS_SESSION_NAME || "";
}

const CONSUMED_KEEP = 200;
const consumedFile = () => join(homedir(), ".aos", "go", ".consumed");
const readConsumed = () => {
  try { return readFileSync(consumedFile(), "utf8").split("\n").filter(Boolean); } catch (e) { return e.code === "ENOENT" ? [] : null; }
};

function opencodeLastUser(sessionId) {
  let db;
  try {
    const dbPath = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode", "opencode.db");
    if (typeof sessionId !== "string" || !existsSync(dbPath)) return null;
    const require = createRequire(import.meta.url);
    try {
      db = new (require("node:sqlite").DatabaseSync)(dbPath, { readOnly: true });
    } catch {
      db = new (require("bun:sqlite").Database)(dbPath, { readonly: true });
    }
    const ses = db.prepare("SELECT parent_id FROM session WHERE id = ?").get(sessionId);
    if (!ses || ses.parent_id != null) return null; // subagent sessions are agent-written, never a human GO
    const msg = db.prepare(
      "SELECT id FROM message WHERE session_id = ? AND json_extract(data, '$.role') = 'user' ORDER BY time_created DESC, id DESC LIMIT 1"
    ).get(sessionId);
    if (!msg) return null;
    const text = db.prepare("SELECT data FROM part WHERE message_id = ? ORDER BY id").all(msg.id)
      .map((r) => JSON.parse(r.data))
      .filter((p) => p?.type === "text" && !p.synthetic && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n")
      .trim();
    return { id: msg.id, text };
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

// Shared with bin/aos-acp.mjs (ACP permission requests). `consume: false`
// verifies without deleting the token, for a caller whose inner gate owns it.
export function tokenGrantsGo(own, { consume = true } = {}) {
  if (typeof own !== "string" || !slug(own)) return { ok: false, reason: "no session name derivable for token path" };
  const file = join(homedir(), ".aos", "go", `${slug(own)}.token`);
  if (!existsSync(file)) return { ok: false, reason: "no GO token for this session" };
  let tok;
  try {
    tok = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { ok: false, reason: "GO token unreadable" };
  }
  const age = Date.now() - Date.parse(tok?.issued_at);
  if (!(age >= 0 && age < TOKEN_TTL_MS)) {
    try { unlinkSync(file); } catch { /* already gone */ }
    return { ok: false, reason: "GO token expired" };
  }
  if (typeof tok.target !== "string" || slug(tok.target) !== slug(own)) {
    return { ok: false, reason: "GO token names another session" };
  }
  const want = `go ${own.trim().toLowerCase()}`;
  let key;
  if (tok.issuer === "opencode") {
    const last = opencodeLastUser(tok.master_session_id);
    if (!last || last.id !== tok.master_message_id || last.text.toLowerCase() !== want) {
      return { ok: false, reason: "master session no longer ends with this GO" };
    }
    key = last.id;
  } else if (typeof tok.master_transcript === "string") {
    const last = lastUserText(tok.master_transcript);
    if (!last.text || last.text.trim().toLowerCase() !== want) {
      return { ok: false, reason: "master transcript no longer ends with this GO" };
    }
    if (!last.uuid) return { ok: false, reason: "master GO entry has no uuid" };
    key = last.uuid;
  } else {
    return { ok: false, reason: "GO token has no master transcript" };
  }
  const consumed = readConsumed();
  if (!consumed) return { ok: false, reason: "GO consumed list unreadable" };
  if (consumed.includes(key)) return { ok: false, reason: "GO already used" };
  if (consume) {
    try {
      // ponytail: read-modify-write, concurrent consumers in the same ms can drop a key; switch to append+trim if that ever matters.
      writeFileSync(consumedFile(), [...consumed, key].slice(-CONSUMED_KEEP).join("\n") + "\n");
      unlinkSync(file);
    } catch { return { ok: false, reason: "could not consume GO token" }; }
  }
  return { ok: true };
}

function lastUserMessageIsGo(transcriptPath) {
  const last = lastUserText(transcriptPath);
  if (last.error) return { ok: false, reason: last.error };
  if (last.text === null) return { ok: false, reason: "no user message found in transcript" };
  return { ok: /^GO$/i.test(last.text.trim()), reason: `last user message was: ${JSON.stringify(last.text)}` };
}

export function lastUserText(transcriptPath) {
  let raw;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch (e) {
    return { text: null, error: `could not read transcript (${e.message})` };
  }

  const lines = raw.split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue; // tolerate partial/trailing lines
    }

    // 1. Antigravity transcript entry format
    if (entry.type === "USER_INPUT" || entry.source === "USER_EXPLICIT") {
      const text = extractAgyText(entry.content);
      if (!text) continue;
      return { text };
    }

    // 2. Claude Code transcript entry format
    if (entry.type === "user" || entry.role === "user") {
      if (entry.isSidechain === true) continue;
      const content = entry.message?.content ?? entry.content;
      const text = extractClaudeText(content).trim();
      if (!text) continue;
      return { text, uuid: entry.uuid ?? null };
    }
  }

  return { text: null };
}

function main() {
  const rawInput = readStdin();
  let input = {};
  if (rawInput.trim()) {
    try {
      input = JSON.parse(rawInput);
    } catch (e) {
      // Harness unknown: deny JSON on stdout (Antigravity) plus stderr + exit 2 (Claude Code/Codex) closes every path.
      const reason = `could not parse hook input: ${e.message}`;
      console.log(JSON.stringify({ decision: "deny", reason: `[MECHANICAL GO-GATE BLOCKED] ${reason}` }));
      process.stderr.write(`Blocked by go-gate hook: ${reason}\n`);
      process.exit(2);
    }
  }

  // Detect harness
  const isAgy = !!(input?.toolCall || input?.conversationId || input?.artifactDirectoryPath || input?.workspacePaths);

  const command =
    input?.toolCall?.args?.CommandLine ||
    input?.toolCall?.args?.command ||
    input?.tool_input?.command ||
    input?.command ||
    "";

  if (typeof command !== "string" || !command.trim()) {
    respond(isAgy, true);
    return;
  }

  const isGuarded = GUARDED_PATTERNS.some((re) => re.test(command));
  if (!isGuarded) {
    respond(isAgy, true);
    return;
  }

  const transcriptPath = input?.transcriptPath || input?.transcript_path;
  if (!transcriptPath) {
    respond(isAgy, false, "no transcriptPath in hook input — cannot verify GO", command);
    return;
  }

  let result = lastUserMessageIsGo(transcriptPath);
  if (!result.ok) {
    const token = tokenGrantsGo(ownSessionName(transcriptPath));
    if (token.ok) result = token;
    else result.reason += `; ${token.reason}`;
  }
  if (result.ok) {
    respond(isAgy, true, "", command);
  } else {
    respond(isAgy, false, result.reason, command);
  }
}

// Run as a hook (node go-gate.mjs); importing it (bin/aos-acp.mjs) must not.
const invokedAs = (() => { try { return realpathSync(process.argv[1] || ""); } catch { return ""; } })();
if (invokedAs === fileURLToPath(import.meta.url)) main();
