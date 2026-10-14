#!/usr/bin/env node
// SessionStart hook: start the loopback A2A sidecar for this session (detached, fail-open).
//   node a2a-session.mjs                      -> Claude Code  (sidecar --mode live, drained by the a2a-inbox hook)
//   node a2a-session.mjs --harness codex      -> Codex        (sidecar --mode codex --thread <session_id>)
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {}

const argv = process.argv.slice(2);
const at = argv.indexOf("--harness");
const harness = at >= 0 && argv[at + 1] ? argv[at + 1] : "claude";

// repo checkout: <repo>/.claude/hooks -> ../../lib; installed copies find the lib under ~/.agents/lib
async function loadLib(file = "a2a-session.mjs") {
  const candidates = [new URL(`../../lib/${file}`, import.meta.url), pathToFileURL(join(homedir(), ".agents", "lib", file))];
  for (const c of candidates) {
    try { return await import(c); } catch { /* try the next location */ }
  }
  return null;
}

try {
  const lib = await loadLib();
  if (lib) {
    const sessionId = input.session_id || "";
    // process.ppid is the harness CLI that spawned this hook
    if (harness === "codex") lib.ensureSidecar({ harness, sessionId, parentPid: process.ppid, mode: "codex", thread: sessionId });
    else {
      const r = lib.ensureSidecar({ harness, sessionId, parentPid: process.ppid });
      // the bdb-aos plugin monitor has no session_id: it finds this session's inbox through a pid binding
      if (harness === "claude" && r?.name) (await loadLib("a2a-monitor.mjs"))?.bindSession(r.name);
    }
  }
} catch {}
process.exit(0);
