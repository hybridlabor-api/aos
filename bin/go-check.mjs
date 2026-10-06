#!/usr/bin/env node
// go-check: one fixed answer to "may this worker run this guarded command?" for callers that
// are not a harness hook (AO). Installed at ~/.aos/bin/go-check.mjs.
//
//   node go-check.mjs --session <Name> --command "<shell string>" [--consume]
//   node go-check.mjs --write-patterns <file>
//
// stdout: {"guarded":bool,"ok":bool,"scope":[...]|null,"reason":"..."}
// exit 0 allowed (not guarded, or a valid GO token; --consume uses it up), 1 guarded without a
// valid GO, 2 error (the caller must treat 2 as denied). Only `GO <Name>` tokens count: mode
// soft grants and mode off belong to the human session and are never read here. Nothing in
// this file writes a token; the tool is synchronous, offline and reads no stdin.

import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

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

export function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--session") o.session = argv[++i];
    else if (a === "--command") o.command = argv[++i];
    else if (a === "--write-patterns") o.writePatterns = argv[++i];
    else if (a === "--consume") o.consume = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

const done = (code, out) => process.stdout.write(JSON.stringify(out) + "\n", () => process.exit(code));

const invokedAs = (() => { try { return realpathSync(process.argv[1] || ""); } catch { return ""; } })();
if (invokedAs === fileURLToPath(import.meta.url)) {
  try {
    const o = parseArgs(process.argv.slice(2));
    const gate = await loadGate();
    if (o.writePatterns) {
      writeFileSync(o.writePatterns, JSON.stringify(patternsJson(gate), null, 2) + "\n");
      done(0, { ok: true, reason: `wrote ${o.writePatterns}` });
    } else {
      const { code, out } = check(gate, o);
      done(code, out);
    }
  } catch (e) {
    done(2, { guarded: null, ok: false, scope: null, reason: String(e?.message || e).slice(0, 300) });
  }
}
