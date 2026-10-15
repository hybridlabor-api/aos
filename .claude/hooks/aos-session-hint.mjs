#!/usr/bin/env node
// AOS SessionStart hint hook: injects a 3-line "daily tools" hint as
// additional context. Zero dependencies, never throws, always exit 0.
//   Input:  the harness SessionStart JSON on stdin (content is not used).
//   Output: {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}
//   Off switches: AOS_SESSION_HINT=off (human or installer kills it) and
//   AOS_DELEGATE_DEPTH>0 (delegated workers stay silent).
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

try {
  try {
    readFileSync(0, "utf8"); // consume stdin; unparseable input is still not an error
  } catch {}

  const depth = Number(process.env.AOS_DELEGATE_DEPTH || 0);
  if (process.env.AOS_SESSION_HINT === "off" || depth > 0) process.exit(0);

  const hints = [
    'plan-canvas is available for plan review — check the canvas with `aos-plan-canvas` and open a plan with `aos-plan-canvas open <file|plan-dir>`.',
    'agenttrail serves a live map of multi-agent builds when one is running.',
    'The automatic tool-routing rules (when to use plan-canvas, agenttrail, subagents, startcycle) live in the "Tool routing (automatic)" block of AGENTS.md.',
  ];

  // Update notification (cache only, <= 1s budget, fail-open, no network)
  try {
    const home = homedir();
    let notice = null;
    try {
      const { cachedUpdateNotice } = await import("../../lib/update-check.js");
      notice = cachedUpdateNotice({ home });
    } catch {
      const fallbackLib = join(home, ".agents", "lib", "update-check.js");
      if (existsSync(fallbackLib)) {
        const { cachedUpdateNotice } = await import(fallbackLib);
        notice = cachedUpdateNotice({ home });
      }
    if (notice) {
      hints.push(notice);
      // Dual-channel output: process.stderr prints directly to the user's terminal
      // without breaking hook runner JSON parsing on stdout, while additionalContext
      // provides update awareness to the assistant model prompt.
      process.stderr.write(`${notice}\n`);
    }
  } catch {}

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: hints.join("\n"),
      },
    }) + "\n",
  );
} catch {}
process.exit(0);
