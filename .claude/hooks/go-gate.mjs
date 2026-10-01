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

import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const GUARDED_PATTERNS = [
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

const slug = (s) => s.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
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

function tokenGrantsGo(transcriptPath) {
  const own = ownSessionName(transcriptPath);
  if (!slug(own)) return { ok: false, reason: "no session name derivable for token path" };
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
  if (typeof tok.master_transcript !== "string") return { ok: false, reason: "GO token has no master transcript" };
  const last = lastUserText(tok.master_transcript);
  if (!last.text || last.text.trim().toLowerCase() !== `go ${own.trim().toLowerCase()}`) {
    return { ok: false, reason: "master transcript no longer ends with this GO" };
  }
  try { unlinkSync(file); } catch { return { ok: false, reason: "could not consume GO token" }; }
  return { ok: true };
}

function lastUserMessageIsGo(transcriptPath) {
  const last = lastUserText(transcriptPath);
  if (last.error) return { ok: false, reason: last.error };
  if (last.text === null) return { ok: false, reason: "no user message found in transcript" };
  return { ok: /^GO$/i.test(last.text.trim()), reason: `last user message was: ${JSON.stringify(last.text)}` };
}

function lastUserText(transcriptPath) {
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
      return { text };
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
    const token = tokenGrantsGo(transcriptPath);
    if (token.ok) result = token;
    else result.reason += `; ${token.reason}`;
  }
  if (result.ok) {
    respond(isAgy, true, "", command);
  } else {
    respond(isAgy, false, result.reason, command);
  }
}

main();
