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
  const { pending, claim, formatInjection, safeField } = await import(pathToFileURL(lib).href);
  const waiting = pending(session);
  if (!waiting.length) return 0;

  if (mode === "drain") {
    const texts = [];
    for (const m of waiting) {
      const msg = claim(m.file);
      if (!msg) continue;
      const taskId = safeField(msg.taskId);
      if (!taskId) continue;
      texts.push(
        `${formatInjection({ ...msg, from: safeField(msg.from) || "unknown" })}\nAnswer by running: aos-a2a reply ${taskId} "<your answer>"`,
      );
    }
    if (texts.length) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: texts.join("\n\n"),
          },
        }) + "\n",
      );
    }
    return 0;
  }

  if (mode === "stop" && input.stop_hook_active !== true) {
    process.stderr.write(
      'Undelivered A2A message(s) waiting: answer them (aos-a2a reply <taskId> "<answer>").\n',
    );
    return 2;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  () => process.exit(0),
);
