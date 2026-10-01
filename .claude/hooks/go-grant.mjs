#!/usr/bin/env node
// UserPromptSubmit hook for the go-gate modes and grants. When the human types
//   /bdb-aos:gogate grant <scope[,scope...]> <15m|2h|1d|session>
//   /bdb-aos:gogate hard|soft|off|status          (also /bdb-aos-gogate ...)
// it records the request in ~/.aos/gate/<session-key>.json with a pointer to
// the prompt (transcript, issue time, text hash). Nothing here is trusted on
// its own: go-gate.mjs re-reads the transcript at use time and honours an
// entry only if a human-typed (origin-checked) prompt with that hash exists.
// A loop, peer, bus or agent prompt may reach this hook, but its transcript
// entry is not human, so what it records never verifies.
//
// CLI: node go-grant.mjs --status [--session <id>]   (read-only, prints status)

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseGogate, textHash, sessionKey, readState, writeState, gateLog, effectiveGate,
  gogateCommandsFor, statusText, listStateKeys,
} from "./go-gate.mjs";

const emptyState = (source) => ({ transcript: source, grants: [] });

// Applies a gogate prompt to the store. `source` is the transcript path or
// "opencode:<sessionID>"; `uuid` the message id when the harness knows it.
// Returns the text for the model (additionalContext), or null for non-gogate prompts.
export function applyGogate(prompt, { key, source, uuid = null, now = Date.now() }) {
  const p = parseGogate(prompt);
  if (!p) return null;
  if (p.error) return `gogate: ${p.error}. Nothing changed.`;
  if (!key || !source) return "gogate: no session id in hook input, nothing recorded.";
  if (process.env.AOS_ACP_CLIENT) return "gogate: an aos-acp worker session cannot set modes or grants.";
  if (p.cmd === "status") return status(key);
  let st = readState(key);
  if (!st || st.transcript !== source) st = emptyState(source);
  const src = { transcript: source, uuid, issued_at: new Date(now).toISOString(), text_hash: textHash(prompt) };
  if (p.cmd === "grant") {
    for (const scope of p.scopes) {
      st.grants.push({ scope, until: new Date(now + p.ms).toISOString(), ...(p.session ? { session_key: key } : {}), source: src });
    }
    st.grants = st.grants.filter((g) => Date.parse(g.until) > now);
  } else {
    st.mode = p.cmd;
    st.mode_source = src;
  }
  try {
    writeState(key, st);
  } catch (e) {
    return `gogate: could NOT record ${p.cmd}: writing ~/.aos/gate failed (${e.code || e.message}). Nothing changed; the gate stays as it was. Tell the human.`;
  }
  gateLog(key, `recorded ${p.cmd}${p.scopes ? ` ${p.scopes.join(",")} ${p.session ? "session" : `${p.ms / 60000}m`}` : ""}`);
  return [
    `gogate: recorded ${p.cmd}${p.scopes ? ` for ${p.scopes.join(", ")}` : ""}${p.session ? " (session = this session id, at most 24h, survives --resume)" : ""}.`,
    "The gate verifies it against this prompt in the transcript on every use, and only accepts a prompt that Claude Code stored with human-origin data.",
    "Claude Code often stores slash commands without that data: if `/bdb-aos:gogate status` lists it as ignored, the human should type it again with a leading space (` /bdb-aos:gogate ...`) so it is stored as typed text.",
    "Tell the human what was recorded; never try to change modes or grants yourself.",
  ].join(" ");
}

export function status(key) {
  const st = readState(key);
  const eff = st ? effectiveGate(key, { source: st.transcript, cmds: gogateCommandsFor(st.transcript) }) : { mode: "soft", grants: [], rejected: [] };
  return statusText(key, eff);
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };

if (isMain()) {
  const argv = process.argv.slice(2);
  if (argv.includes("--status")) {
    const i = argv.indexOf("--session");
    const id = i !== -1 ? argv[i + 1] : process.env.AOS_GATE_SESSION || process.env.CLAUDE_SESSION_ID;
    const keys = id ? [sessionKey(id)] : listStateKeys();
    console.log(keys.length ? keys.map(status).join("\n\n") : "AOS go-gate: no session state; every session runs in soft mode with no grants (behaves like hard).");
    process.exit(0);
  }
  try {
    const input = JSON.parse(readFileSync(0, "utf8"));
    const text = applyGogate(input.prompt, { key: sessionKey(input.session_id), source: input.transcript_path });
    if (text) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text } }));
  } catch { /* a failing hook must never block the prompt */ }
  process.exit(0);
}
