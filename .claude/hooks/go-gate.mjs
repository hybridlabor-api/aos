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

import { readFileSync } from "node:fs";

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

function lastUserMessageIsGo(transcriptPath) {
  let raw;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch (e) {
    return { ok: false, reason: `could not read transcript (${e.message})` };
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
      const isGo = /^GO$/i.test(text.trim());
      return { ok: isGo, reason: `last user message was: ${JSON.stringify(text)}` };
    }

    // 2. Claude Code transcript entry format
    if (entry.type === "user" || entry.role === "user") {
      if (entry.isSidechain === true) continue;
      const content = entry.message?.content ?? entry.content;
      const text = extractClaudeText(content).trim();
      if (!text) continue;
      const isGo = /^GO$/i.test(text);
      return { ok: isGo, reason: `last user message was: ${JSON.stringify(text)}` };
    }
  }

  return { ok: false, reason: "no user message found in transcript" };
}

function main() {
  const rawInput = readStdin();
  let input = {};
  if (rawInput.trim()) {
    try {
      input = JSON.parse(rawInput);
    } catch (e) {
      // If we cannot parse hook input, fail closed
      respond(true, false, `could not parse hook input: ${e.message}`, "unknown");
      return;
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

  const result = lastUserMessageIsGo(transcriptPath);
  if (result.ok) {
    respond(isAgy, true, "", command);
  } else {
    respond(isAgy, false, result.reason, command);
  }
}

main();
