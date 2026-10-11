#!/usr/bin/env node
// A2A inbox hook for Claude Code. `drain` = UserPromptSubmit, `stop` = Stop.
// Messages from other agents are injected as context only; they never count as a GO.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const mode = process.argv[2];

function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

// Checkout layout (../../lib), else the machine-wide copy the installer keeps under ~/.agents/lib.
function libPath() {
  const here = fileURLToPath(new URL("../../lib/a2a-inbox.mjs", import.meta.url));
  return [here, join(homedir(), ".agents", "lib", "a2a-inbox.mjs")].find((p) => existsSync(p)) ?? null;
}

async function main() {
  const lib = libPath();
  if (!lib) {
    process.stderr.write("a2a-inbox: lib/a2a-inbox.mjs not found (checkout ../../lib or ~/.agents/lib); hook skipped.\n");
    return 0;
  }
  const input = readInput();
  const session =
    process.env.AOS_A2A_NAME || `claude-${String(input.session_id || "").slice(0, 8)}`;
  const { pending, claim, formatInjection, replyCommand, safeField } = await import(pathToFileURL(lib).href);
  if (mode === "stop" && input.stop_hook_active === true) return 0; // already nudged once: claim nothing
  const waiting = pending(session);
  if (!waiting.length) return 0;

  // claim every pending message and render it with its reply command (absolute path when aos-a2a is not on PATH,
  // always with --name <session>: a harness shell often has no AOS_A2A_NAME and a model would invent one)
  const texts = [];
  for (const m of waiting) {
    const msg = claim(m.file);
    if (!msg) continue;
    const taskId = safeField(msg.taskId);
    if (!taskId) continue;
    texts.push(`${formatInjection({ ...msg, from: safeField(msg.from) || "unknown" })}\nAnswer by running: ${replyCommand(taskId, undefined, undefined, session)}`);
  }
  if (!texts.length) return 0;

  if (mode === "drain") {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: texts.join("\n\n") },
      }) + "\n",
    );
    return 0;
  }

  // Stop: a message arrived while the turn was running. Hand it over once (it is claimed now) so the
  // turn continues and answers it; stop_hook_active prevents a second block for the same stop.
  if (mode === "stop" && input.stop_hook_active !== true) {
    process.stderr.write(`A2A message(s) arrived during this turn. Answer each one:\n\n${texts.join("\n\n")}\n`);
    return 2;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  () => process.exit(0),
);
