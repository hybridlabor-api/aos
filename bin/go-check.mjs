#!/usr/bin/env node
// go-check: one fixed answer to "may this worker run this guarded command?" for callers that
// are not a harness hook (AO). Installed at ~/.aos/bin/go-check.mjs.
//
//   node go-check.mjs --session <Name> --command "<shell string>" [--consume]
//   node go-check.mjs --session <Name> --ref <id> [--consume]   (GO-over-A2A reference check)
//   node go-check.mjs --write-patterns <file>
//
// REFERENCE MODE: --ref checks a GO-over-A2A reference id (the first 12 hex chars of the
// sha256 of the session's token file) instead of a command. Without --consume it verifies
// WITHOUT consuming; with --consume it consumes once (it also marks the ref as used in
// `.a2a-consumed` inside the GO store, so a replay is told apart from a forged ref).
// Nothing here ever creates a token.
//
// stdout: {"guarded":bool,"ok":bool,"scope":[...]|null,"reason":"..."}
// exit 0 allowed (not guarded, or a valid GO token; --consume uses it up), 1 guarded without a
// valid GO, 2 error (the caller must treat 2 as denied). Only `GO <Name>` tokens count: mode
// soft grants and mode off belong to the human session and are never read here. Nothing in
// this file writes a token; the tool is synchronous, offline and reads no stdin.

import { constants as FS, openSync, fstatSync, readSync, closeSync, existsSync, realpathSync, writeFileSync, readdirSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));

// Bounded regular-file read: a planted FIFO/device must not hang the check. Throws like
// readFileSync (ENOENT keeps its code) for a missing, non-regular or oversized file.
function readReg(f, max = 1 << 20) {
  const fd = openSync(f, FS.O_RDONLY | FS.O_NONBLOCK);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > max) throw new Error("not a small regular file");
    const buf = Buffer.alloc(st.size);
    let n = 0;
    while (n < st.size) { const k = readSync(fd, buf, n, st.size - n, n); if (!k) break; n += k; }
    return buf.toString("utf8", 0, n);
  } finally { closeSync(fd); }
}

async function loadGate() {
  for (const f of [join(here, "go-gate.mjs"), join(here, "..", ".claude", "hooks", "go-gate.mjs")]) {
    if (existsSync(f)) return import(pathToFileURL(f).href);
  }
  throw new Error("go-gate.mjs not found next to go-check.mjs or in ../.claude/hooks");
}

export const patternsJson = (gate) => ({
  version: 1,
  source: "go-gate.mjs GUARDED_PATTERNS (JavaScript RegExp syntax, lookaheads included; not RE2)",
  scopes: gate.SCOPES,
  patterns: gate.GUARDED_PATTERNS.map((r) => ({ source: r.source, flags: r.flags })),
});

export function check(gate, { session, command, consume = false }) {
  if (typeof command !== "string" || !command.trim()) return { code: 2, out: { guarded: null, ok: false, scope: null, reason: "--command is empty" } };
  // Same block cooldown as the hook, keyed by the worker name given as --session.
  const key = typeof session === "string" && session && gate.nameKey ? gate.nameKey(session) : "";
  gate.setGateContext?.({ cwd: process.cwd(), blockTs: key ? gate.readBlockTs(key) : 0 });
  const hard = gate.hardBlockReason(command);
  if (hard) { gate.markBlock?.(key); return { code: 1, out: { guarded: true, ok: false, scope: null, reason: hard } }; }
  const long = gate.commandTooLong?.(command);
  const storeReason = long ? null : gate.gateStoreReason(command);
  if (storeReason) return { code: 1, out: { guarded: true, ok: false, scope: null, reason: storeReason } };
  if (!gate.isGuardedCommand(command)) return { code: 0, out: { guarded: false, ok: true, scope: [], reason: "" } };
  const scope = gate.commandScopes(command);
  if (typeof session !== "string" || !gate.slug(session)) {
    return { code: 2, out: { guarded: true, ok: false, scope, reason: "--session is missing or has no usable name" } };
  }
  const r = gate.tokenGrantsGo(session, { consume });
  if (!r.ok) gate.markBlock?.(key);
  return r.ok
    ? { code: 0, out: { guarded: true, ok: true, scope, reason: consume ? "GO token consumed" : "GO token valid (not consumed)" } }
    : { code: 1, out: { guarded: true, ok: false, scope, reason: long ? `${gate.TOO_LONG_MESSAGE}; ${r.reason}` : r.reason } };
}

// --ref <id> --session <Name>: the GO-over-A2A path. The reference id is derived from the
// token itself, never chosen by an agent, so A2A traffic cannot satisfy it with chosen text.
// The reference is a POINTER (not a secret, not proof of approval of a task or action): a
// verify tells the caller that a valid token for THIS session is in the store; the session's
// own gate is the authority and consumes the token itself when the guarded command runs.
// Verify (no --consume) reads the store only and stays read-only; only a --consume is the
// gate's own single-use write.
export const refId = (tokenText) => createHash("sha256").update(String(tokenText ?? "")).digest("hex").slice(0, 12);

const A2A_REPLAY_KEEP = 200;
const consumedRefsPath = (dir) => join(dir, ".a2a-consumed");
export const readConsumedRefs = (dir) => {
  try { return readReg(consumedRefsPath(dir)).split("\n").filter(Boolean); } catch { return []; }
};
const markRefConsumed = (dir, ref) => {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const keys = [...readConsumedRefs(dir), `a2a:${ref}`].slice(-A2A_REPLAY_KEEP);
    const fd = openSync(consumedRefsPath(dir), FS.O_WRONLY | FS.O_CREAT | FS.O_TRUNC | FS.O_NOFOLLOW | FS.O_NONBLOCK, 0o600);
    try { writeFileSync(fd, keys.join("\n") + "\n"); } finally { closeSync(fd); }
  } catch { /* a failed replay mark is reported by nothing; the token itself is already gone */ }
};

export function checkRef(gate, { session, ref, consume = false }) {
  const id = String(ref ?? "").toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(id)) return { code: 1, out: { ok: false, reason: "malformed reference" } };
  const name = gate.slug(String(session ?? ""));
  if (!name) return { code: 1, out: { ok: false, reason: "malformed reference" } };
  const dir = join(homedir(), ".aos", "go");
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".token")); } catch { files = []; }
  let tokenText = null, matchedFile = null;
  for (const f of files) {
    let text;
    try { text = readReg(join(dir, f), 64 * 1024); } catch { continue; }
    if (refId(text) !== id) continue;
    if (tokenText !== null) return { code: 1, out: { ok: false, reason: "forged reference" } };
    tokenText = text;
    matchedFile = f;
  }
  if (tokenText === null) {
    const replayed = readConsumedRefs(dir).includes(`a2a:${id}`);
    return { code: 1, out: { ok: false, reason: replayed ? "GO already used" : "forged reference" } };
  }
  // Exactly ONE read of the matched file produced tokenText; the hash and the whole pointer
  // check below run on that one read (no re-read / no TOCTOU window).
  if (matchedFile !== `${name}.token`)
    return { code: 1, out: { ok: false, reason: "reference is for another session" } };
  let tok;
  try { tok = JSON.parse(tokenText); } catch { return { code: 1, out: { ok: false, reason: "malformed reference" } }; }
  if (!tok || typeof tok.target !== "string" || gate.slug(tok.target) !== name)
    return { code: 1, out: { ok: false, reason: "reference is for another session" } };
  const age = Date.now() - Date.parse(tok?.issued_at);
  if (!(age >= 0 && age < gate.TOKEN_TTL_MS))
    return { code: 1, out: { ok: false, reason: "GO token expired" } };
  // R4: --ref verify runs the same read-only checks tokenGrantsGo performs (master transcript
  // still ends with the GO; the GO is not in the consumed ledger) — WITHOUT the expiry unlink
  // and without any write. A revoked GO, or a token already in the consumed ledger whose file
  // still exists, must NOT verify.
  const still = tokenStillValid(gate, { name, tokenText });
  if (!still.ok) return { code: 1, out: { ok: false, reason: still.reason } };
  if (consume) {
    // Final authority stays with the gate: its own single-use write (master transcript still
    // ends with the GO, master-consumed ledger, token deletion).
    const g = gate.tokenGrantsGo(name, { consume: true });
    if (!g.ok) return { code: 1, out: { ok: false, reason: g.reason } };
    markRefConsumed(dir, id);
    return { code: 0, out: { ok: true, reason: "GO ref consumed" } };
  }
  return { code: 0, out: { ok: true, reason: "GO ref valid (not consumed)" } };
}

// R4: PURE read-only validity — the checks of the gate's tokenGrantsGo that do not write,
// split out for --ref verification. NO expiry unlink (an expired token's file is never deleted
// from here) and no consume: this function never writes or deletes anything. For
// claude-transcript tokens it re-checks target and TTL and requires that the master transcript
// STILL ends with the human-typed `GO <name>`; the GO's uuid must not sit in the consumed
// ledger (`~/.aos/go/.consumed`, read-only mirror of the gate's readConsumed()). For
// opencode-issued tokens the master-DB check is not reachable read-only from here, so only the
// consumed-ledger check runs against the minted message id (fail-closed when it is missing) —
// the gate itself re-checks everything at consume time either way.
export function tokenStillValid(gate, { name, tokenText }) {
  let tok;
  try { tok = JSON.parse(tokenText); } catch { return { ok: false, reason: "GO token unreadable" }; }
  if (!tok || typeof tok !== "object") return { ok: false, reason: "GO token unreadable" };
  const age = Date.now() - Date.parse(tok?.issued_at);
  if (!(age >= 0 && age < gate.TOKEN_TTL_MS)) return { ok: false, reason: "GO token expired" };
  if (typeof tok.target !== "string" || gate.slug(tok.target) !== name)
    return { ok: false, reason: "GO token names another session" };
  let key = null;
  if (tok.issuer === "opencode") {
    if (typeof tok.master_message_id !== "string" || !tok.master_message_id)
      return { ok: false, reason: "GO token has no master transcript" };
    key = tok.master_message_id;
  } else if (typeof tok.master_transcript === "string" && typeof gate.lastUserText === "function") {
    const last = gate.lastUserText(tok.master_transcript);
    if (last.error) return { ok: false, reason: last.error };
    if (!last.text || !last.human || last.text.trim().toLowerCase() !== `go ${name}`)
      return { ok: false, reason: "master transcript no longer ends with this GO" };
    if (!last.uuid) return { ok: false, reason: "master GO entry has no uuid" };
    key = last.uuid;
  } else {
    return { ok: false, reason: "GO token has no master transcript" };
  }
  let consumed;
  try {
    consumed = readReg(join(homedir(), ".aos", "go", ".consumed")).split("\n").filter(Boolean);
  } catch (e) {
    if (e?.code === "ENOENT") consumed = [];
    else return { ok: false, reason: "GO consumed list unreadable" };
  }
  if (consumed.includes(key)) return { ok: false, reason: "GO already used" };
  return { ok: true };
}

export function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--session") o.session = argv[++i];
    else if (a === "--command") o.command = argv[++i];
    else if (a === "--write-patterns") o.writePatterns = argv[++i];
    else if (a === "--consume") o.consume = true;
    else if (a === "--ref") o.ref = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

const done = (code, out) => process.stdout.write(JSON.stringify(out) + "\n", () => process.exit(code));

const invokedAs = (() => { try { return realpathSync(process.argv[1] || ""); } catch { return ""; } })();
const HELP = `go-check - may this worker run this guarded command?
Usage:
  node go-check.mjs --session <Name> --command "<shell string>" [--consume]
  node go-check.mjs --session <Name> --ref <id> [--consume]   (GO-over-A2A reference check)
  node go-check.mjs --write-patterns <file>
Prints one JSON line {"guarded":bool,"ok":bool,"scope":[...]|null,"reason":"..."}.
Exit: 0 allowed (not guarded, or a valid GO), 1 guarded without a valid GO, 2 error (treat as denied).
Read-only; --consume uses up a valid GO token once. Details: aos help go-check
`;

if (invokedAs === fileURLToPath(import.meta.url)) {
  const argv0 = process.argv.slice(2);
  if (argv0[0] === "help" || argv0.includes("--help") || argv0.includes("-h")) {
    process.stdout.write(HELP, () => process.exit(0));
    await new Promise(() => {});
  }
  try {
    const o = parseArgs(process.argv.slice(2));
    const gate = await loadGate();
    if (o.writePatterns) {
      writeFileSync(o.writePatterns, JSON.stringify(patternsJson(gate), null, 2) + "\n");
      done(0, { ok: true, reason: `wrote ${o.writePatterns}` });
    } else if (o.ref !== undefined) {
      const { code, out } = checkRef(gate, o);
      done(code, out);
    } else {
      const { code, out } = check(gate, o);
      done(code, out);
    }
  } catch (e) {
    done(2, { guarded: null, ok: false, scope: null, reason: String(e?.message || e).slice(0, 300) });
  }
}
