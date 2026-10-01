#!/usr/bin/env node
// UserPromptSubmit hook for the go-gate modes and grants. When the human types,
// as the whole message (plain form, primary):
//   gogate grant <scope[,scope...]> <15m|2h|1d|session>
//   gogate hard|soft|off|status
// or the slash form /bdb-aos:gogate ... (rarely verifies, the hook says so),
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
  gogateCommandsFor, statusText, listStateKeys, OPENCODE_MAX_GRANT_MS,
} from "./go-gate.mjs";

const emptyState = (source) => ({ transcript: source, grants: [] });

// Applies a gogate prompt to the store. `source` is the transcript path or
// "opencode:<sessionID>"; `uuid` the message id when the harness knows it.
// Returns the text for the model (additionalContext), or null for non-gogate prompts.
export function applyGogate(prompt, { key, source, uuid = null, now = Date.now(), opencode = false }) {
  const p = parseGogate(prompt);
  if (!p) return null;
  const slashNote = p.form === "slash"
    ? ` Note: this was a slash command. ${opencode ? "OpenCode accepts only the plain form" : "Claude Code stores slash commands without human-origin data, so the gate will most likely ignore it"}; to make it count, type the plain form as the whole message: \`gogate ${p.cmd === "grant" ? `grant ${p.scopes.join(",")} ${p.session ? "session" : "<duration>"}` : p.cmd || "status"}\`.`
    : "";
  if (p.error) return `gogate: ${p.error}. Nothing changed.`;
  if (!key || !source) return "gogate: no session id in hook input, nothing recorded.";
  if (process.env.AOS_ACP_CLIENT) return "gogate: an aos-acp worker session cannot set modes or grants.";
  if (p.cmd === "status") return status(key);
  if (opencode && p.cmd === "off") return "gogate: `off` is not available on OpenCode (no human-origin signal there). Nothing changed.";
  let st = readState(key);
  if (!st || typeof st !== "object" || st.transcript !== source) st = emptyState(source);
  const src = { transcript: source, uuid, issued_at: new Date(now).toISOString(), text_hash: textHash(prompt) };
  if (p.cmd === "grant") {
    const ms = opencode ? Math.min(p.ms, OPENCODE_MAX_GRANT_MS) : p.ms;
    st.grants = (Array.isArray(st.grants) ? st.grants : []).filter((g) => Date.parse(g?.until) > now);
    for (const scope of p.scopes) st.grants.push({ scope, until: new Date(now + ms).toISOString(), ...(p.session ? { session_key: key } : {}), source: src });
  } else {
    // Append, never overwrite: a later prompt that does not verify must not erase the
    // store entry of the mode that is still in force.
    st.modes = [...(Array.isArray(st.modes) ? st.modes : []), { mode: p.cmd, source: src }].slice(-20);
  }
  try {
    writeState(key, st);
  } catch (e) {
    return `gogate: could NOT record ${p.cmd}: writing ~/.aos/gate failed (${e.code || e.message}). Nothing changed; the gate stays as it was. Tell the human.`;
  }
  gateLog(key, `recorded ${p.form} ${p.cmd}${p.scopes ? ` ${p.scopes.join(",")} ${p.session ? "session" : `${p.ms / 60000}m`}` : ""}`);
  return [
    `gogate: recorded ${p.cmd}${p.scopes ? ` for ${p.scopes.join(", ")}` : ""}${p.session ? " (session = this session id, at most 24h, survives --resume)" : ""}${opencode && p.cmd === "grant" && p.ms > OPENCODE_MAX_GRANT_MS ? " (capped at 2h on OpenCode)" : ""}.`,
    "The gate verifies it against this prompt in the transcript on every use.",
    slashNote,
    "Tell the human what was recorded; never try to change modes or grants yourself.",
  ].filter(Boolean).join(" ");
}

export function status(key) {
  const st = readState(key);
  const eff = st ? effectiveGate(key, { source: st.transcript, cmds: gogateCommandsFor(st.transcript), opencode: String(st.transcript).startsWith("opencode:") }) : { mode: "soft", grants: [], rejected: [] };
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
