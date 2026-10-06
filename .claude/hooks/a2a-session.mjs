#!/usr/bin/env node
// SessionStart hook: start the loopback A2A sidecar for this Claude session (detached, fail-open).
import { readFileSync } from "node:fs";

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {}

try {
  const { ensureSidecar } = await import(new URL("../../lib/a2a-session.mjs", import.meta.url));
  // process.ppid is the claude CLI that spawned this hook
  ensureSidecar({ harness: "claude", sessionId: input.session_id || "", parentPid: process.ppid });
} catch {}
process.exit(0);
